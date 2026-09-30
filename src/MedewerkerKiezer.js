// ─── MEDEWERKER KIEZER ─────────────────────────────────────────────────────────
// Eén invoerveld voor namen van uitzendkrachten, overal in de app hetzelfde.
//
// Waarom: de app koppelt kamer, borgplan, huurschuld en meldingen op de NAAM (vrije tekst).
// Eén tikfout ("Andrejewska" i.p.v. "Andrzejewska", "Ionut" zonder achternaam, een spatie
// te veel) breekt die koppeling (dubbele borgplannen, niet gevonden in Cockpit).
//
// Werking:
//  1. Typen toont een lijst met BESTAANDE namen (bewoners, actieve borgplannen, actieve
//     huurschulden) → aantikken zet de naam exact zoals hij al in de app staat.
//  2. Een NIEUWE naam mag alleen als `nieuwToegestaan` aan staat, en krijgt controles:
//     - minimaal voor- én achternaam (blokkerend, zie naamProbleem)
//     - dubbele spaties / spaties aan het eind worden weggehaald (normaliseerNaam)
//     - waarschuwing "Bedoel je …?" als de naam lijkt op een bestaande naam
//
// Gebruik:
//   <MedewerkerKiezer value={naam} onChange={setNaam} houses={houses} nieuwToegestaan />
//   bij opslaan:  const fout = naamProbleem(naam); if (fout) { showToast(fout,"err"); return; }

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";

const KLEUR = {
  blauw: "#1B3A6B", groen: "#357a2b", rood: "#b91c1c", oranje: "#b45309",
  border: "#d1dbe8", muted: "#6b7a8d", text: "#1a2b47",
};

// Spaties opschonen; hoofdletters en accenten blijven zoals getypt.
export function normaliseerNaam(naam) {
  return (naam || "").replace(/\s+/g, " ").trim();
}

// Vergelijkingsvorm: zonder accenten, kleine letters (ą→a, ł→l, ö→o).
function sleutel(naam) {
  return normaliseerNaam(naam).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l").replace(/Ł/g, "L").toLowerCase();
}
function delen(naam) {
  return sleutel(naam).split(/[\s-]+/).filter(p => p.length > 1);
}

// Blokkerende controle bij opslaan. Geeft een foutmelding terug, of null als het goed is.
export function naamProbleem(naam) {
  const n = normaliseerNaam(naam);
  if (!n) return "Vul de naam van de medewerker in";
  if (delen(n).length < 2) return "Vul voor- én achternaam in (alleen een voornaam kan niet gekoppeld worden)";
  return null;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let vorige = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const huidige = [i];
    for (let j = 1; j <= n; j++) {
      huidige[j] = Math.min(vorige[j] + 1, huidige[j - 1] + 1, vorige[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    vorige = huidige;
  }
  return vorige[n];
}
// Twee naamdelen "lijken op elkaar": 1 letter verschil (kort) of 2 (≥7 letters).
function deelLijkt(a, b) {
  if (a === b) return true;
  const max = Math.max(a.length, b.length) >= 7 ? 2 : 1;
  return Math.abs(a.length - b.length) <= max && levenshtein(a, b) <= max;
}
// Lijkt de getypte naam op een bekende naam? Alle getypte delen moeten terugkomen
// (exact of met een kleine tikfout) en minstens één deel moet een achternaam-achtig deel zijn.
function lijktOp(getypt, bekend) {
  const g = delen(getypt), b = delen(bekend);
  if (!g.length || !b.length) return false;
  return g.every(p => b.some(q => deelLijkt(p, q)));
}

// Namenlijst één keer per sessie ophalen en delen tussen alle invoervelden.
let cache = null, cacheTijd = 0;
async function laadDbNamen() {
  if (cache && Date.now() - cacheTijd < 5 * 60 * 1000) return cache;
  const [borg, huur] = await Promise.all([
    supabase.from("borg_plannen").select("naam_medewerker").eq("status", "actief"),
    supabase.from("huurschulden").select("naam_medewerker").eq("actief", true),
  ]);
  cache = [...(borg.data || []), ...(huur.data || [])].map(r => r.naam_medewerker);
  cacheTijd = Date.now();
  return cache;
}
// Na het aanmaken van een nieuw borgplan e.d. de lijst verversen.
export function vernieuwMedewerkerNamen() { cache = null; }

export function MedewerkerKiezer({
  value, onChange, houses = [], nieuwToegestaan = true,
  placeholder = "Begin te typen en kies de medewerker", className = "fi", autoFocus = false, style,
}) {
  const [dbNamen, setDbNamen] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    let actief = true;
    laadDbNamen().then(n => { if (actief) setDbNamen(n); }).catch(() => {});
    return () => { actief = false; };
  }, []);

  useEffect(() => {
    function klikBuiten(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", klikBuiten);
    return () => document.removeEventListener("mousedown", klikBuiten);
  }, []);

  // Bekende namen met herkomst (bewoner op adres/kamer heeft voorrang als label)
  const bekend = useMemo(() => {
    const map = new Map();
    houses.forEach(h => (h.kamers || []).forEach(k => {
      const n = normaliseerNaam(k.naam);
      if (n && !map.has(n)) map.set(n, `${h.adres} K${k.k}`);
    }));
    dbNamen.forEach(n0 => { const n = normaliseerNaam(n0); if (n && !map.has(n)) map.set(n, "borg/huur"); });
    return [...map.entries()].map(([naam, info]) => ({ naam, info })).sort((a, b) => a.naam.localeCompare(b.naam));
  }, [houses, dbNamen]);

  const waarde = value || "";
  const zoek = sleutel(waarde);
  const exact = bekend.find(b => b.naam === normaliseerNaam(waarde));

  const suggesties = useMemo(() => {
    if (!zoek) return bekend.slice(0, 8);
    const zoekDelen = zoek.split(" ").filter(Boolean);
    return bekend.filter(b => { const s = sleutel(b.naam); return zoekDelen.every(d => s.includes(d)); }).slice(0, 8);
  }, [bekend, zoek]);

  const lijkend = useMemo(() => {
    if (!zoek || exact) return [];
    return bekend.filter(b => lijktOp(waarde, b.naam)).slice(0, 4);
  }, [bekend, waarde, zoek, exact]);

  const probleem = waarde.trim() ? naamProbleem(waarde) : null;
  const kies = naam => { onChange(naam); setOpen(false); };

  return (
    <div ref={wrapRef} style={{ position: "relative", ...style }}>
      <input
        className={className} value={waarde} autoFocus={autoFocus} placeholder={placeholder} autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { const n = normaliseerNaam(waarde); if (n !== waarde) onChange(n); }}
        style={exact ? { borderColor: KLEUR.groen } : undefined}
      />

      {open && suggesties.length > 0 && !exact && (
        <div style={{
          position: "absolute", zIndex: 50, left: 0, right: 0, top: "100%", marginTop: 4, background: "white",
          border: `1.5px solid ${KLEUR.border}`, borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,.12)", maxHeight: 280, overflowY: "auto",
        }}>
          {suggesties.map(s => (
            <div key={s.naam} onMouseDown={e => { e.preventDefault(); kies(s.naam); }}
              style={{ padding: "9px 12px", cursor: "pointer", fontSize: 14, display: "flex", justifyContent: "space-between", gap: 8, borderBottom: "1px solid #eef2f7" }}>
              <span style={{ fontWeight: 600, color: KLEUR.text }}>{s.naam}</span>
              <span style={{ fontSize: 11, color: KLEUR.muted, whiteSpace: "nowrap" }}>{s.info}</span>
            </div>
          ))}
          {nieuwToegestaan && waarde.trim() && (
            <div onMouseDown={e => { e.preventDefault(); setOpen(false); }}
              style={{ padding: "9px 12px", cursor: "pointer", fontSize: 13, color: KLEUR.blauw, fontWeight: 700 }}>
              + Nieuwe medewerker: "{normaliseerNaam(waarde)}"
            </div>
          )}
        </div>
      )}

      {/* Status onder het veld */}
      {exact && (
        <div style={{ fontSize: 11, color: KLEUR.groen, marginTop: 4, fontWeight: 600 }}>✓ Bestaande medewerker ({exact.info})</div>
      )}
      {!exact && waarde.trim() && lijkend.length > 0 && (
        <div style={{ fontSize: 12, marginTop: 6, background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 6, padding: "6px 10px", color: KLEUR.oranje }}>
          ⚠️ Bedoel je:{" "}
          {lijkend.map((l, i) => (
            <span key={l.naam}>
              {i > 0 && " of "}
              <button type="button" onClick={() => kies(l.naam)}
                style={{ background: "none", border: "none", padding: 0, color: KLEUR.blauw, fontWeight: 700, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
                {l.naam}
              </button>
            </span>
          ))}
          ?
        </div>
      )}
      {!exact && waarde.trim() && probleem && (
        <div style={{ fontSize: 11, color: KLEUR.rood, marginTop: 4, fontWeight: 600 }}>✕ {probleem}</div>
      )}
      {!exact && waarde.trim() && !probleem && lijkend.length === 0 && (
        <div style={{ fontSize: 11, color: nieuwToegestaan ? KLEUR.muted : KLEUR.oranje, marginTop: 4, fontWeight: nieuwToegestaan ? 400 : 600 }}>
          {nieuwToegestaan
            ? "Nieuwe medewerker — controleer de spelling (zoals in paspoort/Cockpit)"
            : "⚠️ Niet gevonden als bewoner — kies uit de lijst of controleer de naam"}
        </div>
      )}
    </div>
  );
}
