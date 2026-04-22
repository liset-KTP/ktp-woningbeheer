-- ============================================================
-- KTP Interflex – Woningbeheer
-- Voer dit script uit in Supabase > SQL Editor > New Query
-- ============================================================

-- 1. TABEL: woningen (met kamers als JSON kolom)
CREATE TABLE IF NOT EXISTS woningen (
  id          SERIAL PRIMARY KEY,
  stad        TEXT NOT NULL,
  adres       TEXT NOT NULL,
  postcode    TEXT,
  kamers      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABEL: meldingen
CREATE TABLE IF NOT EXISTS meldingen (
  id               SERIAL PRIMARY KEY,
  type             TEXT NOT NULL,        -- aankomst | vertrek | reservering | overig
  medewerker       TEXT NOT NULL,
  datum            DATE,
  woning_id        INTEGER REFERENCES woningen(id),
  kamer            TEXT,
  wie_regelt       TEXT,
  sleutel_terug    TEXT,                 -- ja | nee | null
  kamer_schoon     TEXT,                 -- ja | nee | null
  sleutel_aantal   INTEGER,
  opmerkingen      TEXT,
  ingediend_door   TEXT NOT NULL,
  status           TEXT DEFAULT 'open',  -- open | afgehandeld | in_behandeling | verwerkt
  afgehandeld_door TEXT,
  afgehandeld_op   TIMESTAMPTZ,
  notitie          TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 3. REALTIME aanzetten voor beide tabellen
ALTER TABLE woningen  REPLICA IDENTITY FULL;
ALTER TABLE meldingen REPLICA IDENTITY FULL;

-- 4. ROW LEVEL SECURITY uitschakelen (iedereen met de link mag lezen/schrijven)
--    Wil je dit later beveiligen? Dan kun je RLS policies toevoegen.
ALTER TABLE woningen  DISABLE ROW LEVEL SECURITY;
ALTER TABLE meldingen DISABLE ROW LEVEL SECURITY;

-- 5. BEGINDATA: alle woningen invoegen
INSERT INTO woningen (id, stad, adres, postcode, kamers) VALUES
(1,  'Almelo',    'Celebestraat 1',        '7606 XC', '[{"k":"1","naam":"Pawel Bartosiak","status":"Lopend","bedrijf":"Pacton"},{"k":"2","naam":"Dariusz Baldyga","status":"Lopend","bedrijf":"Tasche"},{"k":"3","naam":"Andrzej Graczyk","status":"Lopend","bedrijf":"LOA"},{"k":"3.1","naam":"","status":"Beschikbaar","bedrijf":""},{"k":"4","naam":"Patryk Kucharski","status":"Lopend","bedrijf":"Priema Cetra"}]'),
(2,  'Almelo',    'Grotestraat 4',          '7607 CM', '[{"k":"1","naam":"Slawomir Bielak","status":"Lopend","bedrijf":"Falco"},{"k":"2","naam":"Eryk Szalkowski","status":"Controle","bedrijf":""}]'),
(3,  'Almelo',    'Hoornbladstraat 26',     '7605 EG', '[{"k":"1","naam":"Piotr Jakubowski","status":"Lopend","bedrijf":"Triferto Goor"},{"k":"2","naam":"Daniel Sugier","status":"Lopend","bedrijf":"Falco"},{"k":"3","naam":"Jakub Gemza","status":"Lopend","bedrijf":"Potijk"},{"k":"4","naam":"Dawid Wojdat","status":"Lopend","bedrijf":"Tasche"}]'),
(4,  'Almelo',    'Rohofstraat 65',         '7605 AT', '[{"k":"1","naam":"Viorel Stingaciu","status":"Lopend","bedrijf":"Pecocar"},{"k":"2","naam":"Alexandra Stingaciu","status":"Moet aan het werk","bedrijf":""},{"k":"3","naam":"Daniel Pascariu","status":"Lopend","bedrijf":"Pecocar"}]'),
(5,  'Almelo',    'Rietstraat 28',          '7601 XR', '[{"k":"1","naam":"","status":"Beschikbaar","bedrijf":""},{"k":"2","naam":"Daniel Rosca","status":"Lopend","bedrijf":"Pecocar"},{"k":"3","naam":"Ioan Navacoveschi","status":"Lopend","bedrijf":"Tijhof"},{"k":"4","naam":"Emanuel Paraschiv","status":"Lopend","bedrijf":"Denissen"},{"k":"5","naam":"Remigiusz Pilarski","status":"Lopend","bedrijf":"Tijhof"}]'),
(6,  'Almelo',    'Krommendijk 14',         '7603 NJ', '[{"k":"1","naam":"Ionut Hagiu","status":"Lopend","bedrijf":"Tasche"},{"k":"2","naam":"Slawomir Kolodziejczak","status":"Lopend","bedrijf":"Priema Cetra"},{"k":"3","naam":"Wieslaw Gasinski","status":"Lopend","bedrijf":"Matel Metaal"},{"k":"4","naam":"","status":"Beschikbaar","bedrijf":""}]'),
(7,  'Enschede',  'Haaksbergerstraat 302C', '7513 EM', '[{"k":"1","naam":"","status":"Beschikbaar","bedrijf":""},{"k":"2","naam":"Petru Kalanyos","status":"Lopend","bedrijf":"Vd Moolen"},{"k":"3","naam":"","status":"Beschikbaar","bedrijf":""},{"k":"4","naam":"","status":"Beschikbaar","bedrijf":""}]'),
(8,  'Enschede',  'Spaarnestraat 84',       '7523 VM', '[{"k":"1","naam":"Krzysztof Zajfert","status":"Lopend","bedrijf":"Hassing"},{"k":"2","naam":"Samy Ait-Mohamed","status":"Lopend","bedrijf":"Service print"},{"k":"3","naam":"Marek Wutke","status":"Controle","bedrijf":"Pluimers"},{"k":"4","naam":"Mariusz Stusinski","status":"Lopend","bedrijf":"Hassing"},{"k":"5","naam":"","status":"Beschikbaar","bedrijf":""}]'),
(9,  'Enschede',  'Zweringweg 248',         '7545 DA', '[{"k":"1","naam":"Damian Dorobisz","status":"Lopend","bedrijf":"Van der Moolen"},{"k":"2","naam":"Sebastian Ferdek","status":"Lopend","bedrijf":"XHC"},{"k":"3","naam":"Michal Kardasz","status":"Gereserveerd","bedrijf":""},{"k":"4","naam":"Wlodzimierz Piasecki","status":"Lopend","bedrijf":"Hassing"},{"k":"4.2","naam":"","status":"Beschikbaar","bedrijf":""}]'),
(10, 'Goor',      'Deldensestraat 25',      '7471 KT', '[{"k":"1","naam":"Bartosz Derka","status":"Lopend","bedrijf":"Nieuwpoort"},{"k":"2","naam":"Piotr Skwira","status":"Lopend","bedrijf":"Nieuwpoort"},{"k":"3","naam":"Hubert Wysocki","status":"Controle","bedrijf":"Pecocar"},{"k":"4","naam":"Jakub Kramarczuk","status":"Lopend","bedrijf":"Vidra"},{"k":"5","naam":"Krystian Sobek","status":"Lopend","bedrijf":"Vidra"}]'),
(11, 'Goor',      'Nijverheidsweg 5',       '7471 EW', '[{"k":"1","naam":"Wojciech Dabrowski","status":"Lopend","bedrijf":"Vidra"},{"k":"2","naam":"Grzegorz Najda","status":"Lopend","bedrijf":"Vidra"},{"k":"3","naam":"Lukasz Szeleszczuk","status":"Lopend","bedrijf":"Tijhof"},{"k":"4","naam":"Filip Strzelecki","status":"Controle","bedrijf":"Morsink"},{"k":"5","naam":"Damian Strzelecki","status":"Controle","bedrijf":"Vidra"},{"k":"6","naam":"Piotr Tegi","status":"Lopend","bedrijf":"Vidra"}]'),
(12, 'Goor',      'Nijverheidsweg 9',       '7471 EW', '[{"k":"1","naam":"Emilian Balint","status":"Lopend","bedrijf":"Triferto G"},{"k":"2","naam":"Augustin Vama","status":"Moet aan het werk","bedrijf":"Triferto G"},{"k":"3","naam":"Piotr Monasterski","status":"Gereserveerd","bedrijf":""},{"k":"4","naam":"Mariusz Gera","status":"Lopend","bedrijf":"Vidra"},{"k":"5","naam":"Mateusz Gierlicki","status":"Controle","bedrijf":"Steelworks"},{"k":"6","naam":"Piotr Grzeca","status":"Lopend","bedrijf":"Tijhof"}]'),
(13, 'Coevorden', 'Friesestraat 50 A',      '7741 GX', '[{"k":"1","naam":"Patryk Latocha","status":"Controle","bedrijf":"E-coldstore"},{"k":"2","naam":"Kamil Malinowski","status":"Lopend","bedrijf":"Unitech"},{"k":"2.2","naam":"","status":"Beschikbaar","bedrijf":""},{"k":"3","naam":"Jakub Lewandowski","status":"Lopend","bedrijf":"Unitech"}]'),
(14, 'Rijssen',   'Morsweg 3',              '7461 AG', '[{"k":"1","naam":"Lukasz Kluczek","status":"Lopend","bedrijf":"W en K"},{"k":"2","naam":"Marek Wutke","status":"Lopend","bedrijf":"Pluimers"},{"k":"3","naam":"Piotr Kus","status":"Lopend","bedrijf":"Kemper"},{"k":"4","naam":"Robert Buczek","status":"Lopend","bedrijf":"Vidra"}]'),
(15, 'De Krim',   'Coevorderweg 135',       '7781 PA', '[{"k":"1","naam":"Michal Nowak","status":"Lopend","bedrijf":"Oegema"},{"k":"2","naam":"Jaroslaw Flejszer","status":"Lopend","bedrijf":"Oegema"},{"k":"3","naam":"Jaroslaw Gasiorowski","status":"Lopend","bedrijf":"Oegema"},{"k":"4","naam":"Marcin Mazur","status":"Lopend","bedrijf":"Oegema"},{"k":"5","naam":"Patryk Fialkowski","status":"Lopend","bedrijf":"Oegema"},{"k":"6","naam":"Mariusz Dziala","status":"Lopend","bedrijf":"Oegema"},{"k":"7","naam":"Bartosz Nowak","status":"Lopend","bedrijf":"Oegema"},{"k":"8","naam":"Jurica Josic","status":"Lopend","bedrijf":"Oegema"}]')
ON CONFLICT (id) DO NOTHING;

-- Reset ID sequence zodat nieuwe woningen na 15 beginnen
SELECT setval('woningen_id_seq', 15);
