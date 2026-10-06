-- ============================================================
-- KTP Interflex – Woningbeheer: HUURCONTRACTEN
-- Tabel huurovereenkomsten + sync-functie voor de pagina "📄 Huurcontracten".
-- Dit is een kopie van wat in Supabase staat (stand 06-10-2026, einddatumregel bijgewerkt), zodat het
-- opnieuw op te bouwen is. Voer uit in Supabase > SQL Editor > New Query.
-- ============================================================

-- 1. TABEL
CREATE TABLE IF NOT EXISTS huurovereenkomsten (
  id                   bigserial PRIMARY KEY,
  naam_medewerker      text NOT NULL,
  -- genormaliseerde naam (kleine letters, enkele spaties): koppeling met kamerbezetting/meldingen
  naam_sleutel         text GENERATED ALWAYS AS (lower(regexp_replace(trim(naam_medewerker), '\s+', ' ', 'g'))) STORED,
  woning_id            integer REFERENCES woningen(id),
  kamer                text,
  soort                text NOT NULL DEFAULT 'aankomst' CHECK (soort IN ('aankomst','verhuizing','bestaand')),
  melding_id           integer,
  begindatum           date,
  eerste_aankomst      date,            -- basis voor einde huur (26 weken), blijft gelijk bij verhuizing
  einddatum            date,
  einddatum_handmatig  boolean NOT NULL DEFAULT false,
  uit_dienst_datum     date,
  werkgever            text CHECK (werkgever IN ('KTP','FP')),
  huurprijs            numeric,
  borg                 numeric,
  taal                 text CHECK (taal IN ('NL','EN','PL','RO')),
  status               text NOT NULL DEFAULT 'te_maken' CHECK (status IN ('te_maken','verstuurd','getekend')),
  verstuurd_op         date,
  verstuurd_door       text,
  getekend_op          date,
  getekend_door        text,
  in_cockpit           boolean NOT NULL DEFAULT false,
  in_onedrive          boolean NOT NULL DEFAULT false,
  einde_brief_op       date,
  einde_brief_door     text,
  actief               boolean NOT NULL DEFAULT true,
  afgesloten_reden     text CHECK (afgesloten_reden IN ('verhuisd','vertrokken','handmatig')),
  afgesloten_op        date,
  vorige_id            bigint REFERENCES huurovereenkomsten(id),
  opmerking            text,
  aangemaakt_op        timestamptz NOT NULL DEFAULT now(),
  bijgewerkt_op        timestamptz NOT NULL DEFAULT now(),
  bijgewerkt_door      text
);

-- Per persoon maximaal één actieve regel
CREATE UNIQUE INDEX IF NOT EXISTS huurovereenkomsten_een_actief_per_persoon ON huurovereenkomsten (naam_sleutel) WHERE actief;
CREATE INDEX IF NOT EXISTS huurovereenkomsten_woning ON huurovereenkomsten (woning_id);

-- 2. bijgewerkt_op automatisch bijwerken (de app gebruikt dit om het formulier te verversen)
CREATE OR REPLACE FUNCTION huurovereenkomsten_touch()
RETURNS trigger LANGUAGE plpgsql AS $$ begin new.bijgewerkt_op := now(); return new; end $$;

DROP TRIGGER IF EXISTS huurovereenkomsten_touch ON huurovereenkomsten;
CREATE TRIGGER huurovereenkomsten_touch BEFORE UPDATE ON huurovereenkomsten
  FOR EACH ROW EXECUTE FUNCTION huurovereenkomsten_touch();

-- 3. TOEGANG: zelfde model als de rest van de app (inloggen gebeurt in de app zelf, niet via Supabase Auth)
ALTER TABLE huurovereenkomsten ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_huurovereenkomsten ON huurovereenkomsten;
CREATE POLICY allow_all_huurovereenkomsten ON huurovereenkomsten FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 4. SYNC: legt de kamerbezetting (woningen.kamers) naast de contracten.
--    Draait bij openen van de pagina Huurcontracten (supabase.rpc('huurovereenkomsten_sync')).
--    - bewoner niet meer in een kamer   -> regel afgesloten (vertrokken), datum = laatste vertrekmelding
--    - bewoner in andere woning/kamer    -> oude regel afgesloten (verhuisd), nieuwe regel 'verhuizing'
--                                           met dezelfde eerste aankomst/einddatum/huurprijs/borg/taal
--    - nieuwe bewoner                    -> regel 'te_maken', voorgevuld uit aankomst-/verhuismelding en borgplan
--    Einddatum = eerste aankomst + 6 maanden - 1 dag (afspraak KTP), maar nooit later dan
--    26 weken incl. begindatum (+181 dagen) = maximum volgens het contract. Zelfde regel in de app (berekenEinde).
CREATE OR REPLACE FUNCTION public.huurovereenkomsten_sync()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n_nieuw int := 0; n_verhuisd int := 0; n_vertrokken int := 0;
  r record; oud record;
  v_aankomst date; v_aankomst_id int; v_verh date; v_verh_id int;
  v_borg numeric; v_borg_datum date; v_begin date; v_eerste date; v_soort text; v_melding int;
begin
  drop table if exists _bew; create temp table _bew on commit drop as
  select distinct on (sleutel) * from (
    select trim(k->>'naam') as naam,
           lower(regexp_replace(trim(k->>'naam'), '\s+', ' ', 'g')) as sleutel,
           w.id as woning_id, k->>'k' as kamer,
           upper(coalesce(k->>'nationaliteit','')) as nat,
           nullif(k->>'aankomstDatum','') as kamer_aankomst
    from woningen w, jsonb_array_elements(w.kamers) k
    where not coalesce(w.gearchiveerd,false)
      and coalesce(trim(k->>'naam'),'') <> ''
      and coalesce(k->>'status','') not in ('Gereserveerd','Controle','Beschikbaar','Niet beschikbaar')
  ) x order by sleutel, woning_id;

  -- 1. vertrokken
  for oud in select h.* from huurovereenkomsten h
             where h.actief and not exists (select 1 from _bew b where b.sleutel = h.naam_sleutel) loop
    update huurovereenkomsten set actief = false, afgesloten_reden = 'vertrokken',
      afgesloten_op = coalesce((select max(m.datum) from meldingen m
                                 where m.type = 'vertrek'
                                   and lower(regexp_replace(trim(m.medewerker), '\s+', ' ', 'g')) = oud.naam_sleutel
                                   and m.datum >= coalesce(oud.begindatum, '1900-01-01')), current_date),
      bijgewerkt_door = 'sync'
    where id = oud.id;
    n_vertrokken := n_vertrokken + 1;
  end loop;

  -- 2. verhuisd (zelfde persoon, andere woning of kamer)
  for r in select b.*, h.id as oud_id from _bew b join huurovereenkomsten h
             on h.actief and h.naam_sleutel = b.sleutel
            where h.woning_id is distinct from b.woning_id or coalesce(h.kamer,'') <> coalesce(b.kamer,'') loop
    select * into oud from huurovereenkomsten where id = r.oud_id;
    select m.datum, m.id into v_verh, v_verh_id from meldingen m
      where m.type = 'verhuizing' and m.woning_id = r.woning_id
        and lower(regexp_replace(trim(m.medewerker), '\s+', ' ', 'g')) = r.sleutel
      order by m.datum desc nulls last, m.id desc limit 1;
    update huurovereenkomsten set actief = false, afgesloten_reden = 'verhuisd',
      afgesloten_op = coalesce(v_verh, current_date), bijgewerkt_door = 'sync' where id = oud.id;
    insert into huurovereenkomsten (naam_medewerker, woning_id, kamer, soort, melding_id, begindatum,
        eerste_aankomst, einddatum, einddatum_handmatig, uit_dienst_datum, werkgever, huurprijs, borg, taal, vorige_id, bijgewerkt_door)
    values (r.naam, r.woning_id, r.kamer, 'verhuizing', v_verh_id, v_verh,
        oud.eerste_aankomst, oud.einddatum, oud.einddatum_handmatig, oud.uit_dienst_datum,
        oud.werkgever, oud.huurprijs, oud.borg, oud.taal, oud.id, 'sync');
    n_verhuisd := n_verhuisd + 1;
  end loop;

  -- 3. nieuw
  for r in select b.* from _bew b
            where not exists (select 1 from huurovereenkomsten h where h.actief and h.naam_sleutel = b.sleutel) loop
    v_aankomst := null; v_aankomst_id := null; v_verh := null; v_verh_id := null; v_borg := null; v_borg_datum := null;
    select m.datum, m.id into v_aankomst, v_aankomst_id from meldingen m
      where m.type = 'aankomst' and lower(regexp_replace(trim(m.medewerker), '\s+', ' ', 'g')) = r.sleutel
      order by m.datum desc nulls last, m.id desc limit 1;
    select m.datum, m.id into v_verh, v_verh_id from meldingen m
      where m.type = 'verhuizing' and m.woning_id = r.woning_id
        and lower(regexp_replace(trim(m.medewerker), '\s+', ' ', 'g')) = r.sleutel
      order by m.datum desc nulls last, m.id desc limit 1;
    select p.totaal_borg, case when to_char(p.aankomst_datum,'MM-DD') <> '01-01' then p.aankomst_datum end into v_borg, v_borg_datum from borg_plannen p
      where lower(regexp_replace(trim(p.naam_medewerker), '\s+', ' ', 'g')) = r.sleutel
        and coalesce(p.status,'') <> 'vervallen'
      order by p.created_at desc limit 1;

    if v_verh is not null and (v_aankomst is null or v_verh > v_aankomst) then
      v_soort := 'verhuizing'; v_begin := v_verh; v_melding := v_verh_id;
      v_eerste := coalesce(v_aankomst, v_borg_datum);
    elsif v_aankomst is not null then
      v_soort := 'aankomst'; v_begin := v_aankomst; v_eerste := v_aankomst; v_melding := v_aankomst_id;
    else
      v_soort := 'bestaand'; v_melding := null;
      v_begin := coalesce(case when r.kamer_aankomst ~ '^\d{4}-\d{2}-\d{2}$' then r.kamer_aankomst::date end, v_borg_datum);
      v_eerste := v_begin;
    end if;

    insert into huurovereenkomsten (naam_medewerker, woning_id, kamer, soort, melding_id, begindatum,
        eerste_aankomst, einddatum, borg, taal, bijgewerkt_door)
    values (r.naam, r.woning_id, r.kamer, v_soort, v_melding, v_begin, v_eerste,
        least((v_eerste + interval '6 months')::date - 1, v_eerste + 181),
        v_borg, case when r.nat in ('PL','RO') then r.nat end, 'sync');
    n_nieuw := n_nieuw + 1;
  end loop;

  return json_build_object('nieuw', n_nieuw, 'verhuisd', n_verhuisd, 'vertrokken', n_vertrokken);
end $function$;
