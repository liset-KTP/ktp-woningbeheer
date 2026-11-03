-- ============================================================
-- KTP Interflex – Woningbeheer: SNF-CONTROLES & KEURINGEN (02-11-2026)
-- Kopie van de migratie in Supabase (snf_controles_keuringen), zodat het opnieuw op te bouwen is.
--
-- 1. checklist_items.snf_norm: gevuld = verplicht volgens SNF-norm v13.0 (per 1-10-2026).
--    Deze items staan bovenaan in de checklist van de huismeester, met normnummer.
-- 2. Kwartaalchecklist = SNF-logboek (norm 3A.1: min. 4x per jaar, met datum, controleur,
--    bevinding, oplossing, wie het oploste). Afwijkingen staan in checklists.items_opmerkingen
--    (type kwartaal) als { "<item_id>": { bevinding, gemeld_door, gemeld_op, oplossing, opgelost_door, opgelost_op } }.
-- 3. snf_keuringen: wettelijke/periodieke keuringen per woning (brandblusser 2 jr, CV/geiser 2 jr, ...)
--    met vervaldatum. Lezen: iedereen in de app. Schrijven: alleen via snf_keuring_*-functies (sessietoken).
-- ============================================================

-- ─── 1. Verplichte checklist-items markeren ─────────────────────────────────
ALTER TABLE public.checklist_items ADD COLUMN IF NOT EXISTS snf_norm text;

UPDATE public.checklist_items SET snf_norm = v.norm FROM (VALUES
  (9,'7.4'), (10,'7.3'), (11,'6.4'),               -- 4-wekelijks: rookmelders, CO-melders, nooduitgangen
  (22,'6.4'), (74,'7.1'), (23,'6.1'),              -- kwartaal: vluchtwegen, blussers, elektra
  (27,'8.1'), (75,'8.1'), (76,'8.1')               -- kwartaal: buitenruimte, dak, kozijnen/deuren
) AS v(id, norm) WHERE checklist_items.id = v.id AND checklist_items.snf_norm IS NULL;

INSERT INTO public.checklist_items (type, tekst, tekst_en, tekst_ro, tekst_pl, volgorde, actief, snf_norm)
SELECT n.type, n.tekst, n.en, n.ro, n.pl, n.volgorde, true, n.norm FROM (VALUES
  ('4wekelijks','Blusdeken hangt bij elke kookplaats',
    'Fire blanket hangs next to every cooker','Pătura antiincendiu este lângă fiecare aragaz','Koc gaśniczy wisi przy każdej kuchence', 17, '7.2'),
  ('4wekelijks','Brandblusser hangt aan de beugel, binnen 5 meter van de kookplaats, niet gebruikt',
    'Fire extinguisher on its bracket, within 5 metres of the cooker, unused','Stingătorul este pe suport, la max. 5 metri de aragaz, nefolosit','Gaśnica wisi na uchwycie, do 5 metrów od kuchenki, nieużywana', 18, '7.1'),
  ('4wekelijks','SNF-informatiekaart hangt centraal en is leesbaar (24/7-nummer, 112, huisregels, noodprocedure)',
    'SNF information card is posted centrally and readable (24/7 number, 112, house rules, emergency procedure)','Fișa de informare SNF este afișată central și lizibilă (număr 24/7, 112, regulament, procedură de urgență)','Karta informacyjna SNF wisi w widocznym miejscu i jest czytelna (numer 24/7, 112, regulamin, procedura awaryjna)', 19, '10.1'),
  ('kwartaal','Aantal bewoners klopt met de bewonerslijst, geen afgesloten kamers',
    'Number of residents matches the resident list, no locked rooms','Numărul de locatari corespunde listei, nicio cameră încuiată','Liczba mieszkańców zgadza się z listą, brak zamkniętych pokoi', 16, '1.1'),
  ('kwartaal','Per bewoner: bed, stoel, afsluitbare kast en eigen stopcontact',
    'Per resident: bed, chair, lockable wardrobe and own power socket','Pentru fiecare locatar: pat, scaun, dulap cu cheie și priză proprie','Na mieszkańca: łóżko, krzesło, zamykana szafa i własne gniazdko', 17, '2.4'),
  ('kwartaal','Geen verlengsnoeren of dubbelstekkers, geen losse kachels',
    'No extension cords or double adapters, no portable heaters','Fără prelungitoare sau prize duble, fără radiatoare mobile','Brak przedłużaczy i rozgałęźników, brak przenośnych grzejników', 18, '6.1'),
  ('kwartaal','Geen schimmel in badkamer, keuken of andere ruimtes',
    'No mould in bathroom, kitchen or other rooms','Fără mucegai în baie, bucătărie sau alte încăperi','Brak pleśni w łazience, kuchni i innych pomieszczeniach', 19, '4.3'),
  ('kwartaal','Geen kapotte ramen of glas',
    'No broken windows or glass','Fără geamuri sau sticlă spartă','Brak wybitych okien lub szyb', 20, '6.4'),
  ('kwartaal','Goten en regenpijpen in orde',
    'Gutters and drainpipes in good order','Jgheaburile și burlanele sunt în ordine','Rynny i rury spustowe w porządku', 21, '8.1'),
  ('kwartaal','Tuin/groen en afval rondom de woning in orde',
    'Garden/greenery and waste around the house in order','Grădina/spațiul verde și gunoiul din jurul casei sunt în ordine','Ogród/zieleń i odpady wokół domu w porządku', 22, '8.1'),
  ('kwartaal','Sticker CV-ketel/geiser: keuring niet ouder dan 2 jaar',
    'Sticker on boiler/water heater: inspection not older than 2 years','Eticheta centralei/boilerului: verificare nu mai veche de 2 ani','Naklejka na kotle/podgrzewaczu: przegląd nie starszy niż 2 lata', 23, '6.5')
) AS n(type, tekst, en, ro, pl, volgorde, norm)
WHERE NOT EXISTS (SELECT 1 FROM public.checklist_items c WHERE c.type = n.type AND c.tekst = n.tekst);

-- ─── 2. Keuringen per woning ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.snf_keuringen (
  id               bigserial PRIMARY KEY,
  woning_id        integer NOT NULL REFERENCES public.woningen(id),
  soort            text NOT NULL CHECK (soort IN ('brandblusser','cv_geiser','brandmeldinstallatie','overig')),
  omschrijving     text,
  laatste_datum    date,
  interval_maanden integer NOT NULL DEFAULT 24 CHECK (interval_maanden BETWEEN 1 AND 120),
  volgende_datum   date GENERATED ALWAYS AS ((laatste_datum + make_interval(months => interval_maanden))::date) STORED,
  vervangen_uiterlijk date,          -- brandblusser: schuim 5 jr, poeder/CO2 10 jr na productie
  nvt              boolean NOT NULL DEFAULT false,   -- bv. geen gastoestel in de woning
  bedrijf          text,
  opmerking        text,
  bijgewerkt_door_id integer REFERENCES public.gebruikers(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS snf_keuringen_woning_idx ON public.snf_keuringen (woning_id);

DROP TRIGGER IF EXISTS snf_keuringen_touch ON public.snf_keuringen;
CREATE TRIGGER snf_keuringen_touch BEFORE UPDATE ON public.snf_keuringen
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.snf_keuringen ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.snf_keuringen TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.snf_keuringen TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.snf_keuringen_id_seq TO authenticated, service_role;
DROP POLICY IF EXISTS snf_keuringen_lezen ON public.snf_keuringen;
CREATE POLICY snf_keuringen_lezen ON public.snf_keuringen FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.snf_keuring_opslaan(p_token uuid, p_id bigint, p_data jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers; v_id bigint;
begin
  g := public._app_actor(p_token, array['backoffice','huismeester']);
  if p_id is null then
    insert into public.snf_keuringen (woning_id, soort, omschrijving, laatste_datum, interval_maanden,
        vervangen_uiterlijk, nvt, bedrijf, opmerking, bijgewerkt_door_id)
    values ((p_data->>'woning_id')::int, p_data->>'soort', nullif(p_data->>'omschrijving',''),
        nullif(p_data->>'laatste_datum','')::date, coalesce(nullif(p_data->>'interval_maanden','')::int, 24),
        nullif(p_data->>'vervangen_uiterlijk','')::date, coalesce((p_data->>'nvt')::boolean, false),
        nullif(p_data->>'bedrijf',''), nullif(p_data->>'opmerking',''), g.id)
    returning id into v_id;
  else
    update public.snf_keuringen set
        woning_id = (p_data->>'woning_id')::int, soort = p_data->>'soort', omschrijving = nullif(p_data->>'omschrijving',''),
        laatste_datum = nullif(p_data->>'laatste_datum','')::date,
        interval_maanden = coalesce(nullif(p_data->>'interval_maanden','')::int, 24),
        vervangen_uiterlijk = nullif(p_data->>'vervangen_uiterlijk','')::date,
        nvt = coalesce((p_data->>'nvt')::boolean, false),
        bedrijf = nullif(p_data->>'bedrijf',''), opmerking = nullif(p_data->>'opmerking',''), bijgewerkt_door_id = g.id
      where id = p_id returning id into v_id;
    if v_id is null then return json_build_object('ok', false, 'fout', 'Keuring niet gevonden'); end if;
  end if;
  return json_build_object('ok', true, 'id', v_id);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

CREATE OR REPLACE FUNCTION public.snf_keuring_verwijderen(p_token uuid, p_id bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare g public.gebruikers;
begin
  g := public._app_actor(p_token, array['backoffice']);
  delete from public.snf_keuringen where id = p_id;
  return json_build_object('ok', true);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

REVOKE ALL ON FUNCTION public.snf_keuring_opslaan(uuid, bigint, jsonb), public.snf_keuring_verwijderen(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snf_keuring_opslaan(uuid, bigint, jsonb), public.snf_keuring_verwijderen(uuid, bigint)
  TO anon, authenticated, service_role;
