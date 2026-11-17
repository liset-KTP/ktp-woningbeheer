import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";
import { tx, txv } from "./i18n";

// ─── KLACHTENREGISTER (SNF) ──────────────────────────────────────────────────
// Klachten van omwonenden en bewoners per woning. Klachtenprocedure (per 15-10-2026):
// bevestigen binnen 2 werkdagen, afhandelen binnen 10 werkdagen. Register is exporteerbaar
// (CSV, opent in Excel) voor SNF-controles.
// Lezen en schrijven uitsluitend via databasefuncties met het sessietoken (zie supabase/klachten.sql):
// de tabel bevat contactgegevens van omwonenden en is niet direct leesbaar.

const C = {
  blauw:"#1B3A6B", groen:"#4A9B3C", border:"#d1dbe8", text:"#1a2b47", muted:"#6b7a8d",
  rood:"#ef4444", oranje:"#f59e0b", grijs:"#94a3b8",
};
const TERMIJN_BEVESTIGEN = 2, TERMIJN_AFHANDELEN = 10;
const INDIENER = { omwonende:"Omwonende", bewoner:"Bewoner", gemeente:"Gemeente", anders:"Anders" };
const KANAAL = { telefoon:"Telefoon", "e-mail":"E-mail", whatsapp:"WhatsApp", persoonlijk:"Persoonlijk", brief:"Brief", anders:"Anders" };
const CATEGORIE = { geluid:"Geluid", afval:"Afval", parkeren:"Parkeren", gedrag:"Gedrag", onderhoud:"Onderhoud", veiligheid:"Veiligheid", overig:"Overig" };
const STATUS = { nieuw:"Nieuw", in_behandeling:"In behandeling", afgehandeld:"Afgehandeld" };

const inp = { width:"100%", padding:"7px 9px", border:`1px solid ${C.border}`, borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", background:"white", color:C.text };
const btn = (bg, fg="white") => ({ padding:"7px 12px", borderRadius:7, border:"none", background:bg, color:fg, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" });
const lbl = { fontSize:11, fontWeight:700, color:C.muted, marginBottom:3, display:"block" };

function vandaag() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function fmt(d) { if (!d) return ""; const [y,m,dd] = d.slice(0,10).split("-"); return `${dd}-${m}-${y}`; }

// Termijnsignaal: rood = termijn overschreden, oranje = vandaag/morgen laatste dag
function termijn(k) {
  if (k.status === "afgehandeld") {
    const te = k.werkdagen_afhandeling > TERMIJN_AFHANDELEN;
    return { kleur: te ? C.oranje : C.groen, tekst: te ? txv("afgehandeld na {0} werkdagen", k.werkdagen_afhandeling) : tx("binnen termijn") };
  }
  if (!k.bevestigd_op) {
    const over = TERMIJN_BEVESTIGEN - (k.werkdagen_open || 0);
    return over < 0 ? { kleur:C.rood, tekst:tx("bevestiging te laat") } : { kleur:C.oranje, tekst:txv("bevestigen: nog {0} werkdag(en)", over) };
  }
  const over = TERMIJN_AFHANDELEN - (k.werkdagen_open || 0);
  return over < 0 ? { kleur:C.rood, tekst:tx("afhandeling te laat") } : { kleur: over <= 2 ? C.oranje : C.grijs, tekst:txv("afhandelen: nog {0} werkdag(en)", over) };
}

function Badge({ kleur, children }) {
  return <span style={{display:"inline-block",padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700,background:kleur+"1f",color:kleur,border:`1px solid ${kleur}55`,whiteSpace:"nowrap"}}>{children}</span>;
}

const LEEG = { ontvangen_op: "", woning_id:"", adres_vrij:"", indiener_type:"omwonende", indiener_naam:"", indiener_contact:"", kanaal:"telefoon", categorie:"geluid", omschrijving:"", behandelaar_id:"" };

export default function KlachtenModule({ gebruiker, sessieToken, huizen, gebruikers, magControleren, showToast }) {
  const [klachten, setKlachten] = useState([]);
  const [laden, setLaden] = useState(true);
  const [bezig, setBezig] = useState(false);
  const [form, setForm] = useState(null);          // null | {id?, ...velden}
  const [filter, setFilter] = useState({ van:"", tot:"", woning:"", status:"" });

  const isBeheer = gebruiker?.rol === "backoffice" || !!magControleren;
  const huisMap = useMemo(() => Object.fromEntries((huizen || []).map(h => [h.id, h])), [huizen]);
  const adres = k => k.woning_id && huisMap[k.woning_id] ? `${huisMap[k.woning_id].adres}, ${huisMap[k.woning_id].stad}` : (k.adres_vrij || "—");
  const behandelaars = (gebruikers || []).filter(g => g.actief !== false);

  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  const laad = useCallback(async () => {
    setLaden(true);
    const { data, error } = await supabase.rpc("klachten_lijst", { p_token: sessieToken });
    if (error || !data?.ok) toastRef.current(tx("Laden mislukt: ") + (tx(data?.fout) || error?.message || ""), "err");
    setKlachten(data?.klachten || []);
    setLaden(false);
  }, [sessieToken]);
  useEffect(() => { laad(); }, [laad]);

  async function rpc(fn, params, ok) {
    setBezig(true);
    const { data, error } = await supabase.rpc(fn, { p_token: sessieToken, ...params });
    setBezig(false);
    if (error || !data?.ok) { showToast(tx(data?.fout) || error?.message || tx("Actie mislukt"), "err"); return false; }
    if (ok) showToast(ok);
    await laad();
    return true;
  }

  async function opslaan() {
    const f = form;
    if (!f.woning_id && !f.adres_vrij.trim()) return showToast(tx("Kies een woning of vul een adres in"), "err");
    if (!f.omschrijving.trim()) return showToast(tx("Omschrijving is verplicht"), "err");
    const { id, ...velden } = f;
    if (await rpc("klacht_opslaan", { p_id: id || null, p_data: { ...velden, ontvangen_op: velden.ontvangen_op || vandaag() } }, tx("Klacht opgeslagen"))) setForm(null);
  }

  async function actie(k, soort) {
    let data = {};
    if (soort === "afgehandeld") {
      const maatregel = window.prompt(tx("Wat is er gedaan? (verplicht)"), k.maatregel || "");
      if (!maatregel || !maatregel.trim()) return;
      const terug = window.prompt(tx("Wat is aan de melder teruggekoppeld? (mag leeg)"), k.terugkoppeling || "");
      data = { maatregel: maatregel.trim(), terugkoppeling: (terug || "").trim(), datum: vandaag() };
    } else if (soort === "heropend") {
      const reden = window.prompt(tx("Waarom wordt de klacht heropend? (verplicht)"));
      if (!reden || !reden.trim()) return;
      data = { reden: reden.trim() };
    } else if (soort === "bevestigd") {
      data = { datum: vandaag() };
    }
    await rpc("klacht_status", { p_id: k.id, p_actie: soort, p_data: data }, tx("Bijgewerkt"));
  }

  const gefilterd = klachten.filter(k =>
    (!filter.van || k.ontvangen_op >= filter.van) && (!filter.tot || k.ontvangen_op <= filter.tot) &&
    (!filter.woning || String(k.woning_id) === filter.woning) && (!filter.status || k.status === filter.status));

  function exporteer() {
    const cel = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const kop = ["Nr","Ontvangen op","Adres woning","Melder (type)","Naam melder","Contact melder","Kanaal","Categorie","Omschrijving",
      "Behandelaar","Bevestigd op","Werkdagen tot bevestiging","Bevestigd binnen 2 werkdagen","Status","Afgehandeld op",
      "Werkdagen tot afhandeling","Afgehandeld binnen 10 werkdagen","Maatregel","Terugkoppeling aan melder","Geregistreerd door"];
    const rijen = gefilterd.slice().sort((a,b) => a.ontvangen_op.localeCompare(b.ontvangen_op) || a.id - b.id).map(k => [
      k.id, fmt(k.ontvangen_op), adres(k), INDIENER[k.indiener_type], k.indiener_naam, k.indiener_contact, KANAAL[k.kanaal],
      CATEGORIE[k.categorie], k.omschrijving, k.behandelaar_naam, fmt(k.bevestigd_op), k.werkdagen_bevestiging ?? "",
      k.bevestigd_op ? (k.werkdagen_bevestiging <= TERMIJN_BEVESTIGEN ? "ja" : "nee") : "",
      STATUS[k.status], fmt(k.afgehandeld_op), k.werkdagen_afhandeling ?? "",
      k.afgehandeld_op ? (k.werkdagen_afhandeling <= TERMIJN_AFHANDELEN ? "ja" : "nee") : "",
      k.maatregel, k.terugkoppeling, k.aangemaakt_door_naam]);
    const periode = `${filter.van ? fmt(filter.van) : "begin"} t/m ${filter.tot ? fmt(filter.tot) : fmt(vandaag())}`;
    const kopregels = [["Klachtenregister KTP Backoffice B.V. (huisvesting)"], [`Periode: ${periode}`],
      [`Aantal klachten: ${rijen.length}`], [`Geëxporteerd op ${fmt(vandaag())} door ${gebruiker?.naam || ""}`], []];
    if (!rijen.length) kopregels.push(["In deze periode zijn geen klachten geregistreerd."]);
    const csv = [...kopregels, kop, ...rijen].map(r => r.map(cel).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type:"text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a"); el.href = url;
    el.download = `Klachtenregister-KTP-${filter.van || "begin"}-tm-${filter.tot || vandaag()}.csv`; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const zet = (veld, w) => setForm(f => ({ ...f, [veld]: w }));
  const open = klachten.filter(k => k.status !== "afgehandeld");
  const telaat = open.filter(k => termijn(k).kleur === C.rood).length;

  if (form) return (
    <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:10,padding:14,maxWidth:640}}>
      <div style={{fontWeight:800,color:C.blauw,marginBottom:10}}>{form.id ? txv("Klacht #{0} wijzigen", form.id) : tx("➕ Klacht registreren")}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div><label style={lbl}>{tx("Ontvangen op")}</label><input type="date" style={inp} value={form.ontvangen_op || vandaag()} max={vandaag()} onChange={e=>zet("ontvangen_op", e.target.value)} /></div>
        <div><label style={lbl}>{tx("Woning")}</label>
          <select style={inp} value={form.woning_id} onChange={e=>zet("woning_id", e.target.value)}>
            <option value="">{tx("— anders / adres hieronder —")}</option>
            {(huizen || []).map(h => <option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
          </select></div>
        {!form.woning_id && <div style={{gridColumn:"1/3"}}><label style={lbl}>{tx("Adres (als de woning niet in de lijst staat)")}</label><input style={inp} value={form.adres_vrij} onChange={e=>zet("adres_vrij", e.target.value)} /></div>}
        <div><label style={lbl}>{tx("Melder")}</label>
          <select style={inp} value={form.indiener_type} onChange={e=>zet("indiener_type", e.target.value)}>{Object.entries(INDIENER).map(([k,l]) => <option key={k} value={k}>{tx(l)}</option>)}</select></div>
        <div><label style={lbl}>{tx("Via")}</label>
          <select style={inp} value={form.kanaal} onChange={e=>zet("kanaal", e.target.value)}>{Object.entries(KANAAL).map(([k,l]) => <option key={k} value={k}>{tx(l)}</option>)}</select></div>
        <div><label style={lbl}>{tx("Naam melder (mag leeg)")}</label><input style={inp} value={form.indiener_naam} onChange={e=>zet("indiener_naam", e.target.value)} /></div>
        <div><label style={lbl}>{tx("Telefoon of e-mail melder")}</label><input style={inp} value={form.indiener_contact} onChange={e=>zet("indiener_contact", e.target.value)} /></div>
        <div><label style={lbl}>{tx("Soort klacht")}</label>
          <select style={inp} value={form.categorie} onChange={e=>zet("categorie", e.target.value)}>{Object.entries(CATEGORIE).map(([k,l]) => <option key={k} value={k}>{tx(l)}</option>)}</select></div>
        <div><label style={lbl}>{tx("Behandelaar")}</label>
          <select style={inp} value={form.behandelaar_id} onChange={e=>zet("behandelaar_id", e.target.value)}>
            <option value="">{tx("— nog niet toegewezen —")}</option>
            {behandelaars.map(g => <option key={g.id} value={g.id}>{g.naam}</option>)}
          </select></div>
        <div style={{gridColumn:"1/3"}}><label style={lbl}>{tx("Omschrijving van de klacht")}</label><textarea style={{...inp,minHeight:80}} value={form.omschrijving} onChange={e=>zet("omschrijving", e.target.value)} /></div>
      </div>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button style={btn(C.groen)} disabled={bezig} onClick={opslaan}>{tx("💾 Opslaan")}</button>
        <button style={{...btn("white", C.text), border:`1px solid ${C.border}`}} onClick={()=>setForm(null)}>{tx("Annuleren")}</button>
      </div>
    </div>
  );

  return (
    <div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",marginBottom:10}}>
        <button style={btn(C.blauw)} onClick={()=>setForm({ ...LEEG, ontvangen_op: vandaag() })}>{tx("➕ Klacht registreren")}</button>
        <button style={{...btn("white", C.text), border:`1px solid ${C.border}`}} onClick={exporteer}>{tx("⬇️ Export voor controle (Excel)")}</button>
        <span style={{fontSize:12,color:C.muted}}>{txv("{0} open", open.length)}{telaat > 0 && <b style={{color:C.rood}}> · {txv("{0} over de termijn", telaat)}</b>}</span>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:10,fontSize:12}}>
        <label>{tx("Van")} <input type="date" style={{...inp,width:150}} value={filter.van} onChange={e=>setFilter(f=>({...f,van:e.target.value}))} /></label>
        <label>{tx("Tot en met")} <input type="date" style={{...inp,width:150}} value={filter.tot} onChange={e=>setFilter(f=>({...f,tot:e.target.value}))} /></label>
        <select style={{...inp,width:220}} value={filter.woning} onChange={e=>setFilter(f=>({...f,woning:e.target.value}))}>
          <option value="">{tx("Alle woningen")}</option>{(huizen || []).map(h => <option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
        </select>
        <select style={{...inp,width:160}} value={filter.status} onChange={e=>setFilter(f=>({...f,status:e.target.value}))}>
          <option value="">{tx("Alle statussen")}</option>{Object.entries(STATUS).map(([k,l]) => <option key={k} value={k}>{tx(l)}</option>)}
        </select>
      </div>
      <div style={{fontSize:11,color:C.muted,marginBottom:10}}>{tx("Procedure: ontvangst bevestigen binnen 2 werkdagen, afhandelen binnen 10 werkdagen. Ook een klacht die meteen is opgelost registreer je hier.")}</div>
      {laden ? <div style={{color:C.muted}}>{tx("Laden…")}</div>
        : !gefilterd.length ? <div style={{color:C.muted,padding:20,textAlign:"center",background:"white",borderRadius:10,border:`1px solid ${C.border}`}}>{tx("Geen klachten in deze selectie.")}</div>
        : gefilterd.map(k => {
          const t = termijn(k);
          const magBewerken = isBeheer || gebruiker?.id === k.behandelaar_id;
          return (
            <div key={k.id} style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${t.kleur}`,borderRadius:10,padding:12,marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                <div style={{fontWeight:700,color:C.text}}>#{k.id} · {adres(k)}</div>
                <div style={{display:"flex",gap:6}}><Badge kleur={k.status === "afgehandeld" ? C.groen : C.blauw}>{tx(STATUS[k.status])}</Badge><Badge kleur={t.kleur}>{t.tekst}</Badge></div>
              </div>
              <div style={{fontSize:12,color:C.muted,margin:"4px 0"}}>
                {fmt(k.ontvangen_op)} · {tx(INDIENER[k.indiener_type])}{k.indiener_naam ? ` (${k.indiener_naam})` : ""} · {tx(KANAAL[k.kanaal])} · {tx(CATEGORIE[k.categorie])} · {tx("behandelaar")}: {k.behandelaar_naam || "—"}
              </div>
              <div style={{fontSize:13,whiteSpace:"pre-wrap"}}>{k.omschrijving}</div>
              {k.maatregel && <div style={{fontSize:12,marginTop:6,background:"#f0fdf4",padding:"6px 8px",borderRadius:6}}><b>{tx("Gedaan")}:</b> {k.maatregel}{k.terugkoppeling ? <><br/><b>{tx("Teruggekoppeld")}:</b> {k.terugkoppeling}</> : null}</div>}
              {magBewerken && <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                {!k.bevestigd_op && k.status !== "afgehandeld" && <button style={btn(C.oranje)} disabled={bezig} onClick={()=>actie(k,"bevestigd")}>{tx("✉️ Ontvangst bevestigd")}</button>}
                {k.status !== "afgehandeld" && <button style={btn(C.groen)} disabled={bezig} onClick={()=>actie(k,"afgehandeld")}>{tx("✓ Afgehandeld")}</button>}
                {k.status === "afgehandeld" && <button style={{...btn("white", C.text), border:`1px solid ${C.border}`}} disabled={bezig} onClick={()=>actie(k,"heropend")}>{tx("Heropenen")}</button>}
                <button style={{...btn("white", C.text), border:`1px solid ${C.border}`}} onClick={()=>setForm({ ...LEEG, ...Object.fromEntries(Object.keys(LEEG).map(v => [v, k[v] ?? ""])), id:k.id })}>{tx("Wijzigen")}</button>
              </div>}
            </div>
          );
        })}
    </div>
  );
}
