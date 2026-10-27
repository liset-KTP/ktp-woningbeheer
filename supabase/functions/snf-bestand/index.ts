// Edge Function snf-bestand — signed URLs voor de privé bucket "snf-bewijs".
// De app logt niet in via Supabase Auth, dus de bucket heeft geen policies voor anon.
// Deze functie controleert het app-sessietoken + rechten via snf_bestand_toegang() (database)
// en geeft daarna een kortlevende signed URL terug (service_role).
//
// POST { token, actie: "upload"|"download", soort: "bewijs"|"rapport", id?, bestandsnaam?, pad? }
//   upload   -> { ok, pad, signedUrl, uploadToken }   (daarna: rpc snf_bewijs_toevoegen / snf_rapport_koppelen)
//   download -> { ok, url }                           (60 seconden geldig)
// verify_jwt = false: de functie doet zelf de controle op het sessietoken.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "snf-bewijs";

function antwoord(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwoord({ ok: false, fout: "Alleen POST" }, 405);
  let invoer: Record<string, unknown>;
  try { invoer = await req.json(); } catch { return antwoord({ ok: false, fout: "Ongeldige invoer" }, 400); }
  const { token, actie, soort, id, bestandsnaam, pad } = invoer as Record<string, string>;
  if (!token || !actie || !soort) return antwoord({ ok: false, fout: "token, actie en soort zijn verplicht" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: toegang, error } = await sb.rpc("snf_bestand_toegang", {
    p_token: token, p_actie: actie, p_soort: soort, p_id: id ?? null, p_bestandsnaam: bestandsnaam ?? null, p_pad: pad ?? null,
  });
  if (error) return antwoord({ ok: false, fout: error.message }, 500);
  if (!toegang?.ok) return antwoord({ ok: false, fout: toegang?.fout || "Geen toegang" }, 403);

  if (actie === "upload") {
    const { data, error: e } = await sb.storage.from(BUCKET).createSignedUploadUrl(toegang.pad);
    if (e) return antwoord({ ok: false, fout: e.message }, 500);
    return antwoord({ ok: true, pad: toegang.pad, signedUrl: data.signedUrl, uploadToken: data.token });
  }
  const { data, error: e } = await sb.storage.from(BUCKET).createSignedUrl(toegang.pad, 60);
  if (e) return antwoord({ ok: false, fout: e.message }, 500);
  return antwoord({ ok: true, url: data.signedUrl });
});
