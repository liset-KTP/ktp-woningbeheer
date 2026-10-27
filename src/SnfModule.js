import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";

// ─── SNF-INSPECTIES ──────────────────────────────────────────────────────────
// Herstelpunten uit SNF-inspecties (Normec VRO) per woning: bewijs uploaden, backoffice controleert.
//
// Alle schrijfacties lopen via databasefuncties (snf_*) met het sessietoken; de database
// controleert rechten, statusovergangen en het vier-ogenprincipe (zie supabase/snf_inspecties.sql).
// Bestanden staan in de privé bucket "snf-bewijs": uploaden/openen via Edge Function snf-bestand.
//
// Status herstelpunt: open → hersteld (bewijs geüpload) → gecontroleerd (backoffice, niet dezelfde persoon)
//                     hersteld → afgekeurd = terug naar open met reden
// Inspectie wordt automatisch "afgerond" als alle punten gecontroleerd zijn.

const C = {
  blauw:"#1B3A6B", groen:"#4A9B3C", bg:"#f0f4f8", card:"#ffffff", border:"#d1dbe8",
  text:"#1a2b47", muted:"#6b7a8d", rood:"#ef4444", oranje:"#f59e0b", paars:"#7c3aed", grijs:"#94a3b8",
};
const INSTELLING = "Normec VRO B.V.";
const CATEGORIEEN = ["Veiligheid", "Brandveiligheid", "Hygiëne", "Huisvesting", "Informatie", "Overig"];
const STATUS_LABEL = { open:"Open", hersteld:"Hersteld — wacht op controle", gecontroleerd:"Gecontroleerd" };
const STATUS_KLEUR = { open:C.rood, hersteld:C.oranje, gecontroleerd:C.groen };
const ACTIE_LABEL = { aangemaakt:"aangemaakt", hersteld:"hersteld gemeld", goedgekeurd:"goedgekeurd", afgekeurd:"afgekeurd", heropend:"heropend", automatisch:"automatisch" };

const inp = { width:"100%", padding:"7px 9px", border:`1px solid ${C.border}`, borderRadius:7, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", background:"white", color:C.text };
const btn = (bg, fg="white") => ({ padding:"7px 12px", borderRadius:7, border:"none", background:bg, color:fg, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" });
const lbl = { fontSize:11, fontWeight:700, color:C.muted, marginBottom:3, display:"block" };

function vandaag() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function fmt(d) { if (!d) return "—"; const [y,m,dd] = d.slice(0,10).split("-"); return `${dd}-${m}-${y}`; }
function fmtTijd(ts) { if (!ts) return "—"; const d = new Date(ts); return `${d.toLocaleDateString("nl-NL",{day:"2-digit",month:"2-digit",year:"numeric"})} ${d.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"})}`; }
function plusDagen(iso, n) { const d = new Date(iso+"T12:00:00"); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function dagenTot(iso) { if (!iso) return null; return Math.round((new Date(iso+"T12:00:00") - new Date(vandaag()+"T12:00:00"))/86400000); }

// Kleurcode inspectie: groen = alles gecontroleerd; rood = interne deadline verstreken of < 14 dagen tot deadline;
// oranje = < 28 dagen tot deadline; grijs = op schema.
export function snfKleur(insp) {
  if (insp.status === "afgerond") return { kleur:C.groen, label:"Afgerond" };
  const dl = dagenTot(insp.deadline);
  if (dagenTot(insp.interne_deadline) < 0 || dl < 14) return { kleur:C.rood, label: dl < 0 ? `${-dl} dg over deadline` : `nog ${dl} dg` };
  if (dl < 28) return { kleur:C.oranje, label:`nog ${dl} dg` };
  return { kleur:C.grijs, label:`nog ${dl} dg` };
}

function Badge({ kleur, children, title }) {
  return <span title={title} style={{display:"inline-block",padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700,background:kleur+"1f",color:kleur,border:`1px solid ${kleur}55`,whiteSpace:"nowrap"}}>{children}</span>;
}
function Kaart({ children, style }) {
  return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:12,...style}}>{children}</div>;
}

// Edge Function aanroepen; bij een 4xx/5xx zit de foutmelding in de response-body
async function bestandFunctie(body) {
  const { data, error } = await supabase.functions.invoke("snf-bestand", { body });
  if (error) {
    let fout = error.message;
    try { const j = await error.context.json(); fout = j?.fout || fout; } catch {}
    return { ok:false, fout };
  }
  return data || { ok:false, fout:"Geen antwoord" };
}

export default function SnfModule({ gebruiker, sessieToken, houses, gebruikers, showToast }) {
  const [inspecties, setInspecties] = useState([]);
  const [punten, setPunten] = useState([]);
  const [bewijs, setBewijs] = useState([]);
  const [log, setLog] = useState([]);
  const [laden, setLaden] = useState(true);
  const [view, setView] = useState("overzicht");   // overzicht | punten | nieuw
  const [detailId, setDetailId] = useState(null);
  const [bezig, setBezig] = useState(false);
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  const rol = gebruiker?.rol;
  const isBackoffice = rol === "backoffice";
  const huisMap = useMemo(() => Object.fromEntries((houses || []).map(h => [h.id, h])), [houses]);
  const gebrMap = useMemo(() => Object.fromEntries((gebruikers || []).map(g => [g.id, g])), [gebruikers]);
  const naamVan = id => id ? (gebrMap[id]?.naam || `#${id}`) : "—";
  const adresVan = id => huisMap[id] ? `${huisMap[id].adres}, ${huisMap[id].stad}` : `woning #${id}`;
  const magHerstellen = p => isBackoffice || rol === "huismeester" || gebruiker?.id === p.eigenaar_id;

  const laad = useCallback(async () => {
    setLaden(true);
    const [a, b, c, d] = await Promise.all([
      supabase.from("snf_inspecties").select("*").order("inspectiedatum", { ascending:false }),
      supabase.from("snf_herstelpunten").select("*").order("id"),
      supabase.from("snf_bewijs").select("*").order("geupload_op"),
      supabase.from("status_log").select("*").in("bron", ["snf_herstelpunt","snf_inspectie"]).order("op"),
    ]);
    const fout = [a, b, c, d].find(r => r.error);
    if (fout) toastRef.current("Laden mislukt: " + fout.error.message, "err");
    setInspecties(a.data || []); setPunten(b.data || []); setBewijs(c.data || []); setLog(d.data || []);
    setLaden(false);
  }, []);
  useEffect(() => { laad(); }, [laad]);

  // Databasefunctie aanroepen; geeft true bij succes en herlaadt
  async function rpc(fn, params, okTekst) {
    setBezig(true);
    const { data, error } = await supabase.rpc(fn, { p_token: sessieToken, ...params });
    setBezig(false);
    if (error || !data?.ok) { showToast(data?.fout || error?.message || "Actie mislukt", "err"); return null; }
    if (okTekst) showToast(okTekst);
    await laad();
    return data;
  }

  async function openBestand(soort, pad) {
    const venster = window.open("", "_blank");   // direct openen i.v.m. popup-blokkers op telefoon
    const r = await bestandFunctie({ token: sessieToken, actie:"download", soort, pad });
    if (!r.ok) { venster?.close(); showToast(r.fout, "err"); return; }
    if (venster) venster.location.href = r.url; else window.location.href = r.url;
  }

  async function upload(soort, id, file) {
    const r = await bestandFunctie({ token: sessieToken, actie:"upload", soort, id, bestandsnaam: file.name });
    if (!r.ok) { showToast(r.fout, "err"); return null; }
    const { error } = await supabase.storage.from("snf-bewijs").uploadToSignedUrl(r.pad, r.uploadToken, file, { contentType: file.type || undefined });
    if (error) { showToast("Upload mislukt: " + error.message, "err"); return null; }
    return r.pad;
  }

  async function uploadBewijs(punt, files) {
    setBezig(true);
    let n = 0;
    for (const f of files) {
      const pad = await upload("bewijs", punt.id, f);
      if (!pad) continue;
      const { data, error } = await supabase.rpc("snf_bewijs_toevoegen", { p_token: sessieToken, p_herstelpunt_id: punt.id,
        p_pad: pad, p_bestandsnaam: f.name, p_mime: f.type || null, p_grootte: f.size });
      if (error || !data?.ok) showToast(data?.fout || error?.message, "err"); else n++;
    }
    setBezig(false);
    if (n) showToast(`✓ ${n} bestand(en) geüpload`);
    await laad();
  }

  async function uploadRapport(insp, file) {
    setBezig(true);
    const pad = await upload("rapport", insp.id, file);
    setBezig(false);
    if (pad) await rpc("snf_rapport_koppelen", { p_inspectie_id: insp.id, p_pad: pad }, "✓ Rapport opgeslagen");
  }

  const puntenPer = useMemo(() => {
    const m = {};
    for (const p of punten) (m[p.inspectie_id] ||= []).push(p);
    return m;
  }, [punten]);
  const inspMap = useMemo(() => Object.fromEntries(inspecties.map(i => [i.id, i])), [inspecties]);
  const detail = detailId ? inspMap[detailId] : null;

  const ctx = { gebruiker, isBackoffice, naamVan, adresVan, magHerstellen, bewijs, log, bezig, rpc, openBestand,
    uploadBewijs, uploadRapport, gebruikers, houses, puntenPer, inspMap, openDetail: id => setDetailId(id) };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:10,flexWrap:"wrap",marginBottom:12}}>
        <div>
          <div style={{fontSize:20,fontWeight:800,color:C.text}}>🧯 SNF-inspecties</div>
          <div style={{fontSize:12,color:C.muted}}>Herstelpunten per woning: bewijs uploaden → backoffice controleert (vier ogen).</div>
        </div>
        <button style={btn("white", C.blauw)} onClick={laad} disabled={laden}>🔄 Vernieuwen</button>
      </div>

      {detail ? (
        <InspectieDetail insp={detail} punten={puntenPer[detail.id] || []} ctx={ctx} onTerug={()=>setDetailId(null)} />
      ) : (<>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
          {[["overzicht","🏠 Overzicht woningen"],["punten","📋 Openstaande punten"], ...(isBackoffice ? [["nieuw","➕ Nieuwe inspectie"]] : [])].map(([k,l]) => (
            <button key={k} onClick={()=>setView(k)}
              style={{...btn(view===k ? C.blauw : "white", view===k ? "white" : C.text), border:`1px solid ${view===k ? C.blauw : C.border}`}}>{l}</button>
          ))}
        </div>
        {laden ? <div style={{color:C.muted,padding:20}}>Laden…</div>
          : view === "overzicht" ? <Overzicht inspecties={inspecties} ctx={ctx} />
          : view === "punten" ? <OpenPunten punten={punten} ctx={ctx} />
          : <InspectieForm ctx={ctx} onKlaar={id => { setView("overzicht"); if (id) setDetailId(id); }} />}
      </>)}
    </div>
  );
}

// ─── 1. OVERZICHT: laatste inspectie per woning ──────────────────────────────
function Overzicht({ inspecties, ctx }) {
  const rijen = useMemo(() => {
    const laatste = {};
    for (const i of inspecties) if (!laatste[i.woning_id] || i.inspectiedatum > laatste[i.woning_id].inspectiedatum) laatste[i.woning_id] = i;
    const volgorde = { [C.rood]:0, [C.oranje]:1, [C.grijs]:2, [C.groen]:3 };
    return Object.values(laatste).map(i => ({ i, k: snfKleur(i), p: ctx.puntenPer[i.id] || [] }))
      .sort((a,b) => volgorde[a.k.kleur] - volgorde[b.k.kleur] || a.i.deadline.localeCompare(b.i.deadline));
  }, [inspecties, ctx.puntenPer]);
  if (!rijen.length) return <Kaart style={{color:C.muted,textAlign:"center"}}>Nog geen inspecties ingevoerd.</Kaart>;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {rijen.map(({ i, k, p }) => {
        const open = p.filter(x => x.status !== "gecontroleerd");
        const majors = open.filter(x => x.ernst === "major").length, minors = open.length - majors;
        const wacht = p.filter(x => x.status === "hersteld").length;
        return (
          <div key={i.id} onClick={()=>ctx.openDetail(i.id)}
            style={{background:C.card,border:`1px solid ${C.border}`,borderLeft:`6px solid ${k.kleur}`,borderRadius:10,padding:"10px 12px",cursor:"pointer",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <div style={{flex:"1 1 220px",minWidth:0}}>
              <div style={{fontWeight:800,fontSize:14,color:C.text}}>{ctx.adresVan(i.woning_id)}</div>
              <div style={{fontSize:12,color:C.muted}}>Inspectie {fmt(i.inspectiedatum)} · {i.uitslag === "voldoet" ? "voldoet" : "voldoet niet"}{i.vervolgactie ? ` · ${i.vervolgactie}` : ""}</div>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              {majors > 0 && <Badge kleur={C.rood}>{majors} major</Badge>}
              {minors > 0 && <Badge kleur={C.oranje}>{minors} minor</Badge>}
              {wacht > 0 && <Badge kleur={C.paars}>{wacht} wacht op controle</Badge>}
              <span style={{fontSize:12,color:C.muted}}>deadline {fmt(i.deadline)} · intern {fmt(i.interne_deadline)}</span>
              <Badge kleur={k.kleur}>{k.label}</Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── 3. OPENSTAANDE PUNTEN over alle woningen ────────────────────────────────
function OpenPunten({ punten, ctx }) {
  const [f, setF] = useState({ eigenaar:"", woning:"", ernst:"", status:"" });
  const lijst = useMemo(() => punten
    .filter(p => p.status !== "gecontroleerd")
    .map(p => ({ p, i: ctx.inspMap[p.inspectie_id] }))
    .filter(({ p, i }) => i
      && (!f.eigenaar || String(p.eigenaar_id || "") === f.eigenaar)
      && (!f.woning || String(i.woning_id) === f.woning)
      && (!f.ernst || p.ernst === f.ernst)
      && (!f.status || p.status === f.status))
    .sort((a,b) => a.i.deadline.localeCompare(b.i.deadline) || (a.p.ernst === b.p.ernst ? 0 : a.p.ernst === "major" ? -1 : 1)),
  [punten, ctx.inspMap, f]);
  const eigenaren = [...new Set(punten.map(p => p.eigenaar_id).filter(Boolean))];
  const woningen = [...new Set(Object.values(ctx.inspMap).map(i => i.woning_id))];
  const sel = (k, opties, leeg) => (
    <select style={{...inp, width:"auto", minWidth:140}} value={f[k]} onChange={e=>setF(x=>({...x,[k]:e.target.value}))}>
      <option value="">{leeg}</option>
      {opties.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  return (
    <div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
        {sel("eigenaar", eigenaren.map(id => [String(id), ctx.naamVan(id)]), "Alle eigenaren")}
        {sel("woning", woningen.map(id => [String(id), ctx.adresVan(id)]), "Alle woningen")}
        {sel("ernst", [["major","Major"],["minor","Minor"]], "Major + minor")}
        {sel("status", [["open","Open"],["hersteld","Wacht op controle"]], "Open + wacht op controle")}
      </div>
      {!lijst.length ? <Kaart style={{color:C.muted,textAlign:"center"}}>Geen openstaande punten 🎉</Kaart> : (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {lijst.map(({ p, i }) => {
            const k = snfKleur(i);
            return (
              <div key={p.id} onClick={()=>ctx.openDetail(i.id)}
                style={{background:C.card,border:`1px solid ${C.border}`,borderLeft:`6px solid ${k.kleur}`,borderRadius:10,padding:"9px 12px",cursor:"pointer"}}>
                <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                  <b style={{color:C.text,fontSize:13}}>{p.normnummer ? `${p.normnummer} · ` : ""}{p.omschrijving_inspecteur}</b>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginTop:4,fontSize:12,color:C.muted}}>
                  <Badge kleur={p.ernst === "major" ? C.rood : C.oranje}>{p.ernst}</Badge>
                  <Badge kleur={STATUS_KLEUR[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                  {p.status === "open" && p.afkeur_reden && <Badge kleur={C.rood} title={p.afkeur_reden}>afgekeurd</Badge>}
                  <span>{ctx.adresVan(i.woning_id)}</span>·<span>👤 {ctx.naamVan(p.eigenaar_id)}</span>·
                  <span>deadline {fmt(i.deadline)} (intern {fmt(i.interne_deadline)})</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 2. INSPECTIE-DETAIL ─────────────────────────────────────────────────────
function InspectieDetail({ insp, punten, ctx, onTerug }) {
  const [bewerken, setBewerken] = useState(false);
  const [nieuwPunt, setNieuwPunt] = useState(false);
  const k = snfKleur(insp);
  const telling = s => punten.filter(p => p.status === s).length;
  const inspLog = ctx.log.filter(l => l.bron === "snf_inspectie" && l.bron_id === insp.id);
  return (
    <div>
      <button style={{...btn("white", C.blauw), border:`1px solid ${C.border}`, marginBottom:10}} onClick={onTerug}>← Terug</button>
      <Kaart style={{borderLeft:`6px solid ${k.kleur}`,marginBottom:12}}>
        {bewerken ? <InspectieForm insp={insp} ctx={ctx} onKlaar={()=>setBewerken(false)} /> : (<>
          <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:17,fontWeight:800,color:C.text}}>{ctx.adresVan(insp.woning_id)}</div>
              <div style={{fontSize:12,color:C.muted}}>{insp.inspectie_instelling}{insp.inspecteur ? ` · inspecteur ${insp.inspecteur}` : ""}</div>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
              <Badge kleur={k.kleur}>{insp.status === "afgerond" ? "Afgerond" : k.label}</Badge>
              {ctx.isBackoffice && <button style={btn("white", C.blauw)} onClick={()=>setBewerken(true)}>✏️ Wijzigen</button>}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"6px 14px",marginTop:10,fontSize:13,color:C.text}}>
            <Veld l="Inspectiedatum" v={fmt(insp.inspectiedatum)} />
            <Veld l="Rapportnummer" v={insp.rapportnummer || "—"} />
            <Veld l="Inspectienummer" v={insp.inspectienummer || "—"} />
            <Veld l="Uitslag" v={insp.uitslag === "voldoet" ? "Voldoet" : "Voldoet niet"} />
            <Veld l="Vervolgactie" v={insp.vervolgactie || "—"} />
            <Veld l="Deadline" v={fmt(insp.deadline)} />
            <Veld l="Interne deadline" v={fmt(insp.interne_deadline)} />
            <Veld l="Punten" v={`${telling("open")} open · ${telling("hersteld")} te controleren · ${telling("gecontroleerd")} klaar`} />
          </div>
          {insp.opmerking && <div style={{fontSize:12,color:C.muted,marginTop:8}}>📝 {insp.opmerking}</div>}
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginTop:10}}>
            {insp.rapport_pdf
              ? <button style={btn("white", C.blauw)} onClick={()=>ctx.openBestand("rapport", insp.rapport_pdf)}>📄 Rapport openen</button>
              : <span style={{fontSize:12,color:C.muted}}>Geen rapport geüpload</span>}
            {ctx.isBackoffice && <BestandKnop label={insp.rapport_pdf ? "Ander rapport uploaden" : "📎 Rapport (PDF) uploaden"} accept="application/pdf"
              disabled={ctx.bezig} onKies={fs => ctx.uploadRapport(insp, fs[0])} />}
          </div>
          {inspLog.length > 0 && <Geschiedenis rijen={inspLog} />}
        </>)}
      </Kaart>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontSize:15,fontWeight:800,color:C.text}}>Herstelpunten ({punten.length})</div>
        {ctx.isBackoffice && !nieuwPunt && <button style={btn(C.groen)} onClick={()=>setNieuwPunt(true)}>➕ Punt toevoegen</button>}
      </div>
      {nieuwPunt && <Kaart style={{marginBottom:10}}><PuntForm inspectieId={insp.id} ctx={ctx} onKlaar={()=>setNieuwPunt(false)} /></Kaart>}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {[...punten].sort((a,b) => (a.ernst === b.ernst ? 0 : a.ernst === "major" ? -1 : 1) || (a.normnummer || "").localeCompare(b.normnummer || "", "nl", { numeric:true }))
          .map(p => <PuntKaart key={p.id} p={p} ctx={ctx} />)}
        {!punten.length && <Kaart style={{color:C.muted,textAlign:"center"}}>Geen herstelpunten.</Kaart>}
      </div>
    </div>
  );
}

function Veld({ l, v }) {
  return <div><div style={{fontSize:10.5,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px"}}>{l}</div><div>{v}</div></div>;
}

function BestandKnop({ label, accept, multiple, disabled, onKies }) {
  const ref = useRef(null);
  return (<>
    <button style={btn(C.blauw)} disabled={disabled} onClick={()=>ref.current?.click()}>{label}</button>
    <input ref={ref} type="file" accept={accept} multiple={multiple} style={{display:"none"}}
      onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ""; if (fs.length) onKies(fs); }} />
  </>);
}

function Geschiedenis({ rijen }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{marginTop:8}}>
      <button onClick={()=>setOpen(!open)} style={{background:"none",border:"none",padding:0,color:C.blauw,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
        {open ? "▲" : "▼"} Geschiedenis ({rijen.length})
      </button>
      {open && (
        <div style={{marginTop:4,fontSize:12,color:C.text,borderLeft:`2px solid ${C.border}`,paddingLeft:8}}>
          {rijen.map(l => (
            <div key={l.id} style={{marginBottom:3}}>
              <span style={{color:C.muted}}>{fmtTijd(l.op)}</span> · <b>{l.door_naam || "Systeem"}</b> · {ACTIE_LABEL[l.actie] || l.actie}
              {l.van ? ` (${l.van} → ${l.naar})` : ""}{l.reden ? ` — “${l.reden}”` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PuntKaart({ p, ctx }) {
  const [bewerken, setBewerken] = useState(false);
  const [opmerking, setOpmerking] = useState("");
  const bestanden = ctx.bewijs.filter(b => b.herstelpunt_id === p.id);
  const actief = bestanden.filter(b => !b.ingetrokken_op);
  const puntLog = ctx.log.filter(l => l.bron === "snf_herstelpunt" && l.bron_id === p.id);
  const magHerstellen = ctx.magHerstellen(p);
  const zelfHersteld = p.hersteld_door_id === ctx.gebruiker?.id;

  function afkeuren() {
    const reden = window.prompt("Waarom afgekeurd? (verplicht — de eigenaar ziet deze reden)");
    if (reden && reden.trim()) ctx.rpc("snf_herstelpunt_controleren", { p_id: p.id, p_goedgekeurd: false, p_reden: reden.trim() }, "Afgekeurd — punt staat weer open");
  }
  function heropenen() {
    const reden = window.prompt("Waarom heropenen? (verplicht)");
    if (reden && reden.trim()) ctx.rpc("snf_herstelpunt_heropenen", { p_id: p.id, p_reden: reden.trim() }, "Punt heropend");
  }
  function intrekken(b) {
    const reden = window.prompt(`Bestand "${b.bestandsnaam}" intrekken? Geef een reden (het bestand blijft bewaard voor de audit).`);
    if (reden && reden.trim()) ctx.rpc("snf_bewijs_intrekken", { p_bewijs_id: b.id, p_reden: reden.trim() }, "Bewijs ingetrokken");
  }

  if (bewerken) return <Kaart><PuntForm punt={p} inspectieId={p.inspectie_id} ctx={ctx} onKlaar={()=>setBewerken(false)} /></Kaart>;
  return (
    <Kaart style={{borderLeft:`6px solid ${STATUS_KLEUR[p.status]}`}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
        <div style={{flex:"1 1 260px"}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:4}}>
            {p.normnummer && <b style={{color:C.text}}>Norm {p.normnummer}</b>}
            {p.categorie && <span style={{fontSize:12,color:C.muted}}>{p.categorie}</span>}
            <Badge kleur={p.ernst === "major" ? C.rood : C.oranje}>{p.ernst}</Badge>
            <Badge kleur={STATUS_KLEUR[p.status]}>{STATUS_LABEL[p.status]}</Badge>
          </div>
          <div style={{fontSize:13,color:C.text}}><b>Inspecteur:</b> {p.omschrijving_inspecteur}</div>
          {p.actie && <div style={{fontSize:13,color:C.text}}><b>Actie:</b> {p.actie}</div>}
          {p.vereist_bewijs && <div style={{fontSize:13,color:C.text}}><b>Vereist bewijs:</b> {p.vereist_bewijs}</div>}
          <div style={{fontSize:12,color:C.muted,marginTop:3}}>👤 Eigenaar: {ctx.naamVan(p.eigenaar_id)}{p.opmerking ? ` · 📝 ${p.opmerking}` : ""}</div>
        </div>
        {ctx.isBackoffice && <div><button style={btn("white", C.blauw)} onClick={()=>setBewerken(true)}>✏️</button></div>}
      </div>

      {p.status === "open" && p.afkeur_reden && (
        <div style={{background:C.rood+"12",border:`1px solid ${C.rood}40`,borderRadius:8,padding:8,fontSize:12.5,color:C.text,marginTop:8}}>
          ❌ <b>Afgekeurd / heropend:</b> {p.afkeur_reden}
        </div>
      )}
      {p.hersteld_door_id && <div style={{fontSize:12,color:C.text,marginTop:6}}>🔧 Hersteld door <b>{ctx.naamVan(p.hersteld_door_id)}</b> op {fmtTijd(p.hersteld_op)}</div>}
      {p.gecontroleerd_door_id && <div style={{fontSize:12,color:C.text}}>✅ Gecontroleerd door <b>{ctx.naamVan(p.gecontroleerd_door_id)}</b> op {fmtTijd(p.gecontroleerd_op)}</div>}

      {/* Bewijs */}
      <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed ${C.border}`}}>
        <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:4}}>Bewijs ({actief.length})</div>
        {bestanden.map(b => (
          <div key={b.id} style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",fontSize:12.5,marginBottom:3,opacity:b.ingetrokken_op ? .55 : 1}}>
            <button onClick={()=>ctx.openBestand("bewijs", b.bestand)} style={{background:"none",border:"none",padding:0,color:C.blauw,fontWeight:700,cursor:"pointer",fontFamily:"inherit",textDecoration:b.ingetrokken_op ? "line-through" : "underline",fontSize:12.5}}>
              {b.mime_type?.startsWith("image/") ? "🖼️" : "📄"} {b.bestandsnaam}
            </button>
            <span style={{color:C.muted}}>{ctx.naamVan(b.geupload_door_id)} · {fmtTijd(b.geupload_op)}</span>
            {b.ingetrokken_op && <span style={{color:C.rood}}>ingetrokken door {ctx.naamVan(b.ingetrokken_door_id)}: {b.ingetrokken_reden}</span>}
            {!b.ingetrokken_op && p.status === "open" && (ctx.isBackoffice || b.geupload_door_id === ctx.gebruiker?.id) &&
              <button onClick={()=>intrekken(b)} style={{...btn("white", C.rood), padding:"2px 7px", fontSize:11}}>intrekken</button>}
          </div>
        ))}
        {p.status === "open" && magHerstellen && (
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginTop:6}}>
            <BestandKnop label="📷 Foto / bestand toevoegen" accept="image/*,application/pdf" multiple disabled={ctx.bezig} onKies={fs => ctx.uploadBewijs(p, fs)} />
          </div>
        )}
      </div>

      {/* Acties */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginTop:8}}>
        {p.status === "open" && magHerstellen && (<>
          <input style={{...inp, flex:"1 1 200px", width:"auto"}} placeholder="Toelichting (optioneel)" value={opmerking} onChange={e=>setOpmerking(e.target.value)} />
          <button style={btn(actief.length ? C.groen : C.grijs)} disabled={ctx.bezig || !actief.length}
            title={actief.length ? "" : "Upload eerst bewijs"}
            onClick={()=>ctx.rpc("snf_herstelpunt_hersteld", { p_id: p.id, p_opmerking: opmerking.trim() || null }, "✓ Hersteld gemeld — backoffice controleert")}>
            ✔ Hersteld melden
          </button>
          {!actief.length && <span style={{fontSize:12,color:C.muted}}>Upload eerst bewijs.</span>}
        </>)}
        {p.status === "hersteld" && ctx.isBackoffice && (zelfHersteld ? (
          <span style={{fontSize:12,color:C.oranje,fontWeight:700}}>👀 Jij hebt dit hersteld gemeld — een andere backoffice-collega moet controleren.</span>
        ) : (<>
          <button style={btn(C.groen)} disabled={ctx.bezig} onClick={()=>ctx.rpc("snf_herstelpunt_controleren", { p_id: p.id, p_goedgekeurd: true }, "✓ Goedgekeurd")}>✅ Goedkeuren</button>
          <button style={btn(C.rood)} disabled={ctx.bezig} onClick={afkeuren}>❌ Afkeuren</button>
        </>))}
        {p.status === "hersteld" && !ctx.isBackoffice && <span style={{fontSize:12,color:C.muted}}>Wacht op controle door backoffice.</span>}
        {p.status === "gecontroleerd" && ctx.isBackoffice && <button style={btn("white", C.rood)} disabled={ctx.bezig} onClick={heropenen}>↩ Heropenen</button>}
      </div>
      {puntLog.length > 0 && <Geschiedenis rijen={puntLog} />}
    </Kaart>
  );
}

// ─── 4. FORMULIEREN ──────────────────────────────────────────────────────────
function InspectieForm({ insp, ctx, onKlaar }) {
  const [v, setV] = useState(() => insp ? { ...insp, vervolgactie: insp.vervolgactie || "" } : {
    woning_id:"", inspectiedatum: vandaag(), rapportnummer:"", inspectienummer:"", inspectie_instelling: INSTELLING,
    inspecteur:"", uitslag:"voldoet_niet", vervolgactie:"administratief", deadline: plusDagen(vandaag(), 42), interne_deadline: plusDagen(vandaag(), 28), opmerking:"",
  });
  const zet = (k, w) => setV(x => {
    const n = { ...x, [k]: w };
    // standaard: deadline = inspectiedatum + 6 weken, intern = deadline - 14 dagen (handmatig aan te passen)
    if (k === "inspectiedatum" && w) { n.deadline = plusDagen(w, 42); n.interne_deadline = plusDagen(n.deadline, -14); }
    if (k === "deadline" && w) n.interne_deadline = plusDagen(w, -14);
    return n;
  });
  async function opslaan() {
    if (!v.woning_id || !v.inspectiedatum || !v.deadline || !v.interne_deadline) { alert("Vul woning, inspectiedatum en deadlines in."); return; }
    const r = await ctx.rpc("snf_inspectie_opslaan", { p_id: insp?.id || null, p_data: { ...v, woning_id: Number(v.woning_id) } }, insp ? "✓ Inspectie opgeslagen" : "✓ Inspectie aangemaakt — voeg nu de herstelpunten toe");
    if (r) onKlaar(r.id);
  }
  const veld = (k, label, type="text") => (
    <div><label style={lbl}>{label}</label><input type={type} style={inp} value={v[k] || ""} onChange={e=>zet(k, e.target.value)} /></div>
  );
  return (
    <Kaart>
      <div style={{fontSize:15,fontWeight:800,color:C.text,marginBottom:10}}>{insp ? "Inspectie wijzigen" : "Nieuwe inspectie"}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
        <div>
          <label style={lbl}>Woning *</label>
          <select style={inp} value={v.woning_id} onChange={e=>zet("woning_id", e.target.value)}>
            <option value="">— kies woning —</option>
            {(ctx.houses || []).map(h => <option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
          </select>
        </div>
        {veld("inspectiedatum", "Inspectiedatum *", "date")}
        {veld("rapportnummer", "Rapportnummer")}
        {veld("inspectienummer", "Inspectienummer")}
        {veld("inspectie_instelling", "Inspectie-instelling")}
        {veld("inspecteur", "Inspecteur")}
        <div>
          <label style={lbl}>Uitslag *</label>
          <select style={inp} value={v.uitslag} onChange={e=>zet("uitslag", e.target.value)}>
            <option value="voldoet_niet">Voldoet niet</option><option value="voldoet">Voldoet</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Vervolgactie</label>
          <select style={inp} value={v.vervolgactie} onChange={e=>zet("vervolgactie", e.target.value)}>
            <option value="">—</option><option value="administratief">Administratief</option><option value="herinspectie">Herinspectie</option>
          </select>
        </div>
        {veld("deadline", "Deadline * (standaard +6 weken)", "date")}
        {veld("interne_deadline", "Interne deadline * (standaard −14 dagen)", "date")}
      </div>
      <div style={{marginTop:10}}><label style={lbl}>Opmerking</label><textarea style={{...inp, minHeight:50}} value={v.opmerking || ""} onChange={e=>zet("opmerking", e.target.value)} /></div>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button style={btn(C.groen)} disabled={ctx.bezig} onClick={opslaan}>💾 Opslaan</button>
        <button style={{...btn("white", C.text), border:`1px solid ${C.border}`}} onClick={()=>onKlaar(null)}>Annuleren</button>
      </div>
    </Kaart>
  );
}

function PuntForm({ punt, inspectieId, ctx, onKlaar }) {
  const [v, setV] = useState(() => punt ? { ...punt } : {
    normnummer:"", categorie:"", omschrijving_inspecteur:"", ernst:"major", actie:"", vereist_bewijs:"", eigenaar_id:"", opmerking:"",
  });
  const zet = (k, w) => setV(x => ({ ...x, [k]: w }));
  // Eigenaar: wie het herstel regelt. Collega's zitten niet in de SNF-module, dus niet in de lijst.
  const kandidaten = (ctx.gebruikers || []).filter(g => g.rol !== "collega");
  async function opslaan() {
    if (!v.omschrijving_inspecteur.trim()) { alert("Omschrijving van de inspecteur is verplicht."); return; }
    const r = await ctx.rpc("snf_herstelpunt_opslaan", { p_id: punt?.id || null,
      p_data: { ...v, inspectie_id: inspectieId, eigenaar_id: v.eigenaar_id ? Number(v.eigenaar_id) : null } }, punt ? "✓ Punt opgeslagen" : "✓ Punt toegevoegd");
    if (r) onKlaar();
  }
  const veld = (k, label) => <div><label style={lbl}>{label}</label><input style={inp} value={v[k] || ""} onChange={e=>zet(k, e.target.value)} /></div>;
  return (
    <div>
      <div style={{fontSize:14,fontWeight:800,color:C.text,marginBottom:8}}>{punt ? "Herstelpunt wijzigen" : "Nieuw herstelpunt"}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10}}>
        {veld("normnummer", "Normnummer (bv. 6.3)")}
        <div>
          <label style={lbl}>Categorie</label>
          <input style={inp} list="snf-categorieen" value={v.categorie || ""} onChange={e=>zet("categorie", e.target.value)} />
          <datalist id="snf-categorieen">{CATEGORIEEN.map(c => <option key={c} value={c} />)}</datalist>
        </div>
        <div>
          <label style={lbl}>Ernst *</label>
          <select style={inp} value={v.ernst} onChange={e=>zet("ernst", e.target.value)}><option value="major">Major</option><option value="minor">Minor</option></select>
        </div>
        <div>
          <label style={lbl}>Eigenaar</label>
          <select style={inp} value={v.eigenaar_id || ""} onChange={e=>zet("eigenaar_id", e.target.value)}>
            <option value="">— niemand —</option>
            {kandidaten.map(g => <option key={g.id} value={g.id}>{g.naam} ({g.rol})</option>)}
          </select>
        </div>
      </div>
      <div style={{display:"grid",gap:10,marginTop:10}}>
        <div><label style={lbl}>Omschrijving inspecteur *</label><textarea style={{...inp, minHeight:50}} value={v.omschrijving_inspecteur || ""} onChange={e=>zet("omschrijving_inspecteur", e.target.value)} /></div>
        {veld("actie", "Actie (wat moet er gebeuren)")}
        {veld("vereist_bewijs", "Vereist bewijs")}
        {veld("opmerking", "Opmerking")}
      </div>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button style={btn(C.groen)} disabled={ctx.bezig} onClick={opslaan}>💾 Opslaan</button>
        <button style={{...btn("white", C.text), border:`1px solid ${C.border}`}} onClick={onKlaar}>Annuleren</button>
      </div>
    </div>
  );
}
