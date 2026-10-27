-- ============================================================
-- SNF-inspecties: eerste inspectie (Rietstraat 28, Almelo — Normec VRO, 27-10-2026)
-- Koppelt aan de bestaande woning; bestaat die niet, dan wordt er niets aangemaakt.
-- Veilig om opnieuw te draaien (slaat over als het rapport al bestaat).
-- ============================================================
-- SNF-controle ligt bij Liane (backoffice blijft achtervang)
UPDATE public.gebruikers SET snf_controleur = true WHERE lower(trim(naam)) = 'liane' AND actief;

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
