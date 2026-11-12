// ─── BETAALVERZOEKEN ─────────────────────────────────────────────────────────
// Vastleggen + overzicht van betaalverzoeken (zoals het factuuroverzicht).
//  - Elk gemaakt verzoek komt in de tabel betaalverzoeken (met snapshot van de inhoud).
//  - Betaald / te laat wordt BEREKEND uit huurbetalingen: Harald boekt een betaling zoals altijd
//    op de huurschuld, en het verzoek springt vanzelf op betaald. Geen tweede plek om af te vinken.
//  - De taal komt automatisch uit de huurovereenkomst van de medewerker.
import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { tx, txv } from "./i18n";
import { BETAALVERZOEK_TALEN, AFZENDER_STANDAARD, betaalDatum, kenmerkVoor, maakSnapshot,
         betaalverzoekHTML, htmlUitVerzoek, openLeegVenster, schrijfInVenster } from "./betaalverzoek";

const C = {
  blauw:"#1B3A6B", groen:"#4A9B3C", border:"#d1dbe8", text:"#1a2b47", muted:"#6b7a8d",
  rood:"#ef4444", oranje:"#f59e0b", bg:"#f0f4f8",
};
const iso = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`; };
const fmt = d => d ? new Date(String(d).slice(0,10) + "T00:00:00").toLocaleDateString("nl-NL") : "";
const eur = n => "€ " + Number(n || 0).toFixed(2).replace(".", ",");

// Zelfde vergelijkingsvorm als huurovereenkomsten.naam_sleutel, plus zonder accenten
export function naamSleutel(naam) {
  return (naam || "").trim().replace(/\s+/g, " ").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l").replace(/Ł/g, "L").toLowerCase();
}

// Taal per medewerker uit de (laatste) huurovereenkomst: { sleutel: "PL" }
export function useTaalPerMedewerker() {
  const [map, setMap] = useState({});
  useEffect(() => {
    let weg = false;
    supabase.from("huurovereenkomsten").select("naam_medewerker, taal, aangemaakt_op")
      .not("taal", "is", null).order("aangemaakt_op", { ascending: false })
      .then(({ data, error }) => {
        if (error || weg) return;
        const m = {};
        (data || []).forEach(r => { const k = naamSleutel(r.naam_medewerker); if (!m[k]) m[k] = r.taal; });
        setMap(m);
      });
    return () => { weg = true; };
  }, []);
  return map;
}

// Maakt een betaalverzoek: venster openen (direct, in de klik), vastleggen, document tonen.
// Oudere open verzoeken van dezelfde huurschuld worden op "vervangen" gezet, zodat er per
// huurschuld altijd maar één geldig verzoek openstaat.
export async function maakBetaalverzoek({ schuld, spec, betaald, taal, gebruiker, herinneringen = 0, showToast }) {
  const w = openLeegVenster();
  if (!w) { showToast?.(tx("Pop-up geblokkeerd — sta pop-ups toe voor deze app"), "err"); return null; }
  const vandaag = new Date();
  const bedrag = Math.round((spec.totaal - betaald) * 100) / 100;
  const rij = {
    schuld_id: schuld.id, naam_medewerker: schuld.naam_medewerker, kenmerk: kenmerkVoor(schuld),
    datum: iso(vandaag), vervaldatum: iso(betaalDatum(vandaag)), bedrag, taal, afzender: AFZENDER_STANDAARD,
    snapshot: maakSnapshot({ spec, betaald }), herinneringen, aangemaakt_door: gebruiker?.naam || null,
  };
  const { data, error } = await supabase.from("betaalverzoeken").insert([rij]).select().single();
  if (error) {
    console.error(error);
    // Document toch tonen, maar duidelijk melden dat het niet in het overzicht staat
    schrijfInVenster(w, betaalverzoekHTML({ schuld, spec, betaald, taal, vandaag, herinnering: herinneringen }));
    showToast?.(tx("⚠️ Betaalverzoek niet vastgelegd in het overzicht — probeer opnieuw"), "err");
    return null;
  }
  await supabase.from("betaalverzoeken").update({ status: "vervangen" })
    .eq("schuld_id", schuld.id).eq("status", "open").neq("id", data.id);
  await supabase.from("activiteiten").insert([{
    type: "betaalverzoek",
    omschrijving: `📄 ${herinneringen > 0 ? "Herinnering " + herinneringen + " – b" : "B"}etaalverzoek huur ${data.kenmerk} (${taal}): ${eur(bedrag)}, te betalen vóór ${fmt(data.vervaldatum)}.`,
    gedaan_door: gebruiker?.naam || "onbekend",
    extra: { naam: (schuld.naam_medewerker || "").trim(), schuld_id: schuld.id, betaalverzoek_id: data.id, bedrag },
  }]).then(({ error: e }) => { if (e) console.warn("activiteit niet gelogd:", e.message); });
  schrijfInVenster(w, htmlUitVerzoek(data));
  return data;
}

// Status van een verzoek, berekend uit de huurschuld + geregistreerde betalingen.
// open | te_laat | betaald | afgeschreven | ingetrokken | vervangen
export function statusVan(v, schuld, openstaandVan, vandaag = new Date()) {
  const ontvangen = schuld ? (schuld.betalingen || [])
    .filter(b => Number(b.bedrag) > 0 && String(b.datum || "").slice(0,10) >= v.datum)
    .reduce((s, b) => s + Number(b.bedrag), 0) : 0;
  if (v.status === "ingetrokken" || v.status === "vervangen") return { status: v.status, ontvangen };
  if (schuld && ontvangen >= Number(v.bedrag) - 0.005) return { status: "betaald", ontvangen };
  if (schuld && openstaandVan(schuld) <= 0.005) return { status: "betaald", ontvangen };
  if (schuld && Number(schuld.afgeschreven_bedrag) > 0) return { status: "afgeschreven", ontvangen };
  if (v.vervaldatum < iso(vandaag)) return { status: "te_laat", ontvangen };
  return { status: "open", ontvangen };
}

const STATUS_STIJL = {
  open:         { l: "Open",         kl: C.blauw,  bg: "#eef2fb" },
  te_laat:      { l: "Te laat",      kl: "#b91c1c", bg: "#fef2f2" },
  betaald:      { l: "Betaald",      kl: C.groen,  bg: "#f0fdf4" },
  afgeschreven: { l: "Afgeschreven", kl: "#475569", bg: "#f1f5f9" },
  ingetrokken:  { l: "Ingetrokken",  kl: "#475569", bg: "#f1f5f9" },
  vervangen:    { l: "Vervangen",    kl: "#475569", bg: "#f1f5f9" },
};

// ─── KNOP OP DE HUURSCHULDKAART ──────────────────────────────────────────────
export function BetaalverzoekKnop({ schuld, taalAuto, maakVoorSchuld }) {
  const [andere, setAndere] = useState(false);
  const knop = (taal, hoofd) => (
    <button key={taal} onClick={() => maakVoorSchuld(schuld, taal)}
      style={{background:hoofd?C.blauw:"white",border:`1.5px solid ${C.blauw}`,color:hoofd?"white":C.blauw,borderRadius:6,
              padding:hoofd?"6px 12px":"4px 10px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
      {hoofd ? txv("📄 Betaalverzoek ({0})", taal) : taal}
    </button>
  );
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:12,fontSize:12,color:C.muted}}>
      {taalAuto ? (
        <>
          {knop(taalAuto, true)}
          {!andere
            ? <button onClick={() => setAndere(true)} style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer",textDecoration:"underline",fontFamily:"inherit"}}>{tx("andere taal")}</button>
            : BETAALVERZOEK_TALEN.filter(t => t !== taalAuto).map(t => knop(t, false))}
        </>
      ) : (
        <>
          <span style={{fontWeight:600}}>{tx("📄 Betaalverzoek:")}</span>
          {BETAALVERZOEK_TALEN.map(t => knop(t, false))}
          <span style={{fontSize:11}}>{tx("(taal onbekend in huurcontract)")}</span>
        </>
      )}
    </div>
  );
}

// ─── OVERZICHT ───────────────────────────────────────────────────────────────
export function BetaalverzoekenOverzicht({ schulden, gebruiker, isBackoffice, showToast, openstaandVan, maakVoorSchuld }) {
  const [verzoeken, setVerzoeken] = useState([]);
  const [filter, setFilter] = useState("actief");
  const [zoek, setZoek] = useState("");

  const laad = useCallback(async () => {
    const { data, error } = await supabase.from("betaalverzoeken").select("*").order("aangemaakt_op", { ascending: false });
    if (error) { console.error(error); return; }
    setVerzoeken(data || []);
  }, []);
  useEffect(() => {
    laad();
    const ch = supabase.channel("bvz-rt").on("postgres_changes", { event: "*", schema: "public", table: "betaalverzoeken" }, () => laad()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [laad]);

  const perId = Object.fromEntries((schulden || []).map(s => [s.id, s]));
  const rijen = verzoeken.map(v => ({ v, schuld: perId[v.schuld_id], ...statusVan(v, perId[v.schuld_id], openstaandVan) }));

  const som = st => rijen.filter(r => st.includes(r.status));
  const kaarten = [
    ["open",    "Openstaand",   som(["open","te_laat"]), C.blauw],
    ["te_laat", "Te laat",      som(["te_laat"]),        "#b91c1c"],
    ["betaald", "Betaald",      som(["betaald"]),        C.groen],
    ["afgeschreven", "Afgeschreven", som(["afgeschreven"]), "#475569"],
  ];
  const bedragVan = lijst => lijst.reduce((s, r) => s + (r.status === "betaald" ? Number(r.v.bedrag) : Math.max(0, Number(r.v.bedrag) - r.ontvangen)), 0);

  const q = zoek.trim().toLowerCase();
  const zichtbaar = rijen.filter(r => {
    if (filter === "actief" && ["vervangen","ingetrokken"].includes(r.status)) return false;
    if (filter === "open" && !["open","te_laat"].includes(r.status)) return false;
    if (!["actief","open","alle"].includes(filter) && r.status !== filter && !(filter === "ingetrokken" && r.status === "vervangen")) return false;
    if (q && !(`${r.v.naam_medewerker} ${r.v.kenmerk}`.toLowerCase().includes(q))) return false;
    return true;
  });

  async function trekIn(v) {
    const reden = window.prompt(txv("Betaalverzoek {0} intrekken — reden?", v.kenmerk));
    if (reden === null) return;
    const { error } = await supabase.from("betaalverzoeken").update({
      status: "ingetrokken", ingetrokken_door: gebruiker?.naam || null, ingetrokken_op: new Date().toISOString(), ingetrokken_reden: reden || null,
    }).eq("id", v.id);
    if (error) showToast(tx("Fout bij intrekken"), "err"); else showToast(tx("✓ Betaalverzoek ingetrokken"));
  }

  const knopStijl = {background:"white",border:`1.5px solid ${C.border}`,color:C.blauw,borderRadius:6,padding:"4px 9px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"};
  const th = {textAlign:"left",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",color:C.blauw,padding:"10px 10px",borderBottom:`2px solid ${C.blauw}`,whiteSpace:"nowrap"};
  const td = {padding:"10px",borderBottom:`1px solid ${C.border}`,fontSize:13,verticalAlign:"middle"};

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:12,marginBottom:16}}>
        {kaarten.map(([k, l, lijst, kl]) => (
          <div key={k} onClick={() => setFilter(k)}
            style={{background:"white",borderRadius:10,padding:"14px 16px",cursor:"pointer",border:`1px solid ${C.border}`,borderTop:`3px solid ${filter===k?kl:"transparent"}`}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".6px",textTransform:"uppercase",color:C.muted}}>{tx(l)}</div>
            <div style={{fontSize:22,fontWeight:800,color:kl,margin:"4px 0 2px"}}>{eur(bedragVan(lijst))}</div>
            <div style={{fontSize:12,color:C.muted}}>{txv("{0} verzoeken", lijst.length)}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        {[["actief","Alle"],["open","Open"],["te_laat","Te laat"],["betaald","Betaald"],["afgeschreven","Afgeschreven"],["ingetrokken","Ingetrokken/vervangen"]].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{background:filter===v?C.blauw:"white",color:filter===v?"white":C.muted,border:`1.5px solid ${filter===v?C.blauw:C.border}`,borderRadius:20,padding:"6px 13px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            {tx(l)}
          </button>
        ))}
        <input value={zoek} onChange={e => setZoek(e.target.value)} placeholder={tx("🔍 Zoek op naam of kenmerk...")}
          style={{flex:1,minWidth:180,background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
      </div>

      <div style={{background:"white",borderRadius:10,border:`1px solid ${C.border}`,overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr>
            {["Kenmerk","Medewerker","Verstuurd","Vervalt","Bedrag","Ontvangen","Status","Herinneringen",""].map(h =>
              <th key={h} style={{...th,textAlign:["Bedrag","Ontvangen"].includes(h)?"right":"left"}}>{tx(h)}</th>)}
          </tr></thead>
          <tbody>
            {zichtbaar.length === 0 && (
              <tr><td colSpan={9} style={{...td,textAlign:"center",color:C.muted,padding:40}}>
                {tx("Nog geen betaalverzoeken. Maak er een via de knop op een huurschuld.")}
              </td></tr>
            )}
            {zichtbaar.map(({ v, schuld, status, ontvangen }) => {
              const st = STATUS_STIJL[status];
              const kanHerinneren = ["open","te_laat"].includes(status) && schuld && schuld.actief !== false;
              return (
                <tr key={v.id}>
                  <td style={{...td,fontWeight:700}}>{v.kenmerk}<div style={{fontSize:11,color:C.muted,fontWeight:400}}>{v.taal}</div></td>
                  <td style={td}>{v.naam_medewerker}</td>
                  <td style={td}>{fmt(v.datum)}<div style={{fontSize:11,color:C.muted}}>{v.aangemaakt_door}</div></td>
                  <td style={{...td,color:status==="te_laat"?"#b91c1c":C.text,fontWeight:status==="te_laat"?700:400}}>{fmt(v.vervaldatum)}</td>
                  <td style={{...td,textAlign:"right",fontWeight:700}}>{eur(v.bedrag)}</td>
                  <td style={{...td,textAlign:"right",color:ontvangen>0?C.groen:C.muted}}>{ontvangen > 0 ? eur(ontvangen) : "—"}</td>
                  <td style={td}>
                    <span style={{background:st.bg,color:st.kl,fontSize:11,fontWeight:700,padding:"3px 9px",borderRadius:10,whiteSpace:"nowrap"}}>{tx(st.l)}</span>
                    {v.ingetrokken_reden && <div style={{fontSize:11,color:C.muted,marginTop:3}}>{v.ingetrokken_reden}</div>}
                  </td>
                  <td style={td}>{v.herinneringen > 0 ? txv("{0}×", v.herinneringen) : "—"}</td>
                  <td style={{...td,whiteSpace:"nowrap"}}>
                    <div style={{display:"flex",gap:6}}>
                      <button style={knopStijl} title={tx("Document openen")}
                        onClick={() => { const w = openLeegVenster(); if (!w) showToast(tx("Pop-up geblokkeerd — sta pop-ups toe voor deze app"), "err"); else schrijfInVenster(w, htmlUitVerzoek(v)); }}>📄</button>
                      {kanHerinneren && (
                        <button style={knopStijl} title={tx("Herinnering maken met het actuele openstaande bedrag")}
                          onClick={() => maakVoorSchuld(schuld, v.taal, (v.herinneringen || 0) + 1)}>🔔 {tx("Herinnering")}</button>
                      )}
                      {isBackoffice && ["open","te_laat"].includes(status) && (
                        <button style={{...knopStijl,color:C.muted}} title={tx("Intrekken")} onClick={() => trekIn(v)}>✕</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{fontSize:11,color:C.muted,marginTop:8}}>
        {tx("Status gaat vanzelf op Betaald zodra de betaling op de huurschuld is geregistreerd. Er staat per huurschuld maar één verzoek open: een nieuw verzoek of herinnering vervangt het vorige.")}
      </div>
    </div>
  );
}
