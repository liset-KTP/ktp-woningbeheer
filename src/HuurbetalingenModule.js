// Huurbetalingen Module v2
import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

// ─── EMAILJS ──────────────────────────────────────────────────────────────────
const EMAILJS_SERVICE  = "service_1af258e";
const EMAILJS_TEMPLATE = "template_2mjnbok";
const EMAILJS_PUBLIC   = "CJEVdAOdA03ZQxE28";

async function stuurMail(params) {
  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_id: EMAILJS_SERVICE, template_id: EMAILJS_TEMPLATE, user_id: EMAILJS_PUBLIC, template_params: params }),
    });
    if (!res.ok) console.error("EmailJS fout:", await res.text());
  } catch (e) { console.error("EmailJS fout:", e); }
}

const C = {
  blauw:"#1B3A6B", blauwDark:"#132b52", blauwLight:"#2a52a0",
  groen:"#4A9B3C", groenDark:"#357a2b",
  bg:"#f0f4f8", card:"#ffffff", border:"#d1dbe8",
  text:"#1a2b47", muted:"#6b7a8d", rood:"#ef4444",
  oranje:"#f97316", // ← toegevoegd
};

function fmtDate(d) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("nl-NL", { day:"2-digit", month:"2-digit", year:"numeric" });
}
function todayISO() { return new Date().toISOString().slice(0,10); }

function Label({ children }) {
  return <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>{children}</label>;
}
function Input(props) {
  return <input style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}} {...props}/>;
}

// Bereken welke maandagen er zijn vanaf startdatum t/m vandaag (of einddatum)
// Elke maandag = 1 week vooraf verschuldigd
function berekenVerschuldigdeWeken(schuld) {
  if (!schuld.startdatum) return 0;
  const weekbedrag = schuld.tarief_bedrag ? Number(schuld.tarief_bedrag) : 140;
  
  // Vind de eerste maandag op of na de startdatum
  const start = new Date(schuld.startdatum);
  start.setHours(0,0,0,0);
  const dag = start.getDay(); // 0=zo, 1=ma, ..., 6=za
  const dagenNaarMaandag = dag === 1 ? 0 : dag === 0 ? 1 : 8 - dag;
  const eersteMaandag = new Date(start);
  eersteMaandag.setDate(start.getDate() + dagenNaarMaandag);

  // Tel maandagen t/m vandaag (of einddatum)
  const grens = new Date();
  grens.setHours(23,59,59,999);
  if (schuld.einddatum) {
    const eind = new Date(schuld.einddatum);
    eind.setHours(23,59,59,999);
    if (eind < grens) grens.setTime(eind.getTime());
  }
  // Als niet actief en einddatum al gepasseerd: gebruik einddatum als grens
  if (!schuld.actief && schuld.einddatum) {
    const eind = new Date(schuld.einddatum);
    eind.setHours(23,59,59,999);
    grens.setTime(eind.getTime());
  }

  let weken = 0;
  const d = new Date(eersteMaandag);
  while (d <= grens) {
    weken++;
    d.setDate(d.getDate() + 7);
  }
  return { weken, weekbedrag, eersteMaandag };
}

function berekenTotaalVerschuldigd(schuld) {
  const result = berekenVerschuldigdeWeken(schuld);
  const { weken, weekbedrag, eersteMaandag } = (result && typeof result === "object") ? result : { weken: 0, weekbedrag: 140, eersteMaandag: null };
  const extraBedragen = (schuld.betalingen || []).filter(b => Number(b.bedrag) < 0).reduce((s,b) => s + Math.abs(Number(b.bedrag)), 0);

  // Bereken gedeeltelijke eerste week: als niet op maandag gestart, €20/dag tot eerste maandag
  let partieelBedrag = 0;
  if (eersteMaandag && schuld.startdatum) {
    const start = new Date(schuld.startdatum);
    start.setHours(0,0,0,0);
    if (start.getDay() !== 1) { // 1 = maandag
      const dagbedrag = schuld.tarief_dagen ? Number(schuld.tarief_dagen) : 20;
      const dagenInPartieelWeek = Math.round((eersteMaandag - start) / (1000 * 60 * 60 * 24));
      partieelBedrag = dagenInPartieelWeek * dagbedrag;
    }
  }

  return (weken * weekbedrag) + partieelBedrag + Number(schuld.beginsaldo || 0) + extraBedragen;
}

function berekenTotaalBetaald(schuld) {
  return (schuld.betalingen || []).filter(b => Number(b.bedrag) > 0).reduce((s, b) => s + Number(b.bedrag), 0);
}

function berekenOpenstaand(schuld) {
  return Math.max(0, berekenTotaalVerschuldigd(schuld) - berekenTotaalBetaald(schuld));
}

function volgendeBetalingsDatum(schuld) {
  const { eersteMaandag } = berekenVerschuldigdeWeken(schuld);
  if (!eersteMaandag) return null;
  // Vind de eerstvolgende maandag na vandaag
  const nu = new Date();
  nu.setHours(0,0,0,0);
  const d = new Date(eersteMaandag);
  while (d <= nu) d.setDate(d.getDate() + 7);
  return d;
}

export function HuurbetalingenModule({ gebruiker, showToast, readonly = false }) {
  const [schulden, setSchulden] = useState([]);
  const [loading, setLoading] = useState(true);
  const [zoek, setZoek] = useState("");
  const [filterStatus, setFilterStatus] = useState("alle");
  const [sorteer, setSorteer] = useState("openstaand");
  const [toonNieuw, setToonNieuw] = useState(false);

  const isBackoffice = (gebruiker?.rol === "backoffice" || gebruiker?.rol === "financieel") && !readonly;

  const loadSchulden = useCallback(async () => {
    const { data: schuldData, error } = await supabase
      .from("huurschulden")
      .select("*, betalingen:huurbetalingen(*)")
      .order("created_at", { ascending: false });
    if (error) { console.error(error); return; }
    setSchulden(schuldData || []);
  }, []);

  useEffect(() => {
    async function init() { setLoading(true); await loadSchulden(); setLoading(false); }
    init();
  }, [loadSchulden]);

  useEffect(() => {
    const s1 = supabase.channel("hsc-rt").on("postgres_changes",{event:"*",schema:"public",table:"huurschulden"},()=>loadSchulden()).subscribe();
    const s2 = supabase.channel("hbt-rt").on("postgres_changes",{event:"*",schema:"public",table:"huurbetalingen"},()=>loadSchulden()).subscribe();
    return () => { supabase.removeChannel(s1); supabase.removeChannel(s2); };
  }, [loadSchulden]);

  async function addSchuld(data) {
    const { error } = await supabase.from("huurschulden").insert([{
      naam_medewerker: data.naam_medewerker,
      startdatum: data.startdatum,
      einddatum: data.einddatum || null,
      opmerkingen: data.opmerkingen || null,
      aangemaakt_door: gebruiker.naam,
      actief: true,
      beginsaldo: data.beginsaldo || 0,
      tarief_bedrag: data.tarief_bedrag || null,
      tarief_dagen: data.tarief_dagen || null,
    }]);
    if (error) { showToast("Fout bij opslaan","err"); return false; }
    showToast("✓ Huurschuld aangemaakt"); return true;
  }

  async function addBetaling(schuldId, bedrag, opmerking, datum) {
    const { error } = await supabase.from("huurbetalingen").insert([{
      schuld_id: schuldId,
      bedrag: Number(bedrag),
      datum: datum || todayISO(),
      opmerking: opmerking || null,
      geregistreerd_door: gebruiker.naam,
    }]);
    if (error) { showToast("Fout bij opslaan betaling","err"); return false; }
    // Auto-afsluiten: als schuld een einddatum heeft en nu volledig betaald is → actief=false
    const schuld = schulden.find(s => s.id === schuldId);
    if (schuld?.einddatum && schuld?.actief) {
      const bijgewerkt = { ...schuld, betalingen: [...(schuld.betalingen||[]), {bedrag: Number(bedrag), datum: datum||todayISO()}] };
      if (berekenOpenstaand(bijgewerkt) <= 0) {
        await supabase.from("huurschulden").update({ actief: false }).eq("id", schuldId);
        showToast("✓ Betaling opgeslagen — schuld volledig afgerond en afgesloten");
        return true;
      }
    }
    showToast("✓ Betaling geregistreerd"); return true;
  }

  async function sluitAf(schuldId) {
    const { error } = await supabase.from("huurschulden").update({
      actief: false, einddatum: todayISO(),
    }).eq("id", schuldId);
    if (error) { showToast("Fout bij afsluiten","err"); return false; }
    showToast("✓ Huurschuld afgesloten"); return true;
  }

  async function addOpmerking(schuldId, tekst) {
    const schuld = schulden.find(s => s.id === schuldId);
    const huidige = schuld?.opmerkingen || "";
    const nieuw = huidige ? huidige + "\n" + tekst : tekst;
    const { error } = await supabase.from("huurschulden").update({ opmerkingen: nieuw }).eq("id", schuldId);
    if (error) { showToast("Fout bij opslaan","err"); return false; }
    showToast("✓ Opmerking toegevoegd"); return true;
  }

  if (loading) return <div style={{textAlign:"center",padding:"60px",color:C.muted}}>⏳ Laden...</div>;

  const actief   = schulden.filter(s => s.actief);
  const gesloten = schulden.filter(s => !s.actief);
  const totaalOpen = actief.reduce((s, d) => s + berekenOpenstaand(d), 0);

  // Zoek + filter
  const q = zoek.toLowerCase().trim();
  const gefilterd = schulden
    .filter(s => {
      if (filterStatus === "openstaand") return s.actief;
      if (filterStatus === "afgesloten") return !s.actief;
      return true;
    })
    .filter(s => !q || (s.naam_medewerker || "").toLowerCase().includes(q) || (s.opmerkingen || "").toLowerCase().includes(q))
    .sort((a, b) => {
      // Altijd actief voor afgesloten
      if (a.actief !== b.actief) return a.actief ? -1 : 1;
      if (sorteer === "openstaand") return berekenOpenstaand(b) - berekenOpenstaand(a);
      if (sorteer === "naam") return (a.naam_medewerker||"").localeCompare(b.naam_medewerker||"");
      if (sorteer === "laatste_betaling") {
        const laatsteA = (a.betalingen||[]).filter(p=>Number(p.bedrag)>0).sort((x,y)=>new Date(y.datum)-new Date(x.datum))[0]?.datum || "0";
        const laatsteB = (b.betalingen||[]).filter(p=>Number(p.bedrag)>0).sort((x,y)=>new Date(y.datum)-new Date(x.datum))[0]?.datum || "0";
        return new Date(laatsteA) - new Date(laatsteB); // oudste betaling bovenaan
      }
      if (sorteer === "startdatum") return new Date(a.startdatum||0) - new Date(b.startdatum||0);
      return 0;
    });

  const actiefGefilterd  = gefilterd.filter(s => s.actief);
  const geslotenGefilterd = gefilterd.filter(s => !s.actief);

  return (
    <div>
      {/* Header met stats + knop */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,color:C.blauw,marginBottom:3}}>💶 Huurbetalingen</h2>
          <p style={{fontSize:13,color:C.muted}}>
            {actief.length} openstaand · {gesloten.length} afgesloten
            {totaalOpen > 0 && <> · <strong style={{color:C.rood}}>€{totaalOpen.toFixed(2)} open</strong></>}
          </p>
        </div>
        {isBackoffice && (
          <button onClick={() => setToonNieuw(!toonNieuw)}
            style={{background:toonNieuw?"white":C.blauw,color:toonNieuw?C.blauw:"white",border:`2px solid ${C.blauw}`,borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            {toonNieuw ? "✕ Annuleren" : "+ Nieuwe schuld"}
          </button>
        )}
      </div>

      {/* Nieuw schuld form */}
      {toonNieuw && isBackoffice && (
        <div style={{marginBottom:20}}>
          <NieuweSchuld onSubmit={async (d) => { const ok = await addSchuld(d); if (ok) setToonNieuw(false); }} showToast={showToast} />
        </div>
      )}

      {/* Rode banner als er openstaand is */}
      {totaalOpen > 0 && !toonNieuw && (
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <div style={{fontWeight:700,color:"#b91c1c",fontSize:13}}>⚠️ Totaal openstaand: €{totaalOpen.toFixed(2)}</div>
          <div style={{fontSize:12,color:"#b91c1c"}}>Verdeeld over {actief.length} medewerker{actief.length !== 1 ? "s" : ""}</div>
        </div>
      )}

      {/* Zoekbalk + filters + sortering */}
      <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <input
          value={zoek} onChange={e => setZoek(e.target.value)}
          placeholder="🔍 Zoek op naam..."
          style={{flex:1,minWidth:200,background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 14px",fontSize:13,outline:"none",fontFamily:"inherit"}}
        />
        <select value={sorteer} onChange={e => setSorteer(e.target.value)}
          style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 14px",fontSize:13,outline:"none",fontFamily:"inherit",cursor:"pointer"}}>
          <option value="openstaand">↓ Hoogst openstaand</option>
          <option value="laatste_betaling">⏰ Langst geen betaling</option>
          <option value="naam">A–Z Naam</option>
          <option value="startdatum">📅 Startdatum</option>
        </select>
      </div>
      <div style={{display:"flex",gap:4,marginBottom:16,flexWrap:"wrap"}}>
        {[["alle",`Alles (${schulden.length})`],["openstaand",`💶 Openstaand (${actief.length})`],["afgesloten",`✅ Afgesloten (${gesloten.length})`]].map(([v,l]) => (
          <button key={v} onClick={() => setFilterStatus(v)}
            style={{background:filterStatus===v?C.blauw:"white",color:filterStatus===v?"white":C.muted,border:`1.5px solid ${filterStatus===v?C.blauw:C.border}`,borderRadius:20,padding:"7px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            {l}
          </button>
        ))}
      </div>

      {q && <div style={{fontSize:12,color:C.muted,marginBottom:10}}>{gefilterd.length} resultaten voor "<strong>{zoek}</strong>"</div>}

      {gefilterd.length === 0 ? (
        <div style={{textAlign:"center",padding:"60px",color:C.muted}}>
          <div style={{fontSize:40,marginBottom:10}}>🔍</div>
          <div>{q ? `Geen resultaten voor "${zoek}"` : "Geen huurschulden gevonden 🎉"}</div>
        </div>
      ) : (
        <div style={{display:"grid",gap:16}}>
          {/* Openstaande schulden */}
          {actiefGefilterd.length > 0 && (
            <>
              {filterStatus === "alle" && (
                <div style={{display:"flex",alignItems:"center",gap:10,marginTop:4}}>
                  <span style={{fontWeight:700,fontSize:13,color:C.rood}}>💶 Openstaand ({actiefGefilterd.length})</span>
                  <div style={{flex:1,height:1,background:C.border}}/>
                </div>
              )}
              {actiefGefilterd.map(s => (
                <SchuldKaart key={s.id} schuld={s} isBackoffice={isBackoffice} onBetaling={addBetaling} onAfsluiten={sluitAf} onOpmerking={addOpmerking} showToast={showToast} readonly={readonly} gebruiker={gebruiker} />
              ))}
            </>
          )}

          {/* Afgesloten schulden */}
          {geslotenGefilterd.length > 0 && (
            <>
              {filterStatus === "alle" && (
                <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8}}>
                  <span style={{fontWeight:700,fontSize:13,color:C.groen}}>✅ Afgesloten ({geslotenGefilterd.length})</span>
                  <div style={{flex:1,height:1,background:C.border}}/>
                </div>
              )}
              {geslotenGefilterd.map(s => (
                <SchuldKaart key={s.id} schuld={s} isBackoffice={isBackoffice} onBetaling={addBetaling} onAfsluiten={sluitAf} onOpmerking={addOpmerking} showToast={showToast} readonly={true} gebruiker={gebruiker} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SCHULDEN LIJST ───────────────────────────────────────────────────────────
function SchuldenLijst({ schulden, gebruiker, isBackoffice, onBetaling, onAfsluiten, onOpmerking, showToast, readonly }) {
  if (schulden.length === 0) return (
    <div style={{textAlign:"center",padding:"60px",color:C.muted}}>
      <div style={{fontSize:40,marginBottom:10}}>💶</div>
      <div>{readonly ? "Geen afgesloten schulden" : "Geen openstaande huurschulden 🎉"}</div>
    </div>
  );

  return (
    <div style={{display:"grid",gap:16}}>
      {schulden.map(s => (
        <SchuldKaart key={s.id} schuld={s} isBackoffice={isBackoffice} onBetaling={onBetaling} onAfsluiten={onAfsluiten} onOpmerking={onOpmerking} showToast={showToast} readonly={readonly} gebruiker={gebruiker} />
      ))}
    </div>
  );
}

// ─── SCHULD KAART ─────────────────────────────────────────────────────────────
function SchuldKaart({ schuld, isBackoffice, onBetaling, onAfsluiten, onOpmerking, showToast, readonly, gebruiker }) {
  const [toonStopzetten, setToonStopzetten] = useState(false);
  const [stopDatum, setStopDatum] = useState("");
  const [toonBetalingen, setToonBetalingen] = useState(false);
  const [toonBetalingForm, setToonBetalingForm] = useState(false);
  const [toonExtraForm, setToonExtraForm] = useState(false);
  const [toonOpmerkingForm, setToonOpmerkingForm] = useState(false);
  const [bedrag, setBedrag] = useState("");
  const [extraBedrag, setExtraBedrag] = useState("");
  const [extraOpmerking, setExtraOpmerking] = useState("");
  const [betalingOpmerking, setBetalingOpmerking] = useState("");
  const [nieuweOpmerking, setNieuweOpmerking] = useState("");
  const [toonCollegaOpmerkingForm, setToonCollegaOpmerkingForm] = useState(false);
  const [collegaOpmerking, setCollegaOpmerking] = useState("");
  const [savingCollegaOpm, setSavingCollegaOpm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [betalingDatum, setBetalingDatum] = useState(todayISO());

  const openstaand    = berekenOpenstaand(schuld);
  const totaalBetaald = berekenTotaalBetaald(schuld);
  const totaalVerschuldigd = berekenTotaalVerschuldigd(schuld);
  const { weken, weekbedrag } = berekenVerschuldigdeWeken(schuld);
  const volgendeDatum = volgendeBetalingsDatum(schuld);
  const pct   = totaalVerschuldigd > 0 ? Math.min(100, (totaalBetaald / totaalVerschuldigd) * 100) : 0;

  async function handleBetaling() {
    if (!bedrag || isNaN(Number(bedrag)) || Number(bedrag) <= 0) { showToast("Vul een geldig bedrag in","err"); return; }
    setSaving(true);
    await onBetaling(schuld.id, bedrag, betalingOpmerking, betalingDatum);
    setSaving(false);
    setBedrag(""); setBetalingOpmerking(""); setBetalingDatum(todayISO()); setToonBetalingForm(false);
  }

  async function handleOpmerking() {
    if (!nieuweOpmerking.trim()) return;
    setSaving(true);
    await onOpmerking(schuld.id, `[${new Date().toLocaleDateString("nl-NL")}] ${nieuweOpmerking.trim()}`);
    setSaving(false);
    setNieuweOpmerking(""); setToonOpmerkingForm(false);
  }

  const kleur = openstaand === 0 ? C.groen : openstaand > 200 ? C.rood : "#f59e0b";

  return (
    <div style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${kleur}`,borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(27,58,107,.06)"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:16}}>
        <div>
          <div style={{fontWeight:800,fontSize:17,color:C.text,marginBottom:4}}>
            {schuld.naam_medewerker}
            {schuld.einddatum && schuld.actief && openstaand > 0 && (
              <span style={{marginLeft:8,fontSize:11,fontWeight:700,background:"#fef2f2",color:"#ef4444",padding:"2px 8px",borderRadius:8,border:"1px solid #fecaca"}}>
                🛑 Gestopt — schuld loopt nog
              </span>
            )}
            {schuld.actief && openstaand === 0 && (
              <span style={{marginLeft:8,fontSize:11,fontWeight:700,background:"#f0fdf4",color:C.groen,padding:"2px 8px",borderRadius:8,border:"1px solid #bbf7d0"}}>
                ✅ Volledig betaald — klaar om af te sluiten
              </span>
            )}
          </div>
          <div style={{fontSize:12,color:C.muted}}>
            Vanaf {fmtDate(schuld.startdatum)}
            {schuld.einddatum ? ` t/m ${fmtDate(schuld.einddatum)}` : " (lopend)"}
            {" · "}{weken} week{weken !== 1 ? "en" : ""}
            {" · €"}{weekbedrag}/week
          </div>
          {volgendeDatum && !schuld.einddatum && (
            <div style={{fontSize:12,color:"#f59e0b",fontWeight:600,marginTop:3}}>
              📅 Volgende betaling verwacht: {fmtDate(volgendeDatum)} (€{weekbedrag})
            </div>
          )}
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:24,fontWeight:800,color:kleur}}>€{openstaand.toFixed(2)}</div>
          <div style={{fontSize:11,color:C.muted}}>openstaand</div>
        </div>
      </div>

      {/* Voortgangsbalk */}
      <div style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.muted,marginBottom:6}}>
          <span>Betaald: <strong style={{color:C.groen}}>€{totaalBetaald.toFixed(2)}</strong></span>
          <span>Totaal verschuldigd: <strong style={{color:C.rood}}>€{totaalVerschuldigd.toFixed(2)}</strong></span>
        </div>
        <div style={{background:C.bg,borderRadius:99,height:10,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${pct}%`,background:C.groen,borderRadius:99,transition:"width .5s"}}/>
        </div>
        <div style={{fontSize:11,color:C.muted,marginTop:4,textAlign:"right"}}>{pct.toFixed(0)}% betaald</div>
      </div>

      {/* Opmerkingen */}
      {schuld.opmerkingen && (
        <div style={{background:C.bg,borderRadius:8,padding:"10px 14px",fontSize:13,color:C.muted,marginBottom:12,whiteSpace:"pre-wrap"}}>
          💬 {schuld.opmerkingen}
        </div>
      )}

      {/* Betalingen toggle */}
      {(schuld.betalingen || []).length > 0 && (
        <button onClick={() => setToonBetalingen(!toonBetalingen)}
          style={{background:"none",border:"none",color:C.blauw,fontSize:13,cursor:"pointer",fontFamily:"inherit",padding:"4px 0",marginBottom:8,fontWeight:600}}>
          {toonBetalingen ? "▲" : "▼"} {(schuld.betalingen || []).length} betaling{(schuld.betalingen || []).length !== 1 ? "en" : ""} bekijken
        </button>
      )}
      {toonBetalingen && (
        <div style={{background:C.bg,borderRadius:8,padding:12,marginBottom:12}}>
          {(schuld.betalingen || []).sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).map(b => (
            <div key={b.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,fontSize:13}}>
              <div>
                <span style={{fontWeight:700,color:C.groen}}>€{Number(b.bedrag).toFixed(2)}</span>
                <span style={{color:C.muted,marginLeft:10}}>{fmtDate(b.datum)}</span>
                {b.opmerking && <span style={{color:C.muted,marginLeft:10,fontStyle:"italic"}}>"{b.opmerking}"</span>}
              </div>
              <span style={{fontSize:11,color:C.muted}}>door {b.geregistreerd_door}</span>
            </div>
          ))}
        </div>
      )}

      {/* Readonly: collega mag opmerking plaatsen */}
      {readonly && (
        <div style={{marginTop:12}}>
          {toonCollegaOpmerkingForm ? (
            <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:16}}>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Opmerking plaatsen</label>
              <input value={collegaOpmerking} onChange={e=>setCollegaOpmerking(e.target.value)}
                placeholder="bijv. ik betaal op 15 mei de helft..."
                style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box",marginBottom:10}}
                autoFocus/>
              <div style={{display:"flex",gap:8}}>
                <button onClick={async()=>{
                  if(!collegaOpmerking.trim()){return;}
                  setSavingCollegaOpm(true);
                  stuurMail({
                    type: "💬 Opmerking huurschuld",
                    type_icon: "💬",
                    medewerker: schuld.naam_medewerker,
                    woning: "Huurschuld",
                    kamer: "—",
                    datum: new Date().toISOString().slice(0,10),
                    ingediend_door: gebruiker?.naam || "Collega",
                    opmerkingen: collegaOpmerking.trim(),
                  });
                  setSavingCollegaOpm(false);
                  setCollegaOpmerking(""); setToonCollegaOpmerkingForm(false);
                  showToast("✓ Opmerking verstuurd naar backoffice");
                }} disabled={savingCollegaOpm}
                  style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  {savingCollegaOpm ? "⏳" : "✓ Verstuur naar backoffice"}
                </button>
                <button onClick={()=>setToonCollegaOpmerkingForm(false)}
                  style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"9px 14px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                  Annuleren
                </button>
              </div>
            </div>
          ) : (
            <button onClick={()=>setToonCollegaOpmerkingForm(true)}
              style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"9px 14px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
              💬 Opmerking plaatsen
            </button>
          )}
        </div>
      )}

      {/* Acties voor backoffice */}
      {isBackoffice && !readonly && (
        <div>
          {toonExtraForm ? (
            <div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:10,padding:16,marginBottom:10}}>
              <div style={{fontWeight:700,fontSize:13,color:"#b45309",marginBottom:12}}>➕ Extra bedrag toevoegen</div>
              <div style={{fontSize:12,color:"#b45309",marginBottom:12}}>Voeg een extra bedrag toe aan de schuld (bijv. boete, schade of correctie). Dit verhoogt het openstaande bedrag.</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                <div>
                  <Label>Bedrag (€) *</Label>
                  <Input type="number" step="0.01" min="0.01" value={extraBedrag} onChange={e=>setExtraBedrag(e.target.value)} placeholder="bijv. 60.00" autoFocus/>
                </div>
                <div>
                  <Label>Reden *</Label>
                  <Input value={extraOpmerking} onChange={e=>setExtraOpmerking(e.target.value)} placeholder="bijv. schade aan kamer, boete..."/>
                </div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={async()=>{
                  if(!extraBedrag||isNaN(Number(extraBedrag))||Number(extraBedrag)<=0){showToast("Vul een geldig bedrag in","err");return;}
                  if(!extraOpmerking.trim()){showToast("Vul een reden in","err");return;}
                  setSaving(true);
                  await onBetaling(schuld.id, -Number(extraBedrag), "➕ Extra: "+extraOpmerking);
                  setSaving(false);
                  setExtraBedrag(""); setExtraOpmerking(""); setToonExtraForm(false);
                }} disabled={saving}
                  style={{background:"#f59e0b",color:"white",border:"none",borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  {saving ? "⏳" : "✓ Toevoegen aan schuld"}
                </button>
                <button onClick={()=>setToonExtraForm(false)}
                  style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"10px 14px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                  Annuleren
                </button>
              </div>
            </div>
          ) : toonBetalingForm ? (
            <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:16,marginBottom:10}}>
              <div style={{fontWeight:700,fontSize:13,color:C.groen,marginBottom:12}}>💶 Betaling registreren</div>
              <BetalingsKalender
                betalingen={schuld.betalingen || []}
                geselecteerdeDatum={betalingDatum}
                onSelecteer={setBetalingDatum}
              />
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12,marginTop:12}}>
                <div>
                  <Label>Bedrag (€) *</Label>
                  <Input type="number" step="0.01" min="0.01" value={bedrag} onChange={e=>setBedrag(e.target.value)} placeholder="bijv. 130.00" autoFocus/>
                </div>
                <div>
                  <Label>Opmerking</Label>
                  <Input value={betalingOpmerking} onChange={e=>setBetalingOpmerking(e.target.value)} placeholder="bijv. betaalt rest volgende week"/>
                </div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={handleBetaling} disabled={saving}
                  style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  {saving ? "⏳" : "✓ Betaling opslaan"}
                </button>
                <button onClick={()=>setToonBetalingForm(false)}
                  style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"10px 14px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                  Annuleren
                </button>
                <span style={{fontSize:12,color:C.muted,marginLeft:4}}>
                  Datum: <strong style={{color:C.blauw}}>{betalingDatum}</strong>
                </span>
              </div>
            </div>
          ) : toonOpmerkingForm ? (
            <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:16,marginBottom:10}}>
              <Label>Opmerking toevoegen</Label>
              <Input value={nieuweOpmerking} onChange={e=>setNieuweOpmerking(e.target.value)} placeholder="bijv. Pietje betaalt op 15 mei" autoFocus style={{marginBottom:10}}/>
              <div style={{display:"flex",gap:8}}>
                <button onClick={handleOpmerking} disabled={saving}
                  style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  {saving ? "⏳" : "✓ Opslaan"}
                </button>
                <button onClick={()=>setToonOpmerkingForm(false)}
                  style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"9px 14px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                  Annuleren
                </button>
              </div>
            </div>
          ) : (
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={()=>setToonBetalingForm(true)}
                style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                💶 Betaling toevoegen
              </button>
              <button onClick={()=>setToonExtraForm(true)}
                style={{background:"white",border:`1.5px solid #f59e0b`,color:"#b45309",borderRadius:8,padding:"9px 14px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                ➕ Extra bedrag
              </button>
              <button onClick={()=>setToonOpmerkingForm(true)}
                style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"9px 14px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                💬 Opmerking
              </button>
              {toonStopzetten ? (
                <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:12,minWidth:280}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.groen,marginBottom:8}}>📅 Einddatum instellen</div>
                  <div style={{fontSize:12,color:C.muted,marginBottom:8}}>De huur wordt berekend t/m deze datum. Daarna stopt de opbouw.</div>
                  <input type="date" value={stopDatum} onChange={e=>setStopDatum(e.target.value)}
                    style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,fontFamily:"inherit",background:"white",color:C.text,boxSizing:"border-box",marginBottom:8}}/>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={async()=>{
                      if(!stopDatum){showToast("Vul een einddatum in","err");return;}
                      await supabase.from("huurschulden").update({
                        einddatum: stopDatum,
                        actief: true,
                      }).eq("id",schuld.id);
                      showToast("✓ Einddatum ingesteld — huur stopt op "+fmtDate(new Date(stopDatum))+", schuld blijft open tot volledig betaald");
                      setToonStopzetten(false);
                    }} style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      ✓ Opslaan
                    </button>
                    <button onClick={()=>setToonStopzetten(false)}
                      style={{background:"white",border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                      Annuleren
                    </button>
                  </div>
                </div>
              ) : (
                // ─── FIX: fragment wrapper zodat twee buttons naast elkaar kunnen staan ───
                <>
                  <button onClick={()=>{setToonStopzetten(true);setStopDatum(new Date().toISOString().slice(0,10));}}
                    style={{background:"white",border:`1.5px solid ${C.oranje}`,color:C.oranje,borderRadius:8,padding:"9px 14px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                    🛑 Stopzetten
                  </button>
                  {openstaand === 0 && (
                    <button onClick={()=>{ if(window.confirm(`Schuld van ${schuld.naam_medewerker} afsluiten? Alles is betaald.`)) onAfsluiten(schuld.id); }}
                      style={{background:"#f0fdf4",border:`1.5px solid ${C.groen}`,color:C.groen,borderRadius:8,padding:"9px 14px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                      ✅ Afsluiten
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ─── BETALINGS KALENDER ───────────────────────────────────────────────────────
function BetalingsKalender({ betalingen, geselecteerdeDatum, onSelecteer }) {
  const nu = new Date();
  const initDatum = geselecteerdeDatum ? new Date(geselecteerdeDatum) : nu;
  const [huidigJaar, setHuidigJaar] = useState(initDatum.getFullYear());
  const [huidigMaand, setHuidigMaand] = useState(initDatum.getMonth()); // 0-based
  const [tooltip, setTooltip] = useState(null);

  const maandNamen = ["Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"];

  // Maak een map: "YYYY-MM-DD" -> betalingen[]
  const betalingMap = {};
  (betalingen || []).filter(b => Number(b.bedrag) > 0).forEach(b => {
    const key = b.datum ? b.datum.slice(0,10) : null;
    if (!key) return;
    if (!betalingMap[key]) betalingMap[key] = [];
    betalingMap[key].push(b);
  });

  // Bereken dagen van de maand
  const eersteDag = new Date(huidigJaar, huidigMaand, 1);
  const aantalDagen = new Date(huidigJaar, huidigMaand + 1, 0).getDate();
  // Maandag = 0, ..., Zondag = 6
  let startDag = eersteDag.getDay() - 1;
  if (startDag < 0) startDag = 6;

  function dagISO(dag) {
    const m = String(huidigMaand + 1).padStart(2,"0");
    const d = String(dag).padStart(2,"0");
    return `${huidigJaar}-${m}-${d}`;
  }

  function vorigeM() {
    if (huidigMaand === 0) { setHuidigMaand(11); setHuidigJaar(y => y-1); }
    else setHuidigMaand(m => m-1);
  }
  function volgendeM() {
    if (huidigMaand === 11) { setHuidigMaand(0); setHuidigJaar(y => y+1); }
    else setHuidigMaand(m => m+1);
  }

  const vandaag = new Date().toISOString().slice(0,10);
  const cellen = [];
  for (let i = 0; i < startDag; i++) cellen.push(null);
  for (let d = 1; d <= aantalDagen; d++) cellen.push(d);

  return (
    <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginBottom:4}}>
      {/* Navigatie */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <button onClick={vorigeM} style={{background:"none",border:"none",cursor:"pointer",fontSize:16,color:C.muted,padding:"2px 8px"}}>‹</button>
        <span style={{fontWeight:700,fontSize:13,color:C.blauw}}>{maandNamen[huidigMaand]} {huidigJaar}</span>
        <button onClick={volgendeM} style={{background:"none",border:"none",cursor:"pointer",fontSize:16,color:C.muted,padding:"2px 8px"}}>›</button>
      </div>

      {/* Dagnamen */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
        {["Ma","Di","Wo","Do","Vr","Za","Zo"].map(d => (
          <div key={d} style={{textAlign:"center",fontSize:10,fontWeight:700,color:C.muted,padding:"2px 0"}}>{d}</div>
        ))}
      </div>

      {/* Dagen grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
        {cellen.map((dag, i) => {
          if (!dag) return <div key={"e"+i}/>;
          const iso = dagISO(dag);
          const heeftBetaling = !!betalingMap[iso];
          const isGeselecteerd = iso === geselecteerdeDatum;
          const isVandaag = iso === vandaag;
          const bets = betalingMap[iso] || [];

          return (
            <div key={iso} style={{position:"relative"}}
              onMouseEnter={() => heeftBetaling && setTooltip({iso, bets})}
              onMouseLeave={() => setTooltip(null)}>
              <div onClick={() => onSelecteer(iso)}
                style={{
                  textAlign:"center", borderRadius:7, padding:"5px 2px", fontSize:12, fontWeight:isGeselecteerd||isVandaag?700:400,
                  cursor:"pointer", userSelect:"none", transition:"all .15s",
                  background: heeftBetaling ? "#dcfce7" : isGeselecteerd ? C.blauw+"15" : "white",
                  border: isGeselecteerd ? `2px solid ${C.blauw}` : heeftBetaling ? `1.5px solid ${C.groen}` : `1px solid ${C.border}`,
                  color: heeftBetaling ? C.groenDark : isGeselecteerd ? C.blauw : C.text,
                }}>
                {dag}
                {isVandaag && <div style={{width:4,height:4,borderRadius:"50%",background:C.blauw,margin:"1px auto 0"}}/>}
                {heeftBetaling && <div style={{fontSize:8,color:C.groenDark,fontWeight:700}}>✓</div>}
              </div>
              {/* Tooltip */}
              {tooltip?.iso === iso && (
                <div style={{position:"absolute",bottom:"110%",left:"50%",transform:"translateX(-50%)",background:C.blauwDark,color:"white",borderRadius:8,padding:"6px 10px",fontSize:11,whiteSpace:"nowrap",zIndex:99,boxShadow:"0 4px 12px rgba(0,0,0,.2)",pointerEvents:"none"}}>
                  {bets.map((b,bi) => (
                    <div key={bi}>💶 €{Number(b.bedrag).toFixed(2)} — {b.geregistreerd_door}</div>
                  ))}
                  <div style={{position:"absolute",bottom:-5,left:"50%",width:10,height:10,background:C.blauwDark,borderRadius:2,transform:"translateX(-50%) rotate(45deg)"}}/>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legenda */}
      <div style={{display:"flex",gap:14,marginTop:10,fontSize:11,color:C.muted}}>
        <span style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{width:12,height:12,borderRadius:3,background:"#dcfce7",border:`1px solid ${C.groen}`,display:"inline-block"}}/>
          Al verwerkt
        </span>
        <span style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{width:12,height:12,borderRadius:3,background:"white",border:`2px solid ${C.blauw}`,display:"inline-block"}}/>
          Geselecteerd
        </span>
      </div>
    </div>
  );
}

// ─── NIEUWE SCHULD FORMULIER ──────────────────────────────────────────────────
function NieuweSchuld({ onSubmit, showToast }) {
  const [naam, setNaam]           = useState("");
  const [startdatum, setStart]    = useState(todayISO());
  const [einddatum, setEind]      = useState("");
  const [opmerkingen, setOpm]     = useState("");
  const [beginsaldo, setBeginsaldo] = useState("");
  const [tariefType, setTariefType] = useState("standaard");
  const [tariefBedrag, setTariefBedrag] = useState("");
  const [saving, setSaving]       = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    if (!naam.trim())      { showToast("Vul naam medewerker in","err"); return; }
    if (!startdatum)       { showToast("Vul een startdatum in","err"); return; }
    setSaving(true);
    const ok = await onSubmit({ naam_medewerker: naam.trim(), startdatum, einddatum, opmerkingen, beginsaldo: beginsaldo ? Number(beginsaldo) : 0, tarief_bedrag: tariefType==="handmatig" && tariefBedrag ? Number(tariefBedrag) : null });
    setSaving(false);
    if (ok) { setNaam(""); setStart(todayISO()); setEind(""); setOpm(""); setSubmitted(true); setTimeout(()=>setSubmitted(false),2000); }
  }

  if (submitted) return (
    <div style={{textAlign:"center",padding:"60px",color:C.groen}}>
      <div style={{fontSize:40,marginBottom:10}}>✅</div>
      <div style={{fontWeight:700,fontSize:16}}>Huurschuld aangemaakt!</div>
    </div>
  );

  return (
    <div style={{maxWidth:600}}>
      <h3 style={{fontSize:16,fontWeight:800,color:C.blauw,marginBottom:20}}>Nieuwe huurschuld aanmaken</h3>
      <div style={{background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:10,padding:"12px 16px",marginBottom:20,fontSize:13,color:"#b45309"}}>
        ℹ️ Elke maandag op of na de startdatum wordt automatisch het weekbedrag bijgeteld. Standaard €140 per week, vooraf te betalen.
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <div style={{gridColumn:"1/-1"}}>
          <Label>Naam medewerker *</Label>
          <Input value={naam} onChange={e=>setNaam(e.target.value)} placeholder="Voor- en achternaam"/>
        </div>
        <div>
          <Label>Startdatum (eerste dag niet werken) *</Label>
          <Input type="date" value={startdatum} onChange={e=>setStart(e.target.value)}/>
        </div>
        <div>
          <Label>Einddatum (indien bekend)</Label>
          <Input type="date" value={einddatum} onChange={e=>setEind(e.target.value)}/>
          <div style={{fontSize:11,color:C.muted,marginTop:4}}>Leeg = teller loopt nog</div>
        </div>
        <div style={{gridColumn:"1/-1"}}>
          <Label>Weekbedrag</Label>
          <div style={{display:"flex",gap:10,marginBottom:12}}>
            {[["standaard","€140 per week (standaard)"],["handmatig","Afwijkend weekbedrag"]].map(([v,l])=>(
              <div key={v} onClick={()=>setTariefType(v)}
                style={{flex:1,border:`2px solid ${tariefType===v?C.blauw:C.border}`,borderRadius:10,padding:"14px 16px",cursor:"pointer",background:tariefType===v?C.blauw+"10":"white",textAlign:"center"}}>
                <div style={{fontWeight:700,fontSize:13,color:tariefType===v?C.blauw:C.muted}}>{l}</div>
                {v==="standaard" && <div style={{fontSize:11,color:C.muted,marginTop:4}}>Elke maandag €140</div>}
              </div>
            ))}
          </div>
          {tariefType==="handmatig" && (
            <div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:10,padding:14}}>
              <Label>Weekbedrag (€)</Label>
              <Input type="number" step="0.01" min="1" value={tariefBedrag} onChange={e=>setTariefBedrag(e.target.value)} placeholder="bijv. 70"/>
              <div style={{fontSize:11,color:C.muted,marginTop:6}}>Dit bedrag wordt elke maandag bijgeteld</div>
            </div>
          )}
        </div>
        <div>
          <Label>Beginsaldo (€) — bestaande achterstand</Label>
          <Input type="number" step="0.01" min="0" value={beginsaldo} onChange={e=>setBeginsaldo(e.target.value)} placeholder="bijv. 200.00 — laat leeg als er geen achterstand is"/>
          <div style={{fontSize:11,color:C.muted,marginTop:4}}>Dit bedrag wordt direct bovenop de dagelijkse teller gezet</div>
        </div>
        <div style={{gridColumn:"1/-1"}}>
          <Label>Opmerking</Label>
          <textarea value={opmerkingen} onChange={e=>setOpm(e.target.value)} placeholder="bijv. ziek gemeld, verwacht terug 15 mei..."
            style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",resize:"vertical",boxSizing:"border-box"}} rows={3}/>
        </div>
      </div>
      <button onClick={handleSubmit} disabled={saving}
        style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"12px 28px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
        {saving ? "⏳ Opslaan..." : "✓ Huurschuld aanmaken"}
      </button>
    </div>
  );
}
