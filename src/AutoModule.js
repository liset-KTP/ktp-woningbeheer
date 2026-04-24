import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

// ─── KLEUREN (zelfde als App.js) ──────────────────────────────────────────────
const C = {
  blauw:"#1B3A6B", blauwDark:"#132b52", blauwLight:"#2a52a0",
  groen:"#4A9B3C", groenDark:"#357a2b", groenLight:"#5cb84d",
  bg:"#f0f4f8", card:"#ffffff", border:"#d1dbe8",
  text:"#1a2b47", muted:"#6b7a8d", dark:"#0d1f3c",
};

const AUTO_STATUSSEN = ["Lopend","Beschikbaar","Gereserveerd","Niet beschikbaar","Moet ingenomen worden","Vakantie"];
const AUTO_STATUS_MAP = {
  "Lopend":                  { bg:"#4A9B3C18", text:"#357a2b", dot:"#4A9B3C" },
  "Beschikbaar":             { bg:"#1B3A6B18", text:"#1B3A6B", dot:"#2a52a0" },
  "Gereserveerd":            { bg:"#f59e0b18", text:"#b45309", dot:"#f59e0b" },
  "Niet beschikbaar":        { bg:"#ef444418", text:"#b91c1c", dot:"#ef4444" },
  "Moet ingenomen worden":   { bg:"#f9731618", text:"#c2410c", dot:"#f97316" },
  "Vakantie":                { bg:"#8b5cf618", text:"#6d28d9", dot:"#8b5cf6" },
};

function fmtDate(d) { if(!d) return ""; const dt=typeof d==="string"?new Date(d):d; return dt.toLocaleDateString("nl-NL",{day:"2-digit",month:"2-digit",year:"numeric"}); }
function fmtTime(d) { if(!d) return ""; const dt=typeof d==="string"?new Date(d):d; return dt.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"}); }
function fmtFull(d) { if(!d) return ""; return `${fmtDate(d)} ${fmtTime(d)}`; }
function todayISO() { return new Date().toISOString().slice(0,10); }
function nowISO() { return new Date().toISOString().slice(0,16); }

function SH({titel,sub,actie}) {
  return <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24}}>
    <div><h2 style={{fontSize:20,fontWeight:800,color:C.blauw,marginBottom:3}}>{titel}</h2>{sub&&<p style={{fontSize:13,color:C.muted}}>{sub}</p>}</div>
    {actie}
  </div>;
}

// ─── HOOFD AUTO MODULE ────────────────────────────────────────────────────────
export function AutoModule({ gebruiker, showToast }) {
  const [autos, setAutos] = useState([]);
  const [autoMeldingen, setAutoMeldingen] = useState([]);
  const [subTab, setSubTab] = useState("overzicht");
  const [loading, setLoading] = useState(true);

  const loadAutos = useCallback(async () => {
    const { data, error } = await supabase.from("autos").select("*").order("status").order("kenteken");
    if (error) { console.error(error); return; }
    setAutos(data || []);
  }, []);

  const loadAutoMeldingen = useCallback(async () => {
    const { data, error } = await supabase.from("auto_meldingen").select("*").order("created_at", { ascending: false });
    if (error) { console.error(error); return; }
    setAutoMeldingen(data || []);
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([loadAutos(), loadAutoMeldingen()]);
      setLoading(false);
    }
    init();
  }, [loadAutos, loadAutoMeldingen]);

  useEffect(() => {
    const s1 = supabase.channel("aut-rt").on("postgres_changes",{event:"*",schema:"public",table:"autos"},()=>loadAutos()).subscribe();
    const s2 = supabase.channel("aum-rt").on("postgres_changes",{event:"*",schema:"public",table:"auto_meldingen"},()=>loadAutoMeldingen()).subscribe();
    return () => { supabase.removeChannel(s1); supabase.removeChannel(s2); };
  }, [loadAutos, loadAutoMeldingen]);

  async function addAutoMelding(m) {
    const { error } = await supabase.from("auto_meldingen").insert([{...m, ingediend_door: gebruiker.naam, status:"open"}]);
    if (error) { showToast("Fout bij opslaan","err"); return false; }

    // Update auto status als uitgifte of inname
    if (m.kenteken && m.actie !== "geannuleerd") {
      const auto = autos.find(a => a.kenteken === m.kenteken);
      if (auto) {
        const nieuweStatus = m.actie === "uitgifte" ? "Lopend" : "Beschikbaar";
        const updates = {
          status: nieuweStatus,
          naam_medewerker: m.actie === "uitgifte" ? m.naam_medewerker : null,
        };
        await supabase.from("autos").update(updates).eq("id", auto.id);
      }
    }
    showToast("✓ Auto melding ingediend");
    return true;
  }

  async function updateAutoMelding(id, updates) {
    const { error } = await supabase.from("auto_meldingen").update({...updates, afgehandeld_door: gebruiker.naam, afgehandeld_op: new Date().toISOString()}).eq("id", id);
    if (error) showToast("Fout bij updaten","err");
    else showToast("✓ Bijgewerkt");
  }

  async function addAuto(auto) {
    const { error } = await supabase.from("autos").insert([auto]);
    if (error) { showToast("Fout bij toevoegen","err"); return false; }
    showToast("✓ Auto toegevoegd"); return true;
  }

  async function updateAuto(id, updates) {
    const { error } = await supabase.from("autos").update(updates).eq("id", id);
    if (error) { showToast("Fout bij opslaan","err"); return false; }
    showToast("✓ Opgeslagen"); return true;
  }

  async function deleteAuto(id) {
    const { error } = await supabase.from("autos").delete().eq("id", id);
    if (error) { showToast("Fout bij verwijderen","err"); return false; }
    showToast("✓ Auto verwijderd"); return true;
  }

  const openMeldingen = autoMeldingen.filter(m => m.status === "open");
  const isLiset = gebruiker?.naam === "Liset";
  const isBackoffice = gebruiker?.rol === "backoffice";

  if (loading) return <div style={{textAlign:"center",padding:"60px",color:C.muted}}>⏳ Laden...</div>;

  const tabs = [
    { id:"overzicht", label:"🚗 Overzicht" },
    { id:"melding",   label:"📋 Melding doorgeven" },
    { id:"log",       label:`📝 Log ${openMeldingen.length>0?`(${openMeldingen.length} open)`:""}` },
    ...(isBackoffice ? [{ id:"beheer", label:"⚙️ Auto beheer" }] : []),
  ];

  return (
    <div>
      <SH titel="🚗 Auto planning" sub={`${autos.length} auto's · ${autos.filter(a=>a.status==="Beschikbaar").length} beschikbaar · ${autos.filter(a=>a.status==="Lopend").length} uitgegeven`} />

      {/* Sub-tabs */}
      <div style={{display:"flex",gap:6,marginBottom:24,borderBottom:`2px solid ${C.border}`,paddingBottom:0}}>
        {tabs.map(t => (
          <button key={t.id} onClick={()=>setSubTab(t.id)}
            style={{background:"none",border:"none",padding:"10px 18px",fontSize:13,fontWeight:700,color:subTab===t.id?C.blauw:C.muted,borderBottom:subTab===t.id?`3px solid ${C.blauw}`:"3px solid transparent",marginBottom:-2,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}
      </div>

      {subTab==="overzicht" && <AutoOverzicht autos={autos} gebruiker={gebruiker} />}
      {subTab==="melding"   && <AutoMeldingForm autos={autos} gebruiker={gebruiker} onSubmit={addAutoMelding} showToast={showToast} />}
      {subTab==="log"       && <AutoLog meldingen={autoMeldingen} autos={autos} onUpdate={updateAutoMelding} gebruiker={gebruiker} isBackoffice={isBackoffice} />}
      {subTab==="beheer" && isBackoffice && <AutoBeheer autos={autos} onAdd={addAuto} onUpdate={updateAuto} onDelete={deleteAuto} showToast={showToast} />}
    </div>
  );
}

// ─── AUTO OVERZICHT ───────────────────────────────────────────────────────────
function AutoOverzicht({ autos, gebruiker }) {
  const [filterStatus, setFilterStatus] = useState("Alle");
  const [zoek, setZoek] = useState("");
  const isCollega = gebruiker?.rol === "collega";

  const filtered = autos.filter(a => {
    if (filterStatus !== "Alle" && a.status !== filterStatus) return false;
    if (zoek.trim()) {
      const q = zoek.toLowerCase();
      return a.kenteken?.toLowerCase().includes(q) ||
             a.merk_model?.toLowerCase().includes(q) ||
             a.naam_medewerker?.toLowerCase().includes(q);
    }
    return true;
  });

  // APK waarschuwing: binnen 60 dagen
  const apkWaarschuwing = autos.filter(a => {
    if (!a.apk_datum) return false;
    const dagen = Math.ceil((new Date(a.apk_datum) - new Date()) / 86400000);
    return dagen <= 60 && dagen >= 0;
  });

  const verlopen = autos.filter(a => {
    if (!a.apk_datum) return false;
    return new Date(a.apk_datum) < new Date();
  });

  return (
    <div>
      {/* APK waarschuwingen — alleen voor backoffice en huismeester */}
      {!isCollega && (apkWaarschuwing.length > 0 || verlopen.length > 0) && (
        <div style={{marginBottom:20}}>
          {verlopen.length > 0 && (
            <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:12,padding:"12px 18px",marginBottom:10}}>
              <div style={{fontWeight:700,color:"#b91c1c",marginBottom:6}}>🚨 APK verlopen ({verlopen.length})</div>
              {verlopen.map(a => <div key={a.id} style={{fontSize:13,color:"#b91c1c"}}>• {a.kenteken} — {a.merk_model} — verlopen op {fmtDate(a.apk_datum)}</div>)}
            </div>
          )}
          {apkWaarschuwing.length > 0 && (
            <div style={{background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:12,padding:"12px 18px"}}>
              <div style={{fontWeight:700,color:"#b45309",marginBottom:6}}>⚠️ APK bijna verlopen ({apkWaarschuwing.length})</div>
              {apkWaarschuwing.map(a => {
                const dagen = Math.ceil((new Date(a.apk_datum) - new Date()) / 86400000);
                return <div key={a.id} style={{fontSize:13,color:"#b45309"}}>• {a.kenteken} — {a.merk_model} — over {dagen} dagen ({fmtDate(a.apk_datum)})</div>;
              })}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,marginBottom:20}}>
        {[
          {label:"Totaal",     val:autos.length,                                        color:C.muted},
          {label:"Uitgegeven", val:autos.filter(a=>a.status==="Lopend").length,          color:C.groen},
          {label:"Beschikbaar",val:autos.filter(a=>a.status==="Beschikbaar").length,     color:C.blauw},
          {label:"Niet beschikbaar",val:autos.filter(a=>a.status==="Niet beschikbaar").length, color:"#ef4444"},
        ].map(s=>(
          <div key={s.label} className="card" style={{borderTop:`3px solid ${s.color}`,padding:"12px 14px"}}>
            <div style={{fontSize:22,fontWeight:800,color:s.color}}>{s.val}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input value={zoek} onChange={e=>setZoek(e.target.value)} placeholder="🔍 Zoek kenteken, auto, medewerker..."
          style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 14px",fontSize:13,outline:"none",width:260}}/>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {["Alle",...AUTO_STATUSSEN].map(s=>(
            <button key={s} onClick={()=>setFilterStatus(s)}
              style={{background:filterStatus===s?C.blauw:"white",color:filterStatus===s?"white":C.muted,border:`1.5px solid ${filterStatus===s?C.blauw:C.border}`,borderRadius:20,padding:"5px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Auto tabel */}
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"120px 1fr 140px 120px 100px 100px 80px",padding:"10px 16px",fontSize:10,fontWeight:700,color:C.muted,letterSpacing:".6px",textTransform:"uppercase",borderBottom:`1px solid ${C.border}`,background:C.bg}}>
          <span>Kenteken</span><span>Auto</span><span>Medewerker</span><span>Vestiging</span><span>APK datum</span><span>Uitgifte</span><span>Status</span>
        </div>
        {filtered.length === 0 && (
          <div style={{textAlign:"center",padding:"40px",color:C.muted}}>Geen auto's gevonden</div>
        )}
        {filtered.map((a,i) => {
          const c = AUTO_STATUS_MAP[a.status] || {bg:C.bg,text:C.muted,dot:C.muted};
          const apkVerloopt = a.apk_datum && Math.ceil((new Date(a.apk_datum)-new Date())/86400000) <= 60;
          const apkVerlopen = a.apk_datum && new Date(a.apk_datum) < new Date();
          return (
            <div key={a.id} style={{display:"grid",gridTemplateColumns:"120px 1fr 140px 120px 100px 100px 80px",padding:"12px 16px",fontSize:13,borderBottom:i<filtered.length-1?`1px solid ${C.border}`:"none",alignItems:"center",background:i%2===0?"white":C.bg+"40"}}>
              <span style={{fontWeight:800,color:C.blauw,fontFamily:"monospace",fontSize:14}}>{a.kenteken}</span>
              <div>
                <div style={{fontWeight:600,color:C.text}}>{a.merk_model}</div>
                {a.kleur && <div style={{fontSize:11,color:C.muted}}>{a.kleur}</div>}
              </div>
              <span style={{fontSize:12,color:C.text}}>{a.naam_medewerker||<span style={{color:C.muted,fontStyle:"italic"}}>—</span>}</span>
              <span style={{fontSize:12,color:C.muted}}>{a.vestiging||"—"}</span>
              <span style={{fontSize:12,color:apkVerlopen?"#ef4444":apkVerloopt?"#f59e0b":C.muted,fontWeight:apkVerlopen||apkVerloopt?700:400}}>
                {a.apk_datum?fmtDate(a.apk_datum):"—"}
                {apkVerlopen&&" ⚠️"}
              </span>
              <span style={{fontSize:12,color:C.muted}}>{a.datum_uitgifte?fmtDate(a.datum_uitgifte):"—"}</span>
              <span style={{padding:"3px 8px",borderRadius:6,background:c.bg,color:c.text,fontSize:10,fontWeight:700,whiteSpace:"nowrap"}}>{a.status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── AUTO MELDING FORM ────────────────────────────────────────────────────────
function AutoMeldingForm({ autos, gebruiker, onSubmit, showToast }) {
  const [actie, setActie] = useState("uitgifte");
  const [kenteken, setKenteken] = useState("");
  const [naamMedewerker, setNaamMedewerker] = useState("");
  const [datumTijd, setDatumTijd] = useState(nowISO());
  const [tankVol, setTankVol] = useState(null);
  const [schoon, setSchoon] = useState(null);
  const [formulier, setFormulier] = useState(null);
  const [rijbewijs, setRijbewijs] = useState(null);
  const [kilometerstand, setKilometerstand] = useState("");
  const [locatie, setLocatie] = useState("");
  const [opmerkingen, setOpmerkingen] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const acties = [
    { id:"uitgifte",    icon:"🚗", label:"UITGIFTE",       color:C.groen },
    { id:"inname",      icon:"🔑", label:"INNAME",         color:C.blauw },
    { id:"storing",     icon:"🔧", label:"SCHADE/STORING", color:"#f59e0b" },
    { id:"geannuleerd", icon:"❌", label:"GEANNULEERD",    color:"#ef4444" },
  ];

  async function handleSubmit() {
    if (!kenteken) { showToast("Selecteer een kenteken","err"); return; }
    if (!naamMedewerker.trim()) { showToast("Vul naam medewerker in","err"); return; }
    if (actie !== "geannuleerd" && actie !== "storing") {
      if (tankVol===null) { showToast("Geef aan of tank vol is","err"); return; }
      if (schoon===null) { showToast("Geef aan of auto schoon is","err"); return; }
    }
    setSaving(true);
    const ok = await onSubmit({
      actie, kenteken, naam_medewerker: naamMedewerker.trim(),
      datum_tijd: datumTijd, tank_vol: tankVol, schoon,
      formulier_getekend: formulier, rijbewijs_gecontroleerd: rijbewijs,
      kilometerstand: kilometerstand || null, locatie: locatie || null,
      opmerkingen: opmerkingen || null,
    });
    setSaving(false);
    if (ok) {
      setKenteken(""); setNaamMedewerker(""); setTankVol(null); setSchoon(null);
      setFormulier(null); setRijbewijs(null); setKilometerstand(""); setLocatie(""); setOpmerkingen("");
      setSubmitted(true); setTimeout(()=>setSubmitted(false), 2500);
    }
  }

  if (submitted) return (
    <div className="card" style={{textAlign:"center",padding:"60px 40px",maxWidth:600,margin:"0 auto",borderTop:`4px solid ${C.groen}`}}>
      <div style={{fontSize:64,marginBottom:16}}>✅</div>
      <div style={{fontSize:22,fontWeight:800,color:C.groen,marginBottom:8}}>Auto melding ingediend!</div>
      <button className="btn-b" onClick={()=>setSubmitted(false)}>Nieuwe melding</button>
    </div>
  );

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <SH titel="Auto melding doorgeven" sub="Geef een uitgifte, inname of annulering door" />

      {/* Actie kiezen */}
      <div className="card" style={{marginBottom:16,borderTop:`3px solid ${C.blauw}`}}>
        <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:8,display:"block"}}>Actie</label>
        <div style={{display:"flex",gap:10}}>
          {acties.map(a => (
            <div key={a.id} onClick={()=>setActie(a.id)}
              style={{flex:1,border:`2px solid ${actie===a.id?a.color:C.border}`,borderRadius:10,padding:"14px",textAlign:"center",cursor:"pointer",background:actie===a.id?a.color+"12":"white",transition:"all .2s"}}>
              <div style={{fontSize:24,marginBottom:6}}>{a.icon}</div>
              <div style={{fontSize:11,fontWeight:700,color:actie===a.id?a.color:C.muted,letterSpacing:".8px"}}>{a.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:16}}>
        <div>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Kenteken *</label>
          <select style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",appearance:"none"}}
            value={kenteken} onChange={e=>setKenteken(e.target.value)}>
            <option value="">Selecteer auto</option>
            {autos.map(a=><option key={a.id} value={a.kenteken}>{a.kenteken} — {a.merk_model} [{a.status}]</option>)}
          </select>
        </div>
        <div>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Naam medewerker *</label>
          <input style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none"}}
            value={naamMedewerker} onChange={e=>setNaamMedewerker(e.target.value)} placeholder="Voor- en achternaam"/>
        </div>
        <div>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Datum + Tijd *</label>
          <input type="datetime-local" style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none"}}
            value={datumTijd} onChange={e=>setDatumTijd(e.target.value)}/>
        </div>
        <div>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Kilometerstand</label>
          <input style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none"}}
            value={kilometerstand} onChange={e=>setKilometerstand(e.target.value)} placeholder="bijv. 45230" type="number"/>
        </div>
      </div>

      {actie !== "geannuleerd" && actie !== "storing" && (
        <div className="card" style={{marginBottom:16}}>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:12,display:"block"}}>Controlelijst</label>
          {[
            {label:"⛽ Tank vol?",       val:tankVol,  set:setTankVol},
            {label:"🧹 Auto schoon?",    val:schoon,   set:setSchoon},
            {label:"📝 Formulier getekend?", val:formulier, set:setFormulier},
            {label:"🪪 Rijbewijs gecontroleerd?", val:rijbewijs, set:setRijbewijs},
          ].map(({label,val,set})=>(
            <div key={label} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
              <span style={{flex:1,fontSize:14,fontWeight:500,color:C.text}}>{label}</span>
              <div style={{display:"flex",gap:8}}>
                {["ja","nee"].map(v=>(
                  <button key={v} onClick={()=>set(v)}
                    style={{padding:"5px 14px",borderRadius:6,fontSize:12,fontWeight:600,border:"1.5px solid",cursor:"pointer",transition:"all .15s",
                      borderColor:v==="ja"?C.groen:"#ef4444",
                      color:val===v?"white":(v==="ja"?C.groen:"#ef4444"),
                      background:val===v?(v==="ja"?C.groen:"#ef4444"):"white"}}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {actie === "inname" && (
            <div style={{marginTop:12}}>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Locatie auto bij inname</label>
              <input style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none"}}
                value={locatie} onChange={e=>setLocatie(e.target.value)} placeholder="bijv. Parkeerplaats kantoor Enschede"/>
            </div>
          )}
        </div>
      )}

      {/* Storing/schade melden */}
      {actie === "storing" && (
        <div className="card" style={{marginBottom:16,borderTop:`3px solid #f59e0b`}}>
          <label style={{fontSize:11,fontWeight:600,color:"#b45309",letterSpacing:".8px",textTransform:"uppercase",marginBottom:12,display:"block"}}>
            🔧 Wat is er aan de hand?
          </label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            {["Lekke band","Lamp kapot","Motorstoring","Schade / aanrijding","Ruit beschadigd","Accu leeg","Remmen","Overig"].map(opt => {
              const selected = opmerkingen.includes(opt);
              return (
                <button key={opt} onClick={()=>setOpmerkingen(prev => selected ? prev.replace(opt+", ","").replace(", "+opt,"").replace(opt,"").trim() : (prev?prev+", ":"")+opt)}
                  style={{background:selected?"#f59e0b18":"white",border:`1.5px solid ${selected?"#f59e0b":C.border}`,borderRadius:8,padding:"10px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,color:selected?"#b45309":C.text,textAlign:"left",transition:"all .15s"}}>
                  {selected?"✓ ":""}{opt}
                </button>
              );
            })}
          </div>
          <div style={{background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#b45309",fontWeight:500}}>
            ⚠️ De backoffice en huismeester worden direct geïnformeerd
          </div>
        </div>
      )}

      <div className="card" style={{marginBottom:20}}>
        <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Opmerkingen</label>
        <textarea style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",resize:"vertical",fontFamily:"inherit"}}
          value={opmerkingen} onChange={e=>setOpmerkingen(e.target.value)} placeholder="Eventuele bijzonderheden..." rows={3}/>
      </div>

      <button onClick={handleSubmit} disabled={saving}
        style={{width:"100%",background:saving?C.border:C.blauw,color:"white",border:"none",borderRadius:8,padding:14,fontSize:15,fontWeight:700,cursor:saving?"not-allowed":"pointer",fontFamily:"inherit",transition:"background .2s"}}>
        {saving?"⏳ Opslaan...":`✓ ${actie.charAt(0).toUpperCase()+actie.slice(1)} doorgeven`}
      </button>
    </div>
  );
}

// ─── AUTO LOG ─────────────────────────────────────────────────────────────────
function AutoLog({ meldingen, autos, onUpdate, gebruiker, isBackoffice }) {
  const [filter, setFilter] = useState("alle");
  const [notitieMap, setNotitieMap] = useState({});

  const gefilterd = meldingen.filter(m =>
    filter === "alle" ? true :
    filter === "open" ? m.status === "open" :
    filter === "uitgifte" ? m.actie === "uitgifte" :
    filter === "inname" ? m.actie === "inname" :
    filter === "storing" ? m.actie === "storing" : true
  );

  const actiKleur = { uitgifte:C.groen, inname:C.blauw, storing:"#f59e0b", geannuleerd:"#ef4444" };
  const actiIcon  = { uitgifte:"🚗", inname:"🔑", storing:"🔧", geannuleerd:"❌" };

  function exportCSV() {
    let csv = "Datum,Tijd,Actie,Kenteken,Medewerker,Tank vol,Schoon,Formulier,Rijbewijs,KM stand,Locatie,Door,Opmerkingen\n";
    meldingen.forEach(m => {
      const dt = m.created_at ? new Date(m.created_at) : new Date();
      csv += `"${fmtDate(dt)}","${fmtTime(dt)}","${m.actie}","${m.kenteken}","${m.naam_medewerker}","${m.tank_vol||""}","${m.schoon||""}","${m.formulier_getekend||""}","${m.rijbewijs_gecontroleerd||""}","${m.kilometerstand||""}","${m.locatie||""}","${m.ingediend_door}","${m.opmerkingen||""}"\n`;
    });
    const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`KTP_auto_log_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <h3 style={{fontSize:18,fontWeight:800,color:C.blauw}}>Auto log</h3>
          <p style={{fontSize:13,color:C.muted,marginTop:2}}>{meldingen.length} meldingen totaal</p>
        </div>
        <button onClick={exportCSV}
          style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit"}}>
          ⬇ Exporteer CSV
        </button>
      </div>

      <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
        {[["alle","Alle"],["open","Open"],["uitgifte","Uitgifte"],["inname","Inname"],["storing","Schade/Storing"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFilter(v)}
            style={{background:filter===v?C.blauw:"white",color:filter===v?"white":C.muted,border:`1.5px solid ${filter===v?C.blauw:C.border}`,borderRadius:20,padding:"6px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            {l}
          </button>
        ))}
      </div>

      {gefilterd.length === 0 ? (
        <div className="card" style={{textAlign:"center",padding:"50px",color:C.muted}}>
          <div style={{fontSize:40,marginBottom:10}}>🚗</div>
          <div>Geen meldingen gevonden</div>
        </div>
      ) : gefilterd.map(m => {
        const checkItem = (val, label) => (
          <span className="badge" style={{background:val==="ja"?C.groen+"18":val==="nee"?"#fef2f2":C.bg, color:val==="ja"?C.groen:val==="nee"?"#ef4444":C.muted, fontSize:11}}>
            {label}: {val||"—"}
          </span>
        );
        return (
          <div key={m.id} style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${actiKleur[m.actie]||C.muted}`,borderRadius:10,padding:16,marginBottom:10,boxShadow:`0 1px 3px rgba(27,58,107,.05)`}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
              <span style={{fontSize:24}}>{actiIcon[m.actie]||"🚗"}</span>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:6}}>
                  <span style={{fontWeight:800,fontSize:15,color:C.text,fontFamily:"monospace"}}>{m.kenteken}</span>
                  <span style={{fontWeight:600,fontSize:14,color:C.text}}>{m.naam_medewerker}</span>
                  <span style={{padding:"3px 10px",borderRadius:20,background:(actiKleur[m.actie]||C.muted)+"18",color:actiKleur[m.actie]||C.muted,fontSize:11,fontWeight:700}}>
                    {(m.actie||"").toUpperCase()}
                  </span>
                  <span style={{marginLeft:"auto",padding:"3px 10px",borderRadius:20,background:m.status==="open"?C.blauw+"18":"#f0fdf4",color:m.status==="open"?C.blauw:C.groen,fontSize:11,fontWeight:700}}>
                    {(m.status||"").toUpperCase()}
                  </span>
                </div>
                <div style={{fontSize:12,color:C.muted,marginBottom:8}}>
                  📅 {m.datum_tijd?fmtFull(m.datum_tijd):fmtFull(m.created_at)} · Door: {m.ingediend_door}
                  {m.kilometerstand && ` · 🛣 ${m.kilometerstand} km`}
                  {m.locatie && ` · 📍 ${m.locatie}`}
                </div>
                {m.actie !== "geannuleerd" && (
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
                    {checkItem(m.tank_vol,"⛽ Tank vol")}
                    {checkItem(m.schoon,"🧹 Schoon")}
                    {checkItem(m.formulier_getekend,"📝 Formulier")}
                    {checkItem(m.rijbewijs_gecontroleerd,"🪪 Rijbewijs")}
                  </div>
                )}
                {m.opmerkingen && <div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>"{m.opmerkingen}"</div>}
                {m.afgehandeld_door && <div style={{fontSize:12,color:C.groen,marginTop:4}}>✓ Afgehandeld door {m.afgehandeld_door}</div>}
              </div>
            </div>
            {isBackoffice && m.status === "open" && (
              <div style={{marginTop:12,display:"flex",gap:10}}>
                <input value={notitieMap[m.id]||""} onChange={e=>setNotitieMap(p=>({...p,[m.id]:e.target.value}))}
                  placeholder="Notitie (optioneel)..."
                  style={{flex:1,background:C.bg,border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
                <button onClick={()=>onUpdate(m.id,{status:"verwerkt",notitie:notitieMap[m.id]||null})}
                  style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  ✓ Verwerkt
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── AUTO BEHEER ──────────────────────────────────────────────────────────────
function AutoBeheer({ autos, onAdd, onUpdate, onDelete, showToast }) {
  const [toonNieuwe, setToonNieuwe] = useState(false);
  const [nieuw, setNieuw] = useState({kenteken:"",merk_model:"",kleur:"",apk_datum:"",datum_uitgifte:"",vestiging:"",status:"Beschikbaar",naam_medewerker:""});
  const [bewerkId, setBewerkId] = useState(null);
  const [saving, setSaving] = useState(false);

  async function voegToe() {
    if (!nieuw.kenteken.trim() || !nieuw.merk_model.trim()) { showToast("Vul kenteken en auto in","err"); return; }
    setSaving(true);
    await onAdd({...nieuw, kenteken: nieuw.kenteken.toUpperCase().trim()});
    setSaving(false);
    setNieuw({kenteken:"",merk_model:"",kleur:"",apk_datum:"",datum_uitgifte:"",vestiging:"",status:"Beschikbaar",naam_medewerker:""});
    setToonNieuwe(false);
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <h3 style={{fontSize:16,fontWeight:800,color:C.blauw}}>Auto's beheren ({autos.length})</h3>
        <button onClick={()=>setToonNieuwe(!toonNieuwe)}
          style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
          + Auto toevoegen
        </button>
      </div>

      {toonNieuwe && (
        <div className="card" style={{marginBottom:16,borderTop:`3px solid ${C.groen}`}}>
          <div style={{fontWeight:700,fontSize:13,color:C.groen,marginBottom:14}}>Nieuwe auto toevoegen</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
            {[
              {label:"Kenteken *",      key:"kenteken",      ph:"34-GD-HV"},
              {label:"Merk & model *",  key:"merk_model",    ph:"Peugeot 206 Grijs"},
              {label:"Kleur",           key:"kleur",         ph:"Grijs"},
              {label:"Vestiging",       key:"vestiging",     ph:"E / O / L"},
              {label:"Naam medewerker", key:"naam_medewerker",ph:"Wie heeft de auto"},
            ].map(f=>(
              <div key={f.key}>
                <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>{f.label}</label>
                <input value={nieuw[f.key]} onChange={e=>setNieuw(p=>({...p,[f.key]:e.target.value}))} placeholder={f.ph}
                  style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
              </div>
            ))}
            <div>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>APK datum</label>
              <input type="date" value={nieuw.apk_datum} onChange={e=>setNieuw(p=>({...p,apk_datum:e.target.value}))}
                style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
            </div>
            <div>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Datum uitgifte</label>
              <input type="date" value={nieuw.datum_uitgifte} onChange={e=>setNieuw(p=>({...p,datum_uitgifte:e.target.value}))}
                style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
            </div>
            <div>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Status</label>
              <select value={nieuw.status} onChange={e=>setNieuw(p=>({...p,status:e.target.value}))}
                style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",appearance:"none",fontFamily:"inherit"}}>
                {AUTO_STATUSSEN.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={voegToe} disabled={saving}
              style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"10px 24px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              {saving?"⏳ Opslaan...":"✓ Toevoegen"}
            </button>
            <button onClick={()=>setToonNieuwe(false)}
              style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"10px 16px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
              Annuleren
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"120px 1fr 130px 100px 100px 120px 80px",padding:"10px 16px",fontSize:10,fontWeight:700,color:C.muted,letterSpacing:".6px",textTransform:"uppercase",borderBottom:`1px solid ${C.border}`,background:C.bg}}>
          <span>Kenteken</span><span>Auto</span><span>Medewerker</span><span>Vestiging</span><span>APK</span><span>Status</span><span>Acties</span>
        </div>
        {autos.map((a,i) => {
          const c = AUTO_STATUS_MAP[a.status]||{bg:C.bg,text:C.muted};
          return bewerkId === a.id ? (
            <AutoBewerken key={a.id} auto={a} onSave={async u=>{setSaving(true);await onUpdate(a.id,u);setSaving(false);setBewerkId(null);}} onCancel={()=>setBewerkId(null)} saving={saving}/>
          ) : (
            <div key={a.id} style={{display:"grid",gridTemplateColumns:"120px 1fr 130px 100px 100px 120px 80px",padding:"12px 16px",fontSize:12,borderBottom:i<autos.length-1?`1px solid ${C.border}`:"none",alignItems:"center",background:i%2===0?"white":C.bg+"40"}}>
              <span style={{fontWeight:800,color:C.blauw,fontFamily:"monospace"}}>{a.kenteken}</span>
              <div><div style={{fontWeight:600,color:C.text}}>{a.merk_model}</div>{a.kleur&&<div style={{fontSize:11,color:C.muted}}>{a.kleur}</div>}</div>
              <span style={{color:C.muted}}>{a.naam_medewerker||"—"}</span>
              <span style={{color:C.muted}}>{a.vestiging||"—"}</span>
              <span style={{color:a.apk_datum&&new Date(a.apk_datum)<new Date()?"#ef4444":C.muted}}>{a.apk_datum?fmtDate(a.apk_datum):"—"}</span>
              <span style={{padding:"3px 8px",borderRadius:6,background:c.bg,color:c.text,fontSize:10,fontWeight:700}}>{a.status}</span>
              <div style={{display:"flex",gap:4}}>
                <button onClick={()=>setBewerkId(a.id)} style={{background:"white",border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11}}>✏️</button>
                <button onClick={async()=>{if(window.confirm(`${a.kenteken} verwijderen?`)){await onDelete(a.id);}}} style={{background:"#dc2626",color:"white",border:"none",borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11}}>🗑</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AutoBewerken({ auto, onSave, onCancel, saving }) {
  const [v, setV] = useState({...auto});
  return (
    <div style={{padding:"16px",borderBottom:`1px solid ${C.border}`,background:C.blauw+"08",border:`1.5px solid ${C.blauw}`,borderRadius:8,margin:"4px 8px"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:10}}>
        {[
          {label:"Kenteken",      key:"kenteken"},
          {label:"Merk & model",  key:"merk_model"},
          {label:"Kleur",         key:"kleur"},
          {label:"Vestiging",     key:"vestiging"},
          {label:"Medewerker",    key:"naam_medewerker"},
          {label:"APK datum",     key:"apk_datum",     type:"date"},
          {label:"Datum uitgifte",key:"datum_uitgifte", type:"date"},
        ].map(f=>(
          <div key={f.key}>
            <label style={{fontSize:10,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>{f.label}</label>
            <input type={f.type||"text"} value={v[f.key]||""} onChange={e=>setV(p=>({...p,[f.key]:e.target.value}))}
              style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:6,color:C.text,padding:"7px 10px",fontSize:12,outline:"none",fontFamily:"inherit"}}/>
          </div>
        ))}
        <div>
          <label style={{fontSize:10,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>Status</label>
          <select value={v.status||"Beschikbaar"} onChange={e=>setV(p=>({...p,status:e.target.value}))}
            style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:6,color:C.text,padding:"7px 10px",fontSize:12,outline:"none",appearance:"none",fontFamily:"inherit"}}>
            {AUTO_STATUSSEN.map(s=><option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>onSave(v)} disabled={saving}
          style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"8px 20px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
          {saving?"⏳":"✓ Opslaan"}
        </button>
        <button onClick={onCancel}
          style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
          Annuleren
        </button>
      </div>
    </div>
  );
}
