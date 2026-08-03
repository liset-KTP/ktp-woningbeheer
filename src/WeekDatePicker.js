import { useState, useRef, useEffect } from "react";

// ─── Kleuren (zelfde huisstijl als de rest van de app) ────────────────────────
const WD = {
  blauw: "#1B3A6B",
  border: "#d1dbe8",
  text: "#1a2b47",
  muted: "#6b7a8d",
  bg: "#f0f4f8",
  groen: "#4A9B3C",
};

const MAANDEN = ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
const DAGEN = ["ma","di","wo","do","vr","za","zo"];

function pad(n) { return String(n).padStart(2, "0"); }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseISO(str) {
  if (!str) return null;
  const parts = String(str).split("-").map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
}
function isSameDay(a, b) { return a && b && toISO(a) === toISO(b); }

// ISO-8601 weeknummer (zelfde berekening die al elders in de app gebruikt wordt)
function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

/**
 * Eigen datumkiezer met weeknummer-kolom in de popup.
 * Drop-in vervanging voor <input type="date">: zelfde value (yyyy-mm-dd string),
 * maar onChange geeft de nieuwe waarde direct als string terug (geen event).
 *
 * Props: value, onChange(value), className, style, placeholder, autoFocus, disabled
 */
export default function WeekDatePicker({ value, onChange, className = "fi", style = {}, placeholder = "dd-mm-jjjj", autoFocus = false, disabled = false }) {
  const [open, setOpen] = useState(false);
  const selected = parseISO(value);
  const [viewDate, setViewDate] = useState(selected || new Date());
  const boxRef = useRef(null);

  useEffect(() => {
    if (selected) setViewDate(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    function handleOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    function handleEsc(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, []);

  useEffect(() => {
    if (autoFocus && boxRef.current) boxRef.current.focus();
  }, [autoFocus]);

  const jaar = viewDate.getFullYear();
  const maand = viewDate.getMonth();

  const eersteVanMaand = new Date(jaar, maand, 1);
  const startOffset = (eersteVanMaand.getDay() + 6) % 7; // 0 = maandag
  const gridStart = new Date(jaar, maand, 1 - startOffset);

  const weken = [];
  for (let w = 0; w < 6; w++) {
    const dagenRij = [];
    for (let d = 0; d < 7; d++) {
      const dag = new Date(gridStart);
      dag.setDate(gridStart.getDate() + w * 7 + d);
      dagenRij.push(dag);
    }
    weken.push(dagenRij);
  }

  function kiesDag(dag) {
    if (disabled) return;
    onChange(toISO(dag));
    setOpen(false);
  }

  function vorigeMaand(e) { e.stopPropagation(); setViewDate(new Date(jaar, maand - 1, 1)); }
  function volgendeMaand(e) { e.stopPropagation(); setViewDate(new Date(jaar, maand + 1, 1)); }

  const label = selected ? `${pad(selected.getDate())}-${pad(selected.getMonth() + 1)}-${selected.getFullYear()}` : "";
  const vandaag = new Date();

  return (
    <div
      ref={boxRef}
      tabIndex={disabled ? -1 : 0}
      className={className}
      onClick={() => !disabled && setOpen(o => !o)}
      onKeyDown={e => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen(o => !o); } }}
      style={{
        ...style,
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        userSelect: "none",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{ color: label ? "inherit" : "#94a3b8" }}>{label || placeholder}</span>
      <span style={{ fontSize: 13, marginLeft: 6, flexShrink: 0 }}>📅</span>

      {open && !disabled && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 1000,
            background: "white", border: `1px solid ${WD.border}`, borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.14)", padding: 10, width: 290,
            cursor: "default", fontWeight: 400,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button type="button" onClick={vorigeMaand}
              style={{ border: "none", background: "none", cursor: "pointer", fontSize: 15, padding: "2px 10px", color: WD.blauw, fontWeight: 700 }}>
              ‹
            </button>
            <div style={{ fontWeight: 700, fontSize: 13, color: WD.blauw }}>{MAANDEN[maand]} {jaar}</div>
            <button type="button" onClick={volgendeMaand}
              style={{ border: "none", background: "none", cursor: "pointer", fontSize: 15, padding: "2px 10px", color: WD.blauw, fontWeight: 700 }}>
              ›
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "26px repeat(7,1fr)", gap: 2, marginBottom: 2 }}>
            <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", fontWeight: 700 }}>Wk</div>
            {DAGEN.map(d => (
              <div key={d} style={{ fontSize: 10, fontWeight: 700, color: WD.muted, textAlign: "center" }}>{d}</div>
            ))}
          </div>

          {weken.map((dagenRij, wi) => (
            <div key={wi} style={{ display: "grid", gridTemplateColumns: "26px repeat(7,1fr)", gap: 2, marginBottom: 2 }}>
              <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", fontWeight: 700, alignSelf: "center" }}>
                {getISOWeek(dagenRij[0])}
              </div>
              {dagenRij.map((dag, di) => {
                const inMaand = dag.getMonth() === maand;
                const isVandaag = isSameDay(dag, vandaag);
                const isGeselecteerd = isSameDay(dag, selected);
                return (
                  <button key={di} type="button" onClick={() => kiesDag(dag)}
                    style={{
                      fontSize: 12, padding: "5px 0", borderRadius: 6, fontFamily: "inherit",
                      border: isVandaag && !isGeselecteerd ? `1.5px solid ${WD.blauw}` : "1.5px solid transparent",
                      background: isGeselecteerd ? WD.blauw : "white",
                      color: isGeselecteerd ? "white" : inMaand ? WD.text : "#c3cbd8",
                      cursor: "pointer",
                    }}>
                    {dag.getDate()}
                  </button>
                );
              })}
            </div>
          ))}

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: `1px solid ${WD.bg}` }}>
            <button type="button" onClick={() => { onChange(""); setOpen(false); }}
              style={{ fontSize: 11, color: WD.muted, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
              Wissen
            </button>
            <button type="button" onClick={() => kiesDag(new Date())}
              style={{ fontSize: 11, color: WD.groen, background: "none", border: "none", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
              Vandaag
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { getISOWeek };
