-- ============================================================
-- KTP Interflex – Woningbeheer: BETAALVERZOEKEN
-- Elk betaalverzoek dat vanuit Huurbetalingen wordt gemaakt, wordt hier vastgelegd
-- (zoals "Vastleggen in overzicht" bij de facturen). De inhoud van het verzoek staat
-- in snapshot, zodat het document later precies zo terug te halen is als het verstuurd is.
--
-- Betaald / te laat wordt NIET hier bijgehouden maar berekend uit huurbetalingen:
-- zo is er maar één plek waar een betaling wordt geboekt.
-- Voer uit in Supabase > SQL Editor > New Query.
-- ============================================================

CREATE TABLE IF NOT EXISTS betaalverzoeken (
  id                  bigserial PRIMARY KEY,
  schuld_id           bigint NOT NULL REFERENCES huurschulden(id) ON DELETE CASCADE,
  naam_medewerker     text NOT NULL,
  kenmerk             text NOT NULL,                 -- betaalkenmerk, bv. HUUR-57 (vast per huurschuld)
  datum               date NOT NULL DEFAULT current_date,
  vervaldatum         date NOT NULL,
  bedrag              numeric(10,2) NOT NULL CHECK (bedrag > 0),
  taal                text NOT NULL CHECK (taal IN ('NL','EN','PL','RO')),
  afzender            text NOT NULL,                 -- INTERFLEX / BACKOFFICE
  snapshot            jsonb NOT NULL,                -- regels, totalen, tarieven op het moment van versturen
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','ingetrokken','vervangen')),
  herinneringen       integer NOT NULL DEFAULT 0,
  laatste_herinnering date,
  aangemaakt_door     text,
  aangemaakt_op       timestamptz NOT NULL DEFAULT now(),
  ingetrokken_door    text,
  ingetrokken_op      timestamptz,
  ingetrokken_reden   text
);

CREATE INDEX IF NOT EXISTS betaalverzoeken_schuld_idx ON betaalverzoeken (schuld_id);

-- Zelfde toegang als huurschulden/huurbetalingen (fase 2 RLS volgt voor alle tabellen samen)
ALTER TABLE betaalverzoeken ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_betaalverzoeken ON betaalverzoeken;
CREATE POLICY allow_all_betaalverzoeken ON betaalverzoeken FOR ALL USING (true) WITH CHECK (true);

-- Live bijwerken in de app
ALTER PUBLICATION supabase_realtime ADD TABLE betaalverzoeken;
