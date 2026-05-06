import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

const C = {
  blauw:"#1B3A6B", blauwLight:"#2a52a0",
  groen:"#4A9B3C", groenDark:"#357a2b",
  bg:"#f0f4f8", border:"#d1dbe8",
  text:"#1a2b47", muted:"#6b7a8d",
  rood:"#ef4444",
};

// EmailJS
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

function fmtFull(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleDateString("nl-NL", { day:"2-digit", month:"2-digit" }) + " " +
         dt.toLocaleTimeString("nl-NL", { hour:"2-digit", minute:"2-digit" });
}

const KOPPELING_ICONS = {
  auto: "🚗", woning: "🏠", taak: "📌", melding: "🔔", null: "💬"
};

export function BerichtenModule({ gebruiker, houses, taken, meldingen, autos }) {
  const [berichten, setBerichten] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toonNieuw, setToonNieuw] = useState(false);
  const [filter, setFilter] = useState("alle");
  const [zoek, setZoek] = useState("");

  const loadBerichten = useCallback(async () => {
    const { data, error } = await supabase.from("berichten").select("*").order("created_at", { ascending: false });
    if (error) { console.error(error); return; }
    setBerichten(data || []);
  }, []);

  useEffect(() => {
    async function init() { setLoading(true); await loadBerichten(); setLoading(false); }
    init();
  }, [loadBerichten]);

  useEffect(() => {
    const s = supabase.channel("ber-rt").on("postgres_changes", { event: "*", schema: "public", table: "berichten" }, () => loadBerichten()).subscribe();
    return () => supabase.removeChannel(s);
  }, [loadBerichten]);

  async function markeerGelezen(bericht) {
    if ((bericht.gelezen_door || []).includes(gebruiker.naam)) return;
    const nieuw = [...(bericht.gelezen_door || []), gebruiker.naam];
    await supabase.from("berichten").update({ gelezen_door: nieuw }).eq("id", bericht.id);
  }

  async function stuurBericht(data) {
    const { error } = await supabase.from("berichten").insert([{
      tekst: data.tekst,
      van: gebruiker.naam,
      aan: data.aan || null,
      onderwerp: data.onderwerp || null,
      koppeling_type: data.koppeling_type || null,
      koppeling_id: data.koppeling_id || null,
      koppeling_label: data.koppeling_label || null,
      gelezen_door: [gebruiker.naam],
    }]);
    if (error) return false;

    // Mail sturen
    stuurMail({
      type: "💬 Nieuw bericht",
      type_icon: "💬",
      medewerker: data.aan || "Iedereen",
      woning: data.koppeling_label || "—",
      kamer: "—",
      datum: new Date().toISOString().slice(0, 10),
      ingediend_door: gebruiker.naam,
      opmerkingen: data.onderwerp ? `${data.onderwerp}: ${data.tekst}` : data.tekst,
    });
    return true;
  }

  if (loading) return <div style={{ textAlign: "center", padding: "60px", color: C.muted }}>⏳ Laden...</div>;

  const ongelezen = berichten.filter(b =>
    !(b.gelezen_door || []).includes(gebruiker.naam) &&
    (b.aan === null || b.aan === gebruiker.naam || b.van === gebruiker.naam)
  ).length;

  const gefilterd = berichten
    .filter(b => {
      // Filter op aan/van
      if (filter === "aan_mij") return b.aan === gebruiker.naam || b.aan === null;
      if (filter === "van_mij") return b.van === gebruiker.naam;
      if (filter === "ongelezen") return !(b.gelezen_door || []).includes(gebruiker.naam);
      return true;
    })
    .filter(b => {
      if (!zoek.trim()) return true;
      const q = zoek.toLowerCase();
      return b.tekst?.toLowerCase().includes(q) ||
             b.van?.toLowerCase().includes(q) ||
             b.aan?.toLowerCase().includes(q) ||
             b.onderwerp?.toLowerCase().includes(q) ||
             b.koppeling_label?.toLowerCase().includes(q);
    });

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.blauw, marginBottom: 3 }}>
            💬 Berichten
            {ongelezen > 0 && <span style={{ background: C.rood, color: "white", fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 10, marginLeft: 10 }}>{ongelezen}</span>}
          </h2>
          <p style={{ fontSize: 13, color: C.muted }}>{berichten.length} berichten · {ongelezen} ongelezen</p>
        </div>
        <button onClick={() => setToonNieuw(true)}
          style={{ background: C.blauw, color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          ✉️ Nieuw bericht
        </button>
      </div>

      {/* Nieuw bericht formulier */}
      {toonNieuw && (
        <NieuwBerichtForm
          gebruiker={gebruiker}
          houses={houses}
          taken={taken}
          meldingen={meldingen}
          autos={autos}
          onVerstuur={async (data) => {
            const ok = await stuurBericht(data);
            if (ok) setToonNieuw(false);
          }}
          onAnnuleer={() => setToonNieuw(false)}
        />
      )}

      {/* Filters + zoek */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input value={zoek} onChange={e => setZoek(e.target.value)}
          placeholder="🔍 Zoek berichten..."
          style={{ background: "white", border: `1.5px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "8px 14px", fontSize: 13, outline: "none", width: 220 }} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {[["alle", "Alle"], ["aan_mij", "Voor mij"], ["van_mij", "Van mij"], ["ongelezen", `Ongelezen${ongelezen > 0 ? ` (${ongelezen})` : ""}`]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              style={{ background: filter === v ? C.blauw : "white", color: filter === v ? "white" : C.muted, border: `1.5px solid ${filter === v ? C.blauw : C.border}`, borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Berichten lijst */}
      {gefilterd.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px", color: C.muted }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>💬</div>
          <div>Geen berichten gevonden</div>
        </div>
      ) : gefilterd.map(b => (
        <BerichtKaart key={b.id} bericht={b} gebruiker={gebruiker} onMarkeerGelezen={markeerGelezen} />
      ))}
    </div>
  );
}

// ─── BERICHT KAART ────────────────────────────────────────────────────────────
function BerichtKaart({ bericht: b, gebruiker, onMarkeerGelezen }) {
  const [open, setOpen] = useState(false);
  const gelezen = (b.gelezen_door || []).includes(gebruiker.naam);
  const vanMij = b.van === gebruiker.naam;

  function handleOpen() {
    setOpen(!open);
    if (!gelezen) onMarkeerGelezen(b);
  }

  return (
    <div style={{
      background: "white",
      border: `1px solid ${gelezen || vanMij ? C.border : C.blauw}`,
      borderLeft: `4px solid ${gelezen || vanMij ? C.border : C.blauw}`,
      borderRadius: 12,
      marginBottom: 10,
      boxShadow: "0 1px 3px rgba(27,58,107,.05)",
      overflow: "hidden",
    }}>
      {/* Klik-header */}
      <div onClick={handleOpen} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
        {/* Avatar */}
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: vanMij ? C.groen + "20" : C.blauw + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
          {b.van.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{b.van}</span>
            {b.aan ? (
              <span style={{ fontSize: 12, color: C.muted }}>→ {b.aan}</span>
            ) : (
              <span style={{ fontSize: 11, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "1px 8px", color: C.muted }}>iedereen</span>
            )}
            {!gelezen && !vanMij && (
              <span style={{ background: C.blauw, color: "white", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10 }}>NIEUW</span>
            )}
            {b.koppeling_label && (
              <span style={{ fontSize: 11, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "1px 8px", color: C.muted }}>
                {KOPPELING_ICONS[b.koppeling_type]} {b.koppeling_label}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            {b.onderwerp && <span style={{ fontWeight: 600, color: C.text, marginRight: 8 }}>{b.onderwerp}</span>}
            <span style={{ color: gelezen ? C.muted : C.text }}>{b.tekst.length > 80 && !open ? b.tekst.slice(0, 80) + "..." : !open ? b.tekst : ""}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: C.muted }}>{fmtFull(b.created_at)}</div>
          <div style={{ fontSize: 18, color: C.muted, marginTop: 4 }}>{open ? "▲" : "▼"}</div>
        </div>
      </div>

      {/* Uitklapbaar body */}
      {open && (
        <div style={{ padding: "0 18px 16px 18px", borderTop: `1px solid ${C.border}` }}>
          {b.onderwerp && (
            <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginTop: 14, marginBottom: 8 }}>{b.onderwerp}</div>
          )}
          <div style={{ fontSize: 14, color: C.text, marginTop: b.onderwerp ? 0 : 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{b.tekst}</div>
          {b.koppeling_label && (
            <div style={{ marginTop: 12, padding: "8px 12px", background: C.bg, borderRadius: 8, fontSize: 12, color: C.muted }}>
              {KOPPELING_ICONS[b.koppeling_type]} Gekoppeld aan: <strong style={{ color: C.text }}>{b.koppeling_label}</strong>
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 11, color: C.muted }}>
            Gelezen door: {(b.gelezen_door || []).join(", ") || "niemand"}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── NIEUW BERICHT FORMULIER ──────────────────────────────────────────────────
function NieuwBerichtForm({ gebruiker, houses, taken, meldingen, autos, onVerstuur, onAnnuleer }) {
  const [aan, setAan] = useState("");
  const [onderwerp, setOnderwerp] = useState("");
  const [tekst, setTekst] = useState("");
  const [koppelingType, setKoppelingType] = useState("");
  const [koppelingId, setKoppelingId] = useState("");
  const [saving, setSaving] = useState(false);

  // Opties per koppeling type
  const koppelingOpties = {
    woning: houses.map(h => ({ id: h.id, label: `${h.adres}, ${h.stad}` })),
    taak:   taken.filter(t => t.status === "open").map(t => ({ id: t.id, label: t.titel })),
    melding: meldingen.filter(m => m.status === "open").map(m => ({ id: m.id, label: `${m.type} — ${m.medewerker}` })),
    auto:   autos?.map(a => ({ id: a.id, label: `${a.merk} ${a.model} (${a.kenteken})` })) || [],
  };

  const geselecteerdeLabel = koppelingType && koppelingId
    ? koppelingOpties[koppelingType]?.find(o => o.id === Number(koppelingId))?.label
    : null;

  async function handleSubmit() {
    if (!tekst.trim()) return;
    setSaving(true);
    await onVerstuur({
      tekst: tekst.trim(),
      aan: aan || null,
      onderwerp: onderwerp.trim() || null,
      koppeling_type: koppelingType || null,
      koppeling_id: koppelingId ? Number(koppelingId) : null,
      koppeling_label: geselecteerdeLabel || null,
    });
    setSaving(false);
  }

  // Alle gebruikersnamen ophalen
  const [gebruikers, setGebruikers] = useState([]);
  useEffect(() => {
    supabase.from("gebruikers").select("naam").eq("actief", true).then(({ data }) => setGebruikers(data || []));
  }, []);

  const andereGebruikers = gebruikers.filter(g => g.naam !== gebruiker.naam);

  return (
    <div style={{ background: "white", border: `2px solid ${C.blauw}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: C.blauw, marginBottom: 16 }}>✉️ Nieuw bericht</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 6, display: "block" }}>Aan</label>
          <select value={aan} onChange={e => setAan(e.target.value)}
            style={{ width: "100%", background: "white", border: `1.5px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "10px 14px", fontSize: 14, outline: "none", appearance: "none", fontFamily: "inherit" }}>
            <option value="">Iedereen</option>
            {andereGebruikers.map(g => <option key={g.naam} value={g.naam}>{g.naam}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 6, display: "block" }}>Onderwerp (optioneel)</label>
          <input value={onderwerp} onChange={e => setOnderwerp(e.target.value)} placeholder="bijv. Borg auto AB-123-C"
            style={{ width: "100%", background: "white", border: `1.5px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "10px 14px", fontSize: 14, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
        </div>
      </div>

      {/* Koppeling */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 6, display: "block" }}>Koppelen aan (optioneel)</label>
          <select value={koppelingType} onChange={e => { setKoppelingType(e.target.value); setKoppelingId(""); }}
            style={{ width: "100%", background: "white", border: `1.5px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "10px 14px", fontSize: 14, outline: "none", appearance: "none", fontFamily: "inherit" }}>
            <option value="">Geen koppeling</option>
            <option value="woning">🏠 Woning</option>
            <option value="auto">🚗 Auto</option>
            <option value="taak">📌 Taak</option>
            <option value="melding">🔔 Melding</option>
          </select>
        </div>
        {koppelingType && (
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 6, display: "block" }}>Selecteer {koppelingType}</label>
            <select value={koppelingId} onChange={e => setKoppelingId(e.target.value)}
              style={{ width: "100%", background: "white", border: `1.5px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "10px 14px", fontSize: 14, outline: "none", appearance: "none", fontFamily: "inherit" }}>
              <option value="">Kies...</option>
              {(koppelingOpties[koppelingType] || []).map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Bericht tekst */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 6, display: "block" }}>Bericht *</label>
        <textarea value={tekst} onChange={e => setTekst(e.target.value)}
          placeholder="Typ hier je bericht..."
          rows={4}
          style={{ width: "100%", background: "white", border: `1.5px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "10px 14px", fontSize: 14, outline: "none", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={handleSubmit} disabled={saving || !tekst.trim()}
          style={{ background: saving || !tekst.trim() ? C.border : C.blauw, color: "white", border: "none", borderRadius: 8, padding: "11px 24px", fontSize: 14, fontWeight: 700, cursor: saving || !tekst.trim() ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
          {saving ? "⏳ Versturen..." : "✉️ Verstuur"}
        </button>
        <button onClick={onAnnuleer}
          style={{ background: "white", border: `1.5px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: "11px 18px", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
          Annuleren
        </button>
      </div>
    </div>
  );
}
