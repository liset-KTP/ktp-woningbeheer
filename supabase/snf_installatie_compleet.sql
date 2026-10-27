-- ============================================================
-- SNF-INSPECTIES — COMPLEET INSTALLATIESCRIPT (eenmalig)
-- Supabase > SQL Editor > New query > alles plakken > Run
-- Bevat: 1) snf_inspecties.sql  2) login_melding.sql  3) snf_inspecties_seed.sql
-- Veilig om nogmaals te draaien (slaat over wat al bestaat).
-- Gegenereerd uit de losse bestanden in deze map — wijzig die, niet dit bestand.
-- ============================================================
BEGIN;

-- ============================================================
-- KTP Interflex – Woningbeheer: SNF-INSPECTIES
-- Herstelpunten uit SNF-inspecties (Normec VRO) per woning, met bewijs en controle door backoffice.
-- Kopie van de migratie in Supabase (snf_inspecties, 27-10-2026), zodat het opnieuw op te bouwen is.
--
-- Toegang (afwijkend van de rest van de app, bewust):
--   - lezen: anon/authenticated mogen SELECT (zelfde inlogmodel als de app: geen Supabase Auth)
--   - schrijven: GEEN policies voor anon/authenticated -> alleen via de snf_*-functies hieronder,
--     die het sessietoken controleren (_sessie_gebruiker) en de rol toetsen
--   - bestanden: privé bucket "snf-bewijs" zonder policies; uploaden/openen via Edge Function
--     snf-bestand (controleert token, geeft signed URL)
--   - vier-ogen, statusovergangen en logging zitten in triggers: gelden ook voor service_role
-- Statuslogica + status_log zijn generiek opgezet, zodat een klachtenmodule hetzelfde patroon kan gebruiken.
-- ============================================================

-- ─── 1. GENERIEK: status_log + log-trigger ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.status_log (
  id         bigserial PRIMARY KEY,
  bron       text NOT NULL,             -- bv. 'snf_herstelpunt', 'snf_inspectie' (later: 'klacht')
  bron_id    bigint NOT NULL,
  van        text,                      -- null = aangemaakt
  naar       text NOT NULL,
  actie      text,                      -- aangemaakt | hersteld | goedgekeurd | afgekeurd | heropend | automatisch
  reden      text,
  door_id    integer REFERENCES public.gebruikers(id),
  door_naam  text,                      -- naam op moment van actie (blijft leesbaar als gebruiker wijzigt)
  op         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS status_log_bron ON public.status_log (bron, bron_id, op);

-- Wie/waarom komt uit de transactie-instellingen die de app-functies zetten (_app_actor).
-- Aanroep: CREATE TRIGGER ... AFTER INSERT OR UPDATE OF status ... EXECUTE FUNCTION log_statuswijziging('<bron>')
CREATE OR REPLACE FUNCTION public.log_statuswijziging()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_door int := nullif(current_setting('app.gebruiker_id', true), '')::int;
begin
  if TG_OP = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  insert into public.status_log (bron, bron_id, van, naar, actie, reden, door_id, door_naam)
  values (TG_ARGV[0], new.id,
          case when TG_OP = 'UPDATE' then old.status end, new.status,
          coalesce(nullif(current_setting('app.actie', true), ''), case when TG_OP = 'INSERT' then 'aangemaakt' else 'automatisch' end),
          nullif(current_setting('app.reden', true), ''),
          v_door, (select naam from public.gebruikers where id = v_door));
  return new;
end $$;

-- Zet wie de actie doet (voor triggers/log) en controleer de rol. Geeft de gebruiker terug.
CREATE OR REPLACE FUNCTION public._app_actor(p_token uuid, p_rollen text[], p_actie text DEFAULT NULL, p_reden text DEFAULT NULL)
RETURNS public.gebruikers LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers;
begin
  g := public._sessie_gebruiker(p_token);
  if g.id is null then raise exception 'Sessie verlopen — log opnieuw in'; end if;
  if p_rollen is not null and not (g.rol = any(p_rollen)) then raise exception 'Geen rechten'; end if;
  perform set_config('app.gebruiker_id', g.id::text, true);
  perform set_config('app.actie', coalesce(p_actie, ''), true);
  perform set_config('app.reden', coalesce(p_reden, ''), true);
  return g;
end $$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$ begin new.updated_at := now(); return new; end $$;

-- ─── 2. TABELLEN ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.snf_inspecties (
  id                   bigserial PRIMARY KEY,
  woning_id            integer NOT NULL REFERENCES public.woningen(id),
  inspectiedatum       date NOT NULL,
  rapportnummer        text,
  inspectienummer      text,
  inspectie_instelling text NOT NULL DEFAULT 'Normec VRO B.V.',
  inspecteur           text,
  uitslag              text NOT NULL CHECK (uitslag IN ('voldoet','voldoet_niet')),
  vervolgactie         text CHECK (vervolgactie IN ('administratief','herinspectie')),
  deadline             date NOT NULL,        -- standaard inspectiedatum + 6 weken (trigger)
  interne_deadline     date NOT NULL,        -- standaard deadline - 14 dagen (trigger)
  rapport_pdf          text,                 -- pad in bucket snf-bewijs
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','afgerond')),
  afgerond_op          timestamptz,
  aangemaakt_door_id   integer REFERENCES public.gebruikers(id),
  opmerking            text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (interne_deadline <= deadline)
);
CREATE INDEX IF NOT EXISTS snf_inspecties_woning ON public.snf_inspecties (woning_id, inspectiedatum DESC);
CREATE UNIQUE INDEX IF NOT EXISTS snf_inspecties_rapport_uniek ON public.snf_inspecties (inspectie_instelling, rapportnummer) WHERE rapportnummer IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.snf_herstelpunten (
  id                      bigserial PRIMARY KEY,
  inspectie_id            bigint NOT NULL REFERENCES public.snf_inspecties(id),
  normnummer              text,
  categorie               text,
  omschrijving_inspecteur text NOT NULL,
  ernst                   text NOT NULL CHECK (ernst IN ('major','minor')),
  actie                   text,
  vereist_bewijs          text,
  eigenaar_id             integer REFERENCES public.gebruikers(id),
  -- open -> hersteld -> gecontroleerd; afkeuren = terug naar open met afkeur_reden (zie status_log)
  status                  text NOT NULL DEFAULT 'open' CHECK (status IN ('open','hersteld','gecontroleerd')),
  hersteld_door_id        integer REFERENCES public.gebruikers(id),
  hersteld_op             timestamptz,
  gecontroleerd_door_id   integer REFERENCES public.gebruikers(id),
  gecontroleerd_op        timestamptz,
  afkeur_reden            text,
  opmerking               text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'open' OR (hersteld_door_id IS NOT NULL AND hersteld_op IS NOT NULL)),
  CHECK (status <> 'gecontroleerd' OR (gecontroleerd_door_id IS NOT NULL AND gecontroleerd_op IS NOT NULL
                                      AND gecontroleerd_door_id <> hersteld_door_id))
);
CREATE INDEX IF NOT EXISTS snf_herstelpunten_inspectie ON public.snf_herstelpunten (inspectie_id);
CREATE INDEX IF NOT EXISTS snf_herstelpunten_open ON public.snf_herstelpunten (status) WHERE status <> 'gecontroleerd';

CREATE TABLE IF NOT EXISTS public.snf_bewijs (
  id                  bigserial PRIMARY KEY,
  herstelpunt_id      bigint NOT NULL REFERENCES public.snf_herstelpunten(id),
  bestand             text NOT NULL UNIQUE,   -- pad in bucket snf-bewijs
  bestandsnaam        text NOT NULL,
  mime_type           text,
  grootte             bigint,
  geupload_door_id    integer NOT NULL REFERENCES public.gebruikers(id),
  geupload_op         timestamptz NOT NULL DEFAULT now(),
  -- verkeerd bestand? niet verwijderen (audit), maar intrekken
  ingetrokken_door_id integer REFERENCES public.gebruikers(id),
  ingetrokken_op      timestamptz,
  ingetrokken_reden   text
);
CREATE INDEX IF NOT EXISTS snf_bewijs_punt ON public.snf_bewijs (herstelpunt_id);

-- ─── 3. REGELS (triggers) ─────────────────────────────────────────────────────
-- Deadlines standaard invullen
CREATE OR REPLACE FUNCTION public.snf_inspectie_defaults()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin
  if new.deadline is null then new.deadline := new.inspectiedatum + 42; end if;
  if new.interne_deadline is null then new.interne_deadline := new.deadline - 14; end if;
  return new;
end $$;

-- Statusovergangen + vier-ogenprincipe. Draait bij ELKE wijziging, ook door service_role.
CREATE OR REPLACE FUNCTION public.snf_herstelpunt_regels()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if TG_OP = 'INSERT' then
    if new.status <> 'open' then raise exception 'Nieuw herstelpunt moet status open hebben'; end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if old.status = 'open' and new.status = 'hersteld' then
      if not exists (select 1 from public.snf_bewijs b where b.herstelpunt_id = new.id and b.ingetrokken_op is null) then
        raise exception 'Upload eerst bewijs voordat je het punt op hersteld zet';
      end if;
      new.gecontroleerd_door_id := null; new.gecontroleerd_op := null;
    elsif old.status = 'hersteld' and new.status = 'gecontroleerd' then
      if new.gecontroleerd_door_id is null or new.gecontroleerd_door_id = old.hersteld_door_id then
        raise exception 'Vier-ogenprincipe: controleren mag alleen door iemand anders dan wie het punt hersteld heeft';
      end if;
      if new.hersteld_door_id is distinct from old.hersteld_door_id then
        raise exception 'hersteld_door mag niet gewijzigd worden bij controleren';
      end if;
    elsif old.status = 'hersteld' and new.status = 'open' then
      -- afkeuren: reden verplicht
      if coalesce(trim(new.afkeur_reden), '') = '' then raise exception 'Afkeuren kan alleen met een reden'; end if;
      new.hersteld_door_id := null; new.hersteld_op := null;
    elsif old.status = 'gecontroleerd' and new.status = 'open' then
      -- heropenen (bv. bij herinspectie toch niet goed): reden verplicht via app.reden
      if coalesce(trim(current_setting('app.reden', true)), '') = '' then raise exception 'Heropenen kan alleen met een reden'; end if;
      new.hersteld_door_id := null; new.hersteld_op := null;
      new.gecontroleerd_door_id := null; new.gecontroleerd_op := null;
    else
      raise exception 'Statuswijziging % -> % is niet toegestaan', old.status, new.status;
    end if;
  else
    -- zonder statuswijziging mogen de audit-velden niet veranderen
    if new.hersteld_door_id is distinct from old.hersteld_door_id or new.hersteld_op is distinct from old.hersteld_op
       or new.gecontroleerd_door_id is distinct from old.gecontroleerd_door_id or new.gecontroleerd_op is distinct from old.gecontroleerd_op then
      raise exception 'Audit-velden (hersteld/gecontroleerd door/op) wijzigen alleen via een statuswijziging';
    end if;
  end if;
  return new;
end $$;

-- Inspectie automatisch afgerond als alle punten gecontroleerd zijn (of: voldoet zonder punten)
CREATE OR REPLACE FUNCTION public.snf_inspectie_herbereken(p_inspectie_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_totaal int; v_open int; v_uitslag text; v_nieuw text;
begin
  select count(*), count(*) filter (where status <> 'gecontroleerd') into v_totaal, v_open
    from public.snf_herstelpunten where inspectie_id = p_inspectie_id;
  select uitslag into v_uitslag from public.snf_inspecties where id = p_inspectie_id;
  v_nieuw := case when (v_totaal = 0 and v_uitslag = 'voldoet') or (v_totaal > 0 and v_open = 0) then 'afgerond' else 'open' end;
  update public.snf_inspecties
     set status = v_nieuw, afgerond_op = case when v_nieuw = 'afgerond' then coalesce(afgerond_op, now()) end
   where id = p_inspectie_id and status is distinct from v_nieuw;
end $$;

CREATE OR REPLACE FUNCTION public.snf_trg_herbereken()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_actie text := current_setting('app.actie', true);
begin
  -- inspectie-statuswissel als gevolg van een punt: log als 'automatisch'
  perform set_config('app.actie', 'automatisch', true);
  if TG_TABLE_NAME = 'snf_inspecties' then
    perform public.snf_inspectie_herbereken(new.id);
  else
    perform public.snf_inspectie_herbereken(coalesce(new.inspectie_id, old.inspectie_id));
    if TG_OP = 'UPDATE' and new.inspectie_id is distinct from old.inspectie_id then
      perform public.snf_inspectie_herbereken(old.inspectie_id);
    end if;
  end if;
  perform set_config('app.actie', coalesce(v_actie, ''), true);
  return null;
end $$;

DROP TRIGGER IF EXISTS snf_inspecties_defaults ON public.snf_inspecties;
CREATE TRIGGER snf_inspecties_defaults BEFORE INSERT OR UPDATE ON public.snf_inspecties
  FOR EACH ROW EXECUTE FUNCTION public.snf_inspectie_defaults();
DROP TRIGGER IF EXISTS snf_inspecties_touch ON public.snf_inspecties;
CREATE TRIGGER snf_inspecties_touch BEFORE UPDATE ON public.snf_inspecties
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS snf_inspecties_log ON public.snf_inspecties;
CREATE TRIGGER snf_inspecties_log AFTER INSERT OR UPDATE OF status ON public.snf_inspecties
  FOR EACH ROW EXECUTE FUNCTION public.log_statuswijziging('snf_inspectie');
DROP TRIGGER IF EXISTS snf_inspecties_herbereken ON public.snf_inspecties;
CREATE TRIGGER snf_inspecties_herbereken AFTER INSERT OR UPDATE OF uitslag ON public.snf_inspecties
  FOR EACH ROW EXECUTE FUNCTION public.snf_trg_herbereken();

DROP TRIGGER IF EXISTS snf_herstelpunten_regels ON public.snf_herstelpunten;
CREATE TRIGGER snf_herstelpunten_regels BEFORE INSERT OR UPDATE ON public.snf_herstelpunten
  FOR EACH ROW EXECUTE FUNCTION public.snf_herstelpunt_regels();
DROP TRIGGER IF EXISTS snf_herstelpunten_touch ON public.snf_herstelpunten;
CREATE TRIGGER snf_herstelpunten_touch BEFORE UPDATE ON public.snf_herstelpunten
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS snf_herstelpunten_log ON public.snf_herstelpunten;
CREATE TRIGGER snf_herstelpunten_log AFTER INSERT OR UPDATE ON public.snf_herstelpunten
  FOR EACH ROW EXECUTE FUNCTION public.log_statuswijziging('snf_herstelpunt');
DROP TRIGGER IF EXISTS snf_herstelpunten_naberekening ON public.snf_herstelpunten;
CREATE TRIGGER snf_herstelpunten_naberekening AFTER INSERT OR DELETE OR UPDATE OF status, inspectie_id ON public.snf_herstelpunten
  FOR EACH ROW EXECUTE FUNCTION public.snf_trg_herbereken();

-- ─── 4. TOEGANG ───────────────────────────────────────────────────────────────
ALTER TABLE public.snf_inspecties    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snf_herstelpunten ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snf_bewijs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_log        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.snf_inspecties, public.snf_herstelpunten, public.snf_bewijs, public.status_log FROM anon, authenticated;
GRANT SELECT ON public.snf_inspecties, public.snf_herstelpunten, public.snf_bewijs, public.status_log TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.snf_inspecties, public.snf_herstelpunten, public.snf_bewijs, public.status_log TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.snf_inspecties_id_seq, public.snf_herstelpunten_id_seq, public.snf_bewijs_id_seq, public.status_log_id_seq TO authenticated, service_role;

-- Alleen lezen via policies; schrijven uitsluitend via de snf_*-functies (SECURITY DEFINER)
DROP POLICY IF EXISTS snf_inspecties_lezen ON public.snf_inspecties;
CREATE POLICY snf_inspecties_lezen ON public.snf_inspecties FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS snf_herstelpunten_lezen ON public.snf_herstelpunten;
CREATE POLICY snf_herstelpunten_lezen ON public.snf_herstelpunten FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS snf_bewijs_lezen ON public.snf_bewijs;
CREATE POLICY snf_bewijs_lezen ON public.snf_bewijs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS status_log_lezen ON public.status_log;
CREATE POLICY status_log_lezen ON public.status_log FOR SELECT TO anon, authenticated USING (true);

-- Privé bucket, geen policies voor anon/authenticated: alleen de Edge Function (service_role) komt erbij
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('snf-bewijs', 'snf-bewijs', false, 20971520)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ─── 5. APP-FUNCTIES (alle schrijfacties) ─────────────────────────────────────
-- Wie mag wat:
--   inspectie/herstelpunt aanmaken/wijzigen ............ backoffice
--   bewijs uploaden, "hersteld" zetten ................. eigenaar van het punt, huismeester, backoffice
--   goedkeuren/afkeuren/heropenen ...................... SNF-controleur (gebruikers.snf_controleur, bv. Liane)
--                                                        + backoffice als achtervang; nooit wie hersteld heeft
--   bestanden bekijken ................................. backoffice, huismeester, financieel, SNF-controleur
ALTER TABLE public.gebruikers ADD COLUMN IF NOT EXISTS snf_controleur boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public._snf_mag_herstellen(g public.gebruikers, p_punt public.snf_herstelpunten)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  select g.rol in ('backoffice','huismeester') or g.id = p_punt.eigenaar_id
$$;

CREATE OR REPLACE FUNCTION public._snf_mag_controleren(g public.gebruikers)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  select g.rol = 'backoffice' or coalesce(g.snf_controleur, false)
$$;

CREATE OR REPLACE FUNCTION public.snf_inspectie_opslaan(p_token uuid, p_id bigint, p_data jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers; v_id bigint;
begin
  g := public._app_actor(p_token, array['backoffice']);
  if p_id is null then
    insert into public.snf_inspecties (woning_id, inspectiedatum, rapportnummer, inspectienummer, inspectie_instelling,
        inspecteur, uitslag, vervolgactie, deadline, interne_deadline, opmerking, aangemaakt_door_id)
    values ((p_data->>'woning_id')::int, (p_data->>'inspectiedatum')::date, nullif(p_data->>'rapportnummer',''),
        nullif(p_data->>'inspectienummer',''), coalesce(nullif(p_data->>'inspectie_instelling',''), 'Normec VRO B.V.'),
        nullif(p_data->>'inspecteur',''), p_data->>'uitslag', nullif(p_data->>'vervolgactie',''),
        nullif(p_data->>'deadline','')::date, nullif(p_data->>'interne_deadline','')::date,
        nullif(p_data->>'opmerking',''), g.id)
    returning id into v_id;
  else
    update public.snf_inspecties set
        woning_id = (p_data->>'woning_id')::int, inspectiedatum = (p_data->>'inspectiedatum')::date,
        rapportnummer = nullif(p_data->>'rapportnummer',''), inspectienummer = nullif(p_data->>'inspectienummer',''),
        inspectie_instelling = coalesce(nullif(p_data->>'inspectie_instelling',''), 'Normec VRO B.V.'),
        inspecteur = nullif(p_data->>'inspecteur',''), uitslag = p_data->>'uitslag',
        vervolgactie = nullif(p_data->>'vervolgactie',''),
        deadline = nullif(p_data->>'deadline','')::date, interne_deadline = nullif(p_data->>'interne_deadline','')::date,
        opmerking = nullif(p_data->>'opmerking','')
      where id = p_id returning id into v_id;
    if v_id is null then return json_build_object('ok', false, 'fout', 'Inspectie niet gevonden'); end if;
  end if;
  return json_build_object('ok', true, 'id', v_id);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

-- Inhoud van een punt (geen status: die loopt via de functies hieronder)
CREATE OR REPLACE FUNCTION public.snf_herstelpunt_opslaan(p_token uuid, p_id bigint, p_data jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers; v_id bigint;
begin
  g := public._app_actor(p_token, array['backoffice']);
  if p_id is null then
    insert into public.snf_herstelpunten (inspectie_id, normnummer, categorie, omschrijving_inspecteur, ernst,
        actie, vereist_bewijs, eigenaar_id, opmerking)
    values ((p_data->>'inspectie_id')::bigint, nullif(p_data->>'normnummer',''), nullif(p_data->>'categorie',''),
        p_data->>'omschrijving_inspecteur', p_data->>'ernst', nullif(p_data->>'actie',''),
        nullif(p_data->>'vereist_bewijs',''), nullif(p_data->>'eigenaar_id','')::int, nullif(p_data->>'opmerking',''))
    returning id into v_id;
  else
    update public.snf_herstelpunten set
        normnummer = nullif(p_data->>'normnummer',''), categorie = nullif(p_data->>'categorie',''),
        omschrijving_inspecteur = p_data->>'omschrijving_inspecteur', ernst = p_data->>'ernst',
        actie = nullif(p_data->>'actie',''), vereist_bewijs = nullif(p_data->>'vereist_bewijs',''),
        eigenaar_id = nullif(p_data->>'eigenaar_id','')::int, opmerking = nullif(p_data->>'opmerking','')
      where id = p_id returning id into v_id;
    if v_id is null then return json_build_object('ok', false, 'fout', 'Herstelpunt niet gevonden'); end if;
  end if;
  return json_build_object('ok', true, 'id', v_id);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

CREATE OR REPLACE FUNCTION public.snf_herstelpunt_hersteld(p_token uuid, p_id bigint, p_opmerking text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers; p public.snf_herstelpunten;
begin
  g := public._app_actor(p_token, null, 'hersteld', p_opmerking);
  select * into p from public.snf_herstelpunten where id = p_id for update;
  if p.id is null then return json_build_object('ok', false, 'fout', 'Herstelpunt niet gevonden'); end if;
  if not public._snf_mag_herstellen(g, p) then return json_build_object('ok', false, 'fout', 'Geen rechten'); end if;
  update public.snf_herstelpunten
     set status = 'hersteld', hersteld_door_id = g.id, hersteld_op = now(),
         opmerking = coalesce(nullif(trim(p_opmerking), ''), opmerking)
   where id = p_id;
  return json_build_object('ok', true);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

-- p_goedgekeurd = true -> gecontroleerd; false -> terug naar open met reden
CREATE OR REPLACE FUNCTION public.snf_herstelpunt_controleren(p_token uuid, p_id bigint, p_goedgekeurd boolean, p_reden text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers;
begin
  g := public._app_actor(p_token, null, case when p_goedgekeurd then 'goedgekeurd' else 'afgekeurd' end, p_reden);
  if not public._snf_mag_controleren(g) then return json_build_object('ok', false, 'fout', 'Geen rechten'); end if;
  if p_goedgekeurd then
    update public.snf_herstelpunten set status = 'gecontroleerd', gecontroleerd_door_id = g.id, gecontroleerd_op = now(), afkeur_reden = null
     where id = p_id and status = 'hersteld';
  else
    update public.snf_herstelpunten set status = 'open', afkeur_reden = nullif(trim(p_reden), '')
     where id = p_id and status = 'hersteld';
  end if;
  if not found then return json_build_object('ok', false, 'fout', 'Punt staat niet op hersteld (al gecontroleerd of nog open?)'); end if;
  return json_build_object('ok', true);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

CREATE OR REPLACE FUNCTION public.snf_herstelpunt_heropenen(p_token uuid, p_id bigint, p_reden text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers;
begin
  g := public._app_actor(p_token, null, 'heropend', p_reden);
  if not public._snf_mag_controleren(g) then return json_build_object('ok', false, 'fout', 'Geen rechten'); end if;
  update public.snf_herstelpunten set status = 'open', afkeur_reden = nullif(trim(p_reden), '')
   where id = p_id and status = 'gecontroleerd';
  if not found then return json_build_object('ok', false, 'fout', 'Alleen een gecontroleerd punt kan heropend worden'); end if;
  return json_build_object('ok', true);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

-- Aangeroepen door Edge Function snf-bestand (service_role): rechten + pad bepalen vóór signed URL.
-- p_soort: 'bewijs' (p_id = herstelpunt) of 'rapport' (p_id = inspectie). p_actie: 'upload' | 'download'
CREATE OR REPLACE FUNCTION public.snf_bestand_toegang(p_token uuid, p_actie text, p_soort text, p_id bigint, p_bestandsnaam text DEFAULT NULL, p_pad text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers; p public.snf_herstelpunten; i public.snf_inspecties; v_ext text;
begin
  g := public._sessie_gebruiker(p_token);
  if g.id is null then return json_build_object('ok', false, 'fout', 'Sessie verlopen — log opnieuw in'); end if;
  v_ext := lower(coalesce(nullif(substring(p_bestandsnaam from '\.([A-Za-z0-9]{1,8})$'), ''), 'bin'));
  if p_actie = 'download' then
    if g.rol not in ('backoffice','huismeester','financieel') and not public._snf_mag_controleren(g) then return json_build_object('ok', false, 'fout', 'Geen rechten'); end if;
    if p_soort = 'bewijs' and exists (select 1 from public.snf_bewijs where bestand = p_pad)
       or p_soort = 'rapport' and exists (select 1 from public.snf_inspecties where rapport_pdf = p_pad) then
      return json_build_object('ok', true, 'pad', p_pad);
    end if;
    return json_build_object('ok', false, 'fout', 'Bestand niet gevonden');
  elsif p_actie = 'upload' and p_soort = 'bewijs' then
    select * into p from public.snf_herstelpunten where id = p_id;
    if p.id is null then return json_build_object('ok', false, 'fout', 'Herstelpunt niet gevonden'); end if;
    if not public._snf_mag_herstellen(g, p) then return json_build_object('ok', false, 'fout', 'Geen rechten'); end if;
    if p.status <> 'open' then return json_build_object('ok', false, 'fout', 'Bewijs toevoegen kan alleen bij een open punt'); end if;
    return json_build_object('ok', true, 'pad', format('bewijs/%s/%s/%s.%s', p.inspectie_id, p.id, gen_random_uuid(), v_ext));
  elsif p_actie = 'upload' and p_soort = 'rapport' then
    if g.rol <> 'backoffice' then return json_build_object('ok', false, 'fout', 'Geen rechten'); end if;
    select * into i from public.snf_inspecties where id = p_id;
    if i.id is null then return json_build_object('ok', false, 'fout', 'Inspectie niet gevonden'); end if;
    return json_build_object('ok', true, 'pad', format('rapport/%s/%s.%s', i.id, gen_random_uuid(), v_ext));
  end if;
  return json_build_object('ok', false, 'fout', 'Onbekende actie');
end $$;

-- Na upload: registreren. Controleert dat het bestand echt in de bucket staat en bij dit punt hoort.
CREATE OR REPLACE FUNCTION public.snf_bewijs_toevoegen(p_token uuid, p_herstelpunt_id bigint, p_pad text, p_bestandsnaam text, p_mime text DEFAULT NULL, p_grootte bigint DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers; p public.snf_herstelpunten; v_id bigint;
begin
  g := public._app_actor(p_token, null);
  select * into p from public.snf_herstelpunten where id = p_herstelpunt_id;
  if p.id is null then return json_build_object('ok', false, 'fout', 'Herstelpunt niet gevonden'); end if;
  if not public._snf_mag_herstellen(g, p) then return json_build_object('ok', false, 'fout', 'Geen rechten'); end if;
  if p.status <> 'open' then return json_build_object('ok', false, 'fout', 'Bewijs toevoegen kan alleen bij een open punt'); end if;
  if p_pad not like format('bewijs/%s/%s/%%', p.inspectie_id, p.id)
     or not exists (select 1 from storage.objects where bucket_id = 'snf-bewijs' and name = p_pad) then
    return json_build_object('ok', false, 'fout', 'Bestand niet gevonden in opslag — upload opnieuw');
  end if;
  insert into public.snf_bewijs (herstelpunt_id, bestand, bestandsnaam, mime_type, grootte, geupload_door_id)
  values (p.id, p_pad, coalesce(nullif(trim(p_bestandsnaam), ''), 'bestand'), p_mime, p_grootte, g.id)
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

CREATE OR REPLACE FUNCTION public.snf_bewijs_intrekken(p_token uuid, p_bewijs_id bigint, p_reden text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers; p public.snf_herstelpunten; b public.snf_bewijs;
begin
  g := public._app_actor(p_token, null);
  select * into b from public.snf_bewijs where id = p_bewijs_id;
  if b.id is null or b.ingetrokken_op is not null then return json_build_object('ok', false, 'fout', 'Bewijs niet gevonden'); end if;
  select * into p from public.snf_herstelpunten where id = b.herstelpunt_id;
  if not (g.rol = 'backoffice' or g.id = b.geupload_door_id) then return json_build_object('ok', false, 'fout', 'Geen rechten'); end if;
  if p.status <> 'open' then return json_build_object('ok', false, 'fout', 'Bewijs intrekken kan alleen bij een open punt'); end if;
  if coalesce(trim(p_reden), '') = '' then return json_build_object('ok', false, 'fout', 'Geef een reden'); end if;
  update public.snf_bewijs set ingetrokken_door_id = g.id, ingetrokken_op = now(), ingetrokken_reden = trim(p_reden) where id = b.id;
  return json_build_object('ok', true);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

CREATE OR REPLACE FUNCTION public.snf_rapport_koppelen(p_token uuid, p_inspectie_id bigint, p_pad text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers;
begin
  g := public._app_actor(p_token, array['backoffice']);
  if p_pad not like format('rapport/%s/%%', p_inspectie_id)
     or not exists (select 1 from storage.objects where bucket_id = 'snf-bewijs' and name = p_pad) then
    return json_build_object('ok', false, 'fout', 'Bestand niet gevonden in opslag — upload opnieuw');
  end if;
  update public.snf_inspecties set rapport_pdf = p_pad where id = p_inspectie_id;
  return json_build_object('ok', found);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

-- Hulpfuncties en triggerfuncties niet los aanroepbaar vanuit de app
REVOKE ALL ON FUNCTION public._app_actor(uuid, text[], text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._snf_mag_herstellen(public.gebruikers, public.snf_herstelpunten) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._snf_mag_controleren(public.gebruikers) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.snf_inspectie_herbereken(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_statuswijziging() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.snf_herstelpunt_regels() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.snf_trg_herbereken() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.snf_bestand_toegang(uuid, text, text, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snf_bestand_toegang(uuid, text, text, bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION
  public.snf_inspectie_opslaan(uuid, bigint, jsonb),
  public.snf_herstelpunt_opslaan(uuid, bigint, jsonb),
  public.snf_herstelpunt_hersteld(uuid, bigint, text),
  public.snf_herstelpunt_controleren(uuid, bigint, boolean, text),
  public.snf_herstelpunt_heropenen(uuid, bigint, text),
  public.snf_bewijs_toevoegen(uuid, bigint, text, text, text, bigint),
  public.snf_bewijs_intrekken(uuid, bigint, text),
  public.snf_rapport_koppelen(uuid, bigint, text)
TO anon, authenticated;

-- ============================================================
-- KTP Interflex – Woningbeheer: LOGIN-MELDING
-- Zet bij een gebruiker login_melden_aan = '<naam ontvanger>' en bij elke geslaagde login
-- krijgt die ontvanger een bericht (💬 Berichten). Leeg = geen melding.
-- Aanleiding (27-10-2026): Pinar is in de ziektewet, mag nog inloggen, Liset wil weten wanneer.
-- Uitzetten: UPDATE gebruikers SET login_melden_aan = NULL WHERE naam = 'Pinar';
-- ============================================================
ALTER TABLE public.gebruikers ADD COLUMN IF NOT EXISTS login_melden_aan text;

CREATE OR REPLACE FUNCTION public.trg_login_melding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers;
begin
  select * into g from public.gebruikers where id = new.gebruiker_id;
  if coalesce(trim(g.login_melden_aan), '') <> '' then
    insert into public.berichten (tekst, van, aan, onderwerp, koppeling_type, koppeling_label, gelezen_door)
    values (format('%s heeft ingelogd in de woningen-app op %s.', g.naam, to_char(now() at time zone 'Europe/Amsterdam', 'DD-MM-YYYY HH24:MI')),
            'Systeem', trim(g.login_melden_aan), format('🔔 Login: %s', g.naam), 'login', g.naam, '[]'::jsonb);
  end if;
  return new;
end $$;
REVOKE ALL ON FUNCTION public.trg_login_melding() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sessies_login_melding ON public.sessies;
CREATE TRIGGER sessies_login_melding AFTER INSERT ON public.sessies
  FOR EACH ROW EXECUTE FUNCTION public.trg_login_melding();

UPDATE public.gebruikers SET login_melden_aan = 'Liset' WHERE lower(trim(naam)) = 'pinar';

-- ============================================================
-- SNF-inspecties: eerste inspectie (Rietstraat 28, Almelo — Normec VRO, 27-10-2026)
-- Koppelt aan de bestaande woning; bestaat die niet, dan wordt er niets aangemaakt.
-- Veilig om opnieuw te draaien (slaat over als het rapport al bestaat).
-- ============================================================
-- SNF-controle ligt bij Liane (backoffice blijft achtervang). Liane krijgt dezelfde functie als Johan (financieel).
UPDATE public.gebruikers SET snf_controleur = true, rol = 'financieel' WHERE lower(trim(naam)) = 'liane' AND actief;

DO $$
declare v_woning int; v_johan int; v_insp bigint;
begin
  select id into v_woning from public.woningen
   where adres = 'Rietstraat 28' and replace(postcode, ' ', '') = '7601XR' and coalesce(gearchiveerd, false) = false;
  if v_woning is null then raise notice 'Woning Rietstraat 28, 7601 XR niet gevonden — niets aangemaakt'; return; end if;
  if exists (select 1 from public.snf_inspecties where rapportnummer = '2026052442') then
    raise notice 'Inspectie 2026052442 bestaat al — overgeslagen'; return;
  end if;
  select id into v_johan from public.gebruikers where lower(trim(naam)) = 'johan' and actief;
  if v_johan is null then raise notice 'Gebruiker Johan niet gevonden — punten zonder eigenaar'; end if;

  insert into public.snf_inspecties (woning_id, inspectiedatum, rapportnummer, inspectienummer, inspectie_instelling,
      inspecteur, uitslag, vervolgactie, deadline, interne_deadline)
  values (v_woning, '2026-10-27', '2026052442', '1103890', 'Normec VRO B.V.', 'Inge Smit',
      'voldoet_niet', 'administratief', '2026-12-08', '2026-11-24')
  returning id into v_insp;

  insert into public.snf_herstelpunten (inspectie_id, normnummer, categorie, ernst, omschrijving_inspecteur, actie, vereist_bewijs, eigenaar_id, opmerking)
  select v_insp, n, c, e, o, a, b, v_johan, 'Samen met Cristian (huismeester)' from (values
    ('6.3',  'Veiligheid',        'major', 'Lamp badkamer niet spatwaterdicht', 'Vervangen door spatwaterdichte armatuur (min. IP44)', 'Foto armatuur + factuur/typeplaatje'),
    ('6.5',  'Veiligheid',        'major', 'CV-keuring niet herleidbaar: nr. 22855 / R.O.B niet vindbaar in CO-keurregister. Datum onderhoud CV 26-02-2025', 'Keuring door CO-gecertificeerd bedrijf', 'Keuringsrapport met certificaatnummer'),
    ('7.1',  'Brandveiligheid',   'major', 'Blusser zonder statief op de grond, sticker eerstvolgende keuring ontbreekt (productiedatum juli 2025)', 'Ophangen/statief + keuring', 'Foto + keuringsbewijs'),
    ('7.3',  'Brandveiligheid',   'major', 'CO-melder ontbreekt', 'CO-melder plaatsen bij CV', 'Foto'),
    ('10.1', 'Informatie',        'major', 'Informatiekaart ontbreekt', 'SNF-informatiekaart centraal ophangen', 'Foto + kaart'),
    ('6.4',  'Veiligheid',        'minor', 'Glas kapot in deur naar woonkamer', 'Glas vervangen', 'Foto')
  ) as t(n, c, e, o, a, b);
  raise notice 'Inspectie % aangemaakt met 6 herstelpunten', v_insp;
end $$;


COMMIT;

-- Controle (moet tonen: 1 inspectie, 6 punten, Liane financieel + controleur, Pinar -> Liset)
SELECT (SELECT count(*) FROM public.snf_inspecties) AS inspecties,
       (SELECT count(*) FROM public.snf_herstelpunten) AS herstelpunten,
       (SELECT rol || ' / controleur=' || snf_controleur FROM public.gebruikers WHERE lower(trim(naam)) = 'liane') AS liane,
       (SELECT login_melden_aan FROM public.gebruikers WHERE lower(trim(naam)) = 'pinar') AS pinar_melding_aan,
       (SELECT public FROM storage.buckets WHERE id = 'snf-bewijs') AS bucket_publiek;
