-- ============================================================
-- KTP Interflex – Woningbeheer: CENTRALE VERWARMING (04-11-2026)
-- Woningen met centrale verwarming voor het hele pand (bv. Am Busch, Emmerich) hebben geen eigen
-- CV-ketel. Daar kan de huismeester de ketel-items niet controleren.
--  - woningen.centrale_verwarming = true  → items met checklist_items.alleen_eigen_cv vervallen
--    voor die woning, en de CV-keuring is daar niet verplicht in SNF → Keuringen.
--  - Alleen toevoegen, er verdwijnt niets.
-- ============================================================
ALTER TABLE public.woningen ADD COLUMN IF NOT EXISTS centrale_verwarming boolean NOT NULL DEFAULT false;
ALTER TABLE public.checklist_items ADD COLUMN IF NOT EXISTS alleen_eigen_cv boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.woningen.centrale_verwarming IS 'true = centrale verwarming voor het hele pand, geen eigen CV-ketel per woning';
COMMENT ON COLUMN public.checklist_items.alleen_eigen_cv IS 'true = item vervalt voor woningen met centrale_verwarming';

-- 31 = wekelijks "Algemeen: Druk van de ketel", 89 = kwartaal "Sticker CV-ketel/geiser" (SNF 6.5)
UPDATE public.checklist_items SET alleen_eigen_cv = true WHERE id IN (31, 89);

-- Am Busch 41, 43-1, 43-5, 43-7 (Emmerich): centrale verwarming
UPDATE public.woningen SET centrale_verwarming = true WHERE adres ILIKE 'Am Busch%' AND stad = 'Emmerich';
