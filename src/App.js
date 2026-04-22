import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

// ─── KLEUREN HUISSTIJL ────────────────────────────────────────────────────────
const C = {
  blauw:     "#1B3A6B",
  blauwDark: "#132b52",
  blauwLight:"#2a52a0",
  groen:     "#4A9B3C",
  groenDark: "#357a2b",
  groenLight:"#5cb84d",
  bg:        "#f0f4f8",
  card:      "#ffffff",
  border:    "#d1dbe8",
  text:      "#1a2b47",
  muted:     "#6b7a8d",
  dark:      "#0d1f3c",
};

// ─── STANDAARD GEBRUIKERS ─────────────────────────────────────────────────────
const STANDAARD_GEBRUIKERS = [
  { naam: "Liset",     pin: "4768", rol: "backoffice" },
  { naam: "Warscha",   pin: "3994", rol: "backoffice" },
  { naam: "Hans",      pin: "4864", rol: "huismeester" },
  { naam: "Laurens",   pin: "7135", rol: "huismeester" },
  { naam: "Roy",       pin: "7936", rol: "huismeester" },
  { naam: "Harald",    pin: "5900", rol: "collega" },
  { naam: "Johan",     pin: "1326", rol: "collega" },
  { naam: "Karolina",  pin: "5003", rol: "collega" },
  { naam: "Magdalena", pin: "7719", rol: "collega" },
  { naam: "Natalia",   pin: "1959", rol: "collega" },
  { naam: "Cristian",  pin: "2093", rol: "collega" },
  { naam: "Liane",     pin: "7185", rol: "collega" },
  { naam: "Lynn",      pin: "3470", rol: "collega" },
  { naam: "Mihaela",   pin: "7044", rol: "collega" },
];

const GEBRUIKERS_KEY = "ktp_gebruikers_v1";

function laadGebruikers() {
  try {
    const opgeslagen = localStorage.getItem(GEBRUIKERS_KEY);
    if (opgeslagen) return JSON.parse(opgeslagen);
  } catch {}
  return STANDAARD_GEBRUIKERS;
}

function slaGebruikersOp(g) {
  try { localStorage.setItem(GEBRUIKERS_KEY, JSON.stringify(g)); } catch {}
}

// ─── STATUS KLEUREN ───────────────────────────────────────────────────────────
const STATUS_MAP = {
  "Lopend":            { bg: "#4A9B3C18", text: "#357a2b", dot: "#4A9B3C" },
  "Beschikbaar":       { bg: "#1B3A6B18", text: "#1B3A6B", dot: "#2a52a0" },
  "Gereserveerd":      { bg: "#f59e0b18", text: "#b45309", dot: "#f59e0b" },
  "Controle":          { bg: "#ef444418", text: "#b91c1c", dot: "#ef4444" },
  "Niet beschikbaar":  { bg: "#8b5cf618", text: "#6d28d9", dot: "#8b5cf6" },
  "Moet aan het werk": { bg: "#f9731618", text: "#c2410c", dot: "#f97316" },
  "Vertrokken":        { bg: "#71717a18", text: "#3f3f46", dot: "#71717a" },
};
const STATUSSEN = Object.keys(STATUS_MAP);

function fmtDate(d) { const dt = typeof d === "string" ? new Date(d) : d; return dt.toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit" }); }
function fmtTime(d) { const dt = typeof d === "string" ? new Date(d) : d; return dt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }); }
function fmtFull(d) { return `${fmtDate(d)} ${fmtTime(d)}`; }
function todayISO() { return new Date().toISOString().slice(0, 10); }

// ─── LOGO SVG ────────────────────────────────────────────────────────────────
function KTPLogo({ size = 32 }) {
  return (
    <svg width={size * 3.5} height={size} viewBox="0 0 140 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="28" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="26" fill={C.blauw} letterSpacing="-1">KTP</text>
      <text x="62" y="28" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="26" fill={C.groen} letterSpacing="-1">IF</text>
    </svg>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const [gebruiker, setGebruiker] = useState(null);
  const [gebruikers, setGebruikers] = useState(laadGebruikers);
  const [houses, setHouses] = useState([]);
  const [meldingen, setMeldingen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("melding");
  const [toast, setToast] = useState(null);

  const loadHouses = useCallback(async () => {
    const { data, error } = await supabase.from("woningen").select("*").order("id");
    if (error) { console.error(error); return; }
    setHouses(data.map(h => ({ ...h, kamers: h.kamers || [] })));
  }, []);

  const loadMeldingen = useCallback(async () => {
    const { data, error } = await supabase.from("meldingen").select("*").order("created_at", { ascending: false });
    if (error) { console.error(error); return; }
    setMeldingen(data);
  }, []);

  useEffect(() => {
    async function init() { setLoading(true); await Promise.all([loadHouses(), loadMeldingen()]); setLoading(false); }
    init();
  }, [loadHouses, loadMeldingen]);

  useEffect(() => {
    const s1 = supabase.channel("mel-rt").on("postgres_changes", { event: "*", schema: "public", table: "meldingen" }, () => loadMeldingen()).subscribe();
    const s2 = supabase.channel("won-rt").on("postgres_changes", { event: "*", schema: "public", table: "woningen" }, () => loadHouses()).subscribe();
    return () => { supabase.removeChannel(s1); supabase.removeChannel(s2); };
  }, [loadHouses, loadMeldingen]);

  function showToast(msg, type = "ok") { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); }

  function login(g) { setGebruiker(g); setTab(g.rol === "collega" ? "melding" : g.rol === "huismeester" ? "taken" : "woningen"); }
  function logout() { setGebruiker(null); }

  function updateGebruikers(nieuwelijst) { setGebruikers(nieuweklist => { slaGebruikersOp(nieuwelijst); return nieuweklist; }); setGebruikers(nieuwesList => { slaGebruikersOp(nieuwesList); return nieuwesList; }); setGebruikers(nieuwesList => { slaGebruikersOp(nieuwesList); return nieuwesList; });
    setGebruikers(nieuwesList => { const g = nieuwesList; slaGebruikersOp(nieuwesList); return g; });
    setGebruikers(() => { slaGebruikersOp(nieuwesList); return nieuwesList; });
  }

  function setEnSlaOp(lijst) { slaGebruikersOp(lijst); setGebruikers(lijst); }

  async function addMelding(m) {
    const { error } = await supabase.from("meldingen").insert([{
      type: m.type, medewerker: m.medewerker, datum: m.datum,
      woning_id: m.huisId, kamer: m.kamer, wie_regelt: m.wieRegelt || null,
      sleutel_terug: m.sleutelTerug || null, kamer_schoon: m.kamerSchoon || null,
      sleutel_aantal: m.sleutelAantal || null, opmerkingen: m.opmerkingen || null,
      ingediend_door: gebruiker.naam, status: "open",
    }]);
    if (error) { showToast("Fout bij opslaan", "err"); return; }
    const huis = houses.find(h => h.id === m.huisId);
    if (huis) {
      const nk = huis.kamers.map(k => {
        if (k.k !== m.kamer) return k;
        if (m.type === "aankomst")    return { ...k, naam: m.medewerker, status: "Lopend" };
        if (m.type === "reservering") return { ...k, naam: m.medewerker, status: "Gereserveerd" };
        if (m.type === "vertrek") { const p = m.sleutelTerug === "nee" || m.kamerSchoon === "nee"; return { ...k, naam: p ? k.naam : "", status: p ? "Controle" : "Beschikbaar" }; }
        return k;
      });
      await supabase.from("woningen").update({ kamers: nk }).eq("id", m.huisId);
    }
    showToast("✓ Melding verzonden");
  }

  async function updateMeldingStatus(id, newStatus, notitie = "") {
    const { error } = await supabase.from("meldingen").update({ status: newStatus, afgehandeld_door: gebruiker.naam, afgehandeld_op: new Date().toISOString(), notitie: notitie || null }).eq("id", id);
    if (error) showToast("Fout bij updaten", "err");
    else showToast("✓ Status bijgewerkt");
  }

  async function addWoning(w) {
    const { error } = await supabase.from("woningen").insert([w]);
    if (error) { showToast("Fout bij toevoegen woning", "err"); return false; }
    showToast("✓ Woning toegevoegd"); return true;
  }

  async function updateWoning(id, updates) {
    const { error } = await supabase.from("woningen").update(updates).eq("id", id);
    if (error) { showToast("Fout bij opslaan", "err"); return false; }
    showToast("✓ Opgeslagen"); return true;
  }

  async function deleteWoning(id) {
    const { error } = await supabase.from("woningen").delete().eq("id", id);
    if (error) { showToast("Fout bij verwijderen", "err"); return false; }
    showToast("✓ Woning verwijderd"); return true;
  }

  const openMeldingen = meldingen.filter(m => m.status === "open");
  const mijnMeldingen = meldingen.filter(m => m.ingediend_door === gebruiker?.naam);
  const rol = gebruiker?.rol;
  const naam = gebruiker?.naam;
  const isLiset = naam === "Liset";

  if (loading) return <LoadingScreen />;
  if (!gebruiker) return <LoginScreen gebruikers={gebruikers} onLogin={login} />;

  const rolIcon = rol === "backoffice" ? "📊" : rol === "huismeester" ? "🏠" : "👤";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter','Segoe UI',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: ${C.bg}; } ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        button { cursor: pointer; font-family: inherit; } input, textarea, select { font-family: inherit; }
        .fl { font-size: 11px; font-weight: 600; color: ${C.muted}; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 6px; display: block; }
        .fi { width: 100%; background: white; border: 1.5px solid ${C.border}; border-radius: 8px; color: ${C.text}; padding: 10px 14px; font-size: 14px; outline: none; transition: border 0.2s; }
        .fi:focus { border-color: ${C.blauw}; box-shadow: 0 0 0 3px ${C.blauw}18; }
        .fs { width: 100%; background: white; border: 1.5px solid ${C.border}; border-radius: 8px; color: ${C.text}; padding: 10px 14px; font-size: 14px; outline: none; appearance: none; }
        .fs:focus { border-color: ${C.blauw}; }
        .card { background: ${C.card}; border: 1px solid ${C.border}; border-radius: 14px; padding: 22px; box-shadow: 0 1px 4px rgba(27,58,107,0.06); }
        .btn-b { background: ${C.blauw}; color: white; border: none; border-radius: 8px; padding: 11px 22px; font-size: 14px; font-weight: 600; transition: background 0.2s; }
        .btn-b:hover { background: ${C.blauwLight}; } .btn-b:disabled { background: #aab4c4; cursor: not-allowed; }
        .btn-g { background: ${C.groen}; color: white; border: none; border-radius: 8px; padding: 11px 22px; font-size: 14px; font-weight: 600; transition: background 0.2s; }
        .btn-g:hover { background: ${C.groenLight}; } .btn-g:disabled { background: #aab4c4; cursor: not-allowed; }
        .btn-out { background: transparent; border: 1.5px solid ${C.border}; color: ${C.muted}; border-radius: 8px; padding: 9px 18px; font-size: 13px; font-weight: 500; transition: all 0.2s; }
        .btn-out:hover { border-color: ${C.blauw}; color: ${C.blauw}; }
        .btn-r { background: #dc2626; color: white; border: none; border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 600; }
        .btn-r:hover { background: #b91c1c; }
        .tp { background: none; border: none; color: ${C.muted}; padding: 8px 14px; border-radius: 20px; font-size: 13px; font-weight: 500; transition: all 0.2s; white-space: nowrap; }
        .tp.act { background: ${C.blauw}18; color: ${C.blauw}; font-weight: 700; }
        .tp:hover { color: ${C.blauw}; }
        .badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
        .mc { background: white; border: 1px solid ${C.border}; border-radius: 10px; padding: 16px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(27,58,107,0.05); }
        .rt { border: 2px solid ${C.border}; border-radius: 10px; padding: 14px; text-align: center; cursor: pointer; transition: all 0.2s; flex: 1; background: white; }
        .rt.sel { border-color: ${C.blauw}; background: ${C.blauw}10; }
        .rt:hover { border-color: ${C.blauwLight}; }
        .ti { font-size: 26px; display: block; margin-bottom: 6px; }
        .cr { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid ${C.border}; }
        .cr:last-child { border-bottom: none; }
        .cb { padding: 5px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; border: 1.5px solid; cursor: pointer; transition: all 0.15s; background: white; }
        .cb.ja { border-color: ${C.groen}; color: ${C.groen}; } .cb.ja.s { background: ${C.groen}; color: white; }
        .cb.nee { border-color: #ef4444; color: #ef4444; } .cb.nee.s { background: #ef4444; color: white; }
        .br { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid ${C.border}; margin-bottom: 6px; background: ${C.bg}; }
      `}</style>

      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: toast.type === "ok" ? C.groen : "#dc2626", color: "white", padding: "12px 22px", borderRadius: 10, fontWeight: 600, fontSize: 14, boxShadow: "0 8px 30px rgba(0,0,0,0.2)" }}>{toast.msg}</div>}

      {/* TOPBAR */}
      <div style={{ background: C.blauw, borderBottom: `2px solid ${C.groen}`, padding: "0 20px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(27,58,107,0.3)" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", alignItems: "center", gap: 12, height: 58 }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ background: "white", borderRadius: 8, padding: "4px 10px", display: "flex", alignItems: "center" }}>
              <span style={{ fontWeight: 900, fontSize: 15, color: C.blauw, letterSpacing: "-0.5px" }}>KTP</span>
              <span style={{ fontWeight: 900, fontSize: 15, color: C.groen, letterSpacing: "-0.5px", marginLeft: 4 }}>INTERFLEX</span>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2, flex: 1, justifyContent: "center", flexWrap: "wrap" }}>
            {rol === "collega" && (<>
              <button className={`tp ${tab === "melding" ? "act" : ""}`} style={{ color: tab === "melding" ? "white" : "rgba(255,255,255,0.7)", background: tab === "melding" ? C.groen : "transparent" }} onClick={() => setTab("melding")}>👤 Melding</button>
              <button className={`tp ${tab === "mijn" ? "act" : ""}`} style={{ color: tab === "mijn" ? "white" : "rgba(255,255,255,0.7)", background: tab === "mijn" ? C.groen : "transparent" }} onClick={() => setTab("mijn")}>
                📋 Mijn {mijnMeldingen.length > 0 && <span style={{ background: "#ef4444", color: "white", borderRadius: 10, padding: "1px 6px", fontSize: 11, marginLeft: 4 }}>{mijnMeldingen.length}</span>}
              </button>
              <button className={`tp ${tab === "woningen" ? "act" : ""}`} style={{ color: tab === "woningen" ? "white" : "rgba(255,255,255,0.7)", background: tab === "woningen" ? C.groen : "transparent" }} onClick={() => setTab("woningen")}>🏠 Woningen</button>
            </>)}
            {rol === "huismeester" && (<>
              <button className={`tp ${tab === "taken" ? "act" : ""}`} style={{ color: tab === "taken" ? "white" : "rgba(255,255,255,0.7)", background: tab === "taken" ? C.groen : "transparent" }} onClick={() => setTab("taken")}>
                🔧 Taken {openMeldingen.length > 0 && <span style={{ background: "#ef4444", color: "white", borderRadius: 10, padding: "1px 6px", fontSize: 11, marginLeft: 4 }}>{openMeldingen.length}</span>}
              </button>
              <button className={`tp ${tab === "woningen" ? "act" : ""}`} style={{ color: tab === "woningen" ? "white" : "rgba(255,255,255,0.7)", background: tab === "woningen" ? C.groen : "transparent" }} onClick={() => setTab("woningen")}>🏠 Woningen</button>
              <button className={`tp ${tab === "planning" ? "act" : ""}`} style={{ color: tab === "planning" ? "white" : "rgba(255,255,255,0.7)", background: tab === "planning" ? C.groen : "transparent" }} onClick={() => setTab("planning")}>📊 Status</button>
            </>)}
            {rol === "backoffice" && (<>
              <button className={`tp ${tab === "woningen" ? "act" : ""}`} style={{ color: tab === "woningen" ? "white" : "rgba(255,255,255,0.7)", background: tab === "woningen" ? C.groen : "transparent" }} onClick={() => setTab("woningen")}>🏠 Woningen</button>
              <button className={`tp ${tab === "planning" ? "act" : ""}`} style={{ color: tab === "planning" ? "white" : "rgba(255,255,255,0.7)", background: tab === "planning" ? C.groen : "transparent" }} onClick={() => setTab("planning")}>📊 Status</button>
              <button className={`tp ${tab === "inbox" ? "act" : ""}`} style={{ color: tab === "inbox" ? "white" : "rgba(255,255,255,0.7)", background: tab === "inbox" ? C.groen : "transparent" }} onClick={() => setTab("inbox")}>
                📨 Inbox {openMeldingen.length > 0 && <span style={{ background: "#ef4444", color: "white", borderRadius: 10, padding: "1px 6px", fontSize: 11, marginLeft: 4 }}>{openMeldingen.length}</span>}
              </button>
              <button className={`tp ${tab === "log" ? "act" : ""}`} style={{ color: tab === "log" ? "white" : "rgba(255,255,255,0.7)", background: tab === "log" ? C.groen : "transparent" }} onClick={() => setTab("log")}>📝 Log</button>
              {isLiset && <button className={`tp ${tab === "beheer" ? "act" : ""}`} style={{ color: tab === "beheer" ? "white" : "rgba(255,255,255,0.7)", background: tab === "beheer" ? C.groen : "transparent" }} onClick={() => setTab("beheer")}>⚙️ Beheer</button>}
            </>)}
          </div>

          {/* User */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 20, padding: "5px 12px", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14 }}>{rolIcon}</span>
              <span style={{ fontSize: 13, color: "white", fontWeight: 600 }}>{naam}</span>
            </div>
            <button className="btn-out" style={{ padding: "5px 12px", fontSize: 12, borderColor: "rgba(255,255,255,0.3)", color: "rgba(255,255,255,0.8)" }} onClick={logout}>Uitloggen</button>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 20px" }}>
        {rol === "collega" && tab === "melding" && <MeldingForm houses={houses} onSubmit={addMelding} showToast={showToast} />}
        {rol === "collega" && tab === "mijn" && <MijnMeldingen meldingen={mijnMeldingen} houses={houses} />}
        {tab === "woningen" && <WoningenDetail houses={houses} />}
        {tab === "planning" && <PlanningView houses={houses} />}
        {rol === "huismeester" && tab === "taken" && <HuismeesterTaken meldingen={meldingen} houses={houses} onUpdate={updateMeldingStatus} naam={naam} />}
        {rol === "backoffice" && tab === "inbox" && <BackofficeInbox meldingen={meldingen} houses={houses} onUpdate={updateMeldingStatus} naam={naam} showToast={showToast} />}
        {rol === "backoffice" && tab === "log" && <LogView meldingen={meldingen} houses={houses} />}
        {rol === "backoffice" && isLiset && tab === "beheer" && <BeheerView houses={houses} onAdd={addWoning} onUpdate={updateWoning} onDelete={deleteWoning} showToast={showToast} gebruikers={gebruikers} onUpdateGebruikers={setEnSlaOp} />}
      </div>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────

function LoginScreen({ gebruikers, onLogin }) {
  const [zoek, setZoek] = useState("");
  const [geselecteerd, setGeselecteerd] = useState(null);
  const [pin, setPin] = useState("");
  const [fout, setFout] = useState("");
  const gefilterd = zoek.trim() ? gebruikers.filter(g => g.naam.toLowerCase().includes(zoek.toLowerCase())) : gebruikers;

  function probeerLogin() {
    if (!geselecteerd) return;
    if (pin === geselecteerd.pin) { onLogin(geselecteerd); }
    else { setFout("Verkeerde pincode, probeer opnieuw"); setPin(""); }
  }

  const rolKleur = { backoffice: C.blauw, huismeester: C.groen, collega: C.muted };
  const rolIcon  = { backoffice: "📊", huismeester: "🏠", collega: "👤" };

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(135deg, ${C.blauw} 0%, ${C.blauwDark} 60%, ${C.dark} 100%)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Inter',sans-serif", padding: 20 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap'); * { box-sizing: border-box; margin: 0; padding: 0; }`}</style>

      {/* Logo header */}
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 16, background: "rgba(255,255,255,0.1)", borderRadius: 16, padding: "16px 28px", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontWeight: 900, fontSize: 28, color: "white", letterSpacing: "-1px" }}>KTP</span>
            <span style={{ fontWeight: 900, fontSize: 28, color: C.groen, letterSpacing: "-1px", marginLeft: 8 }}>INTERFLEX</span>
          </div>
          <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.3)" }} />
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", letterSpacing: "2px", textTransform: "uppercase", fontWeight: 600 }}>Woningbeheer</div>
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 440, background: "white", borderRadius: 20, boxShadow: "0 40px 80px rgba(0,0,0,0.4)", overflow: "hidden" }}>
        <div style={{ background: C.groen, padding: "16px 28px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "white" }}>{geselecteerd ? `Inloggen als ${geselecteerd.naam}` : "Wie ben jij?"}</div>
        </div>
        <div style={{ padding: "24px 28px 28px" }}>
          {!geselecteerd ? (
            <>
              <input value={zoek} onChange={e => setZoek(e.target.value)} placeholder="🔍 Zoek op naam..."
                style={{ width: "100%", background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "10px 14px", fontSize: 14, outline: "none", marginBottom: 14 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 380, overflowY: "auto" }}>
                {gefilterd.map(g => (
                  <button key={g.naam} onClick={() => { setGeselecteerd(g); setFout(""); setPin(""); }}
                    style={{ background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", color: C.text, display: "flex", alignItems: "center", gap: 12, textAlign: "left", transition: "all 0.15s" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: rolKleur[g.rol] + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{rolIcon[g.rol]}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{g.naam}</div>
                      <div style={{ fontSize: 11, color: rolKleur[g.rol], marginTop: 1, fontWeight: 600, textTransform: "capitalize" }}>{g.rol}</div>
                    </div>
                    <div style={{ marginLeft: "auto", color: C.border, fontSize: 18 }}>›</div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <button onClick={() => { setGeselecteerd(null); setPin(""); setFout(""); }}
                style={{ background: "none", border: "none", color: C.muted, fontSize: 13, marginBottom: 20, display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit" }}>
                ← Terug naar overzicht
              </button>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ width: 64, height: 64, borderRadius: 16, background: rolKleur[geselecteerd.rol] + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 12px" }}>{rolIcon[geselecteerd.rol]}</div>
                <div style={{ fontWeight: 800, fontSize: 20, color: C.text }}>{geselecteerd.naam}</div>
                <div style={{ fontSize: 12, color: rolKleur[geselecteerd.rol], marginTop: 3, fontWeight: 700, textTransform: "capitalize", letterSpacing: "0.5px" }}>{geselecteerd.rol}</div>
              </div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 8 }}>Pincode</label>
              <input type="password" value={pin} onChange={e => { setPin(e.target.value); setFout(""); }} onKeyDown={e => e.key === "Enter" && probeerLogin()} placeholder="••••" maxLength={8}
                style={{ width: "100%", background: C.bg, border: `2px solid ${fout ? "#ef4444" : C.border}`, borderRadius: 10, color: C.text, padding: "16px", fontSize: 26, outline: "none", letterSpacing: 10, textAlign: "center", marginBottom: 10, transition: "border 0.2s" }} />
              {fout && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12, textAlign: "center", fontWeight: 500 }}>⚠ {fout}</div>}
              <button onClick={probeerLogin} disabled={!pin}
                style={{ width: "100%", background: pin ? C.blauw : C.border, color: "white", border: "none", borderRadius: 10, padding: 14, fontSize: 15, fontWeight: 700, cursor: pin ? "pointer" : "not-allowed", fontFamily: "inherit", transition: "background 0.2s" }}>
                Inloggen →
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop: 20, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>KTP Interflex · Woningbeheer systeem</div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(135deg, ${C.blauw} 0%, ${C.dark} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter,sans-serif" }}>
      <div style={{ textAlign: "center", color: "white" }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>⏳</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>KTP Interflex</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>Verbinden met database...</div>
      </div>
    </div>
  );
}

// ─── SECTIE HEADER ────────────────────────────────────────────────────────────

function SectieHeader({ titel, sub, actie }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: C.blauw, marginBottom: 3 }}>{titel}</h2>
        {sub && <p style={{ fontSize: 13, color: C.muted }}>{sub}</p>}
      </div>
      {actie}
    </div>
  );
}

// ─── MELDING FORM ─────────────────────────────────────────────────────────────

function MeldingForm({ houses, onSubmit, showToast }) {
  const [type, setType] = useState("aankomst");
  const [medewerker, setMedewerker] = useState("");
  const [datum, setDatum] = useState(todayISO());
  const [huisId, setHuisId] = useState(houses[0]?.id || 1);
  const [kamer, setKamer] = useState("");
  const [wieRegelt, setWieRegelt] = useState("");
  const [sleutelTerug, setSleutelTerug] = useState(null);
  const [kamerSchoon, setKamerSchoon] = useState(null);
  const [sleutelAantal, setSleutelAantal] = useState(1);
  const [opmerkingen, setOpmerkingen] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectedHouse = houses.find(h => h.id === Number(huisId));

  async function handleSubmit() {
    if (!medewerker.trim()) { showToast("Vul naam medewerker in", "err"); return; }
    if (!kamer) { showToast("Selecteer een kamer", "err"); return; }
    if (type === "vertrek" && (sleutelTerug === null || kamerSchoon === null)) { showToast("Vul sleutel & schoonmaak in", "err"); return; }
    setSaving(true);
    await onSubmit({ type, medewerker: medewerker.trim(), datum, huisId: Number(huisId), kamer, wieRegelt, sleutelTerug, kamerSchoon, sleutelAantal, opmerkingen });
    setSaving(false);
    setMedewerker(""); setOpmerkingen(""); setKamer(""); setSleutelTerug(null); setKamerSchoon(null); setWieRegelt("");
    setSubmitted(true); setTimeout(() => setSubmitted(false), 2500);
  }

  if (submitted) return (
    <div className="card" style={{ textAlign: "center", padding: "80px 40px", maxWidth: 600, margin: "0 auto", borderTop: `4px solid ${C.groen}` }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.groen, marginBottom: 8 }}>Melding verzonden!</div>
      <div style={{ fontSize: 14, color: C.muted, marginBottom: 24 }}>De huismeester en backoffice zijn op de hoogte gebracht.</div>
      <button className="btn-b" onClick={() => setSubmitted(false)}>Nieuwe melding</button>
    </div>
  );

  const types = [
    { id: "aankomst", icon: "🚗", label: "AANKOMST", color: C.groen },
    { id: "vertrek",  icon: "🧳", label: "VERTREK",  color: "#ef4444" },
    { id: "reservering", icon: "📅", label: "RESERVERING", color: C.blauw },
    { id: "overig",   icon: "💬", label: "OVERIG",   color: C.muted },
  ];

  return (
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      <SectieHeader titel="Melding doorgeven" sub="Geef een aankomst, vertrek of reservering door." />
      <div className="card" style={{ marginBottom: 16, borderTop: `3px solid ${C.blauw}` }}>
        <label className="fl">Wat wil je melden?</label>
        <div style={{ display: "flex", gap: 10 }}>
          {types.map(t => (
            <div key={t.id} className={`rt ${type === t.id ? "sel" : ""}`} onClick={() => setType(t.id)}
              style={{ borderColor: type === t.id ? t.color : C.border, background: type === t.id ? t.color + "12" : "white" }}>
              <span className="ti">{t.icon}</span>
              <div style={{ fontSize: 10, fontWeight: 700, color: type === t.id ? t.color : C.muted, letterSpacing: "0.8px" }}>{t.label}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 16 }}>
        <div><label className="fl">Naam medewerker</label><input className="fi" value={medewerker} onChange={e => setMedewerker(e.target.value)} placeholder="Voor- en achternaam" /></div>
        <div><label className="fl">Datum</label><input className="fi" type="date" value={datum} onChange={e => setDatum(e.target.value)} /></div>
        <div>
          <label className="fl">Woning</label>
          <select className="fs" value={huisId} onChange={e => { setHuisId(e.target.value); setKamer(""); }}>
            {houses.map(h => <option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
          </select>
        </div>
        <div>
          <label className="fl">Kamernummer</label>
          <select className="fs" value={kamer} onChange={e => setKamer(e.target.value)}>
            <option value="">Selecteer kamer</option>
            {selectedHouse?.kamers.map(k => <option key={k.k} value={k.k}>Kamer {k.k} {k.naam ? `– ${k.naam}` : "(leeg)"} [{k.status}]</option>)}
          </select>
        </div>
      </div>
      {(type === "aankomst" || type === "reservering") && (
        <div className="card" style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <div><label className="fl">Wie regelt aankomst?</label><input className="fi" value={wieRegelt} onChange={e => setWieRegelt(e.target.value)} placeholder="bijv. NW CB, Hans, zelf..." /></div>
          {type === "aankomst" && <div><label className="fl">Aantal sleutels ontvangen</label><select className="fs" value={sleutelAantal} onChange={e => setSleutelAantal(Number(e.target.value))}>{[0,1,2,3].map(n=><option key={n} value={n}>{n}</option>)}</select></div>}
        </div>
      )}
      {type === "vertrek" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label className="fl">Controlelijst bij vertrek</label>
          <div className="cr"><span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>🔑 Sleutel(s) teruggegeven?</span><div style={{ display: "flex", gap: 8 }}>{["ja","nee"].map(v=><button key={v} className={`cb ${v} ${sleutelTerug===v?"s":""}`} onClick={()=>setSleutelTerug(v)}>{v}</button>)}</div></div>
          <div className="cr"><span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>🧹 Kamer schoon achtergelaten?</span><div style={{ display: "flex", gap: 8 }}>{["ja","nee"].map(v=><button key={v} className={`cb ${v} ${kamerSchoon===v?"s":""}`} onClick={()=>setKamerSchoon(v)}>{v}</button>)}</div></div>
          {sleutelTerug==="nee" && <div style={{ marginTop:10, padding:"10px 14px", background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8, fontSize:13, color:"#b91c1c", fontWeight:500 }}>⚠️ Sleutel niet terug → backoffice wordt geïnformeerd om €50 in te houden van borg</div>}
        </div>
      )}
      <div className="card" style={{ marginBottom: 20 }}><label className="fl">Opmerkingen</label><textarea className="fi" value={opmerkingen} onChange={e=>setOpmerkingen(e.target.value)} placeholder="Eventuele bijzonderheden..." rows={3} style={{ resize:"vertical" }} /></div>
      <button className="btn-b" style={{ width:"100%", padding:14, fontSize:15 }} onClick={handleSubmit} disabled={saving}>
        {saving ? "⏳ Opslaan..." : `✓ ${type.charAt(0).toUpperCase()+type.slice(1)} doorgeven`}
      </button>
    </div>
  );
}

function MijnMeldingen({ meldingen, houses }) {
  if (meldingen.length===0) return <div className="card" style={{ textAlign:"center", padding:"60px 20px" }}><div style={{ fontSize:40, marginBottom:12 }}>📭</div><div style={{ color:C.muted }}>Je hebt nog geen meldingen ingediend</div></div>;
  return <div><SectieHeader titel="Mijn meldingen" />{meldingen.map(m=><MeldingItem key={m.id} m={m} houses={houses} />)}</div>;
}

function MeldingItem({ m, houses }) {
  const ti = { aankomst:"🚗", vertrek:"🧳", reservering:"📅", overig:"💬" };
  const tc = { aankomst:C.groen, vertrek:"#ef4444", reservering:C.blauw, overig:C.muted };
  const huis = houses.find(h=>h.id===m.woning_id);
  return (
    <div className="mc" style={{ borderLeft:`3px solid ${m.sleutel_terug==="nee"||m.kamer_schoon==="nee"?"#ef4444":tc[m.type]||C.muted}` }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
        <div style={{ fontSize:24 }}>{ti[m.type]||"💬"}</div>
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:4 }}>
            <span style={{ fontWeight:700, fontSize:15, color:C.text }}>{m.medewerker}</span>
            <span className="badge" style={{ background:(tc[m.type]||C.muted)+"18", color:tc[m.type]||C.muted }}>{(m.type||"").toUpperCase()}</span>
            <span className="badge" style={{ background:m.status==="open"?C.blauw+"18":"#f0fdf4", color:m.status==="open"?C.blauw:C.groen, marginLeft:"auto" }}>{(m.status||"").toUpperCase()}</span>
          </div>
          <div style={{ fontSize:13, color:C.muted }}>📍 {huis?.adres}, {huis?.stad} · Kamer {m.kamer} · {m.created_at?fmtFull(m.created_at):""}</div>
          {m.wie_regelt && <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>👤 Wie regelt: {m.wie_regelt}</div>}
          {m.type==="vertrek" && <div style={{ display:"flex", gap:8, marginTop:6 }}><span className="badge" style={{ background:m.sleutel_terug==="ja"?C.groen+"18":"#fef2f2", color:m.sleutel_terug==="ja"?C.groen:"#ef4444" }}>🔑 {m.sleutel_terug}</span><span className="badge" style={{ background:m.kamer_schoon==="ja"?C.groen+"18":"#fef2f2", color:m.kamer_schoon==="ja"?C.groen:"#ef4444" }}>🧹 {m.kamer_schoon}</span></div>}
          {m.opmerkingen && <div style={{ fontSize:13, color:C.muted, marginTop:6, fontStyle:"italic" }}>"{m.opmerkingen}"</div>}
        </div>
      </div>
    </div>
  );
}

function HuismeesterTaken({ meldingen, houses, onUpdate, naam }) {
  const [notitieMap, setNotitieMap] = useState({});
  const open = meldingen.filter(m=>m.status==="open");
  const afgehandeld = meldingen.filter(m=>m.status!=="open"&&m.afgehandeld_door===naam);

  function taken(m) {
    const t=[];
    if (m.type==="aankomst") t.push({icon:"🛏",tekst:`Kamer ${m.kamer} gereedmaken voor ${m.medewerker}`});
    if (m.type==="vertrek"&&m.kamer_schoon==="nee") t.push({icon:"🧹",tekst:`Kamer ${m.kamer} schoonmaken`,urgent:true});
    if (m.type==="vertrek") t.push({icon:"🔍",tekst:`Kamer ${m.kamer} controleren na vertrek ${m.medewerker}`});
    if (m.type==="reservering") t.push({icon:"📅",tekst:`Kamer ${m.kamer} klaarzetten voor ${m.medewerker} (aankomst ${m.datum})`});
    if (m.wie_regelt) t.push({icon:"👤",tekst:`Wie regelt: ${m.wie_regelt}`});
    if (m.opmerkingen) t.push({icon:"📝",tekst:m.opmerkingen});
    return t;
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
        <div><h2 style={{ fontSize:20, fontWeight:800, color:C.blauw }}>Openstaande taken</h2><p style={{ fontSize:13, color:C.muted, marginTop:2 }}>Meldingen die jouw actie vereisen</p></div>
        <div style={{ display:"flex", gap:12 }}>
          <div style={{ textAlign:"center", background:"#fef2f2", border:"1px solid #fecaca", borderRadius:10, padding:"10px 20px" }}><div style={{ fontSize:22, fontWeight:700, color:"#ef4444" }}>{open.length}</div><div style={{ fontSize:11, color:C.muted }}>Open</div></div>
          <div style={{ textAlign:"center", background:"#f0fdf4", border:`1px solid ${C.groen}40`, borderRadius:10, padding:"10px 20px" }}><div style={{ fontSize:22, fontWeight:700, color:C.groen }}>{afgehandeld.length}</div><div style={{ fontSize:11, color:C.muted }}>Afgehandeld</div></div>
        </div>
      </div>
      {open.length===0 ? <div className="card" style={{ textAlign:"center", padding:"60px 20px" }}><div style={{ fontSize:48, marginBottom:12 }}>✅</div><div style={{ fontWeight:700, color:C.groen }}>Alles afgehandeld!</div></div>
      : open.map(m=>{
        const huis=houses.find(h=>h.id===m.woning_id);
        const tl=taken(m);
        return (
          <div key={m.id} className="mc" style={{ marginBottom:14, borderLeft:`4px solid ${C.groen}` }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
              <span style={{ fontSize:22 }}>{m.type==="aankomst"?"🚗":m.type==="vertrek"?"🧳":"📅"}</span>
              <div>
                <div style={{ fontWeight:700, fontSize:15, color:C.text }}>{m.medewerker} — <span style={{ color:C.blauw, textTransform:"uppercase", fontSize:12 }}>{m.type}</span></div>
                <div style={{ fontSize:12, color:C.muted }}>📍 {huis?.adres}, {huis?.stad} · K{m.kamer} · Door: {m.ingediend_door} · {m.created_at?fmtFull(m.created_at):""}</div>
              </div>
            </div>
            <div style={{ background:C.bg, borderRadius:8, padding:14, marginBottom:12, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, marginBottom:10, letterSpacing:"0.8px" }}>TE DOEN:</div>
              {tl.map((t,i)=>(
                <div key={i} style={{ display:"flex", gap:10, padding:"6px 0", borderBottom:i<tl.length-1?`1px solid ${C.border}`:"none", alignItems:"center" }}>
                  <span style={{ fontSize:16 }}>{t.icon}</span><span style={{ fontSize:14, flex:1, color:C.text }}>{t.tekst}</span>
                  {t.urgent && <span style={{ fontSize:10, fontWeight:700, color:"#ef4444", background:"#fef2f2", padding:"2px 8px", borderRadius:4 }}>URGENT</span>}
                </div>
              ))}
              {m.type==="vertrek" && <div style={{ marginTop:10, display:"flex", gap:8 }}><span className="badge" style={{ background:m.sleutel_terug==="ja"?C.groen+"18":"#fef2f2", color:m.sleutel_terug==="ja"?C.groen:"#ef4444" }}>🔑 {m.sleutel_terug}</span><span className="badge" style={{ background:m.kamer_schoon==="ja"?C.groen+"18":"#fef2f2", color:m.kamer_schoon==="ja"?C.groen:"#ef4444" }}>🧹 {m.kamer_schoon}</span></div>}
            </div>
            <input className="fi" value={notitieMap[m.id]||""} onChange={e=>setNotitieMap(p=>({...p,[m.id]:e.target.value}))} placeholder="Optionele notitie..." style={{ fontSize:13, marginBottom:10 }} />
            <div style={{ display:"flex", gap:10 }}>
              <button className="btn-g" style={{ flex:1, padding:"10px" }} onClick={()=>onUpdate(m.id,"afgehandeld",notitieMap[m.id]||"")}>✓ Afgehandeld</button>
              <button className="btn-out" onClick={()=>onUpdate(m.id,"in_behandeling",notitieMap[m.id]||"")}>In behandeling</button>
            </div>
          </div>
        );
      })}
      {afgehandeld.length>0 && <div style={{ marginTop:32 }}><h3 style={{ fontSize:13, fontWeight:700, color:C.muted, marginBottom:12, textTransform:"uppercase", letterSpacing:"0.5px" }}>Eerder afgehandeld</h3>{afgehandeld.slice(0,5).map(m=><MeldingItem key={m.id} m={m} houses={houses} />)}</div>}
    </div>
  );
}

function BackofficeInbox({ meldingen, houses, onUpdate, naam, showToast }) {
  const [notitieMap, setNotitieMap] = useState({});
  const [filter, setFilter] = useState("open");
  const actie = meldingen.filter(m=>m.sleutel_terug==="nee"||m.kamer_schoon==="nee");
  const filtered = meldingen.filter(m=>filter==="open"?m.status==="open":filter==="actie"?(m.sleutel_terug==="nee"||m.kamer_schoon==="nee"):true);

  return (
    <div>
      <div style={{ display:"flex", alignItems:"flex-start", gap:16, marginBottom:20 }}>
        <div><h2 style={{ fontSize:20, fontWeight:800, color:C.blauw }}>Backoffice Inbox</h2><p style={{ fontSize:13, color:C.muted, marginTop:2 }}>Meldingen met administratieve of salaris consequenties</p></div>
        {actie.length>0 && <div style={{ marginLeft:"auto", background:"#fef2f2", border:"1px solid #fecaca", borderRadius:10, padding:"10px 18px", textAlign:"center" }}><div style={{ fontSize:20, fontWeight:700, color:"#ef4444" }}>{actie.length}</div><div style={{ fontSize:10, color:C.muted }}>Salarisactie</div></div>}
      </div>
      {actie.length>0 && (
        <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:12, padding:"14px 18px", marginBottom:20 }}>
          <div style={{ fontWeight:700, color:"#b91c1c", marginBottom:8, fontSize:14 }}>⚠️ Salarisverwerking vereist</div>
          {actie.map(m=>{const h=houses.find(h=>h.id===m.woning_id);return <div key={m.id} style={{ fontSize:13, color:"#b91c1c", marginBottom:4, display:"flex", gap:10, flexWrap:"wrap" }}><span>• {m.medewerker} ({h?.adres}, K{m.kamer}):</span>{m.sleutel_terug==="nee"&&<span style={{ background:"#fecaca", padding:"2px 8px", borderRadius:4, fontSize:11 }}>🔑 €50 inhouden</span>}{m.kamer_schoon==="nee"&&<span style={{ background:"#fef3c7", padding:"2px 8px", borderRadius:4, fontSize:11, color:"#b45309" }}>🧹 schoonmaakkosten</span>}</div>;})}
        </div>
      )}
      <div style={{ display:"flex", gap:6, marginBottom:20 }}>{[["open","Open"],["actie","Actie vereist"],["alle","Alle"]].map(([v,l])=><button key={v} className={`tp ${filter===v?"act":""}`} onClick={()=>setFilter(v)}>{l}</button>)}</div>
      {filtered.map(m=>{
        const huis=houses.find(h=>h.id===m.woning_id);
        const na=m.sleutel_terug==="nee"||m.kamer_schoon==="nee";
        return (
          <div key={m.id} className="mc" style={{ marginBottom:12, borderLeft:`4px solid ${na?"#ef4444":C.blauw}` }}>
            <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:10 }}>
              <span style={{ fontSize:22 }}>{m.type==="aankomst"?"🚗":m.type==="vertrek"?"🧳":"📅"}</span>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                  <span style={{ fontWeight:700, color:C.text }}>{m.medewerker}</span>
                  <span className="badge" style={{ background:C.bg, color:C.muted, fontSize:10 }}>{(m.type||"").toUpperCase()}</span>
                  {na && <span className="badge" style={{ background:"#fef2f2", color:"#ef4444", fontSize:10 }}>⚠️ ACTIE SALARIS</span>}
                  <span className="badge" style={{ background:m.status==="open"?C.blauw+"18":"#f0fdf4", color:m.status==="open"?C.blauw:C.groen, marginLeft:"auto", fontSize:10 }}>{(m.status||"").toUpperCase()}</span>
                </div>
                <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>📍 {huis?.adres}, {huis?.stad} · K{m.kamer} · {m.datum} · Door: {m.ingediend_door}</div>
                {m.wie_regelt && <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>👤 Wie regelt: {m.wie_regelt}</div>}
              </div>
            </div>
            <div style={{ background:C.bg, borderRadius:8, padding:12, marginBottom:10, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, marginBottom:8, letterSpacing:"0.8px" }}>ADMINISTRATIEVE ACTIES:</div>
              {m.type==="aankomst"&&<div style={{ fontSize:13, color:C.text }}>✅ Kamer {m.kamer} → <strong style={{ color:C.groen }}>Lopend</strong> — huuraftrek actief per {m.datum}</div>}
              {m.type==="reservering"&&<div style={{ fontSize:13, color:C.text }}>📅 Kamer {m.kamer} gereserveerd voor {m.medewerker} — aankomst {m.datum}</div>}
              {m.type==="vertrek"&&(<><div style={{ fontSize:13, color:C.text, marginBottom:6 }}>{m.sleutel_terug==="nee"?"🔑❌ ":"🔑✅ "}{m.sleutel_terug==="nee"?<strong style={{ color:"#ef4444" }}>NIET terug → €50 inhouden van borg</strong>:<span style={{ color:C.groen }}>Sleutel teruggegeven</span>}</div><div style={{ fontSize:13, color:C.text }}>{m.kamer_schoon==="nee"?"🧹❌ ":"🧹✅ "}{m.kamer_schoon==="nee"?<strong style={{ color:"#f59e0b" }}>NIET schoon → schoonmaakkosten verwerken</strong>:<span style={{ color:C.groen }}>Kamer schoon achtergelaten</span>}</div></>)}
            </div>
            {m.status==="open"&&(<><input className="fi" value={notitieMap[m.id]||""} onChange={e=>setNotitieMap(p=>({...p,[m.id]:e.target.value}))} placeholder="Notitie bij verwerking..." style={{ fontSize:13, marginBottom:10 }} /><button className="btn-b" style={{ width:"100%" }} onClick={()=>onUpdate(m.id,"verwerkt",notitieMap[m.id]||"")}>✓ Verwerkt in administratie</button></>)}
            {m.status!=="open"&&m.afgehandeld_door&&<div style={{ fontSize:12, color:C.muted, marginTop:8 }}>Verwerkt door {m.afgehandeld_door}{m.notitie?` — "${m.notitie}"`:""}</div>}
          </div>
        );
      })}
    </div>
  );
}

function StatKaartje({ label, val, color }) {
  return <div className="card" style={{ borderTop:`3px solid ${color}`, padding:"14px 16px" }}><div style={{ fontSize:26, fontWeight:800, color }}>{val}</div><div style={{ fontSize:11, color:C.muted, marginTop:3 }}>{label}</div></div>;
}

function WoningenDetail({ houses }) {
  const [filterStad, setFilterStad] = useState("Alle");
  const [filterStatus, setFilterStatus] = useState("Alle");
  const [zoek, setZoek] = useState("");
  const steden = ["Alle",...Array.from(new Set(houses.map(h=>h.stad))).sort()];
  const total=houses.reduce((s,h)=>s+h.kamers.length,0);
  const bezet=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.naam&&k.status==="Lopend").length,0);
  const beschikbaar=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Beschikbaar").length,0);
  const gereserveerd=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Gereserveerd").length,0);
  const controle=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Controle").length,0);
  const filtered=houses.filter(h=>{
    if(filterStad!=="Alle"&&h.stad!==filterStad) return false;
    if(filterStatus!=="Alle"&&!h.kamers.some(k=>k.status===filterStatus)) return false;
    if(zoek.trim()){const q=zoek.toLowerCase();return h.adres.toLowerCase().includes(q)||h.stad.toLowerCase().includes(q)||h.kamers.some(k=>k.naam.toLowerCase().includes(q)||k.bedrijf.toLowerCase().includes(q));}
    return true;
  });

  return (
    <div>
      <SectieHeader titel="Woningoverzicht" sub={`Alle ${houses.length} woningen met bewoners en kamerstatus`} />
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10, marginBottom:24 }}>
        <StatKaartje label="Bezet" val={bezet} color={C.groen} />
        <StatKaartje label="Beschikbaar" val={beschikbaar} color={C.blauw} />
        <StatKaartje label="Gereserveerd" val={gereserveerd} color="#f59e0b" />
        <StatKaartje label="Controle" val={controle} color="#ef4444" />
        <StatKaartje label="Totaal kamers" val={total} color={C.muted} />
      </div>
      <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap", alignItems:"center" }}>
        <input value={zoek} onChange={e=>setZoek(e.target.value)} placeholder="🔍 Zoek op naam, adres, bedrijf..."
          style={{ background:"white", border:`1.5px solid ${C.border}`, borderRadius:8, color:C.text, padding:"8px 14px", fontSize:13, outline:"none", width:240 }} />
        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>{steden.map(s=><button key={s} className={`tp ${filterStad===s?"act":""}`} onClick={()=>setFilterStad(s)} style={{ fontSize:12, padding:"6px 12px" }}>{s}</button>)}</div>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
          style={{ background:"white", border:`1.5px solid ${C.border}`, borderRadius:8, color:C.text, padding:"8px 12px", fontSize:12, outline:"none" }}>
          {["Alle",...STATUSSEN].map(s=><option key={s}>{s}</option>)}
        </select>
        <span style={{ fontSize:12, color:C.muted }}>{filtered.length} woningen</span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))", gap:16 }}>
        {filtered.map(h=>{
          const bezette=h.kamers.filter(k=>k.naam&&k.status==="Lopend").length;
          const hasIssue=h.kamers.some(k=>k.status==="Controle"||k.status==="Moet aan het werk");
          const hasVrij=h.kamers.some(k=>k.status==="Beschikbaar");
          return (
            <div key={h.id} className="card" style={{ borderTop:`3px solid ${hasIssue?"#ef4444":hasVrij?C.blauw:C.groen}`, padding:"18px 18px 14px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                <div><div style={{ fontWeight:800, fontSize:15, color:C.text }}>{h.adres}</div><div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{h.stad} · {h.postcode}</div></div>
                <div style={{ textAlign:"right", flexShrink:0, marginLeft:10 }}>
                  <div style={{ fontSize:22, fontWeight:800, color:C.blauw, lineHeight:1 }}>{bezette}<span style={{ fontSize:13, color:C.muted }}>/{h.kamers.length}</span></div>
                  <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>bezet</div>
                </div>
              </div>
              <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:12 }}>
                {h.kamers.map(k=>{const c=STATUS_MAP[k.status]||{dot:C.muted};return <div key={k.k} title={`K${k.k}: ${k.naam||"leeg"} — ${k.status}`} style={{ width:12, height:12, borderRadius:3, background:c.dot+"50", border:`1.5px solid ${c.dot}` }} />;  })}
              </div>
              <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:10 }}>
                {h.kamers.map(k=>{const c=STATUS_MAP[k.status]||{bg:C.bg,text:C.muted,dot:C.muted};return(
                  <div key={k.k} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 8px", borderRadius:7, marginBottom:2, background:k.status==="Controle"?"#fef2f2":k.status==="Beschikbaar"?C.blauw+"08":"transparent" }}>
                    <div style={{ width:6, height:6, borderRadius:2, background:c.dot, flexShrink:0 }} />
                    <span style={{ fontSize:11, fontWeight:700, color:C.muted, minWidth:28, fontFamily:"monospace" }}>K{k.k}</span>
                    <span style={{ flex:1, fontSize:13, color:k.naam?C.text:"#aab4c4", fontStyle:k.naam?"normal":"italic", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{k.naam||"leeg"}</span>
                    {k.bedrijf&&<span style={{ fontSize:11, color:C.muted, whiteSpace:"nowrap", flexShrink:0 }}>{k.bedrijf}</span>}
                    <span style={{ padding:"2px 8px", borderRadius:4, background:c.bg, color:c.text, fontSize:10, fontWeight:600, whiteSpace:"nowrap", flexShrink:0 }}>{k.status}</span>
                  </div>
                );})}
              </div>
              <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.border}`, display:"flex", gap:6, flexWrap:"wrap" }}>
                {hasVrij && <span style={{ fontSize:10, fontWeight:600, color:C.blauw, background:C.blauw+"18", padding:"3px 8px", borderRadius:4 }}>{h.kamers.filter(k=>k.status==="Beschikbaar").length} vrij</span>}
                {h.kamers.filter(k=>k.status==="Gereserveerd").length>0 && <span style={{ fontSize:10, fontWeight:600, color:"#b45309", background:"#fef3c7", padding:"3px 8px", borderRadius:4 }}>{h.kamers.filter(k=>k.status==="Gereserveerd").length} gereserveerd</span>}
                {hasIssue && <span style={{ fontSize:10, fontWeight:600, color:"#ef4444", background:"#fef2f2", padding:"3px 8px", borderRadius:4 }}>⚠ actie vereist</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlanningView({ houses }) {
  const [filterStad, setFilterStad] = useState("Alle");
  const steden=["Alle",...Array.from(new Set(houses.map(h=>h.stad))).sort()];
  const filtered=filterStad==="Alle"?houses:houses.filter(h=>h.stad===filterStad);
  const total=houses.reduce((s,h)=>s+h.kamers.length,0);
  const bezet=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.naam&&k.status==="Lopend").length,0);
  const beschikbaar=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Beschikbaar").length,0);
  const controle=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Controle").length,0);
  return (
    <div>
      <SectieHeader titel="Statusoverzicht" />
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
        <StatKaartje label="Bezet" val={bezet} color={C.groen} />
        <StatKaartje label="Beschikbaar" val={beschikbaar} color={C.blauw} />
        <StatKaartje label="Te controleren" val={controle} color="#ef4444" />
        <StatKaartje label="Totaal kamers" val={total} color={C.muted} />
      </div>
      <div style={{ display:"flex", gap:6, marginBottom:20, flexWrap:"wrap" }}>{steden.map(s=><button key={s} className={`tp ${filterStad===s?"act":""}`} onClick={()=>setFilterStad(s)} style={{ fontSize:12 }}>{s}</button>)}</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))", gap:14 }}>
        {filtered.map(h=>{
          const bezette=h.kamers.filter(k=>k.naam&&k.status==="Lopend").length;
          return(
            <div key={h.id} className="card" style={{ borderTop:`3px solid ${C.blauw}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
                <div><div style={{ fontWeight:800, fontSize:15, color:C.text }}>{h.adres}</div><div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{h.stad} · {h.postcode}</div></div>
                <div style={{ textAlign:"right" }}><div style={{ fontSize:22, fontWeight:800, color:C.blauw }}>{bezette}/{h.kamers.length}</div><div style={{ fontSize:10, color:C.muted }}>bezet</div></div>
              </div>
              <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginBottom:12 }}>{h.kamers.map(k=>{const c=STATUS_MAP[k.status]||{dot:C.muted};return <div key={k.k} title={`K${k.k}: ${k.naam||"leeg"}`} style={{ width:10, height:10, borderRadius:3, background:c.dot+"60", border:`1.5px solid ${c.dot}` }} />;})}</div>
              <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:12 }}>
                {h.kamers.map(k=>{const c=STATUS_MAP[k.status]||{bg:C.bg,text:C.muted};return(
                  <div key={k.k} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", borderRadius:6, marginBottom:2 }}>
                    <span style={{ fontSize:10, fontWeight:700, color:C.muted, minWidth:26, fontFamily:"monospace" }}>K{k.k}</span>
                    <span style={{ flex:1, fontSize:13, color:k.naam?C.text:"#aab4c4", fontStyle:k.naam?"normal":"italic" }}>{k.naam||"leeg"}</span>
                    {k.bedrijf&&<span style={{ fontSize:11, color:C.muted }}>{k.bedrijf}</span>}
                    <span style={{ padding:"2px 8px", borderRadius:4, background:c.bg, color:c.text, fontSize:10, fontWeight:600, whiteSpace:"nowrap" }}>{k.status}</span>
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

// ─── BEHEER VIEW ──────────────────────────────────────────────────────────────

function BeheerView({ houses, onAdd, onUpdate, onDelete, showToast, gebruikers, onUpdateGebruikers }) {
  const [subTab, setSubTab] = useState("woningen");

  return (
    <div>
      <SectieHeader titel="⚙️ Beheer" sub="Alleen beschikbaar voor Liset" />
      <div style={{ display:"flex", gap:6, marginBottom:24, borderBottom:`2px solid ${C.border}`, paddingBottom:0 }}>
        {[["woningen","🏠 Woningen & kamers"],["gebruikers","👥 Gebruikers & pincodes"]].map(([v,l])=>(
          <button key={v} onClick={()=>setSubTab(v)}
            style={{ background:"none", border:"none", padding:"10px 20px", fontSize:14, fontWeight:700, color:subTab===v?C.blauw:C.muted, borderBottom:subTab===v?`3px solid ${C.blauw}`:"3px solid transparent", marginBottom:-2, cursor:"pointer", fontFamily:"inherit" }}>
            {l}
          </button>
        ))}
      </div>
      {subTab==="woningen" && <WoningBeheer houses={houses} onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete} showToast={showToast} />}
      {subTab==="gebruikers" && <GebruikersBeheer gebruikers={gebruikers} onUpdate={onUpdateGebruikers} showToast={showToast} />}
    </div>
  );
}

function WoningBeheer({ houses, onAdd, onUpdate, onDelete, showToast }) {
  const [geselecteerd, setGeselecteerd] = useState(null);
  const [nieuweWoning, setNieuweWoning] = useState({ stad:"", adres:"", postcode:"" });
  const [toonNieuwe, setToonNieuwe] = useState(false);
  const [nieuweKamer, setNieuweKamer] = useState({ k:"", naam:"", bedrijf:"", status:"Beschikbaar" });
  const [bewerkKamer, setBewerkKamer] = useState(null);
  const [saving, setSaving] = useState(false);
  const huis=houses.find(h=>h.id===geselecteerd);

  async function woningToevoegen() {
    if(!nieuweWoning.stad||!nieuweWoning.adres){showToast("Vul stad en adres in","err");return;}
    setSaving(true);
    const ok=await onAdd({...nieuweWoning,kamers:[]});
    setSaving(false);
    if(ok){setNieuweWoning({stad:"",adres:"",postcode:""});setToonNieuwe(false);}
  }

  async function kamerToevoegen() {
    if(!nieuweKamer.k){showToast("Vul kamernummer in","err");return;}
    if(!huis) return;
    if(huis.kamers.some(k=>k.k===nieuweKamer.k)){showToast("Kamernummer bestaat al","err");return;}
    setSaving(true);
    await onUpdate(huis.id,{kamers:[...huis.kamers,{...nieuweKamer}]});
    setSaving(false);
    setNieuweKamer({k:"",naam:"",bedrijf:"",status:"Beschikbaar"});
  }

  async function kamerOpslaan(kamerNr,updates) {
    if(!huis) return;
    setSaving(true);
    await onUpdate(huis.id,{kamers:huis.kamers.map(k=>k.k===kamerNr?{...k,...updates}:k)});
    setSaving(false);
    setBewerkKamer(null);
  }

  async function kamerVerwijderen(kamerNr) {
    if(!huis||!window.confirm(`Kamer ${kamerNr} verwijderen?`)) return;
    setSaving(true);
    await onUpdate(huis.id,{kamers:huis.kamers.filter(k=>k.k!==kamerNr)});
    setSaving(false);
  }

  async function woningVerwijderen(id) {
    if(!window.confirm("Woning verwijderen? Dit kan niet ongedaan worden gemaakt.")) return;
    const ok=await onDelete(id);
    if(ok) setGeselecteerd(null);
  }

  return (
    <div style={{ display:"grid", gridTemplateColumns:"280px 1fr", gap:20 }}>
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <span style={{ fontWeight:700, fontSize:14, color:C.blauw }}>Woningen ({houses.length})</span>
          <button className="btn-b" style={{ padding:"7px 14px", fontSize:12 }} onClick={()=>setToonNieuwe(true)}>+ Woning</button>
        </div>
        {toonNieuwe && (
          <div className="card" style={{ marginBottom:14, borderTop:`3px solid ${C.groen}` }}>
            <div style={{ fontWeight:700, fontSize:13, marginBottom:12, color:C.blauw }}>Nieuwe woning</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <input className="fi" value={nieuweWoning.stad} onChange={e=>setNieuweWoning(p=>({...p,stad:e.target.value}))} placeholder="Stad" style={{ fontSize:13 }} />
              <input className="fi" value={nieuweWoning.adres} onChange={e=>setNieuweWoning(p=>({...p,adres:e.target.value}))} placeholder="Adres" style={{ fontSize:13 }} />
              <input className="fi" value={nieuweWoning.postcode} onChange={e=>setNieuweWoning(p=>({...p,postcode:e.target.value}))} placeholder="Postcode" style={{ fontSize:13 }} />
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn-b" style={{ flex:1, padding:"8px", fontSize:13 }} onClick={woningToevoegen} disabled={saving}>{saving?"⏳":"✓ Toevoegen"}</button>
                <button className="btn-out" style={{ padding:"8px 12px", fontSize:13 }} onClick={()=>setToonNieuwe(false)}>✗</button>
              </div>
            </div>
          </div>
        )}
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {houses.map(h=>(
            <button key={h.id} onClick={()=>setGeselecteerd(h.id)}
              style={{ background:geselecteerd===h.id?C.blauw+"12":"white", border:`1.5px solid ${geselecteerd===h.id?C.blauw:C.border}`, borderRadius:10, padding:"12px 14px", color:C.text, textAlign:"left", transition:"all 0.15s", cursor:"pointer" }}>
              <div style={{ fontWeight:700, fontSize:13 }}>{h.adres}</div>
              <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{h.stad} · {h.kamers.length} kamers</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        {!huis ? (
          <div className="card" style={{ textAlign:"center", padding:"60px 20px" }}><div style={{ fontSize:40, marginBottom:10 }}>👈</div><div style={{ color:C.muted }}>Selecteer een woning</div></div>
        ) : (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
              <div><h3 style={{ fontSize:18, fontWeight:800, color:C.blauw }}>{huis.adres}</h3><div style={{ fontSize:13, color:C.muted, marginTop:2 }}>{huis.stad} · {huis.postcode} · {huis.kamers.length} kamers</div></div>
              <button className="btn-r" onClick={()=>woningVerwijderen(huis.id)}>🗑 Verwijderen</button>
            </div>
            <div className="card" style={{ marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:13, marginBottom:14, color:C.blauw }}>Kamers</div>
              {huis.kamers.length===0&&<div style={{ fontSize:13, color:C.muted, fontStyle:"italic" }}>Nog geen kamers</div>}
              {huis.kamers.map(k=>(
                <div key={k.k}>
                  {bewerkKamer===k.k ? (
                    <KamerBewerken kamer={k} onSave={u=>kamerOpslaan(k.k,u)} onCancel={()=>setBewerkKamer(null)} saving={saving} />
                  ) : (
                    <div className="br">
                      <div style={{ width:6, height:6, borderRadius:2, background:STATUS_MAP[k.status]?.dot||C.muted, flexShrink:0 }} />
                      <span style={{ fontSize:11, fontWeight:700, color:C.muted, minWidth:30, fontFamily:"monospace" }}>K{k.k}</span>
                      <span style={{ flex:1, fontSize:13, color:k.naam?C.text:"#aab4c4", fontStyle:k.naam?"normal":"italic" }}>{k.naam||"leeg"}</span>
                      {k.bedrijf&&<span style={{ fontSize:11, color:C.muted }}>{k.bedrijf}</span>}
                      <span style={{ padding:"2px 8px", borderRadius:4, background:STATUS_MAP[k.status]?.bg||C.bg, color:STATUS_MAP[k.status]?.text||C.muted, fontSize:10, fontWeight:600 }}>{k.status}</span>
                      <button className="btn-out" style={{ padding:"4px 10px", fontSize:11 }} onClick={()=>setBewerkKamer(k.k)}>✏️</button>
                      <button className="btn-r" style={{ padding:"4px 10px", fontSize:11 }} onClick={()=>kamerVerwijderen(k.k)}>🗑</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="card" style={{ borderTop:`3px solid ${C.groen}` }}>
              <div style={{ fontWeight:700, fontSize:13, marginBottom:14, color:C.groen }}>+ Nieuwe kamer toevoegen</div>
              <div style={{ display:"grid", gridTemplateColumns:"80px 1fr 1fr", gap:10, marginBottom:10 }}>
                <div><label className="fl">Kamer nr</label><input className="fi" value={nieuweKamer.k} onChange={e=>setNieuweKamer(p=>({...p,k:e.target.value}))} placeholder="1" style={{ fontSize:13 }} /></div>
                <div><label className="fl">Naam bewoner</label><input className="fi" value={nieuweKamer.naam} onChange={e=>setNieuweKamer(p=>({...p,naam:e.target.value}))} placeholder="Optioneel" style={{ fontSize:13 }} /></div>
                <div><label className="fl">Bedrijf</label><input className="fi" value={nieuweKamer.bedrijf} onChange={e=>setNieuweKamer(p=>({...p,bedrijf:e.target.value}))} placeholder="Optioneel" style={{ fontSize:13 }} /></div>
              </div>
              <div style={{ marginBottom:12 }}><label className="fl">Status</label><select className="fs" value={nieuweKamer.status} onChange={e=>setNieuweKamer(p=>({...p,status:e.target.value}))} style={{ fontSize:13 }}>{STATUSSEN.map(s=><option key={s}>{s}</option>)}</select></div>
              <button className="btn-g" style={{ width:"100%", padding:10, fontSize:13 }} onClick={kamerToevoegen} disabled={saving}>{saving?"⏳ Opslaan...":"✓ Kamer toevoegen"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KamerBewerken({ kamer, onSave, onCancel, saving }) {
  const [naam,setNaam]=useState(kamer.naam||"");
  const [bedrijf,setBedrijf]=useState(kamer.bedrijf||"");
  const [status,setStatus]=useState(kamer.status||"Beschikbaar");
  return (
    <div style={{ background:C.blauw+"08", borderRadius:8, padding:12, marginBottom:6, border:`1.5px solid ${C.blauw}` }}>
      <div style={{ fontSize:12, fontWeight:700, color:C.blauw, marginBottom:10 }}>Kamer {kamer.k} bewerken</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
        <input className="fi" value={naam} onChange={e=>setNaam(e.target.value)} placeholder="Naam bewoner" style={{ fontSize:12 }} />
        <input className="fi" value={bedrijf} onChange={e=>setBedrijf(e.target.value)} placeholder="Bedrijf" style={{ fontSize:12 }} />
      </div>
      <select className="fs" value={status} onChange={e=>setStatus(e.target.value)} style={{ fontSize:12, marginBottom:8 }}>{STATUSSEN.map(s=><option key={s}>{s}</option>)}</select>
      <div style={{ display:"flex", gap:8 }}>
        <button className="btn-b" style={{ flex:1, padding:"7px", fontSize:12 }} onClick={()=>onSave({naam,bedrijf,status})} disabled={saving}>{saving?"⏳":"✓ Opslaan"}</button>
        <button className="btn-out" style={{ padding:"7px 12px", fontSize:12 }} onClick={onCancel}>Annuleren</button>
      </div>
    </div>
  );
}

// ─── GEBRUIKERS BEHEER ────────────────────────────────────────────────────────

function GebruikersBeheer({ gebruikers, onUpdate, showToast }) {
  const [lijst, setLijst] = useState(gebruikers);
  const [nieuw, setNieuw] = useState({ naam:"", pin:"", rol:"collega" });
  const [bewerk, setBewerk] = useState(null);

  useEffect(() => { setLijst(gebruikers); }, [gebruikers]);

  function voegToe() {
    if (!nieuw.naam.trim()) { showToast("Vul een naam in", "err"); return; }
    if (nieuw.pin.length < 4) { showToast("Pincode moet minimaal 4 cijfers zijn", "err"); return; }
    if (lijst.some(g => g.naam.toLowerCase() === nieuw.naam.toLowerCase())) { showToast("Naam bestaat al", "err"); return; }
    const bijgewerkt = [...lijst, { naam: nieuw.naam.trim(), pin: nieuw.pin, rol: nieuw.rol }];
    onUpdate(bijgewerkt);
    setNieuw({ naam:"", pin:"", rol:"collega" });
    showToast(`✓ ${nieuw.naam} toegevoegd`);
  }

  function verwijder(naam) {
    if (naam === "Liset") { showToast("Liset kan niet verwijderd worden", "err"); return; }
    if (!window.confirm(`${naam} verwijderen?`)) return;
    onUpdate(lijst.filter(g => g.naam !== naam));
    showToast(`✓ ${naam} verwijderd`);
  }

  function slaBewerk(oud, updates) {
    const bijgewerkt = lijst.map(g => g.naam === oud ? { ...g, ...updates } : g);
    onUpdate(bijgewerkt);
    setBewerk(null);
    showToast("✓ Opgeslagen");
  }

  const rolKleur = { backoffice: C.blauw, huismeester: C.groen, collega: C.muted };
  const rolIcon  = { backoffice: "📊", huismeester: "🏠", collega: "👤" };

  return (
    <div style={{ maxWidth: 700 }}>
      <div className="card" style={{ marginBottom: 20, borderTop:`3px solid ${C.groen}` }}>
        <div style={{ fontWeight:700, fontSize:14, color:C.groen, marginBottom:16 }}>+ Nieuwe gebruiker toevoegen</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 120px 160px", gap:12, marginBottom:12 }}>
          <div><label className="fl">Naam</label><input className="fi" value={nieuw.naam} onChange={e=>setNieuw(p=>({...p,naam:e.target.value}))} placeholder="Voornaam" /></div>
          <div><label className="fl">Pincode</label><input className="fi" value={nieuw.pin} onChange={e=>setNieuw(p=>({...p,pin:e.target.value.replace(/\D/g,"")}))} placeholder="1234" maxLength={8} type="password" /></div>
          <div>
            <label className="fl">Rol</label>
            <select className="fs" value={nieuw.rol} onChange={e=>setNieuw(p=>({...p,rol:e.target.value}))}>
              <option value="collega">👤 Collega</option>
              <option value="huismeester">🏠 Huismeester</option>
              <option value="backoffice">📊 Backoffice</option>
            </select>
          </div>
        </div>
        <button className="btn-g" style={{ padding:"10px 24px" }} onClick={voegToe}>✓ Toevoegen</button>
      </div>

      <div className="card">
        <div style={{ fontWeight:700, fontSize:14, color:C.blauw, marginBottom:16 }}>Alle gebruikers ({lijst.length})</div>
        {lijst.map(g => (
          <div key={g.naam}>
            {bewerk===g.naam ? (
              <GebruikerBewerken g={g} onSave={u=>slaBewerk(g.naam,u)} onCancel={()=>setBewerk(null)} />
            ) : (
              <div className="br" style={{ marginBottom:8 }}>
                <div style={{ width:32, height:32, borderRadius:8, background:rolKleur[g.rol]+"18", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{rolIcon[g.rol]}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, fontSize:14, color:C.text }}>{g.naam}</div>
                  <div style={{ fontSize:11, color:rolKleur[g.rol], fontWeight:600, textTransform:"capitalize" }}>{g.rol}</div>
                </div>
                <div style={{ fontSize:13, color:C.muted, fontFamily:"monospace", background:C.bg, padding:"4px 10px", borderRadius:6 }}>••••</div>
                <button className="btn-out" style={{ padding:"5px 12px", fontSize:12 }} onClick={()=>setBewerk(g.naam)}>✏️ Bewerken</button>
                {g.naam!=="Liset" && <button className="btn-r" style={{ padding:"5px 12px", fontSize:12 }} onClick={()=>verwijder(g.naam)}>🗑</button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GebruikerBewerken({ g, onSave, onCancel }) {
  const [naam, setNaam] = useState(g.naam);
  const [pin, setPin] = useState(g.pin);
  const [rol, setRol] = useState(g.rol);
  return (
    <div style={{ background:C.blauw+"08", border:`1.5px solid ${C.blauw}`, borderRadius:10, padding:14, marginBottom:8 }}>
      <div style={{ fontSize:12, fontWeight:700, color:C.blauw, marginBottom:12 }}>{g.naam} bewerken</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 120px 160px", gap:10, marginBottom:10 }}>
        <div><label className="fl">Naam</label><input className="fi" value={naam} onChange={e=>setNaam(e.target.value)} style={{ fontSize:13 }} /></div>
        <div><label className="fl">Pincode</label><input className="fi" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,""))} type="text" maxLength={8} style={{ fontSize:13 }} /></div>
        <div><label className="fl">Rol</label>
          <select className="fs" value={rol} onChange={e=>setRol(e.target.value)} style={{ fontSize:13 }}>
            <option value="collega">👤 Collega</option>
            <option value="huismeester">🏠 Huismeester</option>
            <option value="backoffice">📊 Backoffice</option>
          </select>
        </div>
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button className="btn-b" style={{ padding:"8px 20px", fontSize:13 }} onClick={()=>onSave({naam,pin,rol})}>✓ Opslaan</button>
        <button className="btn-out" style={{ padding:"8px 16px", fontSize:13 }} onClick={onCancel}>Annuleren</button>
      </div>
    </div>
  );
}

function LogView({ meldingen, houses }) {
  function exportCSV() {
    let csv="Datum,Tijd,Type,Medewerker,Adres,Kamer,Wie regelt,Ingediend door,Status,Sleutel terug,Kamer schoon,Notitie\n";
    meldingen.forEach(m=>{
      const h=houses.find(h=>h.id===m.woning_id);
      const dt=m.created_at?new Date(m.created_at):new Date();
      csv+=`"${fmtDate(dt)}","${fmtTime(dt)}","${m.type}","${m.medewerker}","${h?.adres||""}","${m.kamer}","${m.wie_regelt||""}","${m.ingediend_door}","${m.status}","${m.sleutel_terug||""}","${m.kamer_schoon||""}","${m.notitie||""}"\n`;
    });
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`KTP_meldingen_${todayISO()}.csv`;a.click();URL.revokeObjectURL(url);
  }
  return (
    <div>
      <SectieHeader titel="Volledig log" sub={`${meldingen.length} meldingen totaal`} actie={<button className="btn-out" onClick={exportCSV}>⬇ Exporteer CSV</button>} />
      {meldingen.length===0 ? <div className="card" style={{ textAlign:"center", padding:"50px" }}><div style={{ fontSize:40, marginBottom:10 }}>📝</div><div style={{ color:C.muted }}>Nog geen meldingen</div></div> : (
        <div className="card" style={{ padding:0, overflow:"hidden" }}>
          <div style={{ display:"grid", gridTemplateColumns:"80px 60px 100px 1fr 1fr 50px 80px 80px", padding:"10px 16px", fontSize:10, fontWeight:700, color:C.muted, letterSpacing:"0.6px", textTransform:"uppercase", borderBottom:`1px solid ${C.border}`, background:C.bg }}>
            <span>Datum</span><span>Tijd</span><span>Type</span><span>Medewerker</span><span>Adres</span><span>Kamer</span><span>Door</span><span>Status</span>
          </div>
          {meldingen.map((m,i)=>{
            const h=houses.find(h=>h.id===m.woning_id);
            const tc={aankomst:C.groen,vertrek:"#ef4444",reservering:C.blauw,overig:C.muted};
            const dt=m.created_at?new Date(m.created_at):new Date();
            return(
              <div key={m.id} style={{ display:"grid", gridTemplateColumns:"80px 60px 100px 1fr 1fr 50px 80px 80px", padding:"10px 16px", fontSize:12, borderBottom:i<meldingen.length-1?`1px solid ${C.border}`:"none", alignItems:"center", background:i%2===0?"white":C.bg+"60" }}>
                <span style={{ color:C.muted }}>{fmtDate(dt)}</span>
                <span style={{ color:C.muted }}>{fmtTime(dt)}</span>
                <span style={{ color:tc[m.type]||C.muted, fontWeight:700, fontSize:10, textTransform:"uppercase" }}>{m.type}</span>
                <span style={{ fontWeight:600, color:C.text }}>{m.medewerker}</span>
                <span style={{ color:C.muted }}>{h?.adres}</span>
                <span style={{ fontFamily:"monospace", color:C.muted }}>K{m.kamer}</span>
                <span style={{ color:C.muted }}>{m.ingediend_door}</span>
                <span style={{ fontSize:10, fontWeight:700, color:m.status==="open"?C.blauw:C.groen }}>{(m.status||"").toUpperCase()}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
