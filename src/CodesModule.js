import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";

// ─── WIFI & SLEUTELKLUIS-CODES PER WONING ────────────────────────────────────
// Iedereen ziet de codes; alleen huismeester + backoffice kunnen wijzigen.
// De tabel is niet direct bereikbaar: alles loopt via databasefuncties die het
// sessietoken controleren (zie supabase/woning_codes.sql).
// "Gewijzigd op" wordt door een database-trigger gezet (servertijd), alleen als
// type/omschrijving/code/opmerking echt veranderd is.
// In het Log komt wél wie/wat/welke woning, maar NOOIT de code zelf.

const C = {
  blauw:"#1B3A6B", blauwDark:"#132b52", groen:"#4A9B3C",
  bg:"#f0f4f8", card:"#ffffff", border:"#d1dbe8",
  text:"#1a2b47", muted:"#6b7a8d",
  rood:"#ef4444", oranje:"#f59e0b",
};

export const CODE_TYPES = {
  wifi:         { label:"Wifi",         icoon:"📶" },
  sleutelkluis: { label:"Sleutelkluis", icoon:"🔐" },
  alarm:        { label:"Alarm",        icoon:"🚨" },
  overig:       { label:"Overig",       icoon:"🔑" },
};

const OUD_NA_DAGEN = 180;

function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("nl-NL",{day:"2-digit",month:"2-digit",year:"numeric"});
}
function dagenGeleden(d) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

const inp = { width:"100%", padding:"8px 10px", border:`1px solid ${C.border}`, borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", background:"white", color:C.text };
const btn = (bg, fg="white") => ({ padding:"7px 12px", borderRadius:7, border:"none", background:bg, color:fg, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" });

function CodeForm({ start, onOpslaan, onAnnuleren, bezig }) {
  const [type, setType] = useState(start?.type || "wifi");
  const [omschrijving, setOmschrijving] = useState(start?.omschrijving || "");
  const [code, setCode] = useState(start?.code || "");
  const [opmerking, setOpmerking] = useState(start?.opmerking || "");

  const placeholder = type === "wifi" ? "Bijv. Wifi beneden / netwerknaam KPN-1234"
    : type === "sleutelkluis" ? "Bijv. Kluis voordeur"
    : type === "alarm" ? "Bijv. Alarmpaneel hal" : "Omschrijving";

  function opslaan() {
    if (!code.trim()) return onOpslaan(null, "Vul een code in");
    if (!omschrijving.trim()) return onOpslaan(null, "Vul een omschrijving in");
    onOpslaan({ type, omschrijving: omschrijving.trim(), code: code.trim(), opmerking: opmerking.trim() || null });
  }

  return (
    <div style={{background:"#f8fafc",border:`1px solid ${C.border}`,borderRadius:9,padding:12,marginTop:8}}>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
        {Object.entries(CODE_TYPES).map(([k,v]) => (
          <button key={k} onClick={()=>setType(k)} type="button"
            style={{...btn(type===k?C.blauw:"white", type===k?"white":C.text), border:`1px solid ${type===k?C.blauw:C.border}`}}>
            {v.icoon} {v.label}
          </button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:8}}>
        <input style={inp} placeholder={placeholder} value={omschrijving} onChange={e=>setOmschrijving(e.target.value)} />
        <input style={{...inp,fontFamily:"monospace",fontSize:14}} placeholder={type==="wifi"?"Wachtwoord":"Code"} value={code} onChange={e=>setCode(e.target.value)} autoComplete="off" />
      </div>
      <input style={{...inp,marginTop:8}} placeholder="Opmerking (optioneel)" value={opmerking} onChange={e=>setOpmerking(e.target.value)} />
      <div style={{display:"flex",gap:8,marginTop:10,justifyContent:"flex-end"}}>
        <button style={btn("white",C.text)} onClick={onAnnuleren} disabled={bezig}>Annuleren</button>
        <button style={btn(C.groen)} onClick={opslaan} disabled={bezig}>{bezig?"Opslaan…":"💾 Opslaan"}</button>
      </div>
    </div>
  );
}

function CodeRegel({ r, magWijzigen, onBewerk, onVerwijder, showToast }) {
  const [toon, setToon] = useState(false);
  const [bevestig, setBevestig] = useState(false);
  const t = CODE_TYPES[r.type] || CODE_TYPES.overig;
  const dagen = dagenGeleden(r.gewijzigd_op);
  const oud = dagen !== null && dagen > OUD_NA_DAGEN;

  async function kopieer() {
    try { await navigator.clipboard.writeText(r.code); showToast("📋 Gekopieerd"); }
    catch { showToast("Kopiëren lukt niet op dit apparaat","err"); }
  }

  return (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderTop:`1px solid ${C.border}`,flexWrap:"wrap"}}>
      <div style={{fontSize:20,width:28,textAlign:"center"}} title={t.label}>{t.icoon}</div>
      <div style={{flex:"1 1 180px",minWidth:0}}>
        <div style={{fontSize:13,fontWeight:700,color:C.text}}>{r.omschrijving}</div>
        {r.opmerking && <div style={{fontSize:12,color:C.muted}}>{r.opmerking}</div>}
        <div style={{fontSize:11,color:oud?C.oranje:C.muted,marginTop:2}}>
          {oud?"⚠️ ":""}Gewijzigd {fmtDate(r.gewijzigd_op)}{r.gewijzigd_door?` door ${r.gewijzigd_door}`:""}
          {oud?` (${dagen} dagen geleden)`:""}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <code style={{background:"#eef2f7",padding:"6px 10px",borderRadius:6,fontSize:14,letterSpacing:toon?0:2,minWidth:90,textAlign:"center",color:C.text}}>
          {toon ? r.code : "••••••"}
        </code>
        <button style={btn("white",C.text)} onClick={()=>setToon(v=>!v)} title={toon?"Verbergen":"Tonen"}>{toon?"🙈":"👁"}</button>
        <button style={btn("white",C.text)} onClick={kopieer} title="Kopiëren">📋</button>
        {magWijzigen && <button style={btn("white",C.blauw)} onClick={onBewerk} title="Wijzigen">✏️</button>}
        {magWijzigen && (bevestig
          ? <><button style={btn(C.rood)} onClick={onVerwijder}>Verwijderen?</button>
              <button style={btn("white",C.text)} onClick={()=>setBevestig(false)}>✕</button></>
          : <button style={btn("white",C.rood)} onClick={()=>setBevestig(true)} title="Verwijderen">🗑</button>)}
      </div>
    </div>
  );
}

export function CodesModule({ gebruiker, token, houses, magWijzigen, showToast }) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [zoek, setZoek] = useState("");
  const [stad, setStad] = useState("");
  const [alleenZonder, setAlleenZonder] = useState(false);
  const [bewerk, setBewerk] = useState(null); // { woningId, regel|null }
  const [bezig, setBezig] = useState(false);

  // showToast is in App niet gememoized -> via ref, anders laadt dit eindeloos opnieuw
  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  const laad = useCallback(async () => {
    const { data, error } = await supabase.rpc("app_codes_lijst", { p_token: token });
    if (error || !data?.ok) toastRef.current("Fout bij laden codes: "+(data?.fout || error?.message || "onbekend"),"err");
    setCodes(data?.codes || []);
    setLoading(false);
  }, [token]);

  useEffect(() => { laad(); }, [laad]);

  const perWoning = useMemo(() => {
    const m = {};
    for (const c of codes) (m[c.woning_id] = m[c.woning_id] || []).push(c);
    return m;
  }, [codes]);

  const steden = useMemo(() => [...new Set((houses||[]).map(h=>h.stad).filter(Boolean))].sort(), [houses]);

  const zichtbaar = (houses||[]).filter(h => {
    if (stad && h.stad !== stad) return false;
    if (alleenZonder && (perWoning[h.id]||[]).length > 0) return false;
    const q = zoek.trim().toLowerCase();
    if (!q) return true;
    if (`${h.adres||""} ${h.stad||""}`.toLowerCase().includes(q)) return true;
    return (perWoning[h.id]||[]).some(c => (c.omschrijving||"").toLowerCase().includes(q));
  });

  async function log(type, omschrijving, extra) {
    await supabase.from("activiteiten").insert([{ type, omschrijving, gedaan_door: gebruiker?.naam || "?", extra }]);
  }

  async function opslaan(woning, regel, waarden, fout) {
    if (fout) { showToast(fout,"err"); return; }
    setBezig(true);
    const t = CODE_TYPES[waarden.type]?.label || waarden.type;
    const { data, error: rpcFout } = await supabase.rpc("app_code_opslaan", {
      p_token: token, p_id: regel?.id ?? null, p_woning_id: woning.id,
      p_type: waarden.type, p_omschrijving: waarden.omschrijving, p_code: waarden.code, p_opmerking: waarden.opmerking,
    });
    const error = rpcFout || (!data?.ok && { message: data?.fout || "Opslaan mislukt" });
    if (regel) {
      if (!error) await log("code_gewijzigd", `🔑 ${t} "${waarden.omschrijving}" gewijzigd — ${woning.adres}`, { woning_id: woning.id, code_id: regel.id });
    } else {
      if (!error) await log("code_toegevoegd", `🔑 ${t} "${waarden.omschrijving}" toegevoegd — ${woning.adres}`, { woning_id: woning.id });
    }
    setBezig(false);
    if (error) { showToast("Fout: "+error.message,"err"); return; }
    showToast("✓ Opgeslagen");
    setBewerk(null);
    laad();
  }

  async function verwijder(woning, regel) {
    const { data, error } = await supabase.rpc("app_code_verwijderen", { p_token: token, p_id: regel.id });
    if (error || !data?.ok) { showToast("Fout: "+(data?.fout || error?.message || "verwijderen mislukt"),"err"); return; }
    const t = CODE_TYPES[regel.type]?.label || regel.type;
    await log("code_verwijderd", `🗑 ${t} "${regel.omschrijving}" verwijderd — ${woning.adres}`, { woning_id: woning.id, code_id: regel.id });
    showToast("Verwijderd");
    laad();
  }

  const aantalZonder = (houses||[]).filter(h => !(perWoning[h.id]||[]).length).length;

  return (
    <div>
      <div style={{marginBottom:18}}>
        <h2 style={{fontSize:20,fontWeight:800,color:C.blauw,marginBottom:3}}>🔑 Codes & wifi</h2>
        <p style={{fontSize:13,color:C.muted}}>
          Wifi-wachtwoorden en sleutelkluiscodes per woning. {magWijzigen ? "Pas een code direct aan zodra hij verandert — de datum wordt automatisch bijgewerkt." : "Alleen de huismeester en backoffice kunnen codes wijzigen."}
        </p>
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14,alignItems:"center"}}>
        <input style={{...inp,flex:"1 1 220px",width:"auto"}} placeholder="🔍 Zoek op adres of omschrijving…" value={zoek} onChange={e=>setZoek(e.target.value)} />
        <select style={{...inp,width:"auto"}} value={stad} onChange={e=>setStad(e.target.value)}>
          <option value="">Alle plaatsen</option>
          {steden.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{fontSize:12,color:C.text,display:"flex",alignItems:"center",gap:5,cursor:"pointer"}}>
          <input type="checkbox" checked={alleenZonder} onChange={e=>setAlleenZonder(e.target.checked)} />
          Alleen woningen zonder codes ({aantalZonder})
        </label>
      </div>

      {loading ? <div style={{color:C.muted,fontSize:13}}>Laden…</div> : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(420px,100%),1fr))",gap:12}}>
          {zichtbaar.map(h => {
            const regels = perWoning[h.id] || [];
            const nieuwOpen = bewerk && bewerk.woningId === h.id && !bewerk.regel;
            return (
              <div key={h.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:11,padding:"12px 14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:4}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:800,color:C.blauw}}>{h.adres}</div>
                    <div style={{fontSize:12,color:C.muted}}>{h.stad}</div>
                  </div>
                  {magWijzigen && !nieuwOpen && (
                    <button style={btn(C.blauw)} onClick={()=>setBewerk({ woningId:h.id, regel:null })}>+ Regel</button>
                  )}
                </div>
                {regels.length === 0 && !nieuwOpen && (
                  <div style={{fontSize:12,color:C.muted,fontStyle:"italic",paddingTop:6}}>Nog geen codes ingevuld</div>
                )}
                {regels.map(r => (bewerk && bewerk.regel?.id === r.id)
                  ? <CodeForm key={r.id} start={r} bezig={bezig} onAnnuleren={()=>setBewerk(null)} onOpslaan={(w,f)=>opslaan(h,r,w,f)} />
                  : <CodeRegel key={r.id} r={r} magWijzigen={magWijzigen} showToast={showToast}
                      onBewerk={()=>setBewerk({ woningId:h.id, regel:r })} onVerwijder={()=>verwijder(h,r)} />
                )}
                {nieuwOpen && <CodeForm bezig={bezig} onAnnuleren={()=>setBewerk(null)} onOpslaan={(w,f)=>opslaan(h,null,w,f)} />}
              </div>
            );
          })}
          {zichtbaar.length === 0 && <div style={{color:C.muted,fontSize:13}}>Geen woningen gevonden.</div>}
        </div>
      )}
    </div>
  );
}

export default CodesModule;
