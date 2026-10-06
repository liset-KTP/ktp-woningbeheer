import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";
import { SJABLOON_TALEN, WERKGEVER_JURIDISCH, VOORZIENINGEN, contractWaarden, informatiebladWaarden, meldpuntVoor, vulSjabloon, haalSjabloon, bewaarBestand } from "./huurcontractWord";

// ─── HUURCONTRACTEN (backoffice) ─────────────────────────────────────────────
// Overzicht per bewoner: moet er nog een huurovereenkomst gemaakt/getekend worden,
// en loopt de huur (max 26 weken, of eerder bij uit dienst) bijna af?
//
// Bron = tabel huurovereenkomsten. De databasefunctie huurovereenkomsten_sync()
// legt de kamerbezetting naast de contracten (draait bij openen van deze pagina):
//   - nieuwe bewoner           -> regel "te maken", velden voorgevuld
//   - bewoner in andere kamer  -> oude regel afgesloten (verhuisd), nieuwe regel;
//                                 einddatum blijft eerste aankomst + 26 weken
//   - bewoner weg              -> regel afgesloten (vertrokken)
// Documenten zelf staan in Cockpit (dossier medewerker) + OneDrive (map woning).

const C = {
  blauw:"#1B3A6B", groen:"#4A9B3C", bg:"#f0f4f8", card:"#ffffff", border:"#d1dbe8",
  text:"#1a2b47", muted:"#6b7a8d", rood:"#ef4444", oranje:"#f59e0b", paars:"#7c3aed",
};
const SIGNAAL_DAGEN = 42;          // 6 weken vóór einde huur: actie (verhuizing/brief)
const PKS_MAX = 159.85;            // prijspeil 1-1-2026 (sjabloon art. 4.1)
const WERKGEVER_TEKST = { KTP:"KTP Backoffice", FP:"Flexpedia" };
const TAAL_LABEL = { NL:"Nederlands", EN:"Engels", PL:"Pools", RO:"Roemeens" };

const inp = { width:"100%", padding:"7px 9px", border:`1px solid ${C.border}`, borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", background:"white", color:C.text };
const btn = (bg, fg="white") => ({ padding:"7px 12px", borderRadius:7, border:"none", background:bg, color:fg, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" });
const lbl = { fontSize:11, fontWeight:700, color:C.muted, marginBottom:3, display:"block" };

function vandaag() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function fmt(d) { if (!d) return "—"; const [y,m,dd] = d.slice(0,10).split("-"); return `${dd}-${m}-${y}`; }
function plusDagen(iso, n) { const d = new Date(iso+"T12:00:00"); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function dagenTot(iso) { if (!iso) return null; return Math.round((new Date(iso+"T12:00:00") - new Date(vandaag()+"T12:00:00"))/86400000); }
function geld(n) { return n==null || n==="" ? "—" : "€ " + Number(n).toFixed(2).replace(".",","); }
// Einde huur: 6 maanden min 1 dag na eerste aankomst (afspraak KTP), maar nooit later dan
// 26 weken incl. begindatum (= +181 dagen) — dat is het maximum uit het contract (art. 3.1 / Huurbevestiging).
// Zelfde regel in de database: huurovereenkomsten_sync().
function maxEinde(eerste) { return eerste ? plusDagen(eerste, 181) : null; }
function berekenEinde(eerste) {
  if (!eerste) return null;
  const [y, m, d] = eerste.split("-").map(Number);
  const laatsteDag = new Date(Date.UTC(y, m - 1 + 6 + 1, 0)).getUTCDate();      // laatste dag van maand +6
  const zesMnd = new Date(Date.UTC(y, m - 1 + 6, Math.min(d, laatsteDag)));      // 31-08 + 6 mnd = 28/29-02
  zesMnd.setUTCDate(zesMnd.getUTCDate() - 1);
  const einde = zesMnd.toISOString().slice(0, 10);
  return einde < maxEinde(eerste) ? einde : maxEinde(eerste);
}
// Effectieve einde huur: vaste einddatum, of eerder als iemand eerder uit dienst gaat
function effectiefEinde(c) {
  if (c.uit_dienst_datum && (!c.einddatum || c.uit_dienst_datum < c.einddatum)) return c.uit_dienst_datum;
  return c.einddatum;
}
function ontbreekt(c) {
  const m = [];
  if (!c.werkgever) m.push("KTP/FP");
  if (c.huurprijs == null) m.push("huurprijs");
  if (!c.begindatum) m.push("begindatum");
  if (!c.einddatum) m.push(c.soort==="verhuizing" ? "eerste aankomst" : "einddatum");
  if (!c.taal) m.push("taal");
  return m;
}

const VIEWS = [
  { k:"te_doen",   label:"📝 Te maken",              f:c=>c.actief && c.status==="te_maken" },
  { k:"verstuurd", label:"📤 Wacht op handtekening", f:c=>c.actief && c.status==="verstuurd" },
  { k:"einde",     label:"⏰ Einde in zicht",         f:c=>{ const d=dagenTot(effectiefEinde(c)); return c.actief && d!=null && d<=SIGNAAL_DAGEN && !c.einde_brief_op; } },
  { k:"archief",   label:"🗂️ Nog niet opgeslagen",   f:c=>c.status==="getekend" && (!c.in_cockpit || !c.in_onedrive) },
  { k:"getekend",  label:"✅ Getekend",               f:c=>c.actief && c.status==="getekend" },
  { k:"alle",      label:"Alle actieve",             f:c=>c.actief },
  { k:"afgesloten",label:"Afgesloten",               f:c=>!c.actief },
];

function Badge({ kleur, children, title }) {
  return <span title={title} style={{padding:"2px 8px",borderRadius:10,background:kleur+"18",color:kleur,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{children}</span>;
}

function EindeBadge({ c }) {
  const eind = effectiefEinde(c);
  const d = dagenTot(eind);
  if (d == null) return <Badge kleur={C.rood}>einde onbekend</Badge>;
  const uitDienst = c.uit_dienst_datum && eind === c.uit_dienst_datum;
  const tekst = d < 0 ? `${-d} d verlopen` : d <= SIGNAAL_DAGEN ? `nog ${d} d` : `nog ${Math.floor(d/7)} wk`;
  const kleur = d < 0 ? C.rood : d <= SIGNAAL_DAGEN ? C.oranje : C.groen;
  return <Badge kleur={kleur} title={uitDienst ? "Eerder uit dienst" : "26 weken na eerste aankomst"}>{uitDienst ? "uit dienst · " : ""}{tekst}</Badge>;
}

function StatusBadge({ c }) {
  if (!c.actief) {
    const zonder = c.status !== "getekend";
    return <Badge kleur={zonder ? C.rood : C.muted}>{c.afgesloten_reden==="verhuisd" ? "verhuisd" : "vertrokken"}{zonder ? " · nooit getekend" : ""}</Badge>;
  }
  if (c.status === "getekend") return <Badge kleur={C.groen}>getekend {fmt(c.getekend_op)}</Badge>;
  if (c.status === "verstuurd") {
    const d = c.verstuurd_op ? -dagenTot(c.verstuurd_op) : null;
    return <Badge kleur={d>7 ? C.rood : C.paars}>verstuurd{d!=null ? ` · ${d} d` : ""}</Badge>;
  }
  return <Badge kleur={C.oranje}>te maken</Badge>;
}

function huurbevestigingTekst(c, huis) {
  const eind = effectiefEinde(c);
  return [
    `Huurder: ${c.naam_medewerker}`,
    `Adres: ${huis?.adres || "?"}`,
    `Plaats: ${[huis?.postcode, huis?.stad].filter(Boolean).join(" ") || "?"}`,
    `Kamernummer: ${c.kamer || "?"}`,
    `Huurprijs: ${c.huurprijs!=null ? geld(c.huurprijs) : "?"} per week`,
    `Afspraken facturatie: via salaris`,
    `Waarborgsom: ${c.borg!=null ? geld(c.borg) : "?"}`,
    `Begindatum: ${fmt(c.begindatum)}`,
    `Einddatum: ${fmt(eind)}`,
    `Werkgever: ${WERKGEVER_JURIDISCH[c.werkgever] || "?"}`,
    `Max. aantal bewoners woning (informatieblad): ${huis?.kamers?.length ?? "?"}`,
  ].join("\n");
}

// Invoer voor de Word-documenten (niet opgeslagen). Staat in de pagina i.p.v. in het formulier,
// zodat het blijft staan als het formulier na opslaan opnieuw laadt.
function startInvoer(huis) {
  return {
    extra: { geboorteplaats:"", geboortedatum:"", telefoon:"", documentnummer:"", bijzonderheden:"geen bijzonderheden", datumOndertekening: vandaag() },
    info: { voorzieningen: VOORZIENINGEN.filter(v => v.standaard).map(v => v.k), maxBewoners: huis?.kamers?.length || "" },
  };
}

function ContractDetail({ c, huis, gebruiker, onOpslaan, onLog, showToast, bezig, invoer, setInvoer }) {
  const [f, setF] = useState(() => ({
    werkgever: c.werkgever || "", huurprijs: c.huurprijs ?? "", borg: c.borg ?? "", taal: c.taal || "",
    begindatum: c.begindatum || "", eerste_aankomst: c.eerste_aankomst || "", einddatum: c.einddatum || "",
    einddatum_handmatig: !!c.einddatum_handmatig, uit_dienst_datum: c.uit_dienst_datum || "", opmerking: c.opmerking || "",
  }));
  const [tekenDatum, setTekenDatum] = useState(vandaag());
  // Alleen voor het Word-document; wordt bewust niet opgeslagen (privacy)
  const { extra, info } = invoer || startInvoer(huis);
  const zetDeel = deel => upd => setInvoer(s => ({ ...s, [deel]: typeof upd === "function" ? upd(s[deel]) : upd }));
  const setExtra = zetDeel("extra"), setInfo = zetDeel("info");
  const [maakt, setMaakt] = useState(false);
  // Informatieblad: per woning verschillend, (nog) niet opgeslagen — na SNF-certificering per woning vastleggen
  const meldpunt = meldpuntVoor(huis?.stad);
  const zet = (k, v) => setF(p => {
    const n = { ...p, [k]: v };
    // Bij aankomst/bestaand is eerste aankomst = begindatum
    if (k === "begindatum" && c.soort !== "verhuizing") n.eerste_aankomst = v;
    if ((k === "begindatum" || k === "eerste_aankomst") && !n.einddatum_handmatig) n.einddatum = berekenEinde(n.eerste_aankomst) || "";
    if (k === "einddatum_handmatig" && !v) n.einddatum = berekenEinde(n.eerste_aankomst) || "";
    return n;
  });

  const gewijzigd = Object.keys(f).some(k => String(f[k] ?? "") !== String((k==="einddatum_handmatig" ? !!c[k] : c[k]) ?? ""));
  const naarDb = () => ({
    werkgever: f.werkgever || null,
    huurprijs: f.huurprijs === "" ? null : Number(String(f.huurprijs).replace(",", ".")),
    borg: f.borg === "" ? null : Number(String(f.borg).replace(",", ".")),
    taal: f.taal || null, begindatum: f.begindatum || null, eerste_aankomst: f.eerste_aankomst || null,
    einddatum: f.einddatum || null, einddatum_handmatig: f.einddatum_handmatig,
    uit_dienst_datum: f.uit_dienst_datum || null, opmerking: f.opmerking.trim() || null,
  });

  const huur = f.huurprijs === "" ? null : Number(String(f.huurprijs).replace(",", "."));
  const ontbr = ontbreekt({ ...c, ...naarDb() });
  const eind = effectiefEinde({ ...c, ...naarDb() });
  const dEind = dagenTot(eind);
  const brief = f.uit_dienst_datum ? "brief 6 (einde arbeids- én huurovereenkomst)" : "brief 7 (einde huurovereenkomst) — of brief 5 bij verhuizing";
  const sjabloon = !f.taal ? "kies taal" : f.taal === "NL" ? "Nederlands" : `Nederlands + ${TAAL_LABEL[f.taal]}`;

  async function downloadWord(soort = "huurovereenkomst") {
    const isInfo = soort === "informatieblad";
    if (!f.taal) return showToast("Kies eerst de taal", "err");
    if (!isInfo && ontbr.length) return showToast("Eerst invullen: " + ontbr.join(", "), "err");
    if (isInfo && !info.voorzieningen.length) return showToast("Vink minstens één gedeelde voorziening aan", "err");
    if (gewijzigd && !(await onOpslaan(c, naarDb(), null))) return;
    if (!SJABLOON_TALEN.includes(f.taal)) return showToast(`Sjabloon ${TAAL_LABEL[f.taal]} is er nog niet`, "err");
    setMaakt(true);
    try {
      const sjabloon = await haalSjabloon(f.taal, soort);
      if (!sjabloon) return showToast(`Sjabloon ${TAAL_LABEL[f.taal]} kon niet geladen worden`, "err");
      const waarden = isInfo ? informatiebladWaarden(huis, info) : contractWaarden({ ...c, ...naarDb() }, huis, eind, extra);
      const blob = await vulSjabloon(sjabloon, waarden);
      const titel = isInfo ? "Informatieblad" : "Huurovereenkomst";
      bewaarBestand(blob, `${titel} ${c.naam_medewerker}.docx`);
      showToast(`📄 ${titel} gedownload`);
    } catch (e) {
      showToast("Word maken mislukt: " + e.message, "err");
    } finally { setMaakt(false); }
  }
  async function status(nieuw) {
    if (gewijzigd) { const ok = await onOpslaan(c, naarDb(), null); if (!ok) return; }
    if (nieuw === "verstuurd") {
      if (ontbr.length) return showToast("Eerst invullen: " + ontbr.join(", "), "err");
      if (await onOpslaan(c, { status:"verstuurd", verstuurd_op: vandaag(), verstuurd_door: gebruiker?.naam || "?" }, null))
        onLog(c, `📤 Huurovereenkomst verstuurd (${WERKGEVER_TEKST[f.werkgever]}, ${huis?.adres||"?"} K${c.kamer||"?"}, huur ${geld(huur)} p/w, t/m ${fmt(eind)})`);
    } else if (nieuw === "getekend") {
      if (ontbr.length) return showToast("Eerst invullen: " + ontbr.join(", "), "err");
      if (!tekenDatum || tekenDatum > vandaag()) return showToast("Ongeldige tekendatum", "err");
      if (await onOpslaan(c, { status:"getekend", getekend_op: tekenDatum, getekend_door: gebruiker?.naam || "?",
            verstuurd_op: c.verstuurd_op || tekenDatum, verstuurd_door: c.verstuurd_door || gebruiker?.naam || "?" }, null))
        onLog(c, `✍️ Huurovereenkomst getekend op ${fmt(tekenDatum)} (${huis?.adres||"?"} K${c.kamer||"?"}, t/m ${fmt(eind)})`);
    } else if (nieuw === "te_maken") {
      if (window.confirm("Status terugzetten naar 'te maken'?"))
        await onOpslaan(c, { status:"te_maken", getekend_op:null, getekend_door:null, verstuurd_op:null, verstuurd_door:null }, "Status teruggezet");
    }
  }
  async function eindeBrief() {
    if (await onOpslaan(c, { einde_brief_op: vandaag(), einde_brief_door: gebruiker?.naam || "?" }, null))
      onLog(c, `✉️ Brief einde huur verstuurd (einde ${fmt(eind)}${f.uit_dienst_datum ? ", uit dienst" : ""})`);
  }

  return (
    <div style={{background:"#f8fafc",borderTop:`1px solid ${C.border}`,padding:14}}>
      {c.soort === "verhuizing" && <div style={{fontSize:12,color:C.paars,marginBottom:10}}>🔁 Verhuizing: nieuwe huurbevestiging (nieuw adres). Einddatum blijft 26 weken na de <b>eerste</b> aankomst. Stuur ook brief 5 (verhuizing).</div>}
      {c.soort === "bestaand" && !c.begindatum && <div style={{fontSize:12,color:C.rood,marginBottom:10}}>⚠️ Bewoner van vóór de app — begindatum onbekend. Zoek de aankomstdatum op (Cockpit/planning) en vul hem in.</div>}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
        <div>
          <span style={lbl}>Werkgever</span>
          <div style={{display:"flex",gap:6}}>
            {["KTP","FP"].map(w => (
              <button key={w} type="button" onClick={()=>zet("werkgever", f.werkgever===w ? "" : w)}
                style={{...btn(f.werkgever===w ? C.blauw : "white", f.werkgever===w ? "white" : C.text), border:`1px solid ${f.werkgever===w ? C.blauw : C.border}`, flex:1}}>{w}</button>
            ))}
          </div>
          <div style={{fontSize:10,color:C.muted,marginTop:3}}>{f.werkgever==="KTP" ? "Tekenen via Kentro" : f.werkgever==="FP" ? "Printen en laten tekenen" : ""}</div>
        </div>
        <div>
          <span style={lbl}>Huurprijs per week (€)</span>
          <input style={{...inp, borderColor: f.huurprijs==="" ? C.oranje : C.border}} inputMode="decimal" value={f.huurprijs} onChange={e=>zet("huurprijs", e.target.value)} placeholder="bijv. 130,00" />
          {huur > PKS_MAX && <div style={{fontSize:10,color:C.oranje,marginTop:3}}>Boven PKS-maximum {geld(PKS_MAX)} — klopt dat?</div>}
        </div>
        <div>
          <span style={lbl}>Waarborgsom (€)</span>
          <input style={inp} inputMode="decimal" value={f.borg} onChange={e=>zet("borg", e.target.value)} />
          <div style={{fontSize:10,color:C.muted,marginTop:3}}>Uit borgplan</div>
        </div>
        <div>
          <span style={lbl}>Taal contract</span>
          <select style={inp} value={f.taal} onChange={e=>zet("taal", e.target.value)}>
            <option value="">— kies —</option>
            {Object.entries(TAAL_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <span style={lbl}>{c.soort==="verhuizing" ? "Begindatum (verhuisdatum)" : "Begindatum"}</span>
          <input type="date" style={{...inp, borderColor: !f.begindatum ? C.rood : C.border}} value={f.begindatum} onChange={e=>zet("begindatum", e.target.value)} />
        </div>
        {c.soort === "verhuizing" && (
          <div>
            <span style={lbl}>Eerste aankomst</span>
            <input type="date" style={{...inp, borderColor: !f.eerste_aankomst ? C.rood : C.border}} value={f.eerste_aankomst} onChange={e=>zet("eerste_aankomst", e.target.value)} />
          </div>
        )}
        <div>
          <span style={lbl}>Einddatum (max 26 wk)</span>
          <input type="date" style={inp} value={f.einddatum} disabled={!f.einddatum_handmatig} onChange={e=>zet("einddatum", e.target.value)} />
          <label style={{fontSize:10,color:C.muted,display:"flex",gap:4,alignItems:"center",marginTop:3}}>
            <input type="checkbox" checked={f.einddatum_handmatig} onChange={e=>zet("einddatum_handmatig", e.target.checked)} /> handmatig (korter)
          </label>
          {f.einddatum_handmatig && f.einddatum && f.eerste_aankomst && f.einddatum > maxEinde(f.eerste_aankomst) &&
            <div style={{fontSize:10,color:C.rood,marginTop:3}}>Langer dan 26 weken — niet toegestaan bij huur van korte duur</div>}
        </div>
        <div>
          <span style={lbl}>Uit dienst per (eerder)</span>
          <input type="date" style={inp} value={f.uit_dienst_datum} onChange={e=>zet("uit_dienst_datum", e.target.value)} />
        </div>
      </div>
      <div style={{marginTop:10}}>
        <span style={lbl}>Opmerking</span>
        <input style={inp} value={f.opmerking} onChange={e=>zet("opmerking", e.target.value)} placeholder="Optioneel" />
      </div>

      {gewijzigd && (
        <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}>
          <button style={btn(C.groen)} disabled={bezig} onClick={()=>onOpslaan(c, naarDb(), "💾 Opgeslagen")}>{bezig ? "Opslaan…" : "💾 Opslaan"}</button>
        </div>
      )}

      {/* Huurovereenkomst als Word: sjabloon in de juiste taal, ingevuld met de gegevens hierboven */}
      <div style={{marginTop:14,background:"white",border:`1px solid ${C.border}`,borderRadius:9,padding:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8}}>
          <div style={{fontWeight:800,fontSize:13,color:C.text}}>📄 Huurovereenkomst <span style={{fontWeight:400,color:C.muted,fontSize:12}}>· sjabloon: {sjabloon}</span></div>
          <button style={btn(C.blauw)} disabled={maakt || bezig} onClick={()=>downloadWord()}>{maakt ? "Bezig…" : "⬇️ Download Word"}</button>
        </div>
        {f.taal && !SJABLOON_TALEN.includes(f.taal) && <div style={{fontSize:12,color:C.rood,marginBottom:8}}>⚠️ Sjabloon {TAAL_LABEL[f.taal]} is er nog niet — Word downloaden kan nu alleen in {SJABLOON_TALEN.map(t=>TAAL_LABEL[t]).join(" en ")}.</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:6}}>
          <div><span style={lbl}>Geboorteplaats</span><input style={inp} value={extra.geboorteplaats} onChange={e=>setExtra(p=>({...p,geboorteplaats:e.target.value}))} /></div>
          <div><span style={lbl}>Geboortedatum</span><input type="date" style={inp} value={extra.geboortedatum} onChange={e=>setExtra(p=>({...p,geboortedatum:e.target.value}))} /></div>
          <div><span style={lbl}>Telefoonnummer</span><input style={inp} value={extra.telefoon} onChange={e=>setExtra(p=>({...p,telefoon:e.target.value}))} /></div>
          <div><span style={lbl}>Nr. ID-document</span><input style={inp} value={extra.documentnummer} onChange={e=>setExtra(p=>({...p,documentnummer:e.target.value}))} /></div>
          <div><span style={lbl}>Datum ondertekening</span><input type="date" style={inp} value={extra.datumOndertekening} onChange={e=>setExtra(p=>({...p,datumOndertekening:e.target.value}))} /></div>
          <div><span style={lbl}>Bijzonderheden</span><input style={inp} value={extra.bijzonderheden} onChange={e=>setExtra(p=>({...p,bijzonderheden:e.target.value}))} /></div>
        </div>
        <div style={{fontSize:11,color:C.muted,marginBottom:8}}>🔒 Deze velden komen alleen in het Word-bestand en worden niet opgeslagen. Leeg laten = stippellijn, met de hand invullen na printen.</div>
        <details>
          <summary style={{fontSize:12,color:C.muted,cursor:"pointer"}}>Controle: wat er in de Huurbevestiging komt</summary>
          <pre style={{margin:"6px 0 0",fontSize:12,fontFamily:"inherit",whiteSpace:"pre-wrap",color:C.text,lineHeight:1.6}}>{huurbevestigingTekst({ ...c, ...naarDb() }, huis)}</pre>
        </details>
      </div>

      {/* Informatieblad (Wet goed verhuurderschap): zelfde taal, meldpunt volgt uit de plaats van de woning */}
      <div style={{marginTop:10,background:"white",border:`1px solid ${C.border}`,borderRadius:9,padding:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8}}>
          <div style={{fontWeight:800,fontSize:13,color:C.text}}>ℹ️ Informatieblad <span style={{fontWeight:400,color:C.muted,fontSize:12}}>· {sjabloon}</span></div>
          <button style={btn(C.blauw)} disabled={maakt || bezig} onClick={()=>downloadWord("informatieblad")}>{maakt ? "Bezig…" : "⬇️ Download Word"}</button>
        </div>
        <span style={lbl}>Gedeelde voorzieningen in deze woning</span>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:8}}>
          {VOORZIENINGEN.map(v => (
            <label key={v.k} style={{fontSize:12,display:"flex",gap:4,alignItems:"center",cursor:"pointer"}}>
              <input type="checkbox" checked={info.voorzieningen.includes(v.k)}
                onChange={e=>setInfo(p=>({...p, voorzieningen: e.target.checked ? [...p.voorzieningen, v.k] : p.voorzieningen.filter(x=>x!==v.k)}))} /> {v.NL}
            </label>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8}}>
          <div><span style={lbl}>Max. aantal bewoners</span><input style={inp} inputMode="numeric" value={info.maxBewoners} onChange={e=>setInfo(p=>({...p,maxBewoners:e.target.value.replace(/\D/g,"")}))} /></div>
          <div style={{gridColumn:"span 2"}}><span style={lbl}>Meldpunt gemeente ({huis?.stad || "?"})</span>
            <div style={{fontSize:12,color: meldpunt ? C.text : C.rood, paddingTop:6}}>{meldpunt || "⚠️ Geen meldpunt bekend voor deze plaats — wordt een stippellijn. Laat toevoegen in huurcontractWord.js (MELDPUNTEN)."}</div>
          </div>
        </div>
      </div>

      {/* Acties */}
      {c.actief && (
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginTop:14}}>
          {c.status === "te_maken" && <button style={btn(C.paars)} disabled={bezig} onClick={()=>status("verstuurd")}>📤 Verstuurd ter ondertekening</button>}
          {c.status !== "getekend" && (<>
            <input type="date" style={{...inp,width:150}} value={tekenDatum} max={vandaag()} onChange={e=>setTekenDatum(e.target.value)} />
            <button style={btn(C.groen)} disabled={bezig} onClick={()=>status("getekend")}>✍️ Getekend</button>
          </>)}
          {c.status !== "te_maken" && <button style={btn("white", C.muted)} disabled={bezig} onClick={()=>status("te_maken")}>↩️ Terugzetten</button>}
          {ontbr.length > 0 && <span style={{fontSize:11,color:C.oranje}}>Nog invullen: {ontbr.join(", ")}</span>}
        </div>
      )}
      {c.status === "getekend" && (
        <div style={{display:"flex",gap:16,flexWrap:"wrap",marginTop:12,fontSize:13}}>
          <label style={{display:"flex",gap:6,alignItems:"center",cursor:"pointer"}}>
            <input type="checkbox" checked={!!c.in_cockpit} onChange={e=>onOpslaan(c, { in_cockpit: e.target.checked }, e.target.checked ? "Opgeslagen in Cockpit ✓" : null)} /> Opgeslagen in Cockpit (dossier medewerker)
          </label>
          <label style={{display:"flex",gap:6,alignItems:"center",cursor:"pointer"}}>
            <input type="checkbox" checked={!!c.in_onedrive} onChange={e=>onOpslaan(c, { in_onedrive: e.target.checked }, e.target.checked ? "Opgeslagen in OneDrive ✓" : null)} /> Opgeslagen in OneDrive (map woning)
          </label>
        </div>
      )}
      {c.actief && dEind != null && dEind <= SIGNAAL_DAGEN && (
        <div style={{marginTop:12,padding:10,borderRadius:8,background:C.oranje+"15",fontSize:12,color:C.text}}>
          ⏰ Huur eindigt {fmt(eind)}{dEind < 0 ? " (verlopen!)" : ""}. Informeer huismeester + kandidaat, regel verhuizing of vertrek en stuur {brief}.
          <div style={{marginTop:8}}>
            {c.einde_brief_op
              ? <span style={{color:C.groen,fontWeight:700}}>✉️ Brief verstuurd op {fmt(c.einde_brief_op)} door {c.einde_brief_door}</span>
              : <button style={btn(C.oranje)} disabled={bezig} onClick={eindeBrief}>✉️ Brief einde huur verstuurd</button>}
          </div>
        </div>
      )}
      {(c.verstuurd_door || c.getekend_door) && (
        <div style={{fontSize:11,color:C.muted,marginTop:10}}>
          {c.verstuurd_op && <>Verstuurd {fmt(c.verstuurd_op)} door {c.verstuurd_door}. </>}
          {c.getekend_op && <>Getekend {fmt(c.getekend_op)} (afgevinkt door {c.getekend_door}).</>}
        </div>
      )}
    </div>
  );
}

export default function HuurcontractenModule({ gebruiker, houses = [], showToast }) {
  const [rijen, setRijen] = useState([]);
  const [laden, setLaden] = useState(true);
  const [bezig, setBezig] = useState(false);
  const [view, setView] = useState("te_doen");
  const [zoek, setZoek] = useState("");
  const [open, setOpen] = useState(null);
  const [docInvoer, setDocInvoer] = useState({});  // per contract-id, alleen in het geheugen

  // showToast is in App een nieuwe functie per render: via ref, anders draait de sync in een lus
  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  const huisMap = useMemo(() => Object.fromEntries(houses.map(h => [h.id, h])), [houses]);

  const laad = useCallback(async (metSync) => {
    setLaden(true);
    if (metSync) {
      const { data: s, error: e } = await supabase.rpc("huurovereenkomsten_sync");
      if (e) toastRef.current("Sync mislukt: " + e.message, "err");
      else if (s && (s.nieuw || s.verhuisd || s.vertrokken))
        toastRef.current(`Bijgewerkt: ${s.nieuw} nieuw, ${s.verhuisd} verhuisd, ${s.vertrokken} vertrokken`);
    }
    const sinds = plusDagen(vandaag(), -120);
    const { data, error } = await supabase.from("huurovereenkomsten").select("*")
      .or(`actief.eq.true,afgesloten_op.gte.${sinds}`).order("naam_medewerker");
    if (error) toastRef.current("Laden mislukt: " + error.message, "err");
    setRijen(data || []);
    setLaden(false);
  }, []);

  useEffect(() => { laad(true); }, [laad]);

  async function opslaan(c, velden, melding) {
    setBezig(true);
    const { data, error } = await supabase.from("huurovereenkomsten")
      .update({ ...velden, bijgewerkt_door: gebruiker?.naam || "?" }).eq("id", c.id).select().single();
    setBezig(false);
    if (error) { showToast("Opslaan mislukt: " + error.message, "err"); return false; }
    setRijen(r => r.map(x => x.id === c.id ? data : x));
    if (melding) showToast(melding);
    return true;
  }
  async function log(c, omschrijving) {
    // extra.medewerker -> komt ook in het Cockpit-dossier via de dossier-sync
    await supabase.from("activiteiten").insert([{ type:"huurcontract", omschrijving, gedaan_door: gebruiker?.naam || "?",
      extra:{ medewerker: c.naam_medewerker, huurcontract_id: c.id } }]);
    showToast(omschrijving.slice(0, 60));
  }

  const tellers = useMemo(() => Object.fromEntries(VIEWS.map(v => [v.k, rijen.filter(v.f).length])), [rijen]);
  const zonderBegin = rijen.filter(c => c.actief && !c.einddatum).length;
  const zichtbaar = useMemo(() => {
    const v = VIEWS.find(x => x.k === view);
    const q = zoek.trim().toLowerCase();
    let lijst = rijen.filter(v.f);
    if (q) lijst = lijst.filter(c => c.naam_medewerker.toLowerCase().includes(q) || (huisMap[c.woning_id]?.adres || "").toLowerCase().includes(q));
    if (view === "einde") lijst = [...lijst].sort((a,b) => (effectiefEinde(a)||"").localeCompare(effectiefEinde(b)||""));
    return lijst;
  }, [rijen, view, zoek, huisMap]);

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:10,flexWrap:"wrap",marginBottom:12}}>
        <div>
          <div style={{fontSize:20,fontWeight:800,color:C.text}}>📄 Huurcontracten</div>
          <div style={{fontSize:12,color:C.muted}}>Wie moet nog tekenen, en wiens huur (max 26 weken) loopt af. Documenten: Cockpit + OneDrive.</div>
        </div>
        <button style={btn("white", C.blauw)} onClick={()=>laad(true)} disabled={laden}>🔄 Vernieuwen</button>
      </div>

      {zonderBegin > 0 && (
        <div style={{background:C.rood+"12",border:`1px solid ${C.rood}40`,borderRadius:9,padding:10,fontSize:13,color:C.text,marginBottom:12}}>
          ⚠️ <b>{zonderBegin}</b> bewoner(s) zonder bekende (eerste) aankomstdatum — einde huur kan niet bewaakt worden. Filter "Alle actieve" en vul de begindatum in.
        </div>
      )}

      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
        {VIEWS.map(v => (
          <button key={v.k} onClick={()=>{ setView(v.k); setOpen(null); }}
            style={{...btn(view===v.k ? C.blauw : "white", view===v.k ? "white" : C.text), border:`1px solid ${view===v.k ? C.blauw : C.border}`}}>
            {v.label} <span style={{opacity:.75}}>({tellers[v.k] || 0})</span>
          </button>
        ))}
      </div>
      <input style={{...inp, maxWidth:320, marginBottom:12}} placeholder="🔍 Zoek naam of adres" value={zoek} onChange={e=>setZoek(e.target.value)} />

      {laden ? <div style={{color:C.muted,padding:20}}>Laden…</div> : zichtbaar.length === 0 ? (
        <div style={{color:C.muted,padding:20,textAlign:"center",background:C.card,borderRadius:10,border:`1px solid ${C.border}`}}>Niets in deze lijst 🎉</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {zichtbaar.map(c => {
            const huis = huisMap[c.woning_id];
            const isOpen = open === c.id;
            const ontbr = c.actief && c.status !== "getekend" ? ontbreekt(c) : [];
            return (
              <div key={c.id} style={{background:C.card,border:`1px solid ${isOpen ? C.blauw : C.border}`,borderRadius:10,overflow:"hidden"}}>
                <div onClick={()=>setOpen(isOpen ? null : c.id)} style={{padding:"10px 12px",cursor:"pointer",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                  <div style={{flex:"1 1 200px",minWidth:0}}>
                    <div style={{fontWeight:800,fontSize:14,color:C.text}}>{c.naam_medewerker}</div>
                    <div style={{fontSize:12,color:C.muted}}>{huis ? `${huis.adres}, ${huis.stad}` : "woning ?"} · K{c.kamer || "?"}</div>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                    <Badge kleur={c.soort==="verhuizing" ? C.paars : c.soort==="bestaand" ? C.muted : C.blauw}>{c.soort}</Badge>
                    {c.werkgever && <Badge kleur={C.blauw}>{c.werkgever}</Badge>}
                    <span style={{fontSize:12,color:C.muted}}>{fmt(c.begindatum)} → {fmt(effectiefEinde(c))}</span>
                    {c.actief && <EindeBadge c={c} />}
                    <StatusBadge c={c} />
                    {c.status==="getekend" && (!c.in_cockpit || !c.in_onedrive) && <Badge kleur={C.oranje}>niet opgeslagen</Badge>}
                    {ontbr.length > 0 && <Badge kleur={C.rood} title={ontbr.join(", ")}>mist {ontbr.length}</Badge>}
                    <span style={{color:C.muted}}>{isOpen ? "▲" : "▼"}</span>
                  </div>
                </div>
                {isOpen && <ContractDetail key={c.id + c.bijgewerkt_op} c={c} huis={huis} gebruiker={gebruiker} onOpslaan={opslaan} onLog={log} showToast={showToast} bezig={bezig}
                  invoer={docInvoer[c.id]} setInvoer={fn => setDocInvoer(p => ({ ...p, [c.id]: fn(p[c.id] || startInvoer(huis)) }))} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
