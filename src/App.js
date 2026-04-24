import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

// ─── KLEUREN HUISSTIJL ────────────────────────────────────────────────────────
const C = {
  blauw:     "#1B3A6B", blauwDark: "#132b52", blauwLight:"#2a52a0",
  groen:     "#4A9B3C", groenDark: "#357a2b", groenLight:"#5cb84d",
  bg:        "#f0f4f8", card: "#ffffff", border: "#d1dbe8",
  text:      "#1a2b47", muted: "#6b7a8d", dark: "#0d1f3c",
};

// Gebruikers komen uit Supabase — geen localStorage meer

// ─── STATUS KLEUREN ───────────────────────────────────────────────────────────
const STATUS_MAP = {
  "Lopend":            { bg:"#4A9B3C18", text:"#357a2b", dot:"#4A9B3C" },
  "Beschikbaar":       { bg:"#1B3A6B18", text:"#1B3A6B", dot:"#2a52a0" },
  "Gereserveerd":      { bg:"#f59e0b18", text:"#b45309", dot:"#f59e0b" },
  "Controle":          { bg:"#ef444418", text:"#b91c1c", dot:"#ef4444" },
  "Niet beschikbaar":  { bg:"#8b5cf618", text:"#6d28d9", dot:"#8b5cf6" },
  "Moet aan het werk": { bg:"#f9731618", text:"#c2410c", dot:"#f97316" },
  "Vertrokken":        { bg:"#71717a18", text:"#3f3f46", dot:"#71717a" },
};
const STATUSSEN = Object.keys(STATUS_MAP);

// ─── CHECKLIST FALLBACK (worden geladen uit Supabase) ────────────────────────
// Items worden dynamisch geladen — hier alleen lege arrays als fallback
const CHECKLIST_WEKELIJKS_FB = [];
const CHECKLIST_4WEKELIJKS_FB = [];
const CHECKLIST_KWARTAAL_FB = [];

// ─── DAGINDELING HUISMEESTER ──────────────────────────────────────────────────
const DAGPLANNING = {
  ma: { label: "Maandag", kleur: C.blauw,    icon: "🔍", focus: "Kamers controleren & meldingen verwerken", taken: ["Openstaande meldingen doornemen in de app", "Vertrokken kamers controleren en vrijgeven", "Schade of problemen documenteren via de app", "Planning week doornemen"] },
  di: { label: "Dinsdag", kleur: "#7c3aed",  icon: "🔧", focus: "Kleine klusjes – Noord omgeving", taken: ["Lamp vervangen indien gemeld", "Rookmelders controleren", "Kleine reparaties afhandelen", "Woningen: Coevorden, De Krim, Rijssen"] },
  wo: { label: "Woensdag", kleur: C.groen,   icon: "🔧", focus: "Kleine klusjes – Midden omgeving", taken: ["Lamp vervangen indien gemeld", "Lekkages/vocht controleren", "Kleine reparaties afhandelen", "Woningen: Goor, Rijssen"] },
  do: { label: "Donderdag", kleur: "#f59e0b", icon: "🔧", focus: "Kleine klusjes – Zuid omgeving", taken: ["Lamp vervangen indien gemeld", "Sloten en deuren controleren", "Kleine reparaties afhandelen", "Woningen: Almelo, Enschede"] },
  vr: { label: "Vrijdag", kleur: "#ef4444",  icon: "✅", focus: "Controles & administratie", taken: ["Wekelijkse checklist afvinken", "Meldingen afsluiten in de app", "Weekrapportage bijwerken", "Nieuwe aankomsten voorbereiden voor volgende week"] },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function fmtDate(d) { const dt = typeof d==="string"?new Date(d):d; return dt.toLocaleDateString("nl-NL",{day:"2-digit",month:"2-digit"}); }
function fmtTime(d) { const dt = typeof d==="string"?new Date(d):d; return dt.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"}); }
function fmtFull(d) { return `${fmtDate(d)} ${fmtTime(d)}`; }
function todayISO() { return new Date().toISOString().slice(0,10); }
function dagVanDeWeek() { return ["zo","ma","di","wo","do","vr","za"][new Date().getDay()]; }

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [gebruiker, setGebruiker] = useState(null);
  const [gebruikers, setGebruikers] = useState([]);
  const [houses, setHouses] = useState([]);
  const [meldingen, setMeldingen] = useState([]);
  const [taken, setTaken] = useState([]);
  const [checklists, setChecklists] = useState([]);
  const [checklistItems, setChecklistItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("melding");
  const [toast, setToast] = useState(null);

  const loadChecklistItems = useCallback(async () => {
    const { data, error } = await supabase.from("checklist_items").select("*").eq("actief", true).order("type").order("volgorde");
    if (error) { console.error("checklist_items:", error); return; }
    setChecklistItems(data || []);
  }, []);

  const loadGebruikers = useCallback(async () => {
    const { data, error } = await supabase.from("gebruikers").select("*").eq("actief", true).order("rol").order("naam");
    if (error) { console.error("gebruikers:", error); return; }
    setGebruikers(data || []);
  }, []);

  const loadHouses = useCallback(async () => {
    const { data, error } = await supabase.from("woningen").select("*").order("stad").order("adres");
    if (error) { console.error(error); return; }
    setHouses(data.map(h => ({ ...h, kamers: h.kamers || [] })));
  }, []);

  const loadMeldingen = useCallback(async () => {
    const { data, error } = await supabase.from("meldingen").select("*").order("created_at", { ascending: false });
    if (error) { console.error(error); return; }
    setMeldingen(data);
  }, []);

  const loadTaken = useCallback(async () => {
    const { data, error } = await supabase.from("taken").select("*").order("created_at", { ascending: false });
    if (error) { console.error("taken:", error); return; }
    setTaken(data || []);
  }, []);

  const loadChecklists = useCallback(async () => {
    const { data, error } = await supabase.from("checklists").select("*").order("created_at", { ascending: false });
    if (error) { console.error("checklists:", error); return; }
    setChecklists(data || []);
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([loadGebruikers(), loadHouses(), loadMeldingen(), loadTaken(), loadChecklists(), loadChecklistItems()]);
      setLoading(false);
    }
    init();
  }, [loadGebruikers, loadHouses, loadMeldingen, loadTaken, loadChecklists, loadChecklistItems]);

  useEffect(() => {
    const s1 = supabase.channel("mel-rt").on("postgres_changes",{event:"*",schema:"public",table:"meldingen"},()=>loadMeldingen()).subscribe();
    const s2 = supabase.channel("won-rt").on("postgres_changes",{event:"*",schema:"public",table:"woningen"},()=>loadHouses()).subscribe();
    const s3 = supabase.channel("tak-rt").on("postgres_changes",{event:"*",schema:"public",table:"taken"},()=>loadTaken()).subscribe();
    const s4 = supabase.channel("chk-rt").on("postgres_changes",{event:"*",schema:"public",table:"checklists"},()=>loadChecklists()).subscribe();
    const s5 = supabase.channel("gbr-rt").on("postgres_changes",{event:"*",schema:"public",table:"gebruikers"},()=>loadGebruikers()).subscribe();
    const s6 = supabase.channel("chi-rt").on("postgres_changes",{event:"*",schema:"public",table:"checklist_items"},()=>loadChecklistItems()).subscribe();
    return () => { supabase.removeChannel(s1); supabase.removeChannel(s2); supabase.removeChannel(s3); supabase.removeChannel(s4); supabase.removeChannel(s5); supabase.removeChannel(s6); };
  }, [loadHouses, loadMeldingen, loadTaken, loadChecklists, loadGebruikers, loadChecklistItems]);

  function showToast(msg, type="ok") { setToast({msg,type}); setTimeout(()=>setToast(null),3500); }
  function login(g) { setGebruiker(g); setTab(g.rol==="collega"?"melding":g.rol==="huismeester"?"dagplanning":"woningen"); }
  function logout() { setGebruiker(null); }
  async function voegGebruikerToe(g) {
    const { error } = await supabase.from("gebruikers").insert([g]);
    if (error) { showToast("Fout bij toevoegen gebruiker", "err"); return false; }
    showToast(`✓ ${g.naam} toegevoegd`); return true;
  }

  async function updateGebruiker(id, updates) {
    const { error } = await supabase.from("gebruikers").update(updates).eq("id", id);
    if (error) { showToast("Fout bij opslaan", "err"); return false; }
    showToast("✓ Opgeslagen"); return true;
  }

  async function verwijderGebruiker(id) {
    const { error } = await supabase.from("gebruikers").update({ actief: false }).eq("id", id);
    if (error) { showToast("Fout bij verwijderen", "err"); return false; }
    showToast("✓ Gebruiker verwijderd"); return true;
  }

  async function addMelding(m) {
    const { error } = await supabase.from("meldingen").insert([{
      type:m.type, medewerker:m.medewerker, datum:m.datum, woning_id:m.huisId,
      kamer:m.kamer, wie_regelt:m.wieRegelt||null, sleutel_terug:m.sleutelTerug||null,
      kamer_schoon:m.kamerSchoon||null, sleutel_aantal:m.sleutelAantal||null,
      opmerkingen:m.opmerkingen||null, ingediend_door:gebruiker.naam, status:"open",
    }]);
    if (error) { showToast("Fout bij opslaan","err"); return; }
    const huis = houses.find(h=>h.id===m.huisId);
    if (huis) {
      const nk = huis.kamers.map(k => {
        if (k.k!==m.kamer) return k;
        if (m.type==="aankomst")    return {...k,naam:m.medewerker,status:"Lopend"};
        if (m.type==="reservering") return {...k,naam:m.medewerker,status:"Gereserveerd"};
        if (m.type==="vertrek") { const p=m.sleutelTerug==="nee"||m.kamerSchoon==="nee"; return {...k,naam:p?k.naam:"",status:p?"Controle":"Beschikbaar"}; }
        return k;
      });
      await supabase.from("woningen").update({kamers:nk}).eq("id",m.huisId);
    }
    showToast("✓ Melding verzonden");
  }

  async function updateMeldingStatus(id, newStatus, notitie="") {
    const { error } = await supabase.from("meldingen").update({status:newStatus,afgehandeld_door:gebruiker.naam,afgehandeld_op:new Date().toISOString(),notitie:notitie||null}).eq("id",id);
    if (error) showToast("Fout bij updaten","err"); else showToast("✓ Status bijgewerkt");
  }

  async function addTaak(taak) {
    const { error } = await supabase.from("taken").insert([{...taak, aangemaakt_door: gebruiker.naam, status:"open"}]);
    if (error) { showToast("Fout bij opslaan taak","err"); return false; }
    showToast("✓ Taak toegevoegd"); return true;
  }

  async function updateTaak(id, updates) {
    const { error } = await supabase.from("taken").update(updates).eq("id",id);
    if (error) showToast("Fout","err"); else showToast("✓ Opgeslagen");
  }

  async function addWoning(w) {
    const { error } = await supabase.from("woningen").insert([w]);
    if (error) { showToast("Fout bij toevoegen woning","err"); return false; }
    showToast("✓ Woning toegevoegd"); return true;
  }

  async function updateWoning(id, updates) {
    const { error } = await supabase.from("woningen").update(updates).eq("id",id);
    if (error) { showToast("Fout bij opslaan","err"); return false; }
    showToast("✓ Opgeslagen"); return true;
  }

  async function deleteWoning(id) {
    const { error } = await supabase.from("woningen").delete().eq("id",id);
    if (error) { showToast("Fout bij verwijderen","err"); return false; }
    showToast("✓ Woning verwijderd"); return true;
  }

  async function slaChecklistOp(type, week, items, huisId) {
    const key = `${type}_${week}_${huisId||"all"}`;
    const bestaand = checklists.find(c=>c.sleutel===key);
    if (bestaand) {
      await supabase.from("checklists").update({items,bijgewerkt_door:gebruiker.naam,updated_at:new Date().toISOString()}).eq("id",bestaand.id);
    } else {
      await supabase.from("checklists").insert([{sleutel:key,type,week_jaar:week,woning_id:huisId||null,items,aangemaakt_door:gebruiker.naam}]);
    }
  }

  const openMeldingen = meldingen.filter(m=>m.status==="open");
  const openTaken = taken.filter(t=>t.status==="open");
  const mijnMeldingen = meldingen.filter(m=>m.ingediend_door===gebruiker?.naam);
  const rol = gebruiker?.rol;
  const naam = gebruiker?.naam;
  const isLiset = naam==="Liset";

  if (loading) return <LoadingScreen />;
  if (!gebruiker) return <LoginScreen gebruikers={gebruikers} onLogin={login} />;

  const rolIcon = rol==="backoffice"?"📊":rol==="huismeester"?"🏠":"👤";
  const totalNotifs = openMeldingen.length + openTaken.length;

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Inter','Segoe UI',sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:${C.bg}} ::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
        button{cursor:pointer;font-family:inherit} input,textarea,select{font-family:inherit}
        .fl{font-size:11px;font-weight:600;color:${C.muted};letter-spacing:.8px;text-transform:uppercase;margin-bottom:6px;display:block}
        .fi{width:100%;background:white;border:1.5px solid ${C.border};border-radius:8px;color:${C.text};padding:10px 14px;font-size:14px;outline:none;transition:border .2s}
        .fi:focus{border-color:${C.blauw};box-shadow:0 0 0 3px ${C.blauw}18}
        .fs{width:100%;background:white;border:1.5px solid ${C.border};border-radius:8px;color:${C.text};padding:10px 14px;font-size:14px;outline:none;appearance:none}
        .card{background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:22px;box-shadow:0 1px 4px rgba(27,58,107,.06)}
        .btn-b{background:${C.blauw};color:white;border:none;border-radius:8px;padding:11px 22px;font-size:14px;font-weight:600;transition:background .2s}
        .btn-b:hover{background:${C.blauwLight}} .btn-b:disabled{background:#aab4c4;cursor:not-allowed}
        .btn-g{background:${C.groen};color:white;border:none;border-radius:8px;padding:11px 22px;font-size:14px;font-weight:600;transition:background .2s}
        .btn-g:hover{background:${C.groenLight}} .btn-g:disabled{background:#aab4c4;cursor:not-allowed}
        .btn-out{background:transparent;border:1.5px solid ${C.border};color:${C.muted};border-radius:8px;padding:9px 18px;font-size:13px;font-weight:500;transition:all .2s}
        .btn-out:hover{border-color:${C.blauw};color:${C.blauw}}
        .btn-r{background:#dc2626;color:white;border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600}
        .btn-r:hover{background:#b91c1c}
        .tp{background:none;border:none;color:rgba(255,255,255,.7);padding:8px 14px;border-radius:20px;font-size:13px;font-weight:500;transition:all .2s;white-space:nowrap}
        .tp.act{background:${C.groen};color:white;font-weight:700}
        .tp:hover{color:white}
        .badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
        .mc{background:white;border:1px solid ${C.border};border-radius:10px;padding:16px;margin-bottom:10px;box-shadow:0 1px 3px rgba(27,58,107,.05)}
        .rt{border:2px solid ${C.border};border-radius:10px;padding:14px;text-align:center;cursor:pointer;transition:all .2s;flex:1;background:white}
        .rt.sel{border-color:${C.blauw};background:${C.blauw}10}
        .cr{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid ${C.border}}
        .cr:last-child{border-bottom:none}
        .cb{padding:5px 14px;border-radius:6px;font-size:12px;font-weight:600;border:1.5px solid;cursor:pointer;background:white}
        .cb.ja{border-color:${C.groen};color:${C.groen}} .cb.ja.s{background:${C.groen};color:white}
        .cb.nee{border-color:#ef4444;color:#ef4444} .cb.nee.s{background:#ef4444;color:white}
        .br{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;border:1px solid ${C.border};margin-bottom:6px;background:${C.bg}}
        .chk-item{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:8px;margin-bottom:6px;background:${C.bg};border:1px solid ${C.border};cursor:pointer;transition:all .15s}
        .chk-item.done{background:#f0fdf4;border-color:${C.groen}40}
        .chk-item:hover{border-color:${C.blauw}60}
        .taak-card{background:white;border:1px solid ${C.border};border-radius:10px;padding:14px;margin-bottom:8px;border-left:4px solid ${C.groen}}
        .taak-card.urgent{border-left-color:#ef4444}
        .taak-card.gedaan{border-left-color:#aab4c4;opacity:.7}
      `}</style>

      {toast && <div style={{position:"fixed",bottom:24,right:24,zIndex:9999,background:toast.type==="ok"?C.groen:"#dc2626",color:"white",padding:"12px 22px",borderRadius:10,fontWeight:600,fontSize:14,boxShadow:"0 8px 30px rgba(0,0,0,.2)"}}>{toast.msg}</div>}

      {/* TOPBAR */}
      <div style={{background:C.blauw,borderBottom:`2px solid ${C.groen}`,padding:"0 20px",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 12px rgba(27,58,107,.3)"}}>
        <div style={{maxWidth:1400,margin:"0 auto",display:"flex",alignItems:"center",gap:12,height:56}}>
          <div style={{background:"white",borderRadius:8,padding:"4px 10px",display:"flex",alignItems:"center",flexShrink:0}}>
            <span style={{fontWeight:900,fontSize:14,color:C.blauw}}>KTP</span>
            <span style={{fontWeight:900,fontSize:14,color:C.groen,marginLeft:4}}>INTERFLEX</span>
          </div>
          <div style={{display:"flex",gap:2,flex:1,justifyContent:"center",flexWrap:"wrap"}}>
            {rol==="collega" && (<>
              <button className={`tp ${tab==="melding"?"act":""}`} onClick={()=>setTab("melding")}>👤 Melding</button>
              <button className={`tp ${tab==="mijn"?"act":""}`} onClick={()=>setTab("mijn")}>📋 Mijn {mijnMeldingen.length>0&&<Notif n={mijnMeldingen.length}/>}</button>
              <button className={`tp ${tab==="taken"?"act":""}`} onClick={()=>setTab("taken")}>📌 To-do {openTaken.length>0&&<Notif n={openTaken.length}/>}</button>
              <button className={`tp ${tab==="woningen"?"act":""}`} onClick={()=>setTab("woningen")}>🏠 Woningen</button>
            </>)}
            {rol==="huismeester" && (<>
              <button className={`tp ${tab==="dagplanning"?"act":""}`} onClick={()=>setTab("dagplanning")}>📅 Mijn dag {totalNotifs>0&&<Notif n={totalNotifs}/>}</button>
              <button className={`tp ${tab==="meldingen"?"act":""}`} onClick={()=>setTab("meldingen")}>🔔 Meldingen {openMeldingen.length>0&&<Notif n={openMeldingen.length}/>}</button>
              <button className={`tp ${tab==="taken"?"act":""}`} onClick={()=>setTab("taken")}>📌 To-do {openTaken.length>0&&<Notif n={openTaken.length}/>}</button>
              <button className={`tp ${tab==="checklist"?"act":""}`} onClick={()=>setTab("checklist")}>✅ Checklists</button>
              <button className={`tp ${tab==="woningen"?"act":""}`} onClick={()=>setTab("woningen")}>🏠 Woningen</button>
            </>)}
            {rol==="backoffice" && (<>
              <button className={`tp ${tab==="woningen"?"act":""}`} onClick={()=>setTab("woningen")}>🏠 Woningen</button>
              <button className={`tp ${tab==="planning"?"act":""}`} onClick={()=>setTab("planning")}>📊 Status</button>
              <button className={`tp ${tab==="taken"?"act":""}`} onClick={()=>setTab("taken")}>📌 To-do {openTaken.length>0&&<Notif n={openTaken.length}/>}</button>
              <button className={`tp ${tab==="inbox"?"act":""}`} onClick={()=>setTab("inbox")}>📨 Inbox {openMeldingen.length>0&&<Notif n={openMeldingen.length}/>}</button>
              <button className={`tp ${tab==="checklist"?"act":""}`} onClick={()=>setTab("checklist")}>✅ Checklists</button>
              <button className={`tp ${tab==="log"?"act":""}`} onClick={()=>setTab("log")}>📝 Log</button>
              {isLiset&&<button className={`tp ${tab==="beheer"?"act":""}`} onClick={()=>setTab("beheer")}>⚙️ Beheer</button>}
            </>)}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            <div style={{background:"rgba(255,255,255,.15)",borderRadius:20,padding:"5px 12px",display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:14}}>{rolIcon}</span>
              <span style={{fontSize:13,color:"white",fontWeight:600}}>{naam}</span>
            </div>
            <button className="btn-out" style={{padding:"5px 12px",fontSize:12,borderColor:"rgba(255,255,255,.3)",color:"rgba(255,255,255,.8)"}} onClick={logout}>Uitloggen</button>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{maxWidth:1400,margin:"0 auto",padding:"28px 20px"}}>
        {rol==="collega"&&tab==="melding"&&<MeldingForm houses={houses} onSubmit={addMelding} showToast={showToast}/>}
        {rol==="collega"&&tab==="mijn"&&<MijnMeldingen meldingen={mijnMeldingen} houses={houses}/>}
        {tab==="taken"&&<TakenView taken={taken} houses={houses} gebruiker={gebruiker} onAdd={addTaak} onUpdate={updateTaak} showToast={showToast}/>}
        {tab==="woningen"&&<WoningenDetail houses={houses}/>}
        {tab==="planning"&&<PlanningView houses={houses}/>}
        {rol==="huismeester"&&tab==="dagplanning"&&<DagplanningView meldingen={meldingen} taken={taken} houses={houses} onUpdate={updateMeldingStatus} onUpdateTaak={updateTaak} naam={naam}/>}
        {rol==="huismeester"&&tab==="meldingen"&&<HuismeesterTaken meldingen={meldingen} houses={houses} onUpdate={updateMeldingStatus} naam={naam}/>}
        {tab==="checklist"&&<ChecklistView houses={houses} checklists={checklists} checklistItems={checklistItems} onSave={slaChecklistOp} gebruiker={gebruiker}/>}
        {rol==="backoffice"&&tab==="inbox"&&<BackofficeInbox meldingen={meldingen} houses={houses} onUpdate={updateMeldingStatus} naam={naam} showToast={showToast}/>}
        {rol==="backoffice"&&tab==="log"&&<LogView meldingen={meldingen} houses={houses}/>}
        {rol==="backoffice"&&isLiset&&tab==="beheer"&&<BeheerView houses={houses} onAdd={addWoning} onUpdate={updateWoning} onDelete={deleteWoning} showToast={showToast} gebruikers={gebruikers} onAddGebruiker={voegGebruikerToe} onUpdateGebruiker={updateGebruiker} onDeleteGebruiker={verwijderGebruiker} checklistItems={checklistItems}/>}
      </div>
    </div>
  );
}

function Notif({n}) { return <span style={{background:"#ef4444",color:"white",borderRadius:10,padding:"1px 6px",fontSize:11,marginLeft:4}}>{n}</span>; }

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({ gebruikers, onLogin }) {
  const [rolFilter, setRolFilter] = useState(null);
  const [geselecteerd, setGeselecteerd] = useState(null);
  const [pin, setPin] = useState("");
  const [fout, setFout] = useState("");

  const rollen = [
    { id:"collega",      icon:"👤", label:"Collega",      kleur:C.muted },
    { id:"huismeester",  icon:"🏠", label:"Huismeester",  kleur:C.groen },
    { id:"backoffice",   icon:"📊", label:"Backoffice",   kleur:C.blauw },
  ];

  const gefilterd = rolFilter ? gebruikers.filter(g=>g.rol===rolFilter) : [];
  const rolKleur  = { backoffice:C.blauw, huismeester:C.groen, collega:C.muted };

  function probeerLogin() {
    if (!geselecteerd) return;
    if (pin===geselecteerd.pin) { onLogin(geselecteerd); }
    else { setFout("Verkeerde pincode, probeer opnieuw"); setPin(""); }
  }

  return (
    <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${C.blauw} 0%,${C.blauwDark} 60%,${C.dark} 100%)`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',sans-serif",padding:20}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap'); *{box-sizing:border-box;margin:0;padding:0}`}</style>
      <div style={{marginBottom:28,textAlign:"center"}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:16,background:"rgba(255,255,255,.1)",borderRadius:16,padding:"14px 28px",border:"1px solid rgba(255,255,255,.2)"}}>
          <span style={{fontWeight:900,fontSize:26,color:"white",letterSpacing:"-1px"}}>KTP</span>
          <span style={{fontWeight:900,fontSize:26,color:C.groen,letterSpacing:"-1px",marginLeft:6}}>INTERFLEX</span>
          <div style={{width:1,height:24,background:"rgba(255,255,255,.3)",marginLeft:8}}/>
          <div style={{fontSize:11,color:"rgba(255,255,255,.6)",letterSpacing:"2px",textTransform:"uppercase",fontWeight:600}}>Woningbeheer</div>
        </div>
      </div>

      <div style={{width:"100%",maxWidth:460,background:"white",borderRadius:20,boxShadow:"0 40px 80px rgba(0,0,0,.4)",overflow:"hidden"}}>
        <div style={{background:C.groen,padding:"16px 28px"}}>
          <div style={{fontSize:14,fontWeight:700,color:"white"}}>
            {!rolFilter ? "Selecteer je rol" : !geselecteerd ? `${rollen.find(r=>r.id===rolFilter)?.label} — Wie ben jij?` : `Inloggen als ${geselecteerd.naam}`}
          </div>
        </div>
        <div style={{padding:"24px 28px 28px"}}>

          {/* Stap 1: Rol kiezen */}
          {!rolFilter && (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {rollen.map(r=>(
                <button key={r.id} onClick={()=>setRolFilter(r.id)}
                  style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:12,padding:"16px 20px",color:C.text,display:"flex",alignItems:"center",gap:14,textAlign:"left",transition:"all .15s",cursor:"pointer"}}>
                  <div style={{width:44,height:44,borderRadius:12,background:r.kleur+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{r.icon}</div>
                  <div>
                    <div style={{fontWeight:700,fontSize:16}}>{r.label}</div>
                    <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                      {r.id==="collega"?"Melding doorgeven & woningen bekijken":r.id==="huismeester"?"Taken & checklists afhandelen":"Planning, inbox & beheer"}
                    </div>
                  </div>
                  <div style={{marginLeft:"auto",color:C.border,fontSize:20}}>›</div>
                </button>
              ))}
            </div>
          )}

          {/* Stap 2: Naam kiezen */}
          {rolFilter && !geselecteerd && (
            <>
              <button onClick={()=>setRolFilter(null)} style={{background:"none",border:"none",color:C.muted,fontSize:13,marginBottom:16,display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontFamily:"inherit"}}>← Terug</button>
              <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:320,overflowY:"auto"}}>
                {gefilterd.map(g=>(
                  <button key={g.naam} onClick={()=>{setGeselecteerd(g);setFout("");setPin("");}}
                    style={{background:C.bg,border:`1.5px solid ${C.border}`,borderRadius:10,padding:"12px 16px",color:C.text,display:"flex",alignItems:"center",gap:12,textAlign:"left",transition:"all .15s",cursor:"pointer"}}>
                    <div style={{width:36,height:36,borderRadius:10,background:rolKleur[g.rol]+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                      {g.rol==="backoffice"?"📊":g.rol==="huismeester"?"🏠":"👤"}
                    </div>
                    <span style={{fontWeight:700,fontSize:15}}>{g.naam}</span>
                    <div style={{marginLeft:"auto",color:C.border,fontSize:18}}>›</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Stap 3: Pincode */}
          {geselecteerd && (
            <>
              <button onClick={()=>{setGeselecteerd(null);setPin("");setFout("");}} style={{background:"none",border:"none",color:C.muted,fontSize:13,marginBottom:20,display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontFamily:"inherit"}}>← Terug</button>
              <div style={{textAlign:"center",marginBottom:24}}>
                <div style={{width:60,height:60,borderRadius:16,background:rolKleur[geselecteerd.rol]+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,margin:"0 auto 10px"}}>
                  {geselecteerd.rol==="backoffice"?"📊":geselecteerd.rol==="huismeester"?"🏠":"👤"}
                </div>
                <div style={{fontWeight:800,fontSize:20,color:C.text}}>{geselecteerd.naam}</div>
              </div>
              <label style={{display:"block",fontSize:11,fontWeight:700,color:C.muted,letterSpacing:"1px",textTransform:"uppercase",marginBottom:8}}>Pincode</label>
              <input type="password" value={pin} onChange={e=>{setPin(e.target.value);setFout("");}} onKeyDown={e=>e.key==="Enter"&&probeerLogin()} placeholder="••••" maxLength={8}
                style={{width:"100%",background:C.bg,border:`2px solid ${fout?"#ef4444":C.border}`,borderRadius:10,color:C.text,padding:"16px",fontSize:26,outline:"none",letterSpacing:10,textAlign:"center",marginBottom:10,transition:"border .2s"}}/>
              {fout&&<div style={{color:"#ef4444",fontSize:13,marginBottom:12,textAlign:"center",fontWeight:500}}>⚠ {fout}</div>}
              <button onClick={probeerLogin} disabled={!pin}
                style={{width:"100%",background:pin?C.blauw:C.border,color:"white",border:"none",borderRadius:10,padding:14,fontSize:15,fontWeight:700,cursor:pin?"pointer":"not-allowed",fontFamily:"inherit",transition:"background .2s"}}>
                Inloggen →
              </button>
            </>
          )}
        </div>
      </div>
      <div style={{marginTop:20,fontSize:12,color:"rgba(255,255,255,.4)"}}>KTP Interflex · Woningbeheer systeem</div>
    </div>
  );
}

function LoadingScreen() {
  return <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${C.blauw} 0%,${C.dark} 100%)`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Inter,sans-serif"}}><div style={{textAlign:"center",color:"white"}}><div style={{fontSize:36,marginBottom:16}}>⏳</div><div style={{fontWeight:700,fontSize:16,marginBottom:6}}>KTP Interflex</div><div style={{fontSize:13,opacity:.6}}>Verbinden met database...</div></div></div>;
}

function SH({titel,sub,actie}) {
  return <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24}}><div><h2 style={{fontSize:20,fontWeight:800,color:C.blauw,marginBottom:3}}>{titel}</h2>{sub&&<p style={{fontSize:13,color:C.muted}}>{sub}</p>}</div>{actie}</div>;
}

function SK({label,val,color}) {
  return <div className="card" style={{borderTop:`3px solid ${color}`,padding:"14px 16px"}}><div style={{fontSize:26,fontWeight:800,color}}>{val}</div><div style={{fontSize:11,color:C.muted,marginTop:3}}>{label}</div></div>;
}

// ─── DAGPLANNING HUISMEESTER ──────────────────────────────────────────────────
function DagplanningView({ meldingen, taken, houses, onUpdate, onUpdateTaak, naam }) {
  const dag = dagVanDeWeek();
  const vandaag = DAGPLANNING[dag];
  const dagNamen = ["ma","di","wo","do","vr"];
  const [gekozenDag, setGekozenDag] = useState(dag in DAGPLANNING ? dag : "ma");
  const getoondeDag = DAGPLANNING[gekozenDag];
  const openMeldingen = meldingen.filter(m=>m.status==="open");
  const openTaken = taken.filter(t=>t.status==="open");
  const [notitieMap, setNotitieMap] = useState({});

  return (
    <div>
      <SH titel="📅 Mijn werkdag" sub={`Vandaag is het ${vandaag ? vandaag.label : "weekend"} — ${vandaag ? vandaag.focus : "Geniet van je vrije dag!"}`} />

      {/* Dagknoppen */}
      <div style={{display:"flex",gap:8,marginBottom:24,flexWrap:"wrap"}}>
        {dagNamen.map(d=>{
          const info = DAGPLANNING[d];
          const isVandaag = d===dag;
          return (
            <button key={d} onClick={()=>setGekozenDag(d)}
              style={{flex:1,minWidth:100,background:gekozenDag===d?info.kleur:"white",color:gekozenDag===d?"white":C.text,border:`2px solid ${gekozenDag===d?info.kleur:C.border}`,borderRadius:12,padding:"12px 10px",cursor:"pointer",fontFamily:"inherit",transition:"all .2s"}}>
              <div style={{fontSize:18,marginBottom:4}}>{info.icon}</div>
              <div style={{fontWeight:700,fontSize:13}}>{info.label}</div>
              {isVandaag&&<div style={{fontSize:10,marginTop:3,opacity:.8,fontWeight:600}}>VANDAAG</div>}
            </button>
          );
        })}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        {/* Dagtaken */}
        <div className="card" style={{borderTop:`4px solid ${getoondeDag.kleur}`}}>
          <div style={{fontWeight:800,fontSize:15,color:getoondeDag.kleur,marginBottom:4}}>{getoondeDag.icon} {getoondeDag.label}</div>
          <div style={{fontSize:13,color:C.muted,marginBottom:16}}>{getoondeDag.focus}</div>
          {getoondeDag.taken.map((t,i)=>(
            <div key={i} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:i<getoondeDag.taken.length-1?`1px solid ${C.border}`:"none",alignItems:"flex-start"}}>
              <div style={{width:22,height:22,borderRadius:6,background:getoondeDag.kleur+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:getoondeDag.kleur,flexShrink:0,marginTop:1}}>{i+1}</div>
              <span style={{fontSize:13,color:C.text}}>{t}</span>
            </div>
          ))}
        </div>

        {/* Open meldingen & taken */}
        <div>
          <div className="card" style={{marginBottom:16,borderTop:`4px solid #ef4444`}}>
            <div style={{fontWeight:800,fontSize:15,color:"#ef4444",marginBottom:12}}>🔔 Open meldingen ({openMeldingen.length})</div>
            {openMeldingen.length===0 ? <div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>Geen openstaande meldingen 🎉</div>
            : openMeldingen.slice(0,5).map(m=>{
              const huis=houses.find(h=>h.id===m.woning_id);
              return (
                <div key={m.id} style={{padding:"10px 0",borderBottom:`1px solid ${C.border}`,display:"flex",gap:10,alignItems:"flex-start"}}>
                  <span style={{fontSize:18}}>{m.type==="aankomst"?"🚗":m.type==="vertrek"?"🧳":"📅"}</span>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13,color:C.text}}>{m.medewerker} — {m.type}</div>
                    <div style={{fontSize:12,color:C.muted}}>{huis?.adres} · K{m.kamer}</div>
                  </div>
                  <button className="btn-g" style={{padding:"5px 12px",fontSize:11}} onClick={()=>onUpdate(m.id,"afgehandeld","")}>✓</button>
                </div>
              );
            })}
            {openMeldingen.length>5&&<div style={{fontSize:12,color:C.muted,marginTop:8,fontStyle:"italic"}}>+{openMeldingen.length-5} meer — zie tabblad Meldingen</div>}
          </div>

          <div className="card" style={{borderTop:`4px solid ${C.groen}`}}>
            <div style={{fontWeight:800,fontSize:15,color:C.groen,marginBottom:12}}>📌 Openstaande to-do's ({openTaken.length})</div>
            {openTaken.length===0 ? <div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>Geen open taken 🎉</div>
            : openTaken.slice(0,5).map(t=>{
              const huis=houses.find(h=>h.id===t.woning_id);
              return (
                <div key={t.id} style={{padding:"10px 0",borderBottom:`1px solid ${C.border}`,display:"flex",gap:10,alignItems:"flex-start"}}>
                  <span style={{fontSize:16,marginTop:2}}>{t.prioriteit==="hoog"?"🔴":t.prioriteit==="middel"?"🟡":"🟢"}</span>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13,color:C.text}}>{t.titel}</div>
                    <div style={{fontSize:12,color:C.muted}}>{huis?.adres||"Algemeen"}{t.kamer?` · K${t.kamer}`:""}</div>
                  </div>
                  <button className="btn-b" style={{padding:"5px 12px",fontSize:11}} onClick={()=>onUpdateTaak(t.id,{status:"gedaan",afgehandeld_door:naam,afgehandeld_op:new Date().toISOString()})}>✓</button>
                </div>
              );
            })}
            {openTaken.length>5&&<div style={{fontSize:12,color:C.muted,marginTop:8,fontStyle:"italic"}}>+{openTaken.length-5} meer — zie tabblad To-do</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TAKEN / TO-DO ────────────────────────────────────────────────────────────
function TakenView({ taken, houses, gebruiker, onAdd, onUpdate, showToast }) {
  const [toonNieuwe, setToonNieuwe] = useState(false);
  const [filter, setFilter] = useState("open");
  const [nieuw, setNieuw] = useState({titel:"",omschrijving:"",woning_id:"",kamer:"",prioriteit:"middel"});
  const [saving, setSaving] = useState(false);

  const gefilterd = taken.filter(t=> filter==="open"?t.status==="open": filter==="gedaan"?t.status==="gedaan": true);
  const selectedHouse = houses.find(h=>h.id===Number(nieuw.woning_id));

  async function voegToe() {
    if (!nieuw.titel.trim()) { showToast("Vul een titel in","err"); return; }
    setSaving(true);
    await onAdd({titel:nieuw.titel.trim(),omschrijving:nieuw.omschrijving||null,woning_id:nieuw.woning_id?Number(nieuw.woning_id):null,kamer:nieuw.kamer||null,prioriteit:nieuw.prioriteit});
    setSaving(false);
    setNieuw({titel:"",omschrijving:"",woning_id:"",kamer:"",prioriteit:"middel"});
    setToonNieuwe(false);
  }

  const prioKleur={hoog:"#ef4444",middel:"#f59e0b",laag:C.groen};
  const prioIcon={hoog:"🔴",middel:"🟡",laag:"🟢"};

  return (
    <div>
      <SH titel="📌 To-do lijst" sub="Meld problemen of klusjes per woning/kamer"
        actie={<button className="btn-b" style={{padding:"9px 18px",fontSize:13}} onClick={()=>setToonNieuwe(!toonNieuwe)}>+ Taak toevoegen</button>} />

      {toonNieuwe && (
        <div className="card" style={{marginBottom:20,borderTop:`3px solid ${C.groen}`}}>
          <div style={{fontWeight:700,fontSize:14,color:C.groen,marginBottom:16}}>Nieuwe taak / melding</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
            <div style={{gridColumn:"1/-1"}}>
              <label className="fl">Omschrijving probleem / taak *</label>
              <input className="fi" value={nieuw.titel} onChange={e=>setNieuw(p=>({...p,titel:e.target.value}))} placeholder="bijv. Lamp kapot in keuken, Kraan lekt, Rookmelder piept..." />
            </div>
            <div>
              <label className="fl">Woning</label>
              <select className="fs" value={nieuw.woning_id} onChange={e=>setNieuw(p=>({...p,woning_id:e.target.value,kamer:""}))}>
                <option value="">Algemeen / niet specifiek</option>
                {houses.map(h=><option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
              </select>
            </div>
            <div>
              <label className="fl">Kamer</label>
              <select className="fs" value={nieuw.kamer} onChange={e=>setNieuw(p=>({...p,kamer:e.target.value}))} disabled={!nieuw.woning_id}>
                <option value="">Geen specifieke kamer</option>
                {selectedHouse?.kamers.map(k=><option key={k.k} value={k.k}>Kamer {k.k}{k.naam?` – ${k.naam}`:""}</option>)}
              </select>
            </div>
            <div>
              <label className="fl">Prioriteit</label>
              <select className="fs" value={nieuw.prioriteit} onChange={e=>setNieuw(p=>({...p,prioriteit:e.target.value}))}>
                <option value="hoog">🔴 Hoog – spoedeisend</option>
                <option value="middel">🟡 Middel – deze week</option>
                <option value="laag">🟢 Laag – wanneer mogelijk</option>
              </select>
            </div>
            <div>
              <label className="fl">Extra toelichting</label>
              <input className="fi" value={nieuw.omschrijving} onChange={e=>setNieuw(p=>({...p,omschrijving:e.target.value}))} placeholder="Optioneel..." />
            </div>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button className="btn-g" style={{flex:1,padding:"10px"}} onClick={voegToe} disabled={saving}>{saving?"⏳ Opslaan...":"✓ Taak toevoegen"}</button>
            <button className="btn-out" onClick={()=>setToonNieuwe(false)}>Annuleren</button>
          </div>
        </div>
      )}

      <div style={{display:"flex",gap:6,marginBottom:20}}>
        {[["open","Open"],["gedaan","Gedaan"],["alle","Alle"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFilter(v)}
            style={{background:filter===v?C.blauw:"white",color:filter===v?"white":C.muted,border:`1.5px solid ${filter===v?C.blauw:C.border}`,borderRadius:20,padding:"6px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            {l} {v==="open"&&<span style={{background:"#ef444430",color:"#ef4444",borderRadius:10,padding:"1px 6px",fontSize:11,marginLeft:4}}>{taken.filter(t=>t.status==="open").length}</span>}
          </button>
        ))}
      </div>

      {gefilterd.length===0 ? (
        <div className="card" style={{textAlign:"center",padding:"50px 20px"}}>
          <div style={{fontSize:40,marginBottom:10}}>📭</div>
          <div style={{color:C.muted}}>Geen taken in deze categorie</div>
        </div>
      ) : gefilterd.map(t=>{
        const huis=houses.find(h=>h.id===t.woning_id);
        const gedaan=t.status==="gedaan";
        return (
          <div key={t.id} className={`taak-card ${t.prioriteit==="hoog"?"urgent":""} ${gedaan?"gedaan":""}`}>
            <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
              <span style={{fontSize:20,marginTop:2}}>{prioIcon[t.prioriteit]||"🟢"}</span>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:4}}>
                  <span style={{fontWeight:700,fontSize:15,color:gedaan?C.muted:C.text,textDecoration:gedaan?"line-through":"none"}}>{t.titel}</span>
                  <span className="badge" style={{background:prioKleur[t.prioriteit]+"18",color:prioKleur[t.prioriteit]}}>{t.prioriteit?.toUpperCase()}</span>
                  {gedaan&&<span className="badge" style={{background:"#f0fdf4",color:C.groen}}>GEDAAN</span>}
                </div>
                <div style={{fontSize:12,color:C.muted}}>
                  {huis?`📍 ${huis.adres}, ${huis.stad}`:"📋 Algemeen"}{t.kamer?` · Kamer ${t.kamer}`:""}
                  {" · "}Toegevoegd door {t.aangemaakt_door}{t.created_at?` · ${fmtFull(t.created_at)}`:""}
                </div>
                {t.omschrijving&&<div style={{fontSize:13,color:C.muted,marginTop:4,fontStyle:"italic"}}>"{t.omschrijving}"</div>}
                {gedaan&&t.afgehandeld_door&&<div style={{fontSize:12,color:C.groen,marginTop:4}}>✓ Afgehandeld door {t.afgehandeld_door}</div>}
              </div>
              {!gedaan&&(
                <button className="btn-g" style={{padding:"7px 14px",fontSize:12,flexShrink:0}}
                  onClick={()=>onUpdate(t.id,{status:"gedaan",afgehandeld_door:gebruiker.naam,afgehandeld_op:new Date().toISOString()})}>
                  ✓ Gedaan
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── CHECKLISTS ───────────────────────────────────────────────────────────────
function ChecklistView({ houses, checklists, checklistItems, onSave, gebruiker }) {
  const weekNr = () => { const d=new Date(); const j=new Date(Date.UTC(d.getFullYear(),0,1)); return Math.ceil((((d-j)/86400000)+j.getDay()+1)/7); };
  const kwartaal = () => Math.ceil((new Date().getMonth()+1)/3);
  const jaar = new Date().getFullYear();

  const [actief, setActief] = useState("wekelijks");
  const [geselecteerdeWoning, setGeselecteerdeWoning] = useState("all");
  const [saving, setSaving] = useState(false);

  const weekSleutel = `${jaar}-W${weekNr()}`;
  const maandSleutel = `${jaar}-4W${Math.ceil(weekNr()/4)}`;
  const kwartaalSleutel = `${jaar}-Q${kwartaal()}`;

  function huidigeSleutel() {
    if (actief==="wekelijks") return weekSleutel;
    if (actief==="4wekelijks") return maandSleutel;
    return kwartaalSleutel;
  }

  // Haal items uit Supabase
  const lijst = checklistItems.filter(i => i.type === actief).map(i => i.tekst);

  const dbSleutel = `${actief}_${huidigeSleutel()}_${geselecteerdeWoning}`;
  const bestaand = checklists.find(c=>c.sleutel===dbSleutel);
  const [afgevinkt, setAfgevinkt] = useState(bestaand?.items||[]);

  useEffect(()=>{
    const b=checklists.find(c=>c.sleutel===dbSleutel);
    setAfgevinkt(b?.items||[]);
  },[actief,geselecteerdeWoning,dbSleutel,checklists]);

  function toggleItem(item) {
    setAfgevinkt(prev=>prev.includes(item)?prev.filter(i=>i!==item):[...prev,item]);
  }

  async function opslaan() {
    setSaving(true);
    await onSave(actief, huidigeSleutel(), afgevinkt, geselecteerdeWoning==="all"?null:Number(geselecteerdeWoning));
    setSaving(false);
  }

  const pct = lijst.length > 0 ? Math.round((afgevinkt.length/lijst.length)*100) : 0;

  const typeInfo = {
    wekelijks:   {label:"Wekelijks",   icon:"📋", kleur:C.blauw,   periode:`Week ${weekNr()}, ${jaar}`},
    "4wekelijks":{label:"4-wekelijks", icon:"📅", kleur:C.groen,   periode:`Periode ${Math.ceil(weekNr()/4)}, ${jaar}`},
    kwartaal:    {label:"Kwartaal",    icon:"🏆", kleur:"#7c3aed", periode:`Q${kwartaal()} ${jaar}`},
  };

  const isBackoffice = gebruiker?.rol==="backoffice";

  return (
    <div>
      <SH titel="✅ Checklists" sub="SNF-gecertificeerde controles voor alle woningen" />

      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        {Object.entries(typeInfo).map(([k,v])=>(
          <button key={k} onClick={()=>setActief(k)}
            style={{flex:1,minWidth:140,background:actief===k?v.kleur:"white",color:actief===k?"white":C.text,border:`2px solid ${actief===k?v.kleur:C.border}`,borderRadius:12,padding:"12px 16px",cursor:"pointer",fontFamily:"inherit",transition:"all .2s",textAlign:"left"}}>
            <div style={{fontSize:20,marginBottom:4}}>{v.icon}</div>
            <div style={{fontWeight:700,fontSize:14}}>{v.label}</div>
            <div style={{fontSize:11,opacity:.8,marginTop:2}}>{v.periode}</div>
            <div style={{fontSize:11,opacity:.6,marginTop:1}}>{checklistItems.filter(i=>i.type===k).length} items</div>
          </button>
        ))}
      </div>

      {isBackoffice && (
        <div style={{marginBottom:20}}>
          <label className="fl">Bekijk checklist voor woning</label>
          <select className="fs" style={{maxWidth:400}} value={geselecteerdeWoning} onChange={e=>setGeselecteerdeWoning(e.target.value)}>
            <option value="all">Alle woningen (algemeen)</option>
            {houses.map(h=><option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
          </select>
        </div>
      )}

      <div className="card" style={{borderTop:`4px solid ${typeInfo[actief].kleur}`}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <div>
            <div style={{fontWeight:800,fontSize:16,color:typeInfo[actief].kleur}}>{typeInfo[actief].icon} {typeInfo[actief].label} — {typeInfo[actief].periode}</div>
            {!isBackoffice&&<div style={{fontSize:13,color:C.muted,marginTop:2}}>Vink af wat je hebt gecontroleerd</div>}
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:28,fontWeight:800,color:pct===100?C.groen:typeInfo[actief].kleur}}>{pct}%</div>
            <div style={{fontSize:11,color:C.muted}}>{afgevinkt.length}/{lijst.length} gedaan</div>
          </div>
        </div>

        <div style={{background:C.bg,borderRadius:99,height:8,marginBottom:20,overflow:"hidden"}}>
          <div style={{height:"100%",background:pct===100?C.groen:typeInfo[actief].kleur,borderRadius:99,width:`${pct}%`,transition:"width .3s"}}/>
        </div>

        {lijst.length === 0 ? (
          <div style={{textAlign:"center",padding:"30px",color:C.muted,fontSize:13}}>
            Nog geen items voor dit type checklist.<br/>
            {isBackoffice && "Voeg items toe via Beheer → Checklists."}
          </div>
        ) : lijst.map((item,i)=>{
          const checked=afgevinkt.includes(item);
          return (
            <div key={i} className={`chk-item ${checked?"done":""}`}
              onClick={()=>!isBackoffice&&toggleItem(item)}
              style={{cursor:isBackoffice?"default":"pointer"}}>
              <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${checked?C.groen:C.border}`,background:checked?C.groen:"white",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .15s"}}>
                {checked&&<span style={{color:"white",fontSize:13,fontWeight:700}}>✓</span>}
              </div>
              <span style={{fontSize:13,color:checked?C.groenDark:C.text,textDecoration:checked?"line-through":"none",fontWeight:checked?500:400}}>{item}</span>
            </div>
          );
        })}

        {!isBackoffice&&lijst.length>0&&(
          <div style={{marginTop:20,display:"flex",gap:10}}>
            <button className="btn-g" style={{flex:1,padding:12}} onClick={opslaan} disabled={saving}>
              {saving?"⏳ Opslaan...":"💾 Voortgang opslaan"}
            </button>
            {afgevinkt.length>0&&<button className="btn-out" onClick={()=>setAfgevinkt([])}>Reset</button>}
          </div>
        )}

        {bestaand&&<div style={{marginTop:12,fontSize:12,color:C.muted}}>Laatst opgeslagen door {bestaand.aangemaakt_door} — {bestaand.updated_at?fmtFull(bestaand.updated_at):fmtFull(bestaand.created_at)}</div>}
      </div>
    </div>
  );
}

// ─── MELDING FORM ─────────────────────────────────────────────────────────────
function MeldingForm({ houses, onSubmit, showToast }) {
  const [type,setType]=useState("aankomst");
  const [medewerker,setMedewerker]=useState("");
  const [datum,setDatum]=useState(todayISO());
  const [huisId,setHuisId]=useState(houses[0]?.id||1);
  const [kamer,setKamer]=useState("");
  const [wieRegelt,setWieRegelt]=useState("");
  const [sleutelTerug,setSleutelTerug]=useState(null);
  const [kamerSchoon,setKamerSchoon]=useState(null);
  const [sleutelAantal,setSleutelAantal]=useState(1);
  const [opmerkingen,setOpmerkingen]=useState("");
  const [submitted,setSubmitted]=useState(false);
  const [saving,setSaving]=useState(false);
  const selectedHouse=houses.find(h=>h.id===Number(huisId));

  async function handleSubmit() {
    if(!medewerker.trim()){showToast("Vul naam medewerker in","err");return;}
    if(!kamer){showToast("Selecteer een kamer","err");return;}
    if(type==="vertrek"&&(sleutelTerug===null||kamerSchoon===null)){showToast("Vul sleutel & schoonmaak in","err");return;}
    setSaving(true);
    await onSubmit({type,medewerker:medewerker.trim(),datum,huisId:Number(huisId),kamer,wieRegelt,sleutelTerug,kamerSchoon,sleutelAantal,opmerkingen});
    setSaving(false);
    setMedewerker("");setOpmerkingen("");setKamer("");setSleutelTerug(null);setKamerSchoon(null);setWieRegelt("");
    setSubmitted(true);setTimeout(()=>setSubmitted(false),2500);
  }

  if(submitted) return (
    <div className="card" style={{textAlign:"center",padding:"80px 40px",maxWidth:600,margin:"0 auto",borderTop:`4px solid ${C.groen}`}}>
      <div style={{fontSize:64,marginBottom:16}}>✅</div>
      <div style={{fontSize:22,fontWeight:800,color:C.groen,marginBottom:8}}>Melding verzonden!</div>
      <div style={{fontSize:14,color:C.muted,marginBottom:24}}>De huismeester en backoffice zijn op de hoogte gebracht.</div>
      <button className="btn-b" onClick={()=>setSubmitted(false)}>Nieuwe melding</button>
    </div>
  );

  const types=[{id:"aankomst",icon:"🚗",label:"AANKOMST",color:C.groen},{id:"vertrek",icon:"🧳",label:"VERTREK",color:"#ef4444"},{id:"reservering",icon:"📅",label:"RESERVERING",color:C.blauw},{id:"overig",icon:"💬",label:"OVERIG",color:C.muted}];

  // Groepeer woningen per stad
  const steden=[...new Set(houses.map(h=>h.stad))].sort();

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <SH titel="Melding doorgeven" sub="Geef een aankomst, vertrek of reservering door." />
      <div className="card" style={{marginBottom:16,borderTop:`3px solid ${C.blauw}`}}>
        <label className="fl">Wat wil je melden?</label>
        <div style={{display:"flex",gap:10}}>
          {types.map(t=>(
            <div key={t.id} className={`rt ${type===t.id?"sel":""}`} onClick={()=>setType(t.id)}
              style={{borderColor:type===t.id?t.color:C.border,background:type===t.id?t.color+"12":"white"}}>
              <span style={{fontSize:26,display:"block",marginBottom:6}}>{t.icon}</span>
              <div style={{fontSize:10,fontWeight:700,color:type===t.id?t.color:C.muted,letterSpacing:".8px"}}>{t.label}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:16}}>
        <div><label className="fl">Naam medewerker</label><input className="fi" value={medewerker} onChange={e=>setMedewerker(e.target.value)} placeholder="Voor- en achternaam"/></div>
        <div><label className="fl">Datum</label><input className="fi" type="date" value={datum} onChange={e=>setDatum(e.target.value)}/></div>
        <div>
          <label className="fl">Woning</label>
          <select className="fs" value={huisId} onChange={e=>{setHuisId(e.target.value);setKamer("");}}>
            {steden.map(stad=>(
              <optgroup key={stad} label={stad}>
                {houses.filter(h=>h.stad===stad).map(h=><option key={h.id} value={h.id}>{h.adres}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="fl">Kamernummer</label>
          <select className="fs" value={kamer} onChange={e=>setKamer(e.target.value)}>
            <option value="">Selecteer kamer</option>
            {selectedHouse?.kamers.map(k=><option key={k.k} value={k.k}>Kamer {k.k}{k.naam?` – ${k.naam}`:""} [{k.status}]</option>)}
          </select>
        </div>
      </div>
      {(type==="aankomst"||type==="reservering")&&(
        <div className="card" style={{marginBottom:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
          <div><label className="fl">Wie regelt aankomst?</label><input className="fi" value={wieRegelt} onChange={e=>setWieRegelt(e.target.value)} placeholder="bijv. NW CB, Hans, zelf..."/></div>
          {type==="aankomst"&&<div><label className="fl">Aantal sleutels ontvangen</label><select className="fs" value={sleutelAantal} onChange={e=>setSleutelAantal(Number(e.target.value))}>{[0,1,2,3].map(n=><option key={n} value={n}>{n}</option>)}</select></div>}
        </div>
      )}
      {type==="vertrek"&&(
        <div className="card" style={{marginBottom:16}}>
          <label className="fl">Controlelijst bij vertrek</label>
          <div className="cr"><span style={{flex:1,fontSize:14,fontWeight:500}}>🔑 Sleutel(s) teruggegeven?</span><div style={{display:"flex",gap:8}}>{["ja","nee"].map(v=><button key={v} className={`cb ${v} ${sleutelTerug===v?"s":""}`} onClick={()=>setSleutelTerug(v)}>{v}</button>)}</div></div>
          <div className="cr"><span style={{flex:1,fontSize:14,fontWeight:500}}>🧹 Kamer schoon achtergelaten?</span><div style={{display:"flex",gap:8}}>{["ja","nee"].map(v=><button key={v} className={`cb ${v} ${kamerSchoon===v?"s":""}`} onClick={()=>setKamerSchoon(v)}>{v}</button>)}</div></div>
          {sleutelTerug==="nee"&&<div style={{marginTop:10,padding:"10px 14px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,fontSize:13,color:"#b91c1c",fontWeight:500}}>⚠️ Sleutel niet terug → backoffice wordt geïnformeerd om €100 in te houden van borg</div>}
        </div>
      )}
      <div className="card" style={{marginBottom:20}}><label className="fl">Opmerkingen</label><textarea className="fi" value={opmerkingen} onChange={e=>setOpmerkingen(e.target.value)} placeholder="Eventuele bijzonderheden..." rows={3} style={{resize:"vertical"}}/></div>
      <button className="btn-b" style={{width:"100%",padding:14,fontSize:15}} onClick={handleSubmit} disabled={saving}>{saving?"⏳ Opslaan...":`✓ ${type.charAt(0).toUpperCase()+type.slice(1)} doorgeven`}</button>
    </div>
  );
}

function MijnMeldingen({meldingen,houses}) {
  if(meldingen.length===0) return <div className="card" style={{textAlign:"center",padding:"60px 20px"}}><div style={{fontSize:40,marginBottom:12}}>📭</div><div style={{color:C.muted}}>Je hebt nog geen meldingen ingediend</div></div>;
  return <div><SH titel="Mijn meldingen"/>{meldingen.map(m=><MeldingItem key={m.id} m={m} houses={houses}/>)}</div>;
}

function MeldingItem({m,houses}) {
  const ti={aankomst:"🚗",vertrek:"🧳",reservering:"📅",overig:"💬"};
  const tc={aankomst:C.groen,vertrek:"#ef4444",reservering:C.blauw,overig:C.muted};
  const huis=houses.find(h=>h.id===m.woning_id);
  return(
    <div className="mc" style={{borderLeft:`3px solid ${m.sleutel_terug==="nee"||m.kamer_schoon==="nee"?"#ef4444":tc[m.type]||C.muted}`}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
        <div style={{fontSize:24}}>{ti[m.type]||"💬"}</div>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:4}}>
            <span style={{fontWeight:700,fontSize:15,color:C.text}}>{m.medewerker}</span>
            <span className="badge" style={{background:(tc[m.type]||C.muted)+"18",color:tc[m.type]||C.muted}}>{(m.type||"").toUpperCase()}</span>
            <span className="badge" style={{background:m.status==="open"?C.blauw+"18":"#f0fdf4",color:m.status==="open"?C.blauw:C.groen,marginLeft:"auto"}}>{(m.status||"").toUpperCase()}</span>
          </div>
          <div style={{fontSize:13,color:C.muted}}>📍 {huis?.adres}, {huis?.stad} · Kamer {m.kamer} · {m.created_at?fmtFull(m.created_at):""}</div>
          {m.wie_regelt&&<div style={{fontSize:12,color:C.muted,marginTop:4}}>👤 Wie regelt: {m.wie_regelt}</div>}
          {m.type==="vertrek"&&<div style={{display:"flex",gap:8,marginTop:6}}><span className="badge" style={{background:m.sleutel_terug==="ja"?C.groen+"18":"#fef2f2",color:m.sleutel_terug==="ja"?C.groen:"#ef4444"}}>🔑 {m.sleutel_terug}</span><span className="badge" style={{background:m.kamer_schoon==="ja"?C.groen+"18":"#fef2f2",color:m.kamer_schoon==="ja"?C.groen:"#ef4444"}}>🧹 {m.kamer_schoon}</span></div>}
          {m.opmerkingen&&<div style={{fontSize:13,color:C.muted,marginTop:6,fontStyle:"italic"}}>"{m.opmerkingen}"</div>}
        </div>
      </div>
    </div>
  );
}

function HuismeesterTaken({meldingen,houses,onUpdate,naam}) {
  const [notitieMap,setNotitieMap]=useState({});
  const open=meldingen.filter(m=>m.status==="open");
  const afgehandeld=meldingen.filter(m=>m.status!=="open"&&m.afgehandeld_door===naam);

  function taken(m){
    const t=[];
    if(m.type==="aankomst") t.push({icon:"🛏",tekst:`Kamer ${m.kamer} gereedmaken voor ${m.medewerker}`});
    if(m.type==="vertrek"&&m.kamer_schoon==="nee") t.push({icon:"🧹",tekst:`Kamer ${m.kamer} schoonmaken`,urgent:true});
    if(m.type==="vertrek") t.push({icon:"🔍",tekst:`Kamer ${m.kamer} controleren na vertrek ${m.medewerker}`});
    if(m.type==="reservering") t.push({icon:"📅",tekst:`Kamer ${m.kamer} klaarzetten voor ${m.medewerker} (aankomst ${m.datum})`});
    if(m.wie_regelt) t.push({icon:"👤",tekst:`Wie regelt: ${m.wie_regelt}`});
    if(m.opmerkingen) t.push({icon:"📝",tekst:m.opmerkingen});
    return t;
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
        <div><h2 style={{fontSize:20,fontWeight:800,color:C.blauw}}>Openstaande meldingen</h2><p style={{fontSize:13,color:C.muted,marginTop:2}}>Meldingen die jouw actie vereisen</p></div>
        <div style={{display:"flex",gap:12}}>
          <div style={{textAlign:"center",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 20px"}}><div style={{fontSize:22,fontWeight:700,color:"#ef4444"}}>{open.length}</div><div style={{fontSize:11,color:C.muted}}>Open</div></div>
          <div style={{textAlign:"center",background:"#f0fdf4",border:`1px solid ${C.groen}40`,borderRadius:10,padding:"10px 20px"}}><div style={{fontSize:22,fontWeight:700,color:C.groen}}>{afgehandeld.length}</div><div style={{fontSize:11,color:C.muted}}>Afgehandeld</div></div>
        </div>
      </div>
      {open.length===0?<div className="card" style={{textAlign:"center",padding:"60px 20px"}}><div style={{fontSize:48,marginBottom:12}}>✅</div><div style={{fontWeight:700,color:C.groen}}>Alles afgehandeld!</div></div>
      :open.map(m=>{
        const huis=houses.find(h=>h.id===m.woning_id);
        const tl=taken(m);
        return(
          <div key={m.id} className="mc" style={{marginBottom:14,borderLeft:`4px solid ${C.groen}`}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <span style={{fontSize:22}}>{m.type==="aankomst"?"🚗":m.type==="vertrek"?"🧳":"📅"}</span>
              <div>
                <div style={{fontWeight:700,fontSize:15,color:C.text}}>{m.medewerker} — <span style={{color:C.blauw,textTransform:"uppercase",fontSize:12}}>{m.type}</span></div>
                <div style={{fontSize:12,color:C.muted}}>📍 {huis?.adres}, {huis?.stad} · K{m.kamer} · Door: {m.ingediend_door} · {m.created_at?fmtFull(m.created_at):""}</div>
              </div>
            </div>
            <div style={{background:C.bg,borderRadius:8,padding:14,marginBottom:12,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:10,letterSpacing:".8px"}}>TE DOEN:</div>
              {tl.map((t,i)=>(
                <div key={i} style={{display:"flex",gap:10,padding:"6px 0",borderBottom:i<tl.length-1?`1px solid ${C.border}`:"none",alignItems:"center"}}>
                  <span style={{fontSize:16}}>{t.icon}</span><span style={{fontSize:14,flex:1,color:C.text}}>{t.tekst}</span>
                  {t.urgent&&<span style={{fontSize:10,fontWeight:700,color:"#ef4444",background:"#fef2f2",padding:"2px 8px",borderRadius:4}}>URGENT</span>}
                </div>
              ))}
            </div>
            <input className="fi" value={notitieMap[m.id]||""} onChange={e=>setNotitieMap(p=>({...p,[m.id]:e.target.value}))} placeholder="Optionele notitie..." style={{fontSize:13,marginBottom:10}}/>
            <div style={{display:"flex",gap:10}}>
              <button className="btn-g" style={{flex:1,padding:"10px"}} onClick={()=>onUpdate(m.id,"afgehandeld",notitieMap[m.id]||"")}>✓ Afgehandeld</button>
              <button className="btn-out" onClick={()=>onUpdate(m.id,"in_behandeling",notitieMap[m.id]||"")}>In behandeling</button>
            </div>
          </div>
        );
      })}
      {afgehandeld.length>0&&<div style={{marginTop:32}}><h3 style={{fontSize:13,fontWeight:700,color:C.muted,marginBottom:12,textTransform:"uppercase",letterSpacing:".5px"}}>Eerder afgehandeld</h3>{afgehandeld.slice(0,5).map(m=><MeldingItem key={m.id} m={m} houses={houses}/>)}</div>}
    </div>
  );
}

function BackofficeInbox({meldingen,houses,onUpdate,naam,showToast}) {
  const [notitieMap,setNotitieMap]=useState({});
  const [filter,setFilter]=useState("open");
  const actie=meldingen.filter(m=>m.sleutel_terug==="nee"||m.kamer_schoon==="nee");
  const filtered=meldingen.filter(m=>filter==="open"?m.status==="open":filter==="actie"?(m.sleutel_terug==="nee"||m.kamer_schoon==="nee"):true);

  return(
    <div>
      <div style={{display:"flex",alignItems:"flex-start",gap:16,marginBottom:20}}>
        <div><h2 style={{fontSize:20,fontWeight:800,color:C.blauw}}>Backoffice Inbox</h2><p style={{fontSize:13,color:C.muted,marginTop:2}}>Meldingen met administratieve of salaris consequenties</p></div>
        {actie.length>0&&<div style={{marginLeft:"auto",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 18px",textAlign:"center"}}><div style={{fontSize:20,fontWeight:700,color:"#ef4444"}}>{actie.length}</div><div style={{fontSize:10,color:C.muted}}>Salarisactie</div></div>}
      </div>
      {actie.length>0&&(
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:12,padding:"14px 18px",marginBottom:20}}>
          <div style={{fontWeight:700,color:"#b91c1c",marginBottom:8,fontSize:14}}>⚠️ Salarisverwerking vereist</div>
          {actie.map(m=>{const h=houses.find(h=>h.id===m.woning_id);return <div key={m.id} style={{fontSize:13,color:"#b91c1c",marginBottom:4,display:"flex",gap:10,flexWrap:"wrap"}}><span>• {m.medewerker} ({h?.adres}, K{m.kamer}):</span>{m.sleutel_terug==="nee"&&<span style={{background:"#fecaca",padding:"2px 8px",borderRadius:4,fontSize:11}}>🔑 €100 inhouden</span>}{m.kamer_schoon==="nee"&&<span style={{background:"#fef3c7",padding:"2px 8px",borderRadius:4,fontSize:11,color:"#b45309"}}>🧹 schoonmaakkosten</span>}</div>;})}
        </div>
      )}
      <div style={{display:"flex",gap:6,marginBottom:20}}>{[["open","Open"],["actie","Actie vereist"],["alle","Alle"]].map(([v,l])=><button key={v} onClick={()=>setFilter(v)} style={{background:filter===v?C.blauw:"white",color:filter===v?"white":C.muted,border:`1.5px solid ${filter===v?C.blauw:C.border}`,borderRadius:20,padding:"6px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>)}</div>
      {filtered.map(m=>{
        const huis=houses.find(h=>h.id===m.woning_id);
        const na=m.sleutel_terug==="nee"||m.kamer_schoon==="nee";
        return(
          <div key={m.id} className="mc" style={{marginBottom:12,borderLeft:`4px solid ${na?"#ef4444":C.blauw}`}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:10}}>
              <span style={{fontSize:22}}>{m.type==="aankomst"?"🚗":m.type==="vertrek"?"🧳":"📅"}</span>
              <div style={{flex:1}}>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <span style={{fontWeight:700,color:C.text}}>{m.medewerker}</span>
                  <span className="badge" style={{background:C.bg,color:C.muted,fontSize:10}}>{(m.type||"").toUpperCase()}</span>
                  {na&&<span className="badge" style={{background:"#fef2f2",color:"#ef4444",fontSize:10}}>⚠️ ACTIE SALARIS</span>}
                  <span className="badge" style={{background:m.status==="open"?C.blauw+"18":"#f0fdf4",color:m.status==="open"?C.blauw:C.groen,marginLeft:"auto",fontSize:10}}>{(m.status||"").toUpperCase()}</span>
                </div>
                <div style={{fontSize:12,color:C.muted,marginTop:4}}>📍 {huis?.adres}, {huis?.stad} · K{m.kamer} · {m.datum} · Door: {m.ingediend_door}</div>
                {m.wie_regelt&&<div style={{fontSize:12,color:C.muted,marginTop:2}}>👤 Wie regelt: {m.wie_regelt}</div>}
              </div>
            </div>
            <div style={{background:C.bg,borderRadius:8,padding:12,marginBottom:10,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:8,letterSpacing:".8px"}}>ADMINISTRATIEVE ACTIES:</div>
              {m.type==="aankomst"&&<div style={{fontSize:13,color:C.text}}>✅ Kamer {m.kamer} → <strong style={{color:C.groen}}>Lopend</strong> — huuraftrek actief per {m.datum}</div>}
              {m.type==="reservering"&&<div style={{fontSize:13,color:C.text}}>📅 Kamer {m.kamer} gereserveerd voor {m.medewerker} — aankomst {m.datum}</div>}
              {m.type==="vertrek"&&(<><div style={{fontSize:13,color:C.text,marginBottom:6}}>{m.sleutel_terug==="nee"?"🔑❌ ":"🔑✅ "}{m.sleutel_terug==="nee"?<strong style={{color:"#ef4444"}}>NIET terug → €100 inhouden van borg</strong>:<span style={{color:C.groen}}>Sleutel teruggegeven</span>}</div><div style={{fontSize:13,color:C.text}}>{m.kamer_schoon==="nee"?"🧹❌ ":"🧹✅ "}{m.kamer_schoon==="nee"?<strong style={{color:"#f59e0b"}}>NIET schoon → schoonmaakkosten verwerken</strong>:<span style={{color:C.groen}}>Kamer schoon achtergelaten</span>}</div></>)}
            </div>
            {m.status==="open"&&(<><input className="fi" value={notitieMap[m.id]||""} onChange={e=>setNotitieMap(p=>({...p,[m.id]:e.target.value}))} placeholder="Notitie bij verwerking..." style={{fontSize:13,marginBottom:10}}/><button className="btn-b" style={{width:"100%"}} onClick={()=>onUpdate(m.id,"verwerkt",notitieMap[m.id]||"")}>✓ Verwerkt in administratie</button></>)}
            {m.status!=="open"&&m.afgehandeld_door&&<div style={{fontSize:12,color:C.muted,marginTop:8}}>Verwerkt door {m.afgehandeld_door}{m.notitie?` — "${m.notitie}"`:""}</div>}
          </div>
        );
      })}
    </div>
  );
}

function WoningenDetail({houses}) {
  const [filterStad,setFilterStad]=useState("Alle");
  const [filterStatus,setFilterStatus]=useState("Alle");
  const [zoek,setZoek]=useState("");
  const steden=["Alle",...Array.from(new Set(houses.map(h=>h.stad))).sort()];
  const total=houses.reduce((s,h)=>s+h.kamers.length,0);
  const bezet=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.naam&&k.status==="Lopend").length,0);
  const beschikbaar=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Beschikbaar").length,0);
  const gereserveerd=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Gereserveerd").length,0);
  const controle=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Controle").length,0);
  const filtered=houses.filter(h=>{
    if(filterStad!=="Alle"&&h.stad!==filterStad) return false;
    if(filterStatus!=="Alle"&&!h.kamers.some(k=>k.status===filterStatus)) return false;
    if(zoek.trim()){const q=zoek.toLowerCase();return h.adres.toLowerCase().includes(q)||h.stad.toLowerCase().includes(q)||h.kamers.some(k=>k.naam.toLowerCase().includes(q)||(k.bedrijf||"").toLowerCase().includes(q));}
    return true;
  });

  return(
    <div>
      <SH titel="Woningoverzicht" sub={`Alle ${houses.length} woningen met bewoners en kamerstatus`}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:24}}>
        <SK label="Bezet" val={bezet} color={C.groen}/>
        <SK label="Beschikbaar" val={beschikbaar} color={C.blauw}/>
        <SK label="Gereserveerd" val={gereserveerd} color="#f59e0b"/>
        <SK label="Controle" val={controle} color="#ef4444"/>
        <SK label="Totaal kamers" val={total} color={C.muted}/>
      </div>
      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
        <input value={zoek} onChange={e=>setZoek(e.target.value)} placeholder="🔍 Zoek op naam, adres, bedrijf..."
          style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 14px",fontSize:13,outline:"none",width:240}}/>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{steden.map(s=><button key={s} onClick={()=>setFilterStad(s)} style={{background:filterStad===s?C.blauw:"white",color:filterStad===s?"white":C.muted,border:`1.5px solid ${filterStad===s?C.blauw:C.border}`,borderRadius:20,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{s}</button>)}</div>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:12,outline:"none"}}>
          {["Alle",...STATUSSEN].map(s=><option key={s}>{s}</option>)}
        </select>
        <span style={{fontSize:12,color:C.muted}}>{filtered.length} woningen</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:16}}>
        {filtered.map(h=>{
          const bezette=h.kamers.filter(k=>k.naam&&k.status==="Lopend").length;
          const hasIssue=h.kamers.some(k=>k.status==="Controle"||k.status==="Moet aan het werk");
          const hasVrij=h.kamers.some(k=>k.status==="Beschikbaar");
          return(
            <div key={h.id} className="card" style={{borderTop:`3px solid ${hasIssue?"#ef4444":hasVrij?C.blauw:C.groen}`,padding:"18px 18px 14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div><div style={{fontWeight:800,fontSize:15,color:C.text}}>{h.adres}</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>{h.stad} · {h.postcode}</div></div>
                <div style={{textAlign:"right",flexShrink:0,marginLeft:10}}><div style={{fontSize:22,fontWeight:800,color:C.blauw,lineHeight:1}}>{bezette}<span style={{fontSize:13,color:C.muted}}>/{h.kamers.length}</span></div><div style={{fontSize:10,color:C.muted,marginTop:2}}>bezet</div></div>
              </div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:12}}>
                {h.kamers.map(k=>{const c=STATUS_MAP[k.status]||{dot:C.muted};return <div key={k.k} title={`K${k.k}: ${k.naam||"leeg"} — ${k.status}`} style={{width:12,height:12,borderRadius:3,background:c.dot+"50",border:`1.5px solid ${c.dot}`}}/>;  })}
              </div>
              <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10}}>
                {h.kamers.map(k=>{const c=STATUS_MAP[k.status]||{bg:C.bg,text:C.muted,dot:C.muted};return(
                  <div key={k.k} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 8px",borderRadius:7,marginBottom:2,background:k.status==="Controle"?"#fef2f2":k.status==="Beschikbaar"?C.blauw+"08":"transparent"}}>
                    <div style={{width:6,height:6,borderRadius:2,background:c.dot,flexShrink:0}}/>
                    <span style={{fontSize:11,fontWeight:700,color:C.muted,minWidth:28,fontFamily:"monospace"}}>K{k.k}</span>
                    <span style={{flex:1,fontSize:13,color:k.naam?C.text:"#aab4c4",fontStyle:k.naam?"normal":"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k.naam||"leeg"}</span>
                    {k.bedrijf&&<span style={{fontSize:11,color:C.muted,whiteSpace:"nowrap",flexShrink:0}}>{k.bedrijf}</span>}
                    <span style={{padding:"2px 8px",borderRadius:4,background:c.bg,color:c.text,fontSize:10,fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>{k.status}</span>
                  </div>
                );})}
              </div>
              <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`,display:"flex",gap:6,flexWrap:"wrap"}}>
                {hasVrij&&<span style={{fontSize:10,fontWeight:600,color:C.blauw,background:C.blauw+"18",padding:"3px 8px",borderRadius:4}}>{h.kamers.filter(k=>k.status==="Beschikbaar").length} vrij</span>}
                {h.kamers.filter(k=>k.status==="Gereserveerd").length>0&&<span style={{fontSize:10,fontWeight:600,color:"#b45309",background:"#fef3c7",padding:"3px 8px",borderRadius:4}}>{h.kamers.filter(k=>k.status==="Gereserveerd").length} gereserveerd</span>}
                {hasIssue&&<span style={{fontSize:10,fontWeight:600,color:"#ef4444",background:"#fef2f2",padding:"3px 8px",borderRadius:4}}>⚠ actie vereist</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlanningView({houses}) {
  const [filterStad,setFilterStad]=useState("Alle");
  const steden=["Alle",...Array.from(new Set(houses.map(h=>h.stad))).sort()];
  const filtered=filterStad==="Alle"?houses:houses.filter(h=>h.stad===filterStad);
  const total=houses.reduce((s,h)=>s+h.kamers.length,0);
  const bezet=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.naam&&k.status==="Lopend").length,0);
  const beschikbaar=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Beschikbaar").length,0);
  const controle=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Controle").length,0);
  return(
    <div>
      <SH titel="Statusoverzicht"/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        <SK label="Bezet" val={bezet} color={C.groen}/>
        <SK label="Beschikbaar" val={beschikbaar} color={C.blauw}/>
        <SK label="Te controleren" val={controle} color="#ef4444"/>
        <SK label="Totaal kamers" val={total} color={C.muted}/>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>{steden.map(s=><button key={s} onClick={()=>setFilterStad(s)} style={{background:filterStad===s?C.blauw:"white",color:filterStad===s?"white":C.muted,border:`1.5px solid ${filterStad===s?C.blauw:C.border}`,borderRadius:20,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{s}</button>)}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14}}>
        {filtered.map(h=>{
          const bezette=h.kamers.filter(k=>k.naam&&k.status==="Lopend").length;
          return(
            <div key={h.id} className="card" style={{borderTop:`3px solid ${C.blauw}`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
                <div><div style={{fontWeight:800,fontSize:15,color:C.text}}>{h.adres}</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>{h.stad} · {h.postcode}</div></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:22,fontWeight:800,color:C.blauw}}>{bezette}/{h.kamers.length}</div><div style={{fontSize:10,color:C.muted}}>bezet</div></div>
              </div>
              <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:12}}>{h.kamers.map(k=>{const c=STATUS_MAP[k.status]||{dot:C.muted};return <div key={k.k} title={`K${k.k}: ${k.naam||"leeg"}`} style={{width:10,height:10,borderRadius:3,background:c.dot+"60",border:`1.5px solid ${c.dot}`}}/>;})}</div>
              <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12}}>
                {h.kamers.map(k=>{const c=STATUS_MAP[k.status]||{bg:C.bg,text:C.muted};return(
                  <div key={k.k} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:6,marginBottom:2}}>
                    <span style={{fontSize:10,fontWeight:700,color:C.muted,minWidth:26,fontFamily:"monospace"}}>K{k.k}</span>
                    <span style={{flex:1,fontSize:13,color:k.naam?C.text:"#aab4c4",fontStyle:k.naam?"normal":"italic"}}>{k.naam||"leeg"}</span>
                    {k.bedrijf&&<span style={{fontSize:11,color:C.muted}}>{k.bedrijf}</span>}
                    <span style={{padding:"2px 8px",borderRadius:4,background:c.bg,color:c.text,fontSize:10,fontWeight:600,whiteSpace:"nowrap"}}>{k.status}</span>
                  </div>
                );})}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BeheerView({houses,onAdd,onUpdate,onDelete,showToast,gebruikers,onAddGebruiker,onUpdateGebruiker,onDeleteGebruiker,checklistItems}) {
  const [subTab,setSubTab]=useState("woningen");
  return(
    <div>
      <SH titel="⚙️ Beheer" sub="Alleen beschikbaar voor Liset"/>
      <div style={{display:"flex",gap:6,marginBottom:24,borderBottom:`2px solid ${C.border}`,paddingBottom:0}}>
        {[["woningen","🏠 Woningen & kamers"],["gebruikers","👥 Gebruikers & pincodes"],["checklists","✅ Checklists"]].map(([v,l])=>(
          <button key={v} onClick={()=>setSubTab(v)}
            style={{background:"none",border:"none",padding:"10px 20px",fontSize:14,fontWeight:700,color:subTab===v?C.blauw:C.muted,borderBottom:subTab===v?`3px solid ${C.blauw}`:"3px solid transparent",marginBottom:-2,cursor:"pointer",fontFamily:"inherit"}}>
            {l}
          </button>
        ))}
      </div>
      {subTab==="woningen"&&<WoningBeheer houses={houses} onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete} showToast={showToast}/>}
      {subTab==="gebruikers"&&<GebruikersBeheer gebruikers={gebruikers} onAdd={onAddGebruiker} onUpdate={onUpdateGebruiker} onDelete={onDeleteGebruiker} showToast={showToast}/>}
      {subTab==="checklists"&&<ChecklistItemsBeheer checklistItems={checklistItems} showToast={showToast}/>}
    </div>
  );
}

function WoningBeheer({houses,onAdd,onUpdate,onDelete,showToast}) {
  const [geselecteerd,setGeselecteerd]=useState(null);
  const [nieuweWoning,setNieuweWoning]=useState({stad:"",adres:"",postcode:""});
  const [toonNieuwe,setToonNieuwe]=useState(false);
  const [nieuweKamer,setNieuweKamer]=useState({k:"",naam:"",bedrijf:"",status:"Beschikbaar"});
  const [bewerkKamer,setBewerkKamer]=useState(null);
  const [saving,setSaving]=useState(false);
  const huis=houses.find(h=>h.id===geselecteerd);

  // Groepeer per stad
  const steden=[...new Set(houses.map(h=>h.stad))].sort();

  async function woningToevoegen() {
    if(!nieuweWoning.stad||!nieuweWoning.adres){showToast("Vul stad en adres in","err");return;}
    setSaving(true);const ok=await onAdd({...nieuweWoning,kamers:[]});setSaving(false);
    if(ok){setNieuweWoning({stad:"",adres:"",postcode:""});setToonNieuwe(false);}
  }
  async function kamerToevoegen() {
    if(!nieuweKamer.k){showToast("Vul kamernummer in","err");return;}
    if(!huis) return;
    if(huis.kamers.some(k=>k.k===nieuweKamer.k)){showToast("Kamernummer bestaat al","err");return;}
    setSaving(true);await onUpdate(huis.id,{kamers:[...huis.kamers,{...nieuweKamer}]});setSaving(false);
    setNieuweKamer({k:"",naam:"",bedrijf:"",status:"Beschikbaar"});
  }
  async function kamerOpslaan(nr,u) { if(!huis) return; setSaving(true); await onUpdate(huis.id,{kamers:huis.kamers.map(k=>k.k===nr?{...k,...u}:k)}); setSaving(false); setBewerkKamer(null); }
  async function kamerVerwijderen(nr) { if(!huis||!window.confirm(`Kamer ${nr} verwijderen?`)) return; setSaving(true); await onUpdate(huis.id,{kamers:huis.kamers.filter(k=>k.k!==nr)}); setSaving(false); }
  async function woningVerwijderen(id) { if(!window.confirm("Woning verwijderen?")) return; const ok=await onDelete(id); if(ok) setGeselecteerd(null); }

  return(
    <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:20}}>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <span style={{fontWeight:700,fontSize:14,color:C.blauw}}>Woningen ({houses.length})</span>
          <button className="btn-b" style={{padding:"7px 14px",fontSize:12}} onClick={()=>setToonNieuwe(true)}>+ Woning</button>
        </div>
        {toonNieuwe&&(
          <div className="card" style={{marginBottom:14,borderTop:`3px solid ${C.groen}`}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:12,color:C.blauw}}>Nieuwe woning</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <input className="fi" value={nieuweWoning.stad} onChange={e=>setNieuweWoning(p=>({...p,stad:e.target.value}))} placeholder="Stad" style={{fontSize:13}}/>
              <input className="fi" value={nieuweWoning.adres} onChange={e=>setNieuweWoning(p=>({...p,adres:e.target.value}))} placeholder="Adres" style={{fontSize:13}}/>
              <input className="fi" value={nieuweWoning.postcode} onChange={e=>setNieuweWoning(p=>({...p,postcode:e.target.value}))} placeholder="Postcode" style={{fontSize:13}}/>
              <div style={{display:"flex",gap:8}}>
                <button className="btn-b" style={{flex:1,padding:"8px",fontSize:13}} onClick={woningToevoegen} disabled={saving}>{saving?"⏳":"✓ Toevoegen"}</button>
                <button className="btn-out" style={{padding:"8px 12px",fontSize:13}} onClick={()=>setToonNieuwe(false)}>✗</button>
              </div>
            </div>
          </div>
        )}
        {/* Gegroepeerd per stad */}
        {steden.map(stad=>(
          <div key={stad} style={{marginBottom:12}}>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:"1px",textTransform:"uppercase",marginBottom:6,paddingLeft:4}}>{stad}</div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {houses.filter(h=>h.stad===stad).map(h=>(
                <button key={h.id} onClick={()=>setGeselecteerd(h.id)}
                  style={{background:geselecteerd===h.id?C.blauw+"12":"white",border:`1.5px solid ${geselecteerd===h.id?C.blauw:C.border}`,borderRadius:10,padding:"10px 14px",color:C.text,textAlign:"left",transition:"all .15s",cursor:"pointer"}}>
                  <div style={{fontWeight:700,fontSize:13}}>{h.adres}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>{h.kamers.length} kamers</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div>
        {!huis?<div className="card" style={{textAlign:"center",padding:"60px 20px"}}><div style={{fontSize:40,marginBottom:10}}>👈</div><div style={{color:C.muted}}>Selecteer een woning</div></div>:(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
              <div><h3 style={{fontSize:18,fontWeight:800,color:C.blauw}}>{huis.adres}</h3><div style={{fontSize:13,color:C.muted,marginTop:2}}>{huis.stad} · {huis.postcode} · {huis.kamers.length} kamers</div></div>
              <button className="btn-r" onClick={()=>woningVerwijderen(huis.id)}>🗑 Verwijderen</button>
            </div>
            <div className="card" style={{marginBottom:16}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:C.blauw}}>Kamers</div>
              {huis.kamers.length===0&&<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>Nog geen kamers</div>}
              {huis.kamers.map(k=>(
                <div key={k.k}>{bewerkKamer===k.k?
                  <KamerBewerken kamer={k} onSave={u=>kamerOpslaan(k.k,u)} onCancel={()=>setBewerkKamer(null)} saving={saving}/>:
                  <div className="br">
                    <div style={{width:6,height:6,borderRadius:2,background:STATUS_MAP[k.status]?.dot||C.muted,flexShrink:0}}/>
                    <span style={{fontSize:11,fontWeight:700,color:C.muted,minWidth:30,fontFamily:"monospace"}}>K{k.k}</span>
                    <span style={{flex:1,fontSize:13,color:k.naam?C.text:"#aab4c4",fontStyle:k.naam?"normal":"italic"}}>{k.naam||"leeg"}</span>
                    {k.bedrijf&&<span style={{fontSize:11,color:C.muted}}>{k.bedrijf}</span>}
                    <span style={{padding:"2px 8px",borderRadius:4,background:STATUS_MAP[k.status]?.bg||C.bg,color:STATUS_MAP[k.status]?.text||C.muted,fontSize:10,fontWeight:600}}>{k.status}</span>
                    <button className="btn-out" style={{padding:"4px 10px",fontSize:11}} onClick={()=>setBewerkKamer(k.k)}>✏️</button>
                    <button className="btn-r" style={{padding:"4px 10px",fontSize:11}} onClick={()=>kamerVerwijderen(k.k)}>🗑</button>
                  </div>
                }</div>
              ))}
            </div>
            <div className="card" style={{borderTop:`3px solid ${C.groen}`}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:C.groen}}>+ Nieuwe kamer toevoegen</div>
              <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr",gap:10,marginBottom:10}}>
                <div><label className="fl">Kamer nr</label><input className="fi" value={nieuweKamer.k} onChange={e=>setNieuweKamer(p=>({...p,k:e.target.value}))} placeholder="1" style={{fontSize:13}}/></div>
                <div><label className="fl">Naam bewoner</label><input className="fi" value={nieuweKamer.naam} onChange={e=>setNieuweKamer(p=>({...p,naam:e.target.value}))} placeholder="Optioneel" style={{fontSize:13}}/></div>
                <div><label className="fl">Bedrijf</label><input className="fi" value={nieuweKamer.bedrijf} onChange={e=>setNieuweKamer(p=>({...p,bedrijf:e.target.value}))} placeholder="Optioneel" style={{fontSize:13}}/></div>
              </div>
              <div style={{marginBottom:12}}><label className="fl">Status</label><select className="fs" value={nieuweKamer.status} onChange={e=>setNieuweKamer(p=>({...p,status:e.target.value}))} style={{fontSize:13}}>{STATUSSEN.map(s=><option key={s}>{s}</option>)}</select></div>
              <button className="btn-g" style={{width:"100%",padding:10,fontSize:13}} onClick={kamerToevoegen} disabled={saving}>{saving?"⏳ Opslaan...":"✓ Kamer toevoegen"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KamerBewerken({kamer,onSave,onCancel,saving}) {
  const [naam,setNaam]=useState(kamer.naam||"");
  const [bedrijf,setBedrijf]=useState(kamer.bedrijf||"");
  const [status,setStatus]=useState(kamer.status||"Beschikbaar");
  return(
    <div style={{background:C.blauw+"08",borderRadius:8,padding:12,marginBottom:6,border:`1.5px solid ${C.blauw}`}}>
      <div style={{fontSize:12,fontWeight:700,color:C.blauw,marginBottom:10}}>Kamer {kamer.k} bewerken</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <input className="fi" value={naam} onChange={e=>setNaam(e.target.value)} placeholder="Naam bewoner" style={{fontSize:12}}/>
        <input className="fi" value={bedrijf} onChange={e=>setBedrijf(e.target.value)} placeholder="Bedrijf" style={{fontSize:12}}/>
      </div>
      <select className="fs" value={status} onChange={e=>setStatus(e.target.value)} style={{fontSize:12,marginBottom:8}}>{STATUSSEN.map(s=><option key={s}>{s}</option>)}</select>
      <div style={{display:"flex",gap:8}}>
        <button className="btn-b" style={{flex:1,padding:"7px",fontSize:12}} onClick={()=>onSave({naam,bedrijf,status})} disabled={saving}>{saving?"⏳":"✓ Opslaan"}</button>
        <button className="btn-out" style={{padding:"7px 12px",fontSize:12}} onClick={onCancel}>Annuleren</button>
      </div>
    </div>
  );
}

function GebruikersBeheer({gebruikers,onAdd,onUpdate,onDelete,showToast}) {
  const [nieuw,setNieuw]=useState({naam:"",pin:"",rol:"collega"});
  const [bewerk,setBewerk]=useState(null);
  const [saving,setSaving]=useState(false);

  async function voegToe() {
    if(!nieuw.naam.trim()){showToast("Vul een naam in","err");return;}
    if(nieuw.pin.length<4){showToast("Pincode moet minimaal 4 cijfers zijn","err");return;}
    if(gebruikers.some(g=>g.naam.toLowerCase()===nieuw.naam.toLowerCase())){showToast("Naam bestaat al","err");return;}
    setSaving(true);
    await onAdd({naam:nieuw.naam.trim(),pin:nieuw.pin,rol:nieuw.rol,actief:true});
    setSaving(false);
    setNieuw({naam:"",pin:"",rol:"collega"});
  }

  async function verwijder(g) {
    if(g.naam==="Liset"){showToast("Liset kan niet verwijderd worden","err");return;}
    if(!window.confirm(`${g.naam} verwijderen?`)) return;
    await onDelete(g.id);
  }

  async function slaBewerk(g, updates) {
    setSaving(true);
    await onUpdate(g.id, updates);
    setSaving(false);
    setBewerk(null);
  }

  const rk={backoffice:C.blauw,huismeester:C.groen,collega:C.muted};
  const ri={backoffice:"📊",huismeester:"🏠",collega:"👤"};

  return(
    <div style={{maxWidth:700}}>
      <div className="card" style={{marginBottom:20,borderTop:`3px solid ${C.groen}`}}>
        <div style={{fontWeight:700,fontSize:14,color:C.groen,marginBottom:16}}>+ Nieuwe gebruiker toevoegen</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 120px 160px",gap:12,marginBottom:12}}>
          <div><label className="fl">Naam</label><input className="fi" value={nieuw.naam} onChange={e=>setNieuw(p=>({...p,naam:e.target.value}))} placeholder="Voornaam"/></div>
          <div><label className="fl">Pincode</label><input className="fi" value={nieuw.pin} onChange={e=>setNieuw(p=>({...p,pin:e.target.value.replace(/\D/g,"")}))} placeholder="1234" maxLength={8} type="password"/></div>
          <div><label className="fl">Rol</label><select className="fs" value={nieuw.rol} onChange={e=>setNieuw(p=>({...p,rol:e.target.value}))}><option value="collega">👤 Collega</option><option value="huismeester">🏠 Huismeester</option><option value="backoffice">📊 Backoffice</option></select></div>
        </div>
        <button className="btn-g" style={{padding:"10px 24px"}} onClick={voegToe} disabled={saving}>{saving?"⏳ Opslaan...":"✓ Toevoegen"}</button>
      </div>
      <div className="card">
        <div style={{fontWeight:700,fontSize:14,color:C.blauw,marginBottom:16}}>Alle gebruikers ({gebruikers.length})</div>
        {gebruikers.map(g=>(
          <div key={g.id}>
            {bewerk===g.id ? <GebruikerBewerken g={g} onSave={u=>slaBewerk(g,u)} onCancel={()=>setBewerk(null)} saving={saving}/>:(
              <div className="br" style={{marginBottom:8}}>
                <div style={{width:32,height:32,borderRadius:8,background:rk[g.rol]+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{ri[g.rol]}</div>
                <div style={{flex:1}}><div style={{fontWeight:700,fontSize:14,color:C.text}}>{g.naam}</div><div style={{fontSize:11,color:rk[g.rol],fontWeight:600,textTransform:"capitalize"}}>{g.rol}</div></div>
                <div style={{fontSize:13,color:C.muted,fontFamily:"monospace",background:C.bg,padding:"4px 10px",borderRadius:6}}>••••</div>
                <button className="btn-out" style={{padding:"5px 12px",fontSize:12}} onClick={()=>setBewerk(g.id)}>✏️ Bewerken</button>
                {g.naam!=="Liset"&&<button className="btn-r" style={{padding:"5px 12px",fontSize:12}} onClick={()=>verwijder(g)}>🗑</button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GebruikerBewerken({g,onSave,onCancel}) {
  const [naam,setNaam]=useState(g.naam);const [pin,setPin]=useState(g.pin);const [rol,setRol]=useState(g.rol);
  return(
    <div style={{background:C.blauw+"08",border:`1.5px solid ${C.blauw}`,borderRadius:10,padding:14,marginBottom:8}}>
      <div style={{fontSize:12,fontWeight:700,color:C.blauw,marginBottom:12}}>{g.naam} bewerken</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 120px 160px",gap:10,marginBottom:10}}>
        <div><label className="fl">Naam</label><input className="fi" value={naam} onChange={e=>setNaam(e.target.value)} style={{fontSize:13}}/></div>
        <div><label className="fl">Pincode</label><input className="fi" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,""))} type="text" maxLength={8} style={{fontSize:13}}/></div>
        <div><label className="fl">Rol</label><select className="fs" value={rol} onChange={e=>setRol(e.target.value)} style={{fontSize:13}}><option value="collega">👤 Collega</option><option value="huismeester">🏠 Huismeester</option><option value="backoffice">📊 Backoffice</option></select></div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn-b" style={{padding:"8px 20px",fontSize:13}} onClick={()=>onSave({naam,pin,rol})}>✓ Opslaan</button>
        <button className="btn-out" style={{padding:"8px 16px",fontSize:13}} onClick={onCancel}>Annuleren</button>
      </div>
    </div>
  );
}

// ─── CHECKLIST ITEMS BEHEER ───────────────────────────────────────────────────
function ChecklistItemsBeheer({ checklistItems, showToast }) {
  const [actief, setActief] = useState("wekelijks");
  const [nieuwTekst, setNieuwTekst] = useState("");
  const [bewerkId, setBewerkId] = useState(null);
  const [bewerkTekst, setBewerkTekst] = useState("");
  const [saving, setSaving] = useState(false);

  const types = [
    { id:"wekelijks",   label:"📋 Wekelijks",   kleur:C.blauw },
    { id:"4wekelijks",  label:"📅 4-wekelijks",  kleur:C.groen },
    { id:"kwartaal",    label:"🏆 Kwartaal",     kleur:"#7c3aed" },
  ];

  const huidigeLijst = checklistItems.filter(i => i.type === actief);
  const actiefInfo = types.find(t => t.id === actief);

  async function voegToe() {
    if (!nieuwTekst.trim()) { showToast("Vul een omschrijving in", "err"); return; }
    setSaving(true);
    const maxVolgorde = huidigeLijst.length > 0 ? Math.max(...huidigeLijst.map(i => i.volgorde)) : 0;
    const { error } = await supabase.from("checklist_items").insert([{
      type: actief, tekst: nieuwTekst.trim(), volgorde: maxVolgorde + 1, actief: true
    }]);
    setSaving(false);
    if (error) { showToast("Fout bij toevoegen", "err"); return; }
    setNieuwTekst("");
    showToast("✓ Item toegevoegd");
  }

  async function slaBewerk(id) {
    if (!bewerkTekst.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("checklist_items").update({ tekst: bewerkTekst.trim() }).eq("id", id);
    setSaving(false);
    if (error) { showToast("Fout bij opslaan", "err"); return; }
    setBewerkId(null);
    showToast("✓ Opgeslagen");
  }

  async function verwijder(id, tekst) {
    if (!window.confirm(`"${tekst.substring(0,50)}..." verwijderen?`)) return;
    const { error } = await supabase.from("checklist_items").update({ actief: false }).eq("id", id);
    if (error) { showToast("Fout bij verwijderen", "err"); return; }
    showToast("✓ Item verwijderd");
  }

  async function verschuif(item, richting) {
    const lijst = [...huidigeLijst].sort((a,b) => a.volgorde - b.volgorde);
    const idx = lijst.findIndex(i => i.id === item.id);
    const swap = richting === "up" ? lijst[idx-1] : lijst[idx+1];
    if (!swap) return;
    await supabase.from("checklist_items").update({ volgorde: swap.volgorde }).eq("id", item.id);
    await supabase.from("checklist_items").update({ volgorde: item.volgorde }).eq("id", swap.id);
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display:"flex", gap:8, marginBottom:20 }}>
        {types.map(t => (
          <button key={t.id} onClick={() => setActief(t.id)}
            style={{ flex:1, background:actief===t.id?t.kleur:"white", color:actief===t.id?"white":C.text, border:`2px solid ${actief===t.id?t.kleur:C.border}`, borderRadius:10, padding:"10px 16px", cursor:"pointer", fontFamily:"inherit", fontWeight:700, fontSize:13, transition:"all .2s" }}>
            {t.label}
            <div style={{ fontSize:11, opacity:.8, marginTop:2, fontWeight:400 }}>{checklistItems.filter(i=>i.type===t.id).length} items</div>
          </button>
        ))}
      </div>

      {/* Nieuw item toevoegen */}
      <div className="card" style={{ marginBottom:16, borderTop:`3px solid ${actiefInfo.kleur}` }}>
        <div style={{ fontWeight:700, fontSize:13, color:actiefInfo.kleur, marginBottom:12 }}>+ Item toevoegen aan {actiefInfo.label}</div>
        <div style={{ display:"flex", gap:10 }}>
          <input className="fi" value={nieuwTekst} onChange={e=>setNieuwTekst(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&voegToe()}
            placeholder="Omschrijving van de controletaak..."
            style={{ flex:1 }} />
          <button className="btn-b" style={{ padding:"10px 20px", flexShrink:0 }} onClick={voegToe} disabled={saving}>
            {saving?"⏳":"+ Toevoegen"}
          </button>
        </div>
      </div>

      {/* Huidige items */}
      <div className="card">
        <div style={{ fontWeight:700, fontSize:13, color:C.blauw, marginBottom:16 }}>
          {actiefInfo.label} — {huidigeLijst.length} items
        </div>
        {huidigeLijst.length === 0 && (
          <div style={{ textAlign:"center", padding:"30px", color:C.muted, fontSize:13 }}>
            Nog geen items. Voeg er hierboven een toe!
          </div>
        )}
        {[...huidigeLijst].sort((a,b)=>a.volgorde-b.volgorde).map((item, idx, arr) => (
          <div key={item.id} style={{ marginBottom:6 }}>
            {bewerkId === item.id ? (
              <div style={{ display:"flex", gap:8, padding:"8px", background:C.blauw+"08", borderRadius:8, border:`1.5px solid ${C.blauw}` }}>
                <input className="fi" value={bewerkTekst} onChange={e=>setBewerkTekst(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&slaBewerk(item.id)}
                  style={{ flex:1, fontSize:13 }} autoFocus />
                <button className="btn-b" style={{ padding:"8px 14px", fontSize:12, flexShrink:0 }} onClick={()=>slaBewerk(item.id)} disabled={saving}>✓</button>
                <button className="btn-out" style={{ padding:"8px 12px", fontSize:12, flexShrink:0 }} onClick={()=>setBewerkId(null)}>✗</button>
              </div>
            ) : (
              <div className="br" style={{ gap:6 }}>
                <span style={{ fontSize:11, fontWeight:700, color:C.muted, minWidth:24, fontFamily:"monospace" }}>{idx+1}</span>
                <span style={{ flex:1, fontSize:13, color:C.text }}>{item.tekst}</span>
                <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                  <button onClick={()=>verschuif(item,"up")} disabled={idx===0}
                    style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:6, padding:"4px 8px", cursor:idx===0?"not-allowed":"pointer", color:idx===0?C.border:C.muted, fontSize:12 }}>↑</button>
                  <button onClick={()=>verschuif(item,"down")} disabled={idx===arr.length-1}
                    style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:6, padding:"4px 8px", cursor:idx===arr.length-1?"not-allowed":"pointer", color:idx===arr.length-1?C.border:C.muted, fontSize:12 }}>↓</button>
                  <button className="btn-out" style={{ padding:"4px 10px", fontSize:11 }}
                    onClick={()=>{ setBewerkId(item.id); setBewerkTekst(item.tekst); }}>✏️</button>
                  <button className="btn-r" style={{ padding:"4px 10px", fontSize:11 }}
                    onClick={()=>verwijder(item.id, item.tekst)}>🗑</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LOG VIEW ─────────────────────────────────────────────────────────────────
  function exportCSV() {
    let csv="Datum,Tijd,Type,Medewerker,Adres,Kamer,Wie regelt,Ingediend door,Status,Sleutel terug,Kamer schoon,Notitie\n";
    meldingen.forEach(m=>{const h=houses.find(h=>h.id===m.woning_id);const dt=m.created_at?new Date(m.created_at):new Date();csv+=`"${fmtDate(dt)}","${fmtTime(dt)}","${m.type}","${m.medewerker}","${h?.adres||""}","${m.kamer}","${m.wie_regelt||""}","${m.ingediend_door}","${m.status}","${m.sleutel_terug||""}","${m.kamer_schoon||""}","${m.notitie||""}"\n`;});
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`KTP_meldingen_${todayISO()}.csv`;a.click();URL.revokeObjectURL(url);
  }
  return(
    <div>
      <SH titel="Volledig log" sub={`${meldingen.length} meldingen totaal`} actie={<button className="btn-out" onClick={exportCSV}>⬇ Exporteer CSV</button>}/>
      {meldingen.length===0?<div className="card" style={{textAlign:"center",padding:"50px"}}><div style={{fontSize:40,marginBottom:10}}>📝</div><div style={{color:C.muted}}>Nog geen meldingen</div></div>:(
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"80px 60px 100px 1fr 1fr 50px 80px 80px",padding:"10px 16px",fontSize:10,fontWeight:700,color:C.muted,letterSpacing:".6px",textTransform:"uppercase",borderBottom:`1px solid ${C.border}`,background:C.bg}}>
            <span>Datum</span><span>Tijd</span><span>Type</span><span>Medewerker</span><span>Adres</span><span>Kamer</span><span>Door</span><span>Status</span>
          </div>
          {meldingen.map((m,i)=>{const h=houses.find(h=>h.id===m.woning_id);const tc={aankomst:C.groen,vertrek:"#ef4444",reservering:C.blauw,overig:C.muted};const dt=m.created_at?new Date(m.created_at):new Date();return(
            <div key={m.id} style={{display:"grid",gridTemplateColumns:"80px 60px 100px 1fr 1fr 50px 80px 80px",padding:"10px 16px",fontSize:12,borderBottom:i<meldingen.length-1?`1px solid ${C.border}`:"none",alignItems:"center",background:i%2===0?"white":C.bg+"60"}}>
              <span style={{color:C.muted}}>{fmtDate(dt)}</span><span style={{color:C.muted}}>{fmtTime(dt)}</span>
              <span style={{color:tc[m.type]||C.muted,fontWeight:700,fontSize:10,textTransform:"uppercase"}}>{m.type}</span>
              <span style={{fontWeight:600,color:C.text}}>{m.medewerker}</span><span style={{color:C.muted}}>{h?.adres}</span>
              <span style={{fontFamily:"monospace",color:C.muted}}>K{m.kamer}</span><span style={{color:C.muted}}>{m.ingediend_door}</span>
              <span style={{fontSize:10,fontWeight:700,color:m.status==="open"?C.blauw:C.groen}}>{(m.status||"").toUpperCase()}</span>
            </div>
          );})}
        </div>
      )}
    </div>
  );
}
