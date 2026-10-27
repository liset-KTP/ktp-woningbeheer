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
