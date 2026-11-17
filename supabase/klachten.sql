-- ============================================================
-- KTP Interflex – Woningbeheer: KLACHTENREGISTER (SNF)
-- Klachten van omwonenden en bewoners per woning, met bevestiging en afhandeling.
-- Bedoeld als auditbestendig register voor SNF-controles (klachtenprocedure per 15-10-2026):
--   bevestigen binnen 2 werkdagen, afhandelen binnen 10 werkdagen.
--
-- Toegang:
--   - de tabel bevat contactgegevens van omwonenden. Daarom GEEN lees-policy voor anon/authenticated:
--     lezen gaat via klachten_lijst(token), schrijven via klacht_opslaan / klacht_status (token + rol).
--   - grants staan wel (vaste afspraak voor nieuwe tabellen); RLS zonder policy blokkeert direct lezen.
--   - statuswijzigingen komen in status_log (bron 'klacht') via de generieke log-trigger.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.klachten (
  id                 bigserial PRIMARY KEY,
  ontvangen_op       date NOT NULL DEFAULT current_date,
  woning_id          integer REFERENCES public.woningen(id),
  adres_vrij         text,                 -- als de klacht niet aan een woning in de app te koppelen is
  indiener_type      text NOT NULL CHECK (indiener_type IN ('omwonende','bewoner','gemeente','anders')),
  indiener_naam      text,
  indiener_contact   text,                 -- telefoon of e-mail
  kanaal             text NOT NULL CHECK (kanaal IN ('telefoon','e-mail','whatsapp','persoonlijk','brief','anders')),
  categorie          text NOT NULL CHECK (categorie IN ('geluid','afval','parkeren','gedrag','onderhoud','veiligheid','overig')),
  omschrijving       text NOT NULL,
  behandelaar_id     integer REFERENCES public.gebruikers(id),
  status             text NOT NULL DEFAULT 'nieuw' CHECK (status IN ('nieuw','in_behandeling','afgehandeld')),
  bevestigd_op       date,                 -- ontvangst bevestigd aan indiener
  afgehandeld_op     date,
  maatregel          text,                 -- wat is er gedaan
  terugkoppeling     text,                 -- wat is aan de indiener teruggekoppeld
  aangemaakt_door_id integer REFERENCES public.gebruikers(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (woning_id IS NOT NULL OR coalesce(trim(adres_vrij),'') <> ''),
  CHECK (status <> 'afgehandeld' OR (afgehandeld_op IS NOT NULL AND coalesce(trim(maatregel),'') <> '')),
  CHECK (bevestigd_op IS NULL OR bevestigd_op >= ontvangen_op),
  CHECK (afgehandeld_op IS NULL OR afgehandeld_op >= ontvangen_op)
);
CREATE INDEX IF NOT EXISTS klachten_datum ON public.klachten (ontvangen_op DESC);
CREATE INDEX IF NOT EXISTS klachten_woning ON public.klachten (woning_id);

DROP TRIGGER IF EXISTS klachten_touch ON public.klachten;
CREATE TRIGGER klachten_touch BEFORE UPDATE ON public.klachten
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS klachten_log ON public.klachten;
CREATE TRIGGER klachten_log AFTER INSERT OR UPDATE OF status ON public.klachten
  FOR EACH ROW EXECUTE FUNCTION public.log_statuswijziging('klacht');

ALTER TABLE public.klachten ENABLE ROW LEVEL SECURITY;   -- bewust geen policies (zie boven)
GRANT SELECT ON public.klachten TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.klachten TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.klachten_id_seq TO authenticated, service_role;

-- Werkdagen tussen twee datums (ma-vr, zonder feestdagen)
CREATE OR REPLACE FUNCTION public.werkdagen_tussen(p_van date, p_tot date)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  select case when p_tot is null or p_van is null then null
    else (select count(*)::int from generate_series(p_van + 1, p_tot, interval '1 day') d
          where extract(isodow from d) < 6) end
$$;

-- Lezen: iedereen die ingelogd is (sessietoken). Geeft ook termijnen terug voor de export.
CREATE OR REPLACE FUNCTION public.klachten_lijst(p_token uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers;
begin
  g := public._sessie_gebruiker(p_token);
  if g.id is null then return json_build_object('ok', false, 'fout', 'Sessie verlopen — log opnieuw in'); end if;
  return json_build_object('ok', true, 'klachten', coalesce((
    select json_agg(row_to_json(x) order by x.ontvangen_op desc, x.id desc) from (
      select k.*,
             public.werkdagen_tussen(k.ontvangen_op, k.bevestigd_op)   as werkdagen_bevestiging,
             public.werkdagen_tussen(k.ontvangen_op, k.afgehandeld_op) as werkdagen_afhandeling,
             public.werkdagen_tussen(k.ontvangen_op, current_date)     as werkdagen_open,
             (select naam from public.gebruikers where id = k.behandelaar_id)     as behandelaar_naam,
             (select naam from public.gebruikers where id = k.aangemaakt_door_id) as aangemaakt_door_naam
        from public.klachten k) x), '[]'::json));
end $$;

-- Registreren / wijzigen: iedereen die ingelogd is mag registreren; wijzigen backoffice, SNF-controleur of behandelaar
CREATE OR REPLACE FUNCTION public.klacht_opslaan(p_token uuid, p_id bigint, p_data jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers; v_id bigint; k public.klachten;
begin
  g := public._app_actor(p_token, null);
  if p_id is null then
    insert into public.klachten (ontvangen_op, woning_id, adres_vrij, indiener_type, indiener_naam, indiener_contact,
        kanaal, categorie, omschrijving, behandelaar_id, aangemaakt_door_id)
    values (coalesce(nullif(p_data->>'ontvangen_op','')::date, current_date), nullif(p_data->>'woning_id','')::int,
        nullif(p_data->>'adres_vrij',''), p_data->>'indiener_type', nullif(p_data->>'indiener_naam',''),
        nullif(p_data->>'indiener_contact',''), p_data->>'kanaal', p_data->>'categorie', p_data->>'omschrijving',
        nullif(p_data->>'behandelaar_id','')::int, g.id)
    returning id into v_id;
  else
    select * into k from public.klachten where id = p_id;
    if k.id is null then return json_build_object('ok', false, 'fout', 'Klacht niet gevonden'); end if;
    if not (g.rol = 'backoffice' or coalesce(g.snf_controleur,false) or g.id = k.behandelaar_id or g.id = k.aangemaakt_door_id) then
      return json_build_object('ok', false, 'fout', 'Geen rechten');
    end if;
    update public.klachten set
        ontvangen_op = coalesce(nullif(p_data->>'ontvangen_op','')::date, ontvangen_op),
        woning_id = nullif(p_data->>'woning_id','')::int, adres_vrij = nullif(p_data->>'adres_vrij',''),
        indiener_type = p_data->>'indiener_type', indiener_naam = nullif(p_data->>'indiener_naam',''),
        indiener_contact = nullif(p_data->>'indiener_contact',''), kanaal = p_data->>'kanaal',
        categorie = p_data->>'categorie', omschrijving = p_data->>'omschrijving',
        behandelaar_id = nullif(p_data->>'behandelaar_id','')::int
      where id = p_id returning id into v_id;
  end if;
  return json_build_object('ok', true, 'id', v_id);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

-- Voortgang: bevestigen, in behandeling, afhandelen (maatregel verplicht), heropenen (reden verplicht)
CREATE OR REPLACE FUNCTION public.klacht_status(p_token uuid, p_id bigint, p_actie text, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers; k public.klachten;
begin
  g := public._app_actor(p_token, null, p_actie, nullif(p_data->>'reden',''));
  select * into k from public.klachten where id = p_id;
  if k.id is null then return json_build_object('ok', false, 'fout', 'Klacht niet gevonden'); end if;
  if not (g.rol = 'backoffice' or coalesce(g.snf_controleur,false) or g.id = k.behandelaar_id) then
    return json_build_object('ok', false, 'fout', 'Geen rechten: alleen backoffice, SNF-controleur of de behandelaar');
  end if;
  if p_actie = 'bevestigd' then
    update public.klachten set bevestigd_op = coalesce(nullif(p_data->>'datum','')::date, current_date),
      status = case when status = 'nieuw' then 'in_behandeling' else status end where id = p_id;
  elsif p_actie = 'in_behandeling' then
    update public.klachten set status = 'in_behandeling', behandelaar_id = coalesce(behandelaar_id, g.id) where id = p_id;
  elsif p_actie = 'afgehandeld' then
    if coalesce(trim(p_data->>'maatregel'),'') = '' then return json_build_object('ok', false, 'fout', 'Vul in wat er gedaan is'); end if;
    update public.klachten set status = 'afgehandeld',
      afgehandeld_op = coalesce(nullif(p_data->>'datum','')::date, current_date),
      bevestigd_op = coalesce(bevestigd_op, nullif(p_data->>'datum','')::date, current_date),
      maatregel = p_data->>'maatregel', terugkoppeling = nullif(p_data->>'terugkoppeling',''),
      behandelaar_id = coalesce(behandelaar_id, g.id) where id = p_id;
  elsif p_actie = 'heropend' then
    if coalesce(trim(p_data->>'reden'),'') = '' then return json_build_object('ok', false, 'fout', 'Heropenen kan alleen met een reden'); end if;
    update public.klachten set status = 'in_behandeling', afgehandeld_op = null where id = p_id;
  else
    return json_build_object('ok', false, 'fout', 'Onbekende actie');
  end if;
  return json_build_object('ok', true, 'id', p_id);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

REVOKE ALL ON FUNCTION public.klachten_lijst(uuid), public.klacht_opslaan(uuid, bigint, jsonb),
  public.klacht_status(uuid, bigint, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.klachten_lijst(uuid), public.klacht_opslaan(uuid, bigint, jsonb),
  public.klacht_status(uuid, bigint, text, jsonb), public.werkdagen_tussen(date, date) TO anon, authenticated, service_role;
