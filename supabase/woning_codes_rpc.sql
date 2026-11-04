-- Fase 2 / blok 1 (04-11-2026): woning_codes alleen nog via RPC met sessietoken.
-- Stap A: functies aanmaken (app kan ze direct gebruiken).
-- Stap B (pas NA de deploy van CodesModule.js): directe tabeltoegang intrekken — zie onderaan.

-- Lezen: iedere ingelogde gebruiker met een actieve sessie.
create or replace function public.codes_lijst(p_token uuid)
returns setof public.woning_codes
language plpgsql stable security definer
set search_path to 'public'
as $$
declare g public.gebruikers;
begin
  g := public._sessie_gebruiker(p_token);
  if g.id is null then raise exception 'Sessie verlopen — log opnieuw in'; end if;
  return query select * from public.woning_codes order by type, omschrijving;
end $$;

-- Toevoegen (p_id null) of wijzigen: alleen backoffice en huismeester.
-- Naam van wie het deed komt uit de sessie (niet te vervalsen); log zonder de code zelf.
create or replace function public.codes_opslaan(
  p_token uuid, p_id bigint, p_woning_id integer,
  p_type text, p_omschrijving text, p_code text, p_opmerking text default null)
returns json
language plpgsql security definer
set search_path to 'public'
as $$
declare
  g public.gebruikers; w public.woningen; v_id bigint; v_label text;
begin
  g := public._app_actor(p_token, array['backoffice','huismeester'], 'code_opslaan');
  if coalesce(trim(p_code),'') = '' then return json_build_object('ok',false,'fout','Vul een code in'); end if;
  if coalesce(trim(p_omschrijving),'') = '' then return json_build_object('ok',false,'fout','Vul een omschrijving in'); end if;
  if p_type not in ('wifi','sleutelkluis','alarm','overig') then return json_build_object('ok',false,'fout','Onbekend type'); end if;
  v_label := case p_type when 'wifi' then 'Wifi' when 'sleutelkluis' then 'Sleutelkluis' when 'alarm' then 'Alarm' else 'Overig' end;

  if p_id is null then
    select * into w from public.woningen where id = p_woning_id;
    if w.id is null then return json_build_object('ok',false,'fout','Woning niet gevonden'); end if;
    insert into public.woning_codes (woning_id, type, omschrijving, code, opmerking, aangemaakt_door, gewijzigd_door)
    values (p_woning_id, p_type, trim(p_omschrijving), trim(p_code), nullif(trim(p_opmerking),''), g.naam, g.naam)
    returning id into v_id;
    insert into public.activiteiten (type, omschrijving, gedaan_door, extra)
    values ('code_toegevoegd', '🔑 '||v_label||' "'||trim(p_omschrijving)||'" toegevoegd — '||w.adres, g.naam,
            jsonb_build_object('woning_id', w.id));
  else
    select wo.* into w from public.woning_codes c join public.woningen wo on wo.id = c.woning_id where c.id = p_id;
    if w.id is null then return json_build_object('ok',false,'fout','Code niet gevonden'); end if;
    update public.woning_codes
       set type = p_type, omschrijving = trim(p_omschrijving), code = trim(p_code),
           opmerking = nullif(trim(p_opmerking),''), gewijzigd_door = g.naam
     where id = p_id
    returning id into v_id;
    insert into public.activiteiten (type, omschrijving, gedaan_door, extra)
    values ('code_gewijzigd', '🔑 '||v_label||' "'||trim(p_omschrijving)||'" gewijzigd — '||w.adres, g.naam,
            jsonb_build_object('woning_id', w.id, 'code_id', v_id));
  end if;
  return json_build_object('ok', true, 'id', v_id);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

-- Verwijderen: alleen backoffice en huismeester.
create or replace function public.codes_verwijderen(p_token uuid, p_id bigint)
returns json
language plpgsql security definer
set search_path to 'public'
as $$
declare g public.gebruikers; c public.woning_codes; w public.woningen; v_label text;
begin
  g := public._app_actor(p_token, array['backoffice','huismeester'], 'code_verwijderen');
  select * into c from public.woning_codes where id = p_id;
  if c.id is null then return json_build_object('ok',false,'fout','Code niet gevonden'); end if;
  select * into w from public.woningen where id = c.woning_id;
  v_label := case c.type when 'wifi' then 'Wifi' when 'sleutelkluis' then 'Sleutelkluis' when 'alarm' then 'Alarm' else 'Overig' end;
  delete from public.woning_codes where id = p_id;
  insert into public.activiteiten (type, omschrijving, gedaan_door, extra)
  values ('code_verwijderd', '🗑 '||v_label||' "'||c.omschrijving||'" verwijderd — '||coalesce(w.adres,'?'), g.naam,
          jsonb_build_object('woning_id', c.woning_id, 'code_id', c.id));
  return json_build_object('ok', true);
exception when others then
  return json_build_object('ok', false, 'fout', sqlerrm);
end $$;

revoke all on function public.codes_lijst(uuid) from public;
revoke all on function public.codes_opslaan(uuid, bigint, integer, text, text, text, text) from public;
revoke all on function public.codes_verwijderen(uuid, bigint) from public;
grant execute on function public.codes_lijst(uuid) to anon, authenticated;
grant execute on function public.codes_opslaan(uuid, bigint, integer, text, text, text, text) to anon, authenticated;
grant execute on function public.codes_verwijderen(uuid, bigint) to anon, authenticated;

-- Bucket bijlages: publiek overschrijven en verwijderen uit (de app doet dat nooit).
drop policy if exists "Allow public delete" on storage.objects;
drop policy if exists "Allow public update" on storage.objects;

-- ── Stap B: pas uitvoeren NA de deploy van de nieuwe CodesModule.js ──
-- drop policy if exists allow_all_woning_codes on public.woning_codes;
-- revoke all on public.woning_codes from anon, authenticated;
