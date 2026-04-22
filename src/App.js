import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { INITIAL_HOUSES } from "./data";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const STATUS_MAP = {
  "Lopend":           { bg: "#16a34a22", text: "#16a34a", dot: "#16a34a" },
  "Beschikbaar":      { bg: "#3b82f622", text: "#3b82f6", dot: "#3b82f6" },
  "Gereserveerd":     { bg: "#f59e0b22", text: "#d97706", dot: "#f59e0b" },
  "Controle":         { bg: "#ef444422", text: "#dc2626", dot: "#ef4444" },
  "Niet beschikbaar": { bg: "#8b5cf622", text: "#7c3aed", dot: "#8b5cf6" },
  "Moet aan het werk":{ bg: "#f9731622", text: "#ea580c", dot: "#f97316" },
  "Vertrokken":       { bg: "#71717a22", text: "#52525b", dot: "#71717a" },
};

const WIE_OPTIES = ["NW CB", "NW HK", "Huismeester", "Zelf", "Anders"];

function fmtDate(d) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit" });
}
function fmtTime(d) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}
function fmtFull(d) { return `${fmtDate(d)} ${fmtTime(d)}`; }
function todayISO() { return new Date().toISOString().slice(0, 10); }

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const [rol, setRol] = useState(null);
  const [naam, setNaam] = useState("");
  const [naamInput, setNaamInput] = useState("");

  const [houses, setHouses] = useState([]);
  const [meldingen, setMeldingen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("melding");
  const [toast, setToast] = useState(null);

  // ── Laad woningen uit Supabase ──
  const loadHouses = useCallback(async () => {
    const { data, error } = await supabase
      .from("woningen")
      .select("*")
      .order("id");
    if (error) { console.error("Fout bij laden woningen:", error); return; }
    // kamers is opgeslagen als JSON in Supabase
    setHouses(data.map(h => ({ ...h, kamers: h.kamers || [] })));
  }, []);

  // ── Laad meldingen uit Supabase ──
  const loadMeldingen = useCallback(async () => {
    const { data, error } = await supabase
      .from("meldingen")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) { console.error("Fout bij laden meldingen:", error); return; }
    setMeldingen(data);
  }, []);

  // ── Initieel laden ──
  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([loadHouses(), loadMeldingen()]);
      setLoading(false);
    }
    init();
  }, [loadHouses, loadMeldingen]);

  // ── Realtime updates: nieuwe meldingen verschijnen direct bij iedereen ──
  useEffect(() => {
    const meldingenSub = supabase
      .channel("meldingen-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "meldingen" },
        () => loadMeldingen()
      )
      .subscribe();

    const woningenSub = supabase
      .channel("woningen-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "woningen" },
        () => loadHouses()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(meldingenSub);
      supabase.removeChannel(woningenSub);
    };
  }, [loadHouses, loadMeldingen]);

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  function login(r) {
    if (!naamInput.trim()) return;
    setNaam(naamInput.trim());
    setRol(r);
    setTab(r === "collega" ? "melding" : r === "huismeester" ? "taken" : "woningen");
  }

  function logout() { setRol(null); setNaam(""); setNaamInput(""); }

  // ── Nieuwe melding opslaan in Supabase + woning updaten ──
  async function addMelding(m) {
    // 1. Sla melding op
    const { error: mErr } = await supabase.from("meldingen").insert([{
      type: m.type,
      medewerker: m.medewerker,
      datum: m.datum,
      woning_id: m.huisId,
      kamer: m.kamer,
      wie_regelt: m.wieRegelt || null,
      sleutel_terug: m.sleutelTerug || null,
      kamer_schoon: m.kamerSchoon || null,
      sleutel_aantal: m.sleutelAantal || null,
      opmerkingen: m.opmerkingen || null,
      ingediend_door: naam,
      status: "open",
    }]);
    if (mErr) { showToast("Fout bij opslaan melding", "err"); console.error(mErr); return; }

    // 2. Update kamer in woning
    const huis = houses.find(h => h.id === m.huisId);
    if (huis) {
      const nieuweKamers = huis.kamers.map(k => {
        if (k.k !== m.kamer) return k;
        if (m.type === "aankomst")    return { ...k, naam: m.medewerker, status: "Lopend" };
        if (m.type === "reservering") return { ...k, naam: m.medewerker, status: "Gereserveerd" };
        if (m.type === "vertrek") {
          const heeftProbleem = m.sleutelTerug === "nee" || m.kamerSchoon === "nee";
          return { ...k, naam: heeftProbleem ? k.naam : "", status: heeftProbleem ? "Controle" : "Beschikbaar" };
        }
        return k;
      });
      await supabase.from("woningen").update({ kamers: nieuweKamers }).eq("id", m.huisId);
    }

    showToast("✓ Melding verzonden naar huismeester & backoffice");
  }

  // ── Melding status updaten (huismeester / backoffice) ──
  async function updateMeldingStatus(id, newStatus, notitie = "") {
    const { error } = await supabase.from("meldingen").update({
      status: newStatus,
      afgehandeld_door: naam,
      afgehandeld_op: new Date().toISOString(),
      notitie: notitie || null,
    }).eq("id", id);
    if (error) { showToast("Fout bij updaten", "err"); console.error(error); }
    else showToast("✓ Status bijgewerkt");
  }

  const openMeldingen = meldingen.filter(m => m.status === "open");
  const mijnMeldingen = meldingen.filter(m => m.ingediend_door === naam);

  if (loading) return <LoadingScreen />;
  if (!rol) return <LoginScreen naamInput={naamInput} setNaamInput={setNaamInput} onLogin={login} />;

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "#e8eaf0", fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #1a1d27; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        button { cursor: pointer; font-family: inherit; }
        input, textarea, select { font-family: inherit; }
        .field-label { font-size: 11px; font-weight: 600; color: #6b7280; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 6px; display: block; }
        .field-input { width: 100%; background: #1e2130; border: 1.5px solid #2d3148; border-radius: 8px; color: #e8eaf0; padding: 10px 14px; font-size: 14px; outline: none; transition: border 0.2s; }
        .field-input:focus { border-color: #f97316; }
        .field-select { width: 100%; background: #1e2130; border: 1.5px solid #2d3148; border-radius: 8px; color: #e8eaf0; padding: 10px 14px; font-size: 14px; outline: none; appearance: none; }
        .field-select:focus { border-color: #f97316; }
        .card { background: #1a1d27; border: 1px solid #23263a; border-radius: 14px; padding: 22px; }
        .btn-orange { background: #f97316; color: white; border: none; border-radius: 8px; padding: 11px 22px; font-size: 14px; font-weight: 600; transition: background 0.2s; }
        .btn-orange:hover { background: #ea6c0a; }
        .btn-ghost { background: transparent; border: 1.5px solid #2d3148; color: #9ca3af; border-radius: 8px; padding: 9px 18px; font-size: 13px; font-weight: 500; transition: all 0.2s; }
        .btn-ghost:hover { border-color: #f97316; color: #f97316; }
        .tab-pill { background: none; border: none; color: #6b7280; padding: 8px 18px; border-radius: 20px; font-size: 13px; font-weight: 500; transition: all 0.2s; }
        .tab-pill.active { background: #f9731620; color: #f97316; font-weight: 600; }
        .badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
        .melding-card { background: #1e2130; border: 1px solid #2d3148; border-radius: 10px; padding: 16px; margin-bottom: 10px; }
        .radio-tile { border: 2px solid #2d3148; border-radius: 10px; padding: 16px; text-align: center; cursor: pointer; transition: all 0.2s; flex: 1; }
        .radio-tile.selected { border-color: #f97316; background: #f9731612; }
        .radio-tile:hover { border-color: #4d5480; }
        .type-icon { font-size: 28px; display: block; margin-bottom: 6px; }
        .check-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #23263a; }
        .check-row:last-child { border-bottom: none; }
        .check-btn { padding: 5px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; border: 1.5px solid; cursor: pointer; transition: all 0.15s; }
        .check-btn.ja { border-color: #16a34a; color: #16a34a; background: transparent; }
        .check-btn.ja.sel { background: #16a34a; color: white; }
        .check-btn.nee { border-color: #ef4444; color: #ef4444; background: transparent; }
        .check-btn.nee.sel { background: #ef4444; color: white; }
      `}</style>

      {/* TOAST */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: toast.type === "ok" ? "#16a34a" : "#dc2626", color: "white", padding: "12px 22px", borderRadius: 10, fontWeight: 600, fontSize: 14, boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}>
          {toast.msg}
        </div>
      )}

      {/* TOPBAR */}
      <div style={{ background: "#13151f", borderBottom: "1px solid #1e2130", padding: "0 28px", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", gap: 16, height: 56 }}>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.5px", flexShrink: 0 }}>
            <span style={{ color: "#f97316" }}>KTP</span> <span style={{ color: "#e8eaf0" }}>Interflex</span>
          </div>

          <div style={{ display: "flex", gap: 2, flex: 1, justifyContent: "center", flexWrap: "wrap" }}>
            {rol === "collega" && (
              <>
                <button className={`tab-pill ${tab === "melding" ? "active" : ""}`} onClick={() => setTab("melding")}>👤 Melding</button>
                <button className={`tab-pill ${tab === "mijn" ? "active" : ""}`} onClick={() => setTab("mijn")}>
                  📋 Mijn meldingen {mijnMeldingen.length > 0 && <span style={{ background: "#f97316", color: "white", borderRadius: 10, padding: "1px 6px", fontSize: 11, marginLeft: 4 }}>{mijnMeldingen.length}</span>}
                </button>
                <button className={`tab-pill ${tab === "woningen" ? "active" : ""}`} onClick={() => setTab("woningen")}>🏠 Woningen</button>
              </>
            )}
            {rol === "huismeester" && (
              <>
                <button className={`tab-pill ${tab === "taken" ? "active" : ""}`} onClick={() => setTab("taken")}>
                  🔧 Taken {openMeldingen.length > 0 && <span style={{ background: "#ef4444", color: "white", borderRadius: 10, padding: "1px 6px", fontSize: 11, marginLeft: 4 }}>{openMeldingen.length}</span>}
                </button>
                <button className={`tab-pill ${tab === "woningen" ? "active" : ""}`} onClick={() => setTab("woningen")}>🏠 Woningen</button>
                <button className={`tab-pill ${tab === "planning" ? "active" : ""}`} onClick={() => setTab("planning")}>📊 Status</button>
              </>
            )}
            {rol === "backoffice" && (
              <>
                <button className={`tab-pill ${tab === "woningen" ? "active" : ""}`} onClick={() => setTab("woningen")}>🏠 Woningen</button>
                <button className={`tab-pill ${tab === "planning" ? "active" : ""}`} onClick={() => setTab("planning")}>📊 Status</button>
                <button className={`tab-pill ${tab === "inbox" ? "active" : ""}`} onClick={() => setTab("inbox")}>
                  📨 Inbox {openMeldingen.length > 0 && <span style={{ background: "#ef4444", color: "white", borderRadius: 10, padding: "1px 6px", fontSize: 11, marginLeft: 4 }}>{openMeldingen.length}</span>}
                </button>
                <button className={`tab-pill ${tab === "log" ? "active" : ""}`} onClick={() => setTab("log")}>📝 Log</button>
              </>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              {rol === "collega" ? "👤" : rol === "huismeester" ? "🏠" : "📊"} <span style={{ color: "#9ca3af" }}>{naam}</span>
            </span>
            <button className="btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={logout}>Uit</button>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px" }}>
        {rol === "collega" && tab === "melding" && (
          <MeldingForm houses={houses} onSubmit={addMelding} showToast={showToast} />
        )}
        {rol === "collega" && tab === "mijn" && (
          <MijnMeldingen meldingen={mijnMeldingen} houses={houses} />
        )}
        {tab === "woningen" && <WoningenDetail houses={houses} />}
        {tab === "planning" && <PlanningView houses={houses} />}
        {rol === "huismeester" && tab === "taken" && (
          <HuismeesterTaken meldingen={meldingen} houses={houses} onUpdate={updateMeldingStatus} naam={naam} />
        )}
        {rol === "backoffice" && tab === "inbox" && (
          <BackofficeInbox meldingen={meldingen} houses={houses} onUpdate={updateMeldingStatus} naam={naam} showToast={showToast} />
        )}
        {rol === "backoffice" && tab === "log" && (
          <LogView meldingen={meldingen} houses={houses} />
        )}
      </div>
    </div>
  );
}

// ─── LOADING ──────────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
        <div style={{ color: "#6b7280", fontSize: 14 }}>Verbinden met database...</div>
      </div>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────

function LoginScreen({ naamInput, setNaamInput, onLogin }) {
  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap'); * { box-sizing: border-box; margin: 0; padding: 0; }`}</style>
      <div style={{ width: 460, padding: 40, background: "#1a1d27", borderRadius: 20, border: "1px solid #23263a", boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontWeight: 800, fontSize: 28, letterSpacing: "-1px", marginBottom: 6 }}>
            <span style={{ color: "#f97316" }}>KTP</span> <span style={{ color: "#e8eaf0" }}>Interflex</span>
          </div>
          <div style={{ fontSize: 13, color: "#6b7280" }}>Woningbeheer systeem</div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b7280", letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: 8 }}>Jouw naam</label>
          <input
            value={naamInput} onChange={e => setNaamInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && naamInput.trim()) onLogin("collega"); }}
            placeholder="Voor- en achternaam"
            style={{ width: "100%", background: "#0f1117", border: "1.5px solid #2d3148", borderRadius: 10, color: "#e8eaf0", padding: "12px 16px", fontSize: 15, outline: "none" }}
          />
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14, textAlign: "center" }}>Log in als:</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[
            { rol: "collega", icon: "👤", label: "Collega", sub: "Melding doorgeven" },
            { rol: "huismeester", icon: "🏠", label: "Huismeester", sub: "Taken afhandelen" },
            { rol: "backoffice", icon: "📊", label: "Backoffice", sub: "Planning & salaris" },
          ].map(({ rol, icon, label, sub }) => (
            <button key={rol} onClick={() => onLogin(rol)} disabled={!naamInput.trim()}
              style={{ background: naamInput.trim() ? "#1e2130" : "#15181f", border: "1.5px solid #2d3148", borderRadius: 12, padding: "16px 10px", color: "#e8eaf0", cursor: naamInput.trim() ? "pointer" : "not-allowed", opacity: naamInput.trim() ? 1 : 0.4, transition: "all 0.2s" }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>{icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{sub}</div>
            </button>
          ))}
        </div>
      </div>
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
  const [wieRegelt, setWieRegelt] = useState("NW CB");
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
    if (type === "vertrek" && (sleutelTerug === null || kamerSchoon === null)) {
      showToast("Vul sleutel & schoonmaak in", "err"); return;
    }
    setSaving(true);
    await onSubmit({ type, medewerker: medewerker.trim(), datum, huisId: Number(huisId), kamer, wieRegelt, sleutelTerug, kamerSchoon, sleutelAantal, opmerkingen });
    setSaving(false);
    setMedewerker(""); setOpmerkingen(""); setKamer(""); setSleutelTerug(null); setKamerSchoon(null);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2500);
  }

  if (submitted) return (
    <div className="card" style={{ textAlign: "center", padding: "80px 40px", maxWidth: 600, margin: "0 auto" }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a", marginBottom: 8 }}>Melding verzonden!</div>
      <div style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>De huismeester en backoffice zijn op de hoogte gebracht.</div>
      <button className="btn-orange" onClick={() => setSubmitted(false)}>Nieuwe melding</button>
    </div>
  );

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Melding doorgeven</h2>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>Geef een aankomst, vertrek of reservering door.</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <label className="field-label">Wat wil je melden?</label>
        <div style={{ display: "flex", gap: 10 }}>
          {[{ id: "aankomst", icon: "🚗", label: "AANKOMST" }, { id: "vertrek", icon: "🧳", label: "VERTREK" }, { id: "reservering", icon: "📅", label: "RESERVERING" }, { id: "overig", icon: "💬", label: "OVERIG" }].map(t => (
            <div key={t.id} className={`radio-tile ${type === t.id ? "selected" : ""}`} onClick={() => setType(t.id)}>
              <span className="type-icon">{t.icon}</span>
              <div style={{ fontSize: 11, fontWeight: 700, color: type === t.id ? "#f97316" : "#6b7280", letterSpacing: "0.8px" }}>{t.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 16 }}>
        <div>
          <label className="field-label">Naam medewerker</label>
          <input className="field-input" value={medewerker} onChange={e => setMedewerker(e.target.value)} placeholder="Voor- en achternaam" />
        </div>
        <div>
          <label className="field-label">Datum</label>
          <input className="field-input" type="date" value={datum} onChange={e => setDatum(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Woning</label>
          <select className="field-select" value={huisId} onChange={e => { setHuisId(e.target.value); setKamer(""); }}>
            {houses.map(h => <option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Kamernummer</label>
          <select className="field-select" value={kamer} onChange={e => setKamer(e.target.value)}>
            <option value="">Selecteer kamer</option>
            {selectedHouse?.kamers.map(k => (
              <option key={k.k} value={k.k}>Kamer {k.k} {k.naam ? `– ${k.naam}` : "(leeg)"} [{k.status}]</option>
            ))}
          </select>
        </div>
      </div>

      {(type === "aankomst" || type === "reservering") && (
        <div className="card" style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <div>
            <label className="field-label">Wie regelt aankomst?</label>
            <select className="field-select" value={wieRegelt} onChange={e => setWieRegelt(e.target.value)}>
              {WIE_OPTIES.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          {type === "aankomst" && (
            <div>
              <label className="field-label">Aantal sleutels ontvangen</label>
              <select className="field-select" value={sleutelAantal} onChange={e => setSleutelAantal(Number(e.target.value))}>
                {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {type === "vertrek" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label className="field-label">Controlelijst bij vertrek</label>
          <div className="check-row">
            <span style={{ flex: 1, fontSize: 14 }}>🔑 Sleutel(s) teruggegeven?</span>
            <div style={{ display: "flex", gap: 8 }}>
              {["ja", "nee"].map(v => (
                <button key={v} className={`check-btn ${v} ${sleutelTerug === v ? "sel" : ""}`} onClick={() => setSleutelTerug(v)}>{v}</button>
              ))}
            </div>
          </div>
          <div className="check-row">
            <span style={{ flex: 1, fontSize: 14 }}>🧹 Kamer schoon achtergelaten?</span>
            <div style={{ display: "flex", gap: 8 }}>
              {["ja", "nee"].map(v => (
                <button key={v} className={`check-btn ${v} ${kamerSchoon === v ? "sel" : ""}`} onClick={() => setKamerSchoon(v)}>{v}</button>
              ))}
            </div>
          </div>
          {sleutelTerug === "nee" && (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "#ef444412", border: "1px solid #ef444440", borderRadius: 8, fontSize: 13, color: "#fca5a5" }}>
              ⚠️ Sleutel niet terug → backoffice wordt geïnformeerd om €50 in te houden van borg
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <label className="field-label">Opmerkingen</label>
        <textarea className="field-input" value={opmerkingen} onChange={e => setOpmerkingen(e.target.value)} placeholder="Eventuele bijzonderheden..." rows={3} style={{ resize: "vertical" }} />
      </div>

      <button className="btn-orange" style={{ width: "100%", padding: 14, fontSize: 15 }} onClick={handleSubmit} disabled={saving}>
        {saving ? "⏳ Opslaan..." : `✓ ${type.charAt(0).toUpperCase() + type.slice(1)} doorgeven`}
      </button>
    </div>
  );
}

// ─── MIJN MELDINGEN ───────────────────────────────────────────────────────────

function MijnMeldingen({ meldingen, houses }) {
  if (meldingen.length === 0) return (
    <div className="card" style={{ textAlign: "center", padding: "60px 20px", color: "#4b5563" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
      <div>Je hebt nog geen meldingen ingediend</div>
    </div>
  );
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Mijn meldingen</h2>
      {meldingen.map(m => <MeldingItem key={m.id} m={m} houses={houses} />)}
    </div>
  );
}

// ─── MELDING ITEM ─────────────────────────────────────────────────────────────

function MeldingItem({ m, houses }) {
  const typeIcons = { aankomst: "🚗", vertrek: "🧳", reservering: "📅", overig: "💬" };
  const typeColors = { aankomst: "#16a34a", vertrek: "#ef4444", reservering: "#f59e0b", overig: "#6b7280" };
  const huis = houses.find(h => h.id === m.woning_id);
  const ts = m.created_at;

  return (
    <div className="melding-card" style={{ borderLeft: `3px solid ${m.sleutel_terug === "nee" || m.kamer_schoon === "nee" ? "#ef4444" : typeColors[m.type] || "#6b7280"}` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontSize: 26 }}>{typeIcons[m.type] || "💬"}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{m.medewerker}</span>
            <span className="badge" style={{ background: (typeColors[m.type] || "#6b7280") + "22", color: typeColors[m.type] || "#6b7280" }}>{(m.type || "").toUpperCase()}</span>
            <span className="badge" style={{ background: m.status === "open" ? "#f9731622" : "#16a34a22", color: m.status === "open" ? "#f97316" : "#16a34a", marginLeft: "auto" }}>
              {(m.status || "").toUpperCase()}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "#9ca3af" }}>
            📍 {huis?.adres}, {huis?.stad} · Kamer {m.kamer} · {ts ? fmtFull(ts) : ""}
          </div>
          {m.type === "vertrek" && (
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <span className="badge" style={{ background: m.sleutel_terug === "ja" ? "#16a34a22" : "#ef444422", color: m.sleutel_terug === "ja" ? "#16a34a" : "#ef4444" }}>
                🔑 Sleutel: {m.sleutel_terug || "?"}
              </span>
              <span className="badge" style={{ background: m.kamer_schoon === "ja" ? "#16a34a22" : "#ef444422", color: m.kamer_schoon === "ja" ? "#16a34a" : "#ef4444" }}>
                🧹 Schoon: {m.kamer_schoon || "?"}
              </span>
            </div>
          )}
          {m.opmerkingen && <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6, fontStyle: "italic" }}>"{m.opmerkingen}"</div>}
          {m.notitie && <div style={{ fontSize: 13, color: "#f59e0b", marginTop: 4 }}>📝 {m.notitie}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── HUISMEESTER TAKEN ────────────────────────────────────────────────────────

function HuismeesterTaken({ meldingen, houses, onUpdate, naam }) {
  const [notitieMap, setNotitieMap] = useState({});
  const open = meldingen.filter(m => m.status === "open");
  const afgehandeld = meldingen.filter(m => m.status !== "open" && m.afgehandeld_door === naam);

  function taken(m) {
    const t = [];
    if (m.type === "aankomst") t.push({ icon: "🛏", tekst: `Kamer ${m.kamer} gereedmaken voor ${m.medewerker}` });
    if (m.type === "vertrek" && m.kamer_schoon === "nee") t.push({ icon: "🧹", tekst: `Kamer ${m.kamer} schoonmaken (niet schoon achtergelaten)`, urgent: true });
    if (m.type === "vertrek") t.push({ icon: "🔍", tekst: `Kamer ${m.kamer} controleren na vertrek ${m.medewerker}` });
    if (m.type === "reservering") t.push({ icon: "📅", tekst: `Kamer ${m.kamer} klaarzetten voor ${m.medewerker} (aankomst ${m.datum})` });
    if (m.opmerkingen) t.push({ icon: "📝", tekst: m.opmerkingen });
    return t;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Openstaande taken</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>Meldingen die jouw actie vereisen</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ textAlign: "center", background: "#ef444415", border: "1px solid #ef444430", borderRadius: 10, padding: "10px 20px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#ef4444" }}>{open.length}</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Open</div>
          </div>
          <div style={{ textAlign: "center", background: "#16a34a15", border: "1px solid #16a34a30", borderRadius: 10, padding: "10px 20px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a" }}>{afgehandeld.length}</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Afgehandeld</div>
          </div>
        </div>
      </div>

      {open.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "60px 20px", color: "#4b5563" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div style={{ fontWeight: 600 }}>Alles afgehandeld!</div>
        </div>
      ) : open.map(m => {
        const huis = houses.find(h => h.id === m.woning_id);
        const takenLijst = taken(m);
        return (
          <div key={m.id} className="melding-card" style={{ marginBottom: 14, borderLeft: "3px solid #f97316" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>{m.type === "aankomst" ? "🚗" : m.type === "vertrek" ? "🧳" : "📅"}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{m.medewerker} — <span style={{ color: "#f97316", textTransform: "uppercase", fontSize: 12 }}>{m.type}</span></div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>📍 {huis?.adres}, {huis?.stad} · K{m.kamer} · Door: {m.ingediend_door} · {m.created_at ? fmtFull(m.created_at) : ""}</div>
              </div>
            </div>
            <div style={{ background: "#0f1117", borderRadius: 8, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 10, letterSpacing: "0.8px" }}>TE DOEN:</div>
              {takenLijst.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: i < takenLijst.length - 1 ? "1px solid #1e2130" : "none", alignItems: "center" }}>
                  <span style={{ fontSize: 16 }}>{t.icon}</span>
                  <span style={{ fontSize: 14, flex: 1 }}>{t.tekst}</span>
                  {t.urgent && <span style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", background: "#ef444420", padding: "2px 8px", borderRadius: 4 }}>URGENT</span>}
                </div>
              ))}
              {m.type === "vertrek" && (
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <span className="badge" style={{ background: m.sleutel_terug === "ja" ? "#16a34a22" : "#ef444422", color: m.sleutel_terug === "ja" ? "#16a34a" : "#ef4444" }}>🔑 Sleutel: {m.sleutel_terug}</span>
                  <span className="badge" style={{ background: m.kamer_schoon === "ja" ? "#16a34a22" : "#ef444422", color: m.kamer_schoon === "ja" ? "#16a34a" : "#ef4444" }}>🧹 Schoon: {m.kamer_schoon}</span>
                </div>
              )}
            </div>
            <input className="field-input" value={notitieMap[m.id] || ""} onChange={e => setNotitieMap(p => ({ ...p, [m.id]: e.target.value }))} placeholder="Optionele notitie..." style={{ fontSize: 13, marginBottom: 10 }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-orange" style={{ flex: 1 }} onClick={() => onUpdate(m.id, "afgehandeld", notitieMap[m.id] || "")}>✓ Afgehandeld</button>
              <button className="btn-ghost" onClick={() => onUpdate(m.id, "in_behandeling", notitieMap[m.id] || "")}>In behandeling</button>
            </div>
          </div>
        );
      })}

      {afgehandeld.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#4b5563", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Eerder afgehandeld</h3>
          {afgehandeld.slice(0, 5).map(m => <MeldingItem key={m.id} m={m} houses={houses} />)}
        </div>
      )}
    </div>
  );
}

// ─── BACKOFFICE INBOX ─────────────────────────────────────────────────────────

function BackofficeInbox({ meldingen, houses, onUpdate, naam, showToast }) {
  const [notitieMap, setNotitieMap] = useState({});
  const [filter, setFilter] = useState("open");
  const actieMeldingen = meldingen.filter(m => m.sleutel_terug === "nee" || m.kamer_schoon === "nee");
  const filtered = meldingen.filter(m => filter === "open" ? m.status === "open" : filter === "actie" ? (m.sleutel_terug === "nee" || m.kamer_schoon === "nee") : true);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Backoffice Inbox</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>Meldingen met administratieve of salaris consequenties</p>
        </div>
        {actieMeldingen.length > 0 && (
          <div style={{ marginLeft: "auto", background: "#ef444415", border: "1px solid #ef444440", borderRadius: 10, padding: "10px 18px", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#ef4444" }}>{actieMeldingen.length}</div>
            <div style={{ fontSize: 10, color: "#6b7280" }}>Salarisactie</div>
          </div>
        )}
      </div>

      {actieMeldingen.length > 0 && (
        <div style={{ background: "#ef444412", border: "1px solid #ef444430", borderRadius: 12, padding: "14px 18px", marginBottom: 20 }}>
          <div style={{ fontWeight: 700, color: "#fca5a5", marginBottom: 8, fontSize: 14 }}>⚠️ Salarisverwerking vereist</div>
          {actieMeldingen.map(m => {
            const huis = houses.find(h => h.id === m.woning_id);
            return (
              <div key={m.id} style={{ fontSize: 13, color: "#fca5a5", marginBottom: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span>• {m.medewerker} ({huis?.adres}, K{m.kamer}):</span>
                {m.sleutel_terug === "nee" && <span style={{ background: "#ef444430", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>🔑 Sleutel niet terug → €50 inhouden</span>}
                {m.kamer_schoon === "nee" && <span style={{ background: "#f59e0b30", padding: "2px 8px", borderRadius: 4, fontSize: 11, color: "#fcd34d" }}>🧹 Kamer niet schoon → schoonmaakkosten</span>}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {[["open", "Open"], ["actie", "Actie vereist"], ["alle", "Alle"]].map(([v, l]) => (
          <button key={v} className={`tab-pill ${filter === v ? "active" : ""}`} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>

      {filtered.map(m => {
        const huis = houses.find(h => h.id === m.woning_id);
        const needsActie = m.sleutel_terug === "nee" || m.kamer_schoon === "nee";
        return (
          <div key={m.id} className="melding-card" style={{ marginBottom: 12, borderLeft: `3px solid ${needsActie ? "#ef4444" : "#3b82f6"}` }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 22 }}>{m.type === "aankomst" ? "🚗" : m.type === "vertrek" ? "🧳" : "📅"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>{m.medewerker}</span>
                  <span className="badge" style={{ background: "#1e2130", color: "#9ca3af", fontSize: 10 }}>{(m.type || "").toUpperCase()}</span>
                  {needsActie && <span className="badge" style={{ background: "#ef444422", color: "#ef4444", fontSize: 10 }}>⚠️ ACTIE SALARIS</span>}
                  <span className="badge" style={{ background: m.status === "open" ? "#f9731622" : "#16a34a22", color: m.status === "open" ? "#f97316" : "#16a34a", marginLeft: "auto", fontSize: 10 }}>{(m.status || "").toUpperCase()}</span>
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>📍 {huis?.adres}, {huis?.stad} · K{m.kamer} · {m.datum} · Door: {m.ingediend_door}</div>
              </div>
            </div>
            <div style={{ background: "#0f1117", borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 8, letterSpacing: "0.8px" }}>ADMINISTRATIEVE ACTIES:</div>
              {m.type === "aankomst" && <div style={{ fontSize: 13, color: "#9ca3af" }}>✅ Kamer {m.kamer} bijgewerkt naar <strong style={{ color: "#16a34a" }}>Lopend</strong> — huuraftrek actief per {m.datum}</div>}
              {m.type === "reservering" && <div style={{ fontSize: 13, color: "#9ca3af" }}>📅 Kamer {m.kamer} gereserveerd voor {m.medewerker} — aankomst {m.datum}</div>}
              {m.type === "vertrek" && (
                <>
                  <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 6 }}>
                    {m.sleutel_terug === "nee" ? "🔑❌ Sleutel " : "🔑✅ Sleutel "}
                    {m.sleutel_terug === "nee" ? <strong style={{ color: "#ef4444" }}>NIET terug → €50 inhouden van borg</strong> : <span style={{ color: "#16a34a" }}>teruggegeven</span>}
                  </div>
                  <div style={{ fontSize: 13, color: "#9ca3af" }}>
                    {m.kamer_schoon === "nee" ? "🧹❌ Kamer " : "🧹✅ Kamer "}
                    {m.kamer_schoon === "nee" ? <strong style={{ color: "#f59e0b" }}>NIET schoon → schoonmaakkosten verwerken</strong> : <span style={{ color: "#16a34a" }}>schoon achtergelaten</span>}
                  </div>
                </>
              )}
            </div>
            {m.status === "open" && (
              <>
                <input className="field-input" value={notitieMap[m.id] || ""} onChange={e => setNotitieMap(p => ({ ...p, [m.id]: e.target.value }))} placeholder="Notitie bij verwerking..." style={{ fontSize: 13, marginBottom: 10 }} />
                <button className="btn-orange" style={{ width: "100%" }} onClick={() => onUpdate(m.id, "verwerkt", notitieMap[m.id] || "")}>✓ Verwerkt in administratie</button>
              </>
            )}
            {m.status !== "open" && m.afgehandeld_door && (
              <div style={{ fontSize: 12, color: "#4b5563" }}>Verwerkt door {m.afgehandeld_door}{m.notitie ? ` — "${m.notitie}"` : ""}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── WONINGEN DETAIL ──────────────────────────────────────────────────────────

function WoningenDetail({ houses }) {
  const [filterStad, setFilterStad] = useState("Alle");
  const [filterStatus, setFilterStatus] = useState("Alle");
  const [zoek, setZoek] = useState("");
  const steden = ["Alle", ...Array.from(new Set(houses.map(h => h.stad))).sort()];
  const statussen = ["Alle", "Lopend", "Beschikbaar", "Gereserveerd", "Controle", "Niet beschikbaar", "Moet aan het werk"];

  const total = houses.reduce((s, h) => s + h.kamers.length, 0);
  const bezet = houses.reduce((s, h) => s + h.kamers.filter(k => k.naam && k.status === "Lopend").length, 0);
  const beschikbaar = houses.reduce((s, h) => s + h.kamers.filter(k => k.status === "Beschikbaar").length, 0);
  const gereserveerd = houses.reduce((s, h) => s + h.kamers.filter(k => k.status === "Gereserveerd").length, 0);
  const controle = houses.reduce((s, h) => s + h.kamers.filter(k => k.status === "Controle").length, 0);

  const filtered = houses.filter(h => {
    if (filterStad !== "Alle" && h.stad !== filterStad) return false;
    if (filterStatus !== "Alle" && !h.kamers.some(k => k.status === filterStatus)) return false;
    if (zoek.trim()) {
      const q = zoek.toLowerCase();
      return h.adres.toLowerCase().includes(q) || h.stad.toLowerCase().includes(q) ||
        h.kamers.some(k => k.naam.toLowerCase().includes(q) || k.bedrijf.toLowerCase().includes(q));
    }
    return true;
  });

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Woningoverzicht</h2>
        <p style={{ fontSize: 13, color: "#6b7280" }}>Alle {houses.length} woningen met bewoners en kamerstatus</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 24 }}>
        {[{ label: "Bezet", val: bezet, color: "#16a34a" }, { label: "Beschikbaar", val: beschikbaar, color: "#3b82f6" }, { label: "Gereserveerd", val: gereserveerd, color: "#f59e0b" }, { label: "Controle", val: controle, color: "#ef4444" }, { label: "Totaal kamers", val: total, color: "#6b7280" }].map(s => (
          <div key={s.label} className="card" style={{ borderTop: `3px solid ${s.color}`, padding: "14px 16px" }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input value={zoek} onChange={e => setZoek(e.target.value)} placeholder="🔍 Zoek op naam, adres, bedrijf..."
          style={{ background: "#1e2130", border: "1.5px solid #2d3148", borderRadius: 8, color: "#e8eaf0", padding: "8px 14px", fontSize: 13, outline: "none", width: 240 }} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {steden.map(s => <button key={s} className={`tab-pill ${filterStad === s ? "active" : ""}`} onClick={() => setFilterStad(s)} style={{ fontSize: 12, padding: "6px 12px" }}>{s}</button>)}
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ background: "#1e2130", border: "1.5px solid #2d3148", borderRadius: 8, color: "#e8eaf0", padding: "8px 12px", fontSize: 12, outline: "none" }}>
          {statussen.map(s => <option key={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: 12, color: "#4b5563" }}>{filtered.length} woningen</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
        {filtered.map(h => {
          const bezette = h.kamers.filter(k => k.naam && k.status === "Lopend").length;
          const hasIssue = h.kamers.some(k => k.status === "Controle" || k.status === "Moet aan het werk");
          const hasVrij = h.kamers.some(k => k.status === "Beschikbaar");
          return (
            <div key={h.id} className="card" style={{ borderTop: `3px solid ${hasIssue ? "#ef4444" : hasVrij ? "#3b82f6" : "#f97316"}`, padding: "18px 18px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{h.adres}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{h.stad} · {h.postcode}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 10 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#f97316", lineHeight: 1 }}>{bezette}<span style={{ fontSize: 13, color: "#4b5563" }}>/{h.kamers.length}</span></div>
                  <div style={{ fontSize: 10, color: "#4b5563", marginTop: 2 }}>bezet</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                {h.kamers.map(k => {
                  const c = STATUS_MAP[k.status] || { dot: "#6b7280" };
                  return <div key={k.k} title={`K${k.k}: ${k.naam || "leeg"} — ${k.status}`} style={{ width: 12, height: 12, borderRadius: 3, background: c.dot + "50", border: `1.5px solid ${c.dot}` }} />;
                })}
              </div>
              <div style={{ borderTop: "1px solid #23263a", paddingTop: 10 }}>
                {h.kamers.map(k => {
                  const c = STATUS_MAP[k.status] || { bg: "#1e2130", text: "#9ca3af", dot: "#6b7280" };
                  return (
                    <div key={k.k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 7, marginBottom: 2, background: k.status === "Controle" ? "#ef444410" : k.status === "Beschikbaar" ? "#3b82f608" : "transparent" }}>
                      <div style={{ width: 6, height: 6, borderRadius: 2, background: c.dot, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#4b5563", minWidth: 28, fontFamily: "monospace" }}>K{k.k}</span>
                      <span style={{ flex: 1, fontSize: 13, color: k.naam ? "#e8eaf0" : "#3d4168", fontStyle: k.naam ? "normal" : "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.naam || "leeg"}</span>
                      {k.bedrijf && <span style={{ fontSize: 11, color: "#4b5563", whiteSpace: "nowrap", flexShrink: 0 }}>{k.bedrijf}</span>}
                      <span style={{ padding: "2px 8px", borderRadius: 4, background: c.bg, color: c.text, fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>{k.status}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1a1d27", display: "flex", gap: 6, flexWrap: "wrap" }}>
                {hasVrij && <span style={{ fontSize: 10, fontWeight: 600, color: "#3b82f6", background: "#3b82f615", padding: "3px 8px", borderRadius: 4 }}>{h.kamers.filter(k => k.status === "Beschikbaar").length} vrij</span>}
                {h.kamers.filter(k => k.status === "Gereserveerd").length > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: "#f59e0b", background: "#f59e0b15", padding: "3px 8px", borderRadius: 4 }}>{h.kamers.filter(k => k.status === "Gereserveerd").length} gereserveerd</span>}
                {hasIssue && <span style={{ fontSize: 10, fontWeight: 600, color: "#ef4444", background: "#ef444415", padding: "3px 8px", borderRadius: 4 }}>⚠ actie vereist</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PLANNING VIEW ────────────────────────────────────────────────────────────

function PlanningView({ houses }) {
  const [filterStad, setFilterStad] = useState("Alle");
  const steden = ["Alle", ...Array.from(new Set(houses.map(h => h.stad))).sort()];
  const filtered = filterStad === "Alle" ? houses : houses.filter(h => h.stad === filterStad);
  const total = houses.reduce((s, h) => s + h.kamers.length, 0);
  const bezet = houses.reduce((s, h) => s + h.kamers.filter(k => k.naam && k.status === "Lopend").length, 0);
  const beschikbaar = houses.reduce((s, h) => s + h.kamers.filter(k => k.status === "Beschikbaar").length, 0);
  const controle = houses.reduce((s, h) => s + h.kamers.filter(k => k.status === "Controle").length, 0);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
        {[{ label: "Bezet", val: bezet, color: "#16a34a" }, { label: "Beschikbaar", val: beschikbaar, color: "#3b82f6" }, { label: "Te controleren", val: controle, color: "#ef4444" }, { label: "Totaal kamers", val: total, color: "#6b7280" }].map(s => (
          <div key={s.label} className="card" style={{ borderTop: `3px solid ${s.color}` }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {steden.map(s => <button key={s} className={`tab-pill ${filterStad === s ? "active" : ""}`} onClick={() => setFilterStad(s)} style={{ fontSize: 12 }}>{s}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
        {filtered.map(h => {
          const bezette = h.kamers.filter(k => k.naam && k.status === "Lopend").length;
          return (
            <div key={h.id} className="card" style={{ borderTop: "3px solid #f97316" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{h.adres}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{h.stad} · {h.postcode}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#f97316" }}>{bezette}/{h.kamers.length}</div>
                  <div style={{ fontSize: 10, color: "#6b7280" }}>bezet</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 12 }}>
                {h.kamers.map(k => { const c = STATUS_MAP[k.status] || { dot: "#6b7280" }; return <div key={k.k} title={`K${k.k}: ${k.naam || "leeg"}`} style={{ width: 10, height: 10, borderRadius: 3, background: c.dot + "60", border: `1.5px solid ${c.dot}` }} />; })}
              </div>
              <div style={{ borderTop: "1px solid #23263a", paddingTop: 12 }}>
                {h.kamers.map(k => { const c = STATUS_MAP[k.status] || { bg: "#1e2130", text: "#9ca3af" }; return (
                  <div key={k.k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#4b5563", minWidth: 26, fontFamily: "monospace" }}>K{k.k}</span>
                    <span style={{ flex: 1, fontSize: 13, color: k.naam ? "#e8eaf0" : "#4b5563", fontStyle: k.naam ? "normal" : "italic" }}>{k.naam || "leeg"}</span>
                    {k.bedrijf && <span style={{ fontSize: 11, color: "#6b7280" }}>{k.bedrijf}</span>}
                    <span style={{ padding: "2px 8px", borderRadius: 4, background: c.bg, color: c.text, fontSize: 10, fontWeight: 600, whiteSpace: "nowrap" }}>{k.status}</span>
                  </div>
                ); })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── LOG VIEW ─────────────────────────────────────────────────────────────────

function LogView({ meldingen, houses }) {
  function exportCSV() {
    let csv = "Datum,Tijd,Type,Medewerker,Adres,Kamer,Ingediend door,Status,Sleutel terug,Kamer schoon,Notitie\n";
    meldingen.forEach(m => {
      const h = houses.find(h => h.id === m.woning_id);
      const dt = m.created_at ? new Date(m.created_at) : new Date();
      csv += `"${fmtDate(dt)}","${fmtTime(dt)}","${m.type}","${m.medewerker}","${h?.adres || ""}","${m.kamer}","${m.ingediend_door}","${m.status}","${m.sleutel_terug || ""}","${m.kamer_schoon || ""}","${m.notitie || ""}"\n`;
    });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `KTP_meldingen_${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Volledig log</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>{meldingen.length} meldingen totaal</p>
        </div>
        <button className="btn-ghost" onClick={exportCSV}>⬇ Exporteer CSV</button>
      </div>
      {meldingen.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "50px", color: "#4b5563" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📝</div><div>Nog geen meldingen</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 70px 100px 1fr 1fr 60px 80px 80px", padding: "10px 16px", fontSize: 10, fontWeight: 700, color: "#4b5563", letterSpacing: "0.6px", textTransform: "uppercase", borderBottom: "1px solid #23263a", background: "#13151f" }}>
            <span>Datum</span><span>Tijd</span><span>Type</span><span>Medewerker</span><span>Adres</span><span>Kamer</span><span>Door</span><span>Status</span>
          </div>
          {meldingen.map((m, i) => {
            const h = houses.find(h => h.id === m.woning_id);
            const typeColors = { aankomst: "#16a34a", vertrek: "#ef4444", reservering: "#f59e0b", overig: "#6b7280" };
            const dt = m.created_at ? new Date(m.created_at) : new Date();
            return (
              <div key={m.id} style={{ display: "grid", gridTemplateColumns: "80px 70px 100px 1fr 1fr 60px 80px 80px", padding: "10px 16px", fontSize: 13, borderBottom: i < meldingen.length - 1 ? "1px solid #1a1d27" : "none", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>{fmtDate(dt)}</span>
                <span style={{ fontSize: 12, color: "#4b5563" }}>{fmtTime(dt)}</span>
                <span style={{ color: typeColors[m.type] || "#6b7280", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{m.type}</span>
                <span style={{ fontWeight: 500 }}>{m.medewerker}</span>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>{h?.adres}</span>
                <span style={{ fontSize: 12, fontFamily: "monospace", color: "#6b7280" }}>K{m.kamer}</span>
                <span style={{ fontSize: 12, color: "#6b7280" }}>{m.ingediend_door}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: m.status === "open" ? "#f97316" : "#16a34a" }}>{(m.status || "").toUpperCase()}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
