import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

const C = {
  blauw:"#1B3A6B", blauwDark:"#132b52", blauwLight:"#2a52a0",
  groen:"#4A9B3C", groenDark:"#357a2b", groenLight:"#5cb84d",
  bg:"#f0f4f8", card:"#ffffff", border:"#d1dbe8",
  text:"#1a2b47", muted:"#6b7a8d", dark:"#0d1f3c",
  oranje:"#f97316",
};

const FIETS_STATUSSEN = ["In gebruik", "Beschikbaar", "Ingeleverd"];
const FIETS_STATUS_MAP = {
  "In gebruik":   { bg:"#4A9B3C18", text:"#357a2b", dot:"#4A9B3C" },
  "Beschikbaar":  { bg:"#1B3A6B18", text:"#1B3A6B", dot:"#2a52a0" },
  "Ingeleverd":   { bg:"#71717a18", text:"#3f3f46", dot:"#71717a" },
};

function fmtDate(d) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("nl-NL", { day:"2-digit", month:"2-digit", year:"numeric" });
}
function todayISO() { return new Date().toISOString().slice(0,10); }

function SH({ titel, sub, actie }) {
  return (
    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24}}>
      <div>
        <h2 style={{fontSize:20,fontWeight:800,color:C.blauw,marginBottom:3}}>{titel}</h2>
        {sub && <p style={{fontSize:13,color:C.muted}}>{sub}</p>}
      </div>
      {actie}
    </div>
  );
}

function Label({ children }) {
  return (
    <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>
      {children}
    </label>
  );
}

function Input({ ...props }) {
  return (
    <input style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}} {...props}/>
  );
}

// ─── HOOFD FIETS MODULE ───────────────────────────────────────────────────────
export function FietsModule({ gebruiker, showToast }) {
  const [fietsen, setFietsen] = useState([]);
  const [fietsLog, setFietsLog] = useState([]);
  const [borgmeldingen, setBorgmeldingen] = useState([]);
  const [subTab, setSubTab] = useState("overzicht");
  const [loading, setLoading] = useState(true);

  const isBackoffice = gebruiker?.rol === "backoffice";
  const isHuismeester = gebruiker?.rol === "huismeester";
  const magBeheren = isBackoffice || isHuismeester;

  const loadFietsen = useCallback(async () => {
    const { data, error } = await supabase.from("fietsen").select("*").order("status").order("fietsnummer");
    if (error) { console.error(error); return; }
    setFietsen(data || []);
  }, []);

  const loadFietsLog = useCallback(async () => {
    const { data, error } = await supabase.from("fiets_log").select("*").order("created_at", { ascending: false });
    if (error) { console.error(error); return; }
    setFietsLog(data || []);
  }, []);

  const loadBorgmeldingen = useCallback(async () => {
    const { data, error } = await supabase.from("fiets_borgmeldingen").select("*").order("created_at", { ascending: false });
    if (error) { console.error(error); return; }
    setBorgmeldingen(data || []);
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([loadFietsen(), loadFietsLog(), loadBorgmeldingen()]);
      setLoading(false);
    }
    init();
  }, [loadFietsen, loadFietsLog, loadBorgmeldingen]);

  useEffect(() => {
    const s1 = supabase.channel("fie-rt").on("postgres_changes",{event:"*",schema:"public",table:"fietsen"},()=>loadFietsen()).subscribe();
    const s2 = supabase.channel("flo-rt").on("postgres_changes",{event:"*",schema:"public",table:"fiets_log"},()=>loadFietsLog()).subscribe();
    const s3 = supabase.channel("fbo-rt").on("postgres_changes",{event:"*",schema:"public",table:"fiets_borgmeldingen"},()=>loadBorgmeldingen()).subscribe();
    return () => { supabase.removeChannel(s1); supabase.removeChannel(s2); supabase.removeChannel(s3); };
  }, [loadFietsen, loadFietsLog, loadBorgmeldingen]);

  async function registreerUitgifte(data) {
    const fiets = fietsen.find(f => f.id === data.fiets_id);
    if (!fiets) { showToast("Fiets niet gevonden","err"); return false; }

    // 1. Log opslaan
    const { error: logErr } = await supabase.from("fiets_log").insert([{
      fiets_id: data.fiets_id,
      fietsnummer: fiets.fietsnummer,
      actie: "uitgifte",
      naam_medewerker: data.naam_medewerker,
      datum: data.datum,
      opmerkingen: data.opmerkingen || null,
      ingediend_door: gebruiker.naam,
    }]);
    if (logErr) { showToast("Fout bij opslaan","err"); return false; }

    // 2. Fietsstatus bijwerken
    await supabase.from("fietsen").update({
      status: "In gebruik",
      naam_medewerker: data.naam_medewerker,
      datum_uitgifte: data.datum,
    }).eq("id", data.fiets_id);

    // 3. Taak voor huismeester: staat controleren bij inname
    await supabase.from("taken").insert([{
      titel: "🚲 Fiets controleren bij inname — " + data.naam_medewerker,
      omschrijving: "Fiets " + fiets.fietsnummer + (fiets.merk ? " (" + fiets.merk + ")" : "") + " is uitgegeven op " + data.datum + ". Controleer bij inname of de fiets in goede staat is (geen schade, banden goed, slot werkt).",
      prioriteit: "middel",
      aangemaakt_door: gebruiker.naam,
      status: "open",
    }]);

    // 4. Borgmelding voor backoffice
    await supabase.from("fiets_borgmeldingen").insert([{
      fiets_id: data.fiets_id,
      fietsnummer: fiets.fietsnummer,
      naam_medewerker: data.naam_medewerker,
      actie: "borg_inhouden",
      datum: data.datum,
      ingediend_door: gebruiker.naam,
      status: "open",
      bericht: "💰 Borg inhouden — fiets " + fiets.fietsnummer + (fiets.merk ? " (" + fiets.merk + ")" : "") + " uitgegeven aan " + data.naam_medewerker + " op " + data.datum,
    }]);

    showToast("✓ Uitgifte geregistreerd — taak & borgmelding aangemaakt");
    return true;
  }

  async function registreerInname(data) {
    const fiets = fietsen.find(f => f.id === data.fiets_id);
    if (!fiets) { showToast("Fiets niet gevonden","err"); return false; }

    // 1. Log opslaan
    const { error: logErr } = await supabase.from("fiets_log").insert([{
      fiets_id: data.fiets_id,
      fietsnummer: fiets.fietsnummer,
      actie: "inname",
      naam_medewerker: fiets.naam_medewerker || data.naam_medewerker,
      datum: data.datum,
      opmerkingen: data.opmerkingen || null,
      ingediend_door: gebruiker.naam,
    }]);
    if (logErr) { showToast("Fout bij opslaan","err"); return false; }

    // 2. Fietsstatus bijwerken
    await supabase.from("fietsen").update({
      status: "Ingeleverd",
      naam_medewerker: null,
      datum_inname: data.datum,
    }).eq("id", data.fiets_id);

    // 3. Borg terugbetaalmelding voor backoffice
    await supabase.from("fiets_borgmeldingen").insert([{
      fiets_id: data.fiets_id,
      fietsnummer: fiets.fietsnummer,
      naam_medewerker: fiets.naam_medewerker || data.naam_medewerker,
      actie: "borg_terugbetalen",
      datum: data.datum,
      ingediend_door: gebruiker.naam,
      status: "open",
      bericht: "💶 Borg terugbetalen — fiets " + fiets.fietsnummer + (fiets.merk ? " (" + fiets.merk + ")" : "") + " ingenomen van " + (fiets.naam_medewerker || data.naam_medewerker) + " op " + data.datum + (data.opmerkingen ? ". Opmerking: " + data.opmerkingen : ""),
    }]);

    showToast("✓ Inname geregistreerd — borgmelding aangemaakt");
    return true;
  }

  async function addFiets(fiets) {
    const { error } = await supabase.from("fietsen").insert([fiets]);
    if (error) { showToast("Fout bij toevoegen","err"); return false; }
    showToast("✓ Fiets toegevoegd"); return true;
  }

  async function updateFiets(id, updates) {
    const { error } = await supabase.from("fietsen").update(updates).eq("id", id);
    if (error) { showToast("Fout bij opslaan","err"); return false; }
    showToast("✓ Opgeslagen"); return true;
  }

  async function deleteFiets(id) {
    const { error } = await supabase.from("fietsen").delete().eq("id", id);
    if (error) { showToast("Fout bij verwijderen","err"); return false; }
    showToast("✓ Fiets verwijderd"); return true;
  }

  if (loading) return <div style={{textAlign:"center",padding:"60px",color:C.muted}}>⏳ Laden...</div>;

  const openBorg = borgmeldingen.filter(b => b.status === "open");

  const tabs = [
    { id:"overzicht", label:"🚲 Overzicht" },
    { id:"uitgifte",  label:"📋 Uitgifte / Inname" },
    { id:"log",       label:"📝 Log" },
    ...(isBackoffice ? [{ id:"borg", label:`💰 Borg${openBorg.length > 0 ? ` (${openBorg.length})` : ""}` }] : []),
    ...(magBeheren ? [{ id:"beheer", label:"⚙️ Beheer" }] : []),
  ];

  const beschikbaar = fietsen.filter(f => f.status === "Beschikbaar").length;
  const inGebruik   = fietsen.filter(f => f.status === "In gebruik").length;

  return (
    <div>
      <SH titel="🚲 Fietsregistratie" sub={`${fietsen.length} fietsen · ${inGebruik} uitgegeven · ${beschikbaar} beschikbaar`} />

      <div style={{display:"flex",gap:6,marginBottom:24,borderBottom:`2px solid ${C.border}`,paddingBottom:0}}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            style={{background:"none",border:"none",padding:"10px 18px",fontSize:13,fontWeight:700,color:subTab===t.id?C.blauw:C.muted,borderBottom:subTab===t.id?`3px solid ${C.blauw}`:"3px solid transparent",marginBottom:-2,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "overzicht"  && <FietsOverzicht fietsen={fietsen} />}
      {subTab === "uitgifte"   && <FietsUitgifte fietsen={fietsen} gebruiker={gebruiker} onUitgifte={registreerUitgifte} onInname={registreerInname} showToast={showToast} />}
      {subTab === "log"        && <FietsLogView log={fietsLog} fietsen={fietsen} />}
      {subTab === 'borg' && isBackoffice && <FietsBorg borgmeldingen={borgmeldingen} gebruiker={gebruiker} onVerwerk={async (id) => { await supabase.from('fiets_borgmeldingen').update({status:'verwerkt', afgehandeld_door: gebruiker.naam, afgehandeld_op: new Date().toISOString()}).eq('id', id); showToast('✓ Borgmelding verwerkt'); await loadBorgmeldingen(); }} />}
      {subTab === "beheer" && magBeheren && <FietsBeheer fietsen={fietsen} onAdd={addFiets} onUpdate={updateFiets} onDelete={deleteFiets} showToast={showToast} />}
    </div>
  );
}

// ─── OVERZICHT ────────────────────────────────────────────────────────────────
function FietsOverzicht({ fietsen }) {
  const [zoek, setZoek] = useState("");
  const [filterStatus, setFilterStatus] = useState("Alle");

  const filtered = fietsen.filter(f => {
    if (filterStatus !== "Alle" && f.status !== filterStatus) return false;
    if (zoek.trim()) {
      const q = zoek.toLowerCase();
      return f.fietsnummer?.toLowerCase().includes(q) ||
             f.merk?.toLowerCase().includes(q) ||
             f.naam_medewerker?.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div>
      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,marginBottom:20}}>
        {[
          {label:"Totaal",      val:fietsen.length,                                      color:C.muted},
          {label:"In gebruik",  val:fietsen.filter(f=>f.status==="In gebruik").length,   color:C.groen},
          {label:"Beschikbaar", val:fietsen.filter(f=>f.status==="Beschikbaar").length,  color:C.blauw},
          {label:"Ingeleverd",  val:fietsen.filter(f=>f.status==="Ingeleverd").length,   color:"#71717a"},
        ].map(s => (
          <div key={s.label} className="card" style={{borderTop:`3px solid ${s.color}`,padding:"12px 14px"}}>
            <div style={{fontSize:22,fontWeight:800,color:s.color}}>{s.val}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input value={zoek} onChange={e=>setZoek(e.target.value)} placeholder="🔍 Zoek fietsnummer, merk, medewerker..."
          style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 14px",fontSize:13,outline:"none",width:280}}/>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {["Alle",...FIETS_STATUSSEN].map(s => (
            <button key={s} onClick={()=>setFilterStatus(s)}
              style={{background:filterStatus===s?C.blauw:"white",color:filterStatus===s?"white":C.muted,border:`1.5px solid ${filterStatus===s?C.blauw:C.border}`,borderRadius:20,padding:"5px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Tabel */}
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"130px 1fr 160px 120px 110px 90px",padding:"10px 16px",fontSize:10,fontWeight:700,color:C.muted,letterSpacing:".6px",textTransform:"uppercase",borderBottom:`1px solid ${C.border}`,background:C.bg}}>
          <span>Fietsnr.</span><span>Merk</span><span>Medewerker</span><span>Datum uitgifte</span><span>Datum inname</span><span>Status</span>
        </div>
        {filtered.length === 0 && (
          <div style={{textAlign:"center",padding:"40px",color:C.muted}}>Geen fietsen gevonden</div>
        )}
        {filtered.map((f, i) => {
          const c = FIETS_STATUS_MAP[f.status] || {bg:C.bg,text:C.muted};
          return (
            <div key={f.id} style={{display:"grid",gridTemplateColumns:"130px 1fr 160px 120px 110px 90px",padding:"12px 16px",fontSize:13,borderBottom:i<filtered.length-1?`1px solid ${C.border}`:"none",alignItems:"center",background:i%2===0?"white":C.bg+"40"}}>
              <span style={{fontWeight:800,color:C.blauw,fontFamily:"monospace",fontSize:14}}>{f.fietsnummer}</span>
              <span style={{fontWeight:600,color:C.text}}>{f.merk || <span style={{color:C.muted,fontStyle:"italic"}}>—</span>}</span>
              <span style={{fontSize:12,color:C.text}}>{f.naam_medewerker || <span style={{color:C.muted,fontStyle:"italic"}}>—</span>}</span>
              <span style={{fontSize:12,color:C.muted}}>{f.datum_uitgifte ? fmtDate(f.datum_uitgifte) : "—"}</span>
              <span style={{fontSize:12,color:C.muted}}>{f.datum_inname ? fmtDate(f.datum_inname) : "—"}</span>
              <span style={{padding:"3px 8px",borderRadius:6,background:c.bg,color:c.text,fontSize:10,fontWeight:700,whiteSpace:"nowrap"}}>{f.status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── UITGIFTE / INNAME FORM ───────────────────────────────────────────────────
function FietsUitgifte({ fietsen, gebruiker, onUitgifte, onInname, showToast }) {
  const [actie, setActie] = useState("uitgifte");
  const [fietsId, setFietsId] = useState("");
  const [naamMedewerker, setNaamMedewerker] = useState("");
  const [datum, setDatum] = useState(todayISO());
  const [opmerkingen, setOpmerkingen] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const beschikbareFietsen = fietsen.filter(f => f.status === "Beschikbaar");
  const inGebruikFietsen   = fietsen.filter(f => f.status === "In gebruik");
  const lijstVoorActie = actie === "uitgifte" ? beschikbareFietsen : inGebruikFietsen;

  // Bij selectie van fiets bij inname: naam alvast invullen
  function handleFietsChange(id) {
    setFietsId(id);
    if (actie === "inname") {
      const fiets = fietsen.find(f => f.id === parseInt(id) || f.id === id);
      if (fiets?.naam_medewerker) setNaamMedewerker(fiets.naam_medewerker);
    }
  }

  async function handleSubmit() {
    if (!fietsId) { showToast("Selecteer een fiets","err"); return; }
    if (!naamMedewerker.trim()) { showToast("Vul naam medewerker in","err"); return; }
    setSaving(true);
    const payload = { fiets_id: fietsId, naam_medewerker: naamMedewerker.trim(), datum, opmerkingen };
    const ok = actie === "uitgifte" ? await onUitgifte(payload) : await onInname(payload);
    setSaving(false);
    if (ok) {
      setFietsId(""); setNaamMedewerker(""); setOpmerkingen(""); setDatum(todayISO());
      setSubmitted(true); setTimeout(() => setSubmitted(false), 2500);
    }
  }

  if (submitted) return (
    <div className="card" style={{textAlign:"center",padding:"60px 40px",maxWidth:600,margin:"0 auto",borderTop:`4px solid ${C.groen}`}}>
      <div style={{fontSize:64,marginBottom:16}}>✅</div>
      <div style={{fontSize:22,fontWeight:800,color:C.groen,marginBottom:8}}>
        {actie === "uitgifte" ? "Uitgifte geregistreerd!" : "Inname geregistreerd!"}
      </div>
      <button className="btn-b" onClick={()=>setSubmitted(false)}>Nieuwe registratie</button>
    </div>
  );

  const acties = [
    { id:"uitgifte", icon:"🚲", label:"UITGIFTE", color:C.groen,  tel:beschikbareFietsen.length, sub:"beschikbaar" },
    { id:"inname",   icon:"🔑", label:"INNAME",   color:C.blauw,  tel:inGebruikFietsen.length,   sub:"in gebruik" },
  ];

  return (
    <div style={{maxWidth:680,margin:"0 auto"}}>
      <SH titel="Fiets uitgifte / inname" sub="Registreer een uitgifte of inname van een fiets" />

      {/* Actie kiezen */}
      <div className="card" style={{marginBottom:16,borderTop:`3px solid ${C.blauw}`}}>
        <Label>Actie</Label>
        <div style={{display:"flex",gap:12}}>
          {acties.map(a => (
            <div key={a.id} onClick={()=>{ setActie(a.id); setFietsId(""); setNaamMedewerker(""); }}
              style={{flex:1,border:`2px solid ${actie===a.id?a.color:C.border}`,borderRadius:10,padding:"16px",textAlign:"center",cursor:"pointer",background:actie===a.id?a.color+"12":"white",transition:"all .2s"}}>
              <div style={{fontSize:28,marginBottom:6}}>{a.icon}</div>
              <div style={{fontSize:12,fontWeight:700,color:actie===a.id?a.color:C.muted,letterSpacing:".8px"}}>{a.label}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:4}}>{a.tel} {a.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:16}}>
        <div>
          <Label>Fiets *</Label>
          {lijstVoorActie.length === 0 ? (
            <div style={{background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"12px 14px",fontSize:13,color:"#b45309",fontWeight:500}}>
              {actie === "uitgifte" ? "⚠️ Geen beschikbare fietsen" : "⚠️ Geen fietsen in gebruik"}
            </div>
          ) : (
            <select style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",appearance:"none",fontFamily:"inherit"}}
              value={fietsId} onChange={e=>handleFietsChange(e.target.value)}>
              <option value="">Selecteer fiets</option>
              {lijstVoorActie.map(f => (
                <option key={f.id} value={f.id}>
                  {f.fietsnummer}{f.merk ? ` — ${f.merk}` : ""}{actie==="inname"&&f.naam_medewerker?` (${f.naam_medewerker})`:""}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <Label>Naam medewerker *</Label>
          <Input value={naamMedewerker} onChange={e=>setNaamMedewerker(e.target.value)} placeholder="Voor- en achternaam"/>
        </div>
        <div>
          <Label>Datum *</Label>
          <Input type="date" value={datum} onChange={e=>setDatum(e.target.value)}/>
        </div>
        <div>
          <Label>Opmerkingen</Label>
          <Input value={opmerkingen} onChange={e=>setOpmerkingen(e.target.value)} placeholder="Bijv. band lek, slot ontbreekt..."/>
        </div>
      </div>

      <button onClick={handleSubmit} disabled={saving || lijstVoorActie.length === 0}
        style={{width:"100%",background:saving||lijstVoorActie.length===0?C.border:C.blauw,color:"white",border:"none",borderRadius:8,padding:14,fontSize:15,fontWeight:700,cursor:saving||lijstVoorActie.length===0?"not-allowed":"pointer",fontFamily:"inherit",transition:"background .2s"}}>
        {saving ? "⏳ Opslaan..." : actie === "uitgifte" ? "✓ Uitgifte registreren" : "✓ Inname registreren"}
      </button>
    </div>
  );
}

// ─── LOG ──────────────────────────────────────────────────────────────────────
function FietsLogView({ log, fietsen }) {
  const [filter, setFilter] = useState("alle");
  const [zoek, setZoek] = useState("");

  const gefilterd = log.filter(l => {
    if (filter === "uitgifte" && l.actie !== "uitgifte") return false;
    if (filter === "inname"   && l.actie !== "inname")   return false;
    if (zoek.trim()) {
      const q = zoek.toLowerCase();
      return l.fietsnummer?.toLowerCase().includes(q) ||
             l.naam_medewerker?.toLowerCase().includes(q) ||
             l.ingediend_door?.toLowerCase().includes(q);
    }
    return true;
  });

  function exportCSV() {
    let csv = "Datum,Actie,Fietsnummer,Medewerker,Ingediend door,Opmerkingen\n";
    log.forEach(l => {
      csv += `"${fmtDate(l.created_at)}","${l.actie}","${l.fietsnummer}","${l.naam_medewerker||""}","${l.ingediend_door}","${l.opmerkingen||""}"\n`;
    });
    const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`KTP_fiets_log_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  const actiKleur = { uitgifte:C.groen, inname:C.blauw };
  const actiIcon  = { uitgifte:"🚲", inname:"🔑" };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <h3 style={{fontSize:18,fontWeight:800,color:C.blauw}}>Fiets log</h3>
          <p style={{fontSize:13,color:C.muted,marginTop:2}}>{log.length} registraties totaal</p>
        </div>
        <button onClick={exportCSV}
          style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit"}}>
          ⬇ Exporteer CSV
        </button>
      </div>

      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input value={zoek} onChange={e=>setZoek(e.target.value)} placeholder="🔍 Zoek fietsnummer of medewerker..."
          style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 14px",fontSize:13,outline:"none",width:260}}/>
        <div style={{display:"flex",gap:4}}>
          {[["alle","Alle"],["uitgifte","Uitgifte"],["inname","Inname"]].map(([v,l]) => (
            <button key={v} onClick={()=>setFilter(v)}
              style={{background:filter===v?C.blauw:"white",color:filter===v?"white":C.muted,border:`1.5px solid ${filter===v?C.blauw:C.border}`,borderRadius:20,padding:"6px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {gefilterd.length === 0 ? (
        <div className="card" style={{textAlign:"center",padding:"50px",color:C.muted}}>
          <div style={{fontSize:40,marginBottom:10}}>🚲</div>
          <div>Geen registraties gevonden</div>
        </div>
      ) : gefilterd.map(l => (
        <div key={l.id} style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${actiKleur[l.actie]||C.muted}`,borderRadius:10,padding:16,marginBottom:10,boxShadow:`0 1px 3px rgba(27,58,107,.05)`}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
            <span style={{fontSize:24}}>{actiIcon[l.actie]||"🚲"}</span>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:6}}>
                <span style={{fontWeight:800,fontSize:15,color:C.text,fontFamily:"monospace"}}>{l.fietsnummer}</span>
                <span style={{fontWeight:600,fontSize:14,color:C.text}}>{l.naam_medewerker}</span>
                <span style={{padding:"3px 10px",borderRadius:20,background:(actiKleur[l.actie]||C.muted)+"18",color:actiKleur[l.actie]||C.muted,fontSize:11,fontWeight:700}}>
                  {(l.actie||"").toUpperCase()}
                </span>
              </div>
              <div style={{fontSize:12,color:C.muted}}>
                📅 {fmtDate(l.datum || l.created_at)} · Door: {l.ingediend_door}
              </div>
              {l.opmerkingen && (
                <div style={{fontSize:13,color:C.muted,fontStyle:"italic",marginTop:4}}>"{l.opmerkingen}"</div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── BEHEER ───────────────────────────────────────────────────────────────────
function FietsBeheer({ fietsen, onAdd, onUpdate, onDelete, showToast }) {
  const [toonNieuwe, setToonNieuwe] = useState(false);
  const [nieuw, setNieuw] = useState({ fietsnummer:"", merk:"", status:"Beschikbaar", naam_medewerker:"", datum_uitgifte:"", datum_inname:"" });
  const [bewerkId, setBewerkId] = useState(null);
  const [saving, setSaving] = useState(false);

  async function voegToe() {
    if (!nieuw.fietsnummer.trim()) { showToast("Vul een fietsnummer in","err"); return; }
    setSaving(true);
    await onAdd({ ...nieuw, fietsnummer: nieuw.fietsnummer.trim() });
    setSaving(false);
    setNieuw({ fietsnummer:"", merk:"", status:"Beschikbaar", naam_medewerker:"", datum_uitgifte:"", datum_inname:"" });
    setToonNieuwe(false);
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <h3 style={{fontSize:16,fontWeight:800,color:C.blauw}}>Fietsen beheren ({fietsen.length})</h3>
        <button onClick={()=>setToonNieuwe(!toonNieuwe)}
          style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
          + Fiets toevoegen
        </button>
      </div>

      {toonNieuwe && (
        <div className="card" style={{marginBottom:16,borderTop:`3px solid ${C.groen}`}}>
          <div style={{fontWeight:700,fontSize:13,color:C.groen,marginBottom:14}}>Nieuwe fiets toevoegen</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
            {[
              {label:"Fietsnummer *", key:"fietsnummer",      ph:"bijv. KTP-001"},
              {label:"Merk",          key:"merk",              ph:"bijv. Gazelle, Cortina"},
              {label:"Medewerker",    key:"naam_medewerker",   ph:"Wie heeft de fiets"},
            ].map(f => (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <input value={nieuw[f.key]} onChange={e=>setNieuw(p=>({...p,[f.key]:e.target.value}))} placeholder={f.ph}
                  style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
              </div>
            ))}
            <div>
              <Label>Datum uitgifte</Label>
              <input type="date" value={nieuw.datum_uitgifte} onChange={e=>setNieuw(p=>({...p,datum_uitgifte:e.target.value}))}
                style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
            </div>
            <div>
              <Label>Datum inname</Label>
              <input type="date" value={nieuw.datum_inname} onChange={e=>setNieuw(p=>({...p,datum_inname:e.target.value}))}
                style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
            </div>
            <div>
              <Label>Status</Label>
              <select value={nieuw.status} onChange={e=>setNieuw(p=>({...p,status:e.target.value}))}
                style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",appearance:"none",fontFamily:"inherit"}}>
                {FIETS_STATUSSEN.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={voegToe} disabled={saving}
              style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"10px 24px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              {saving ? "⏳ Opslaan..." : "✓ Toevoegen"}
            </button>
            <button onClick={()=>setToonNieuwe(false)}
              style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"10px 16px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
              Annuleren
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"140px 1fr 160px 120px 110px 90px 80px",padding:"10px 16px",fontSize:10,fontWeight:700,color:C.muted,letterSpacing:".6px",textTransform:"uppercase",borderBottom:`1px solid ${C.border}`,background:C.bg}}>
          <span>Fietsnr.</span><span>Merk</span><span>Medewerker</span><span>Uitgifte</span><span>Inname</span><span>Status</span><span>Acties</span>
        </div>
        {fietsen.map((f, i) => {
          const c = FIETS_STATUS_MAP[f.status] || {bg:C.bg,text:C.muted};
          return bewerkId === f.id ? (
            <FietsBewerken key={f.id} fiets={f} onSave={async u=>{setSaving(true);await onUpdate(f.id,u);setSaving(false);setBewerkId(null);}} onCancel={()=>setBewerkId(null)} saving={saving}/>
          ) : (
            <div key={f.id} style={{display:"grid",gridTemplateColumns:"140px 1fr 160px 120px 110px 90px 80px",padding:"12px 16px",fontSize:12,borderBottom:i<fietsen.length-1?`1px solid ${C.border}`:"none",alignItems:"center",background:i%2===0?"white":C.bg+"40"}}>
              <span style={{fontWeight:800,color:C.blauw,fontFamily:"monospace"}}>{f.fietsnummer}</span>
              <span style={{color:C.text}}>{f.merk||"—"}</span>
              <span style={{color:C.muted}}>{f.naam_medewerker||"—"}</span>
              <span style={{color:C.muted}}>{f.datum_uitgifte?fmtDate(f.datum_uitgifte):"—"}</span>
              <span style={{color:C.muted}}>{f.datum_inname?fmtDate(f.datum_inname):"—"}</span>
              <span style={{padding:"3px 8px",borderRadius:6,background:c.bg,color:c.text,fontSize:10,fontWeight:700}}>{f.status}</span>
              <div style={{display:"flex",gap:4}}>
                <button onClick={()=>setBewerkId(f.id)} style={{background:"white",border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11}}>✏️</button>
                <button onClick={async()=>{if(window.confirm(`Fiets ${f.fietsnummer} verwijderen?`)){await onDelete(f.id);}}} style={{background:"#dc2626",color:"white",border:"none",borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11}}>🗑</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FietsBewerken({ fiets, onSave, onCancel, saving }) {
  const [v, setV] = useState({...fiets});
  return (
    <div style={{padding:"16px",borderBottom:`1px solid ${C.border}`,background:C.blauw+"08",border:`1.5px solid ${C.blauw}`,borderRadius:8,margin:"4px 8px"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:10}}>
        {[
          {label:"Fietsnummer",   key:"fietsnummer"},
          {label:"Merk",          key:"merk"},
          {label:"Medewerker",    key:"naam_medewerker"},
          {label:"Datum uitgifte",key:"datum_uitgifte", type:"date"},
          {label:"Datum inname",  key:"datum_inname",   type:"date"},
        ].map(f => (
          <div key={f.key}>
            <label style={{fontSize:10,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>{f.label}</label>
            <input type={f.type||"text"} value={v[f.key]||""} onChange={e=>setV(p=>({...p,[f.key]:e.target.value}))}
              style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:6,color:C.text,padding:"7px 10px",fontSize:12,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
          </div>
        ))}
        <div>
          <label style={{fontSize:10,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>Status</label>
          <select value={v.status||"Beschikbaar"} onChange={e=>setV(p=>({...p,status:e.target.value}))}
            style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:6,color:C.text,padding:"7px 10px",fontSize:12,outline:"none",appearance:"none",fontFamily:"inherit"}}>
            {FIETS_STATUSSEN.map(s => <option key={s}>{s}</option>)}
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

// ─── BORG MELDINGEN (backoffice) ──────────────────────────────────────────────
function FietsBorg({ borgmeldingen, gebruiker, onVerwerk }) {
  const [filter, setFilter] = useState("open");

  const gefilterd = borgmeldingen.filter(b =>
    filter === "alle" ? true : b.status === filter
  );

  const openCount = borgmeldingen.filter(b => b.status === "open").length;

  return (
    <div>
      <div style={{marginBottom:20}}>
        <h3 style={{fontSize:18,fontWeight:800,color:C.blauw}}>💰 Borgmeldingen</h3>
        <p style={{fontSize:13,color:C.muted,marginTop:2}}>{openCount} openstaand · {borgmeldingen.length} totaal</p>
      </div>

      {openCount > 0 && (
        <div style={{background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:12,padding:"12px 18px",marginBottom:20}}>
          <div style={{fontWeight:700,color:"#b45309"}}>⚠️ {openCount} borgmelding{openCount > 1 ? "en" : ""} wacht{openCount === 1 ? "" : "en"} op afhandeling</div>
          <div style={{fontSize:13,color:"#b45309",marginTop:4}}>Controleer hieronder of er borg ingehouden of terugbetaald moet worden.</div>
        </div>
      )}

      <div style={{display:"flex",gap:6,marginBottom:20}}>
        {[["open","Open"],["verwerkt","Verwerkt"],["alle","Alle"]].map(([v,l]) => (
          <button key={v} onClick={()=>setFilter(v)}
            style={{background:filter===v?C.blauw:"white",color:filter===v?"white":C.muted,border:`1.5px solid ${filter===v?C.blauw:C.border}`,borderRadius:20,padding:"6px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            {l}{v==="open"&&openCount>0&&<span style={{background:"#ef444430",color:"#ef4444",borderRadius:10,padding:"1px 6px",fontSize:11,marginLeft:6}}>{openCount}</span>}
          </button>
        ))}
      </div>

      {gefilterd.length === 0 ? (
        <div className="card" style={{textAlign:"center",padding:"50px",color:C.muted}}>
          <div style={{fontSize:40,marginBottom:10}}>💰</div>
          <div>{filter === "open" ? "Geen openstaande borgmeldingen 🎉" : "Geen meldingen gevonden"}</div>
        </div>
      ) : gefilterd.map(b => {
        const isInhouden = b.actie === "borg_inhouden";
        const kleur = isInhouden ? "#f59e0b" : C.groen;
        const verwerkt = b.status === "verwerkt";
        return (
          <div key={b.id} style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${verwerkt ? C.muted : kleur}`,borderRadius:10,padding:16,marginBottom:10,boxShadow:`0 1px 3px rgba(27,58,107,.05)`,opacity:verwerkt?0.7:1}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
              <span style={{fontSize:24}}>{isInhouden ? "💰" : "💶"}</span>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:6}}>
                  <span style={{fontWeight:800,fontSize:15,color:C.text,fontFamily:"monospace"}}>{b.fietsnummer}</span>
                  <span style={{fontWeight:600,fontSize:14,color:C.text}}>{b.naam_medewerker}</span>
                  <span style={{padding:"3px 10px",borderRadius:20,background:kleur+"18",color:kleur,fontSize:11,fontWeight:700}}>
                    {isInhouden ? "BORG INHOUDEN" : "BORG TERUGBETALEN"}
                  </span>
                  {verwerkt && (
                    <span style={{padding:"3px 10px",borderRadius:20,background:"#f0fdf4",color:C.groen,fontSize:11,fontWeight:700}}>✓ VERWERKT</span>
                  )}
                </div>
                <div style={{fontSize:13,color:C.muted,marginBottom:6}}>{b.bericht}</div>
                <div style={{fontSize:12,color:C.muted}}>
                  📅 {b.datum} · Ingediend door: {b.ingediend_door}
                  {verwerkt && b.afgehandeld_door && ` · ✓ Afgehandeld door ${b.afgehandeld_door}`}
                </div>
              </div>
            </div>
            {!verwerkt && (
              <div style={{marginTop:12,display:"flex",justifyContent:"flex-end"}}>
                <button onClick={() => onVerwerk(b.id)}
                  style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"9px 20px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  ✓ {isInhouden ? "Borg ingehouden" : "Borg terugbetaald"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
