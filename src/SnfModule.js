import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";
import { tx, txv, dbTekst } from "./i18n";

// ─── SNF-INSPECTIES ──────────────────────────────────────────────────────────
// Herstelpunten uit SNF-inspecties (Normec VRO) per woning: bewijs uploaden, SNF-controleur (Liane) of
// backoffice controleert.
//
// Alle schrijfacties lopen via databasefuncties (snf_*) met het sessietoken; de database
// controleert rechten, statusovergangen en het vier-ogenprincipe (zie supabase/snf_inspecties.sql).
// Bestanden staan in de privé bucket "snf-bewijs": uploaden/openen via Edge Function snf-bestand.
//
// Status herstelpunt: open → hersteld (bewijs geüpload) → gecontroleerd (controleur, niet dezelfde persoon)
//                     hersteld → afgekeurd = terug naar open met reden
// Inspectie wordt automatisch "afgerond" als alle punten gecontroleerd zijn.
// Teksten via tx()/txv(): vertalingen in src/i18n/teksten.json (huismeester werkt in eigen taal).

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
  if (insp.status === "afgerond") return { kleur:C.groen, label:tx("Afgerond") };
  const dl = dagenTot(insp.deadline);
  if (dagenTot(insp.interne_deadline) < 0 || dl < 14) return { kleur:C.rood, label: dl < 0 ? txv("{0} dg over deadline", -dl) : txv("nog {0} dg", dl) };
  if (dl < 28) return { kleur:C.oranje, label:txv("nog {0} dg", dl) };
  return { kleur:C.grijs, label:txv("nog {0} dg", dl) };
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
    return { ok:false, fout: tx(fout) };
  }
  return data ? { ...data, fout: tx(data.fout) } : { ok:false, fout:tx("Geen antwoord") };
}

export default function SnfModule({ gebruiker, sessieToken, houses, gebruikers, magControleren, showToast }) {
  const [inspecties, setInspecties] = useState([]);
  const [punten, setPunten] = useState([]);
  const [bewijs, setBewijs] = useState([]);
  const [log, setLog] = useState([]);
  const [keuringen, setKeuringen] = useState([]);
  const [kwartaalLijsten, setKwartaalLijsten] = useState([]);
  const [kwartaalItems, setKwartaalItems] = useState([]);
  const [laden, setLaden] = useState(true);
  const [view, setView] = useState("overzicht");   // overzicht | punten | logboek | keuringen | nieuw
  const [detailId, setDetailId] = useState(null);
  const [bezig, setBezig] = useState(false);
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  const rol = gebruiker?.rol;
  const isBackoffice = rol === "backoffice";
  const huisMap = useMemo(() => Object.fromEntries((houses || []).map(h => [h.id, h])), [houses]);
  const gebrMap = useMemo(() => Object.fromEntries((gebruikers || []).map(g => [g.id, g])), [gebruikers]);
  const naamVan = id => id ? (gebrMap[id]?.naam || `#${id}`) : "—";
  const adresVan = id => huisMap[id] ? `${huisMap[id].adres}, ${huisMap[id].stad}` : txv("woning #{0}", id);
  const magHerstellen = p => isBackoffice || rol === "huismeester" || gebruiker?.id === p.eigenaar_id;

  const laad = useCallback(async () => {
    setLaden(true);
    const [a, b, c, d, e, f, g] = await Promise.all([
      supabase.from("snf_inspecties").select("*").order("inspectiedatum", { ascending:false }),
      supabase.from("snf_herstelpunten").select("*").order("id"),
      supabase.from("snf_bewijs").select("*").order("geupload_op"),
      supabase.from("status_log").select("*").in("bron", ["snf_herstelpunt","snf_inspectie"]).order("op"),
      supabase.from("snf_keuringen").select("*").order("woning_id"),
      supabase.from("checklists").select("*").eq("type", "kwartaal"),
      supabase.from("checklist_items").select("*").eq("type", "kwartaal"),
    ]);
    const fout = [a, b, c, d, e, f, g].find(r => r.error);
    if (fout) toastRef.current(tx("Laden mislukt: ") + fout.error.message, "err");
    setInspecties(a.data || []); setPunten(b.data || []); setBewijs(c.data || []); setLog(d.data || []);
    setKeuringen(e.data || []); setKwartaalLijsten(f.data || []); setKwartaalItems(g.data || []);
    setLaden(false);
  }, []);
  useEffect(() => { laad(); }, [laad]);

  // Databasefunctie aanroepen; geeft true bij succes en herlaadt
  async function rpc(fn, params, okTekst) {
    setBezig(true);
    const { data, error } = await supabase.rpc(fn, { p_token: sessieToken, ...params });
    setBezig(false);
    if (error || !data?.ok) { showToast(tx(data?.fout) || error?.message || tx("Actie mislukt"), "err"); return null; }
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
    if (error) { showToast(tx("Upload mislukt: ") + error.message, "err"); return null; }
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
      if (error || !data?.ok) showToast(tx(data?.fout) || error?.message, "err"); else n++;
    }
    setBezig(false);
    if (n) showToast(txv("✓ {0} bestand(en) geüpload", n));
    await laad();
  }

  async function uploadRapport(insp, file) {
    setBezig(true);
    const pad = await upload("rapport", insp.id, file);
    setBezig(false);
    if (pad) await rpc("snf_rapport_koppelen", { p_inspectie_id: insp.id, p_pad: pad }, tx("✓ Rapport opgeslagen"));
  }

  const puntenPer = useMemo(() => {
    const m = {};
    for (const p of punten) (m[p.inspectie_id] ||= []).push(p);
    return m;
  }, [punten]);
  const inspMap = useMemo(() => Object.fromEntries(inspecties.map(i => [i.id, i])), [inspecties]);
  const detail = detailId ? inspMap[detailId] : null;

  // Signalen bovenaan: verlopen keuringen en woningen zonder SNF-kwartaalcontrole vorig kwartaal
  const actieveHuizen = useMemo(() => (houses || []).filter(h => !h.gearchiveerd), [houses]);
  const keurSignaal = useMemo(() => {
    const st = keuringen.map(keuringStatus);
    return { verlopen: st.filter(x => x.niveau === "rood").length, binnenkort: st.filter(x => x.niveau === "oranje").length,
      ontbreekt: actieveHuizen.filter(h => verplichtVoor(h).some(s => !keuringen.some(k => k.woning_id === h.id && k.soort === s))).length };
  }, [keuringen, actieveHuizen]);
  const kwSignaal = useMemo(() => {
    const vorige = vorigKwartaal();
    return actieveHuizen.filter(h => !kwartaalStatus(kwartaalLijsten, kwartaalItems, h.id, vorige, h).klaar).length;
  }, [actieveHuizen, kwartaalLijsten, kwartaalItems]);

  const ctx = { gebruiker, isBackoffice, magControleren: isBackoffice || !!magControleren, naamVan, adresVan, magHerstellen, bewijs, log, bezig, rpc, openBestand,
    uploadBewijs, uploadRapport, gebruikers, houses, puntenPer, inspMap, openDetail: id => setDetailId(id) };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:10,flexWrap:"wrap",marginBottom:12}}>
        <div>
          <div style={{fontSize:20,fontWeight:800,color:C.text}}>{tx("🧯 SNF-inspecties")}</div>
          <div style={{fontSize:12,color:C.muted}}>{tx("Herstelpunten per woning: bewijs uploaden → controleur keurt goed (vier ogen).")}</div>
        </div>
        <button style={btn("white", C.blauw)} onClick={laad} disabled={laden}>{tx("🔄 Vernieuwen")}</button>
      </div>

      {detail ? (
        <InspectieDetail insp={detail} punten={puntenPer[detail.id] || []} ctx={ctx} onTerug={()=>setDetailId(null)} />
      ) : (<>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
          {[["overzicht","🏠 Overzicht woningen"],["punten","📋 Openstaande punten"],["logboek","📒 Logboek kwartaalcontrole"],["keuringen","🗓 Keuringen"], ...(isBackoffice ? [["nieuw","➕ Nieuwe inspectie"]] : [])].map(([k,l]) => (
            <button key={k} onClick={()=>setView(k)}
              style={{...btn(view===k ? C.blauw : "white", view===k ? "white" : C.text), border:`1px solid ${view===k ? C.blauw : C.border}`}}>{tx(l)}</button>
          ))}
        </div>
        {!laden && (keurSignaal.verlopen + keurSignaal.binnenkort + keurSignaal.ontbreekt + kwSignaal) > 0 && (
          <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"9px 12px",marginBottom:12,fontSize:12.5,color:"#7f1d1d",display:"flex",gap:14,flexWrap:"wrap"}}>
            {keurSignaal.verlopen > 0 && <span onClick={()=>setView("keuringen")} style={{cursor:"pointer"}}>🔴 {txv("{0} keuring(en) verlopen", keurSignaal.verlopen)}</span>}
            {keurSignaal.binnenkort > 0 && <span onClick={()=>setView("keuringen")} style={{cursor:"pointer"}}>🟠 {txv("{0} keuring(en) binnen 60 dagen", keurSignaal.binnenkort)}</span>}
            {keurSignaal.ontbreekt > 0 && <span onClick={()=>setView("keuringen")} style={{cursor:"pointer"}}>⚪ {txv("{0} woning(en): blusser- of CV-keuring niet ingevuld", keurSignaal.ontbreekt)}</span>}
            {kwSignaal > 0 && <span onClick={()=>setView("logboek")} style={{cursor:"pointer"}}>📒 {txv("{0} woning(en) zonder volledige kwartaalcontrole vorig kwartaal", kwSignaal)}</span>}
          </div>
        )}
        {laden ? <div style={{color:C.muted,padding:20}}>{tx("Laden…")}</div>
          : view === "overzicht" ? <Overzicht inspecties={inspecties} ctx={ctx} />
          : view === "punten" ? <OpenPunten punten={punten} ctx={ctx} />
          : view === "logboek" ? <Logboek huizen={actieveHuizen} lijsten={kwartaalLijsten} items={kwartaalItems} ctx={ctx} onWijzig={laad} />
          : view === "keuringen" ? <Keuringen huizen={actieveHuizen} keuringen={keuringen} ctx={ctx} />
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
  if (!rijen.length) return <Kaart style={{color:C.muted,textAlign:"center"}}>{tx("Nog geen inspecties ingevoerd.")}</Kaart>;
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
              <div style={{fontSize:12,color:C.muted}}>{txv("Inspectie {0}", fmt(i.inspectiedatum))} · {tx(i.uitslag === "voldoet" ? "voldoet" : "voldoet niet")}{i.vervolgactie ? ` · ${tx(i.vervolgactie)}` : ""}</div>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              {majors > 0 && <Badge kleur={C.rood}>{majors} major</Badge>}
              {minors > 0 && <Badge kleur={C.oranje}>{minors} minor</Badge>}
              {wacht > 0 && <Badge kleur={C.paars}>{txv("{0} wacht op controle", wacht)}</Badge>}
              <span style={{fontSize:12,color:C.muted}}>{txv("deadline {0} · intern {1}", fmt(i.deadline), fmt(i.interne_deadline))}</span>
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
      <option value="">{tx(leeg)}</option>
      {opties.map(([v,l]) => <option key={v} value={v}>{tx(l)}</option>)}
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
      {!lijst.length ? <Kaart style={{color:C.muted,textAlign:"center"}}>{tx("Geen openstaande punten 🎉")}</Kaart> : (
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
                  <Badge kleur={STATUS_KLEUR[p.status]}>{tx(STATUS_LABEL[p.status])}</Badge>
                  {p.status === "open" && p.afkeur_reden && <Badge kleur={C.rood} title={p.afkeur_reden}>{tx("afgekeurd")}</Badge>}
                  <span>{ctx.adresVan(i.woning_id)}</span>·<span>👤 {ctx.naamVan(p.eigenaar_id)}</span>·
                  <span>{txv("deadline {0} (intern {1})", fmt(i.deadline), fmt(i.interne_deadline))}</span>
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
      <button style={{...btn("white", C.blauw), border:`1px solid ${C.border}`, marginBottom:10}} onClick={onTerug}>{tx("← Terug")}</button>
      <Kaart style={{borderLeft:`6px solid ${k.kleur}`,marginBottom:12}}>
        {bewerken ? <InspectieForm insp={insp} ctx={ctx} onKlaar={()=>setBewerken(false)} /> : (<>
          <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:17,fontWeight:800,color:C.text}}>{ctx.adresVan(insp.woning_id)}</div>
              <div style={{fontSize:12,color:C.muted}}>{insp.inspectie_instelling}{insp.inspecteur ? ` · ${txv("inspecteur {0}", insp.inspecteur)}` : ""}</div>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
              <Badge kleur={k.kleur}>{k.label}</Badge>
              {ctx.isBackoffice && <button style={btn("white", C.blauw)} onClick={()=>setBewerken(true)}>{tx("✏️ Wijzigen")}</button>}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"6px 14px",marginTop:10,fontSize:13,color:C.text}}>
            <Veld l="Inspectiedatum" v={fmt(insp.inspectiedatum)} />
            <Veld l="Rapportnummer" v={insp.rapportnummer || "—"} />
            <Veld l="Inspectienummer" v={insp.inspectienummer || "—"} />
            <Veld l="Uitslag" v={tx(insp.uitslag === "voldoet" ? "Voldoet" : "Voldoet niet")} />
            <Veld l="Vervolgactie" v={insp.vervolgactie ? tx(insp.vervolgactie) : "—"} />
            <Veld l="Deadline" v={fmt(insp.deadline)} />
            <Veld l="Interne deadline" v={fmt(insp.interne_deadline)} />
            <Veld l="Punten" v={txv("{0} open · {1} te controleren · {2} klaar", telling("open"), telling("hersteld"), telling("gecontroleerd"))} />
          </div>
          {insp.opmerking && <div style={{fontSize:12,color:C.muted,marginTop:8}}>📝 {insp.opmerking}</div>}
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginTop:10}}>
            {insp.rapport_pdf
              ? <button style={btn("white", C.blauw)} onClick={()=>ctx.openBestand("rapport", insp.rapport_pdf)}>{tx("📄 Rapport openen")}</button>
              : <span style={{fontSize:12,color:C.muted}}>{tx("Geen rapport geüpload")}</span>}
            {ctx.isBackoffice && <BestandKnop label={insp.rapport_pdf ? "Ander rapport uploaden" : "📎 Rapport (PDF) uploaden"} accept="application/pdf"
              disabled={ctx.bezig} onKies={fs => ctx.uploadRapport(insp, fs[0])} />}
          </div>
          {inspLog.length > 0 && <Geschiedenis rijen={inspLog} />}
        </>)}
      </Kaart>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontSize:15,fontWeight:800,color:C.text}}>{txv("Herstelpunten ({0})", punten.length)}</div>
        {ctx.isBackoffice && !nieuwPunt && <button style={btn(C.groen)} onClick={()=>setNieuwPunt(true)}>{tx("➕ Punt toevoegen")}</button>}
      </div>
      {nieuwPunt && <Kaart style={{marginBottom:10}}><PuntForm inspectieId={insp.id} ctx={ctx} onKlaar={()=>setNieuwPunt(false)} /></Kaart>}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {[...punten].sort((a,b) => (a.ernst === b.ernst ? 0 : a.ernst === "major" ? -1 : 1) || (a.normnummer || "").localeCompare(b.normnummer || "", "nl", { numeric:true }))
          .map(p => <PuntKaart key={p.id} p={p} ctx={ctx} />)}
        {!punten.length && <Kaart style={{color:C.muted,textAlign:"center"}}>{tx("Geen herstelpunten.")}</Kaart>}
      </div>
    </div>
  );
}

function Veld({ l, v }) {
  return <div><div style={{fontSize:10.5,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px"}}>{tx(l)}</div><div>{v}</div></div>;
}

function BestandKnop({ label, accept, multiple, disabled, onKies }) {
  const ref = useRef(null);
  return (<>
    <button style={btn(C.blauw)} disabled={disabled} onClick={()=>ref.current?.click()}>{tx(label)}</button>
    <input ref={ref} type="file" accept={accept} multiple={multiple} style={{display:"none"}}
      onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ""; if (fs.length) onKies(fs); }} />
  </>);
}

function Geschiedenis({ rijen }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{marginTop:8}}>
      <button onClick={()=>setOpen(!open)} style={{background:"none",border:"none",padding:0,color:C.blauw,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
        {open ? "▲" : "▼"} {txv("Geschiedenis ({0})", rijen.length)}
      </button>
      {open && (
        <div style={{marginTop:4,fontSize:12,color:C.text,borderLeft:`2px solid ${C.border}`,paddingLeft:8}}>
          {rijen.map(l => (
            <div key={l.id} style={{marginBottom:3}}>
              <span style={{color:C.muted}}>{fmtTijd(l.op)}</span> · <b>{l.door_naam || tx("Systeem")}</b> · {tx(ACTIE_LABEL[l.actie] || l.actie)}
              {l.van ? ` (${tx(l.van)} → ${tx(l.naar)})` : ""}{l.reden ? ` — “${l.reden}”` : ""}
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
    const reden = window.prompt(tx("Waarom afgekeurd? (verplicht — de eigenaar ziet deze reden)"));
    if (reden && reden.trim()) ctx.rpc("snf_herstelpunt_controleren", { p_id: p.id, p_goedgekeurd: false, p_reden: reden.trim() }, tx("Afgekeurd — punt staat weer open"));
  }
  function heropenen() {
    const reden = window.prompt(tx("Waarom heropenen? (verplicht)"));
    if (reden && reden.trim()) ctx.rpc("snf_herstelpunt_heropenen", { p_id: p.id, p_reden: reden.trim() }, tx("Punt heropend"));
  }
  function intrekken(b) {
    const reden = window.prompt(txv("Bestand \"{0}\" intrekken? Geef een reden (het bestand blijft bewaard voor de audit).", b.bestandsnaam));
    if (reden && reden.trim()) ctx.rpc("snf_bewijs_intrekken", { p_bewijs_id: b.id, p_reden: reden.trim() }, tx("Bewijs ingetrokken"));
  }

  if (bewerken) return <Kaart><PuntForm punt={p} inspectieId={p.inspectie_id} ctx={ctx} onKlaar={()=>setBewerken(false)} /></Kaart>;
  return (
    <Kaart style={{borderLeft:`6px solid ${STATUS_KLEUR[p.status]}`}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
        <div style={{flex:"1 1 260px"}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:4}}>
            {p.normnummer && <b style={{color:C.text}}>{txv("Norm {0}", p.normnummer)}</b>}
            {p.categorie && <span style={{fontSize:12,color:C.muted}}>{tx(p.categorie)}</span>}
            <Badge kleur={p.ernst === "major" ? C.rood : C.oranje}>{p.ernst}</Badge>
            <Badge kleur={STATUS_KLEUR[p.status]}>{tx(STATUS_LABEL[p.status])}</Badge>
          </div>
          <div style={{fontSize:13,color:C.text}}><b>{tx("Inspecteur:")}</b> {p.omschrijving_inspecteur}</div>
          {p.actie && <div style={{fontSize:13,color:C.text}}><b>{tx("Actie:")}</b> {p.actie}</div>}
          {p.vereist_bewijs && <div style={{fontSize:13,color:C.text}}><b>{tx("Vereist bewijs:")}</b> {p.vereist_bewijs}</div>}
          <div style={{fontSize:12,color:C.muted,marginTop:3}}>👤 {tx("Eigenaar:")} {ctx.naamVan(p.eigenaar_id)}{p.opmerking ? ` · 📝 ${p.opmerking}` : ""}</div>
        </div>
        {ctx.isBackoffice && <div><button style={btn("white", C.blauw)} onClick={()=>setBewerken(true)}>✏️</button></div>}
      </div>

      {p.status === "open" && p.afkeur_reden && (
        <div style={{background:C.rood+"12",border:`1px solid ${C.rood}40`,borderRadius:8,padding:8,fontSize:12.5,color:C.text,marginTop:8}}>
          ❌ <b>{tx("Afgekeurd / heropend:")}</b> {p.afkeur_reden}
        </div>
      )}
      {p.hersteld_door_id && <div style={{fontSize:12,color:C.text,marginTop:6}}>🔧 {tx("Hersteld door")} <b>{ctx.naamVan(p.hersteld_door_id)}</b> · {fmtTijd(p.hersteld_op)}</div>}
      {p.gecontroleerd_door_id && <div style={{fontSize:12,color:C.text}}>✅ {tx("Gecontroleerd door")} <b>{ctx.naamVan(p.gecontroleerd_door_id)}</b> · {fmtTijd(p.gecontroleerd_op)}</div>}

      {/* Bewijs */}
      <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed ${C.border}`}}>
        <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:4}}>{txv("Bewijs ({0})", actief.length)}</div>
        {bestanden.map(b => (
          <div key={b.id} style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",fontSize:12.5,marginBottom:3,opacity:b.ingetrokken_op ? .55 : 1}}>
            <button onClick={()=>ctx.openBestand("bewijs", b.bestand)} style={{background:"none",border:"none",padding:0,color:C.blauw,fontWeight:700,cursor:"pointer",fontFamily:"inherit",textDecoration:b.ingetrokken_op ? "line-through" : "underline",fontSize:12.5}}>
              {b.mime_type?.startsWith("image/") ? "🖼️" : "📄"} {b.bestandsnaam}
            </button>
            <span style={{color:C.muted}}>{ctx.naamVan(b.geupload_door_id)} · {fmtTijd(b.geupload_op)}</span>
            {b.ingetrokken_op && <span style={{color:C.rood}}>{txv("ingetrokken door {0}:", ctx.naamVan(b.ingetrokken_door_id))} {b.ingetrokken_reden}</span>}
            {!b.ingetrokken_op && p.status === "open" && (ctx.isBackoffice || b.geupload_door_id === ctx.gebruiker?.id) &&
              <button onClick={()=>intrekken(b)} style={{...btn("white", C.rood), padding:"2px 7px", fontSize:11}}>{tx("intrekken")}</button>}
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
          <input style={{...inp, flex:"1 1 200px", width:"auto"}} placeholder={tx("Toelichting (optioneel)")} value={opmerking} onChange={e=>setOpmerking(e.target.value)} />
          <button style={btn(actief.length ? C.groen : C.grijs)} disabled={ctx.bezig || !actief.length}
            title={actief.length ? "" : tx("Upload eerst bewijs.")}
            onClick={()=>ctx.rpc("snf_herstelpunt_hersteld", { p_id: p.id, p_opmerking: opmerking.trim() || null }, tx("✓ Hersteld gemeld — wacht op controle"))}>
            {tx("✔ Hersteld melden")}
          </button>
          {!actief.length && <span style={{fontSize:12,color:C.muted}}>{tx("Upload eerst bewijs.")}</span>}
        </>)}
        {p.status === "hersteld" && ctx.magControleren && (zelfHersteld ? (
          <span style={{fontSize:12,color:C.oranje,fontWeight:700}}>{tx("👀 Jij hebt dit hersteld gemeld — iemand anders moet controleren (vier ogen).")}</span>
        ) : (<>
          <button style={btn(C.groen)} disabled={ctx.bezig} onClick={()=>ctx.rpc("snf_herstelpunt_controleren", { p_id: p.id, p_goedgekeurd: true }, tx("✓ Goedgekeurd"))}>{tx("✅ Goedkeuren")}</button>
          <button style={btn(C.rood)} disabled={ctx.bezig} onClick={afkeuren}>{tx("❌ Afkeuren")}</button>
        </>))}
        {p.status === "hersteld" && !ctx.magControleren && <span style={{fontSize:12,color:C.muted}}>{tx("Wacht op controle.")}</span>}
        {p.status === "gecontroleerd" && ctx.magControleren && <button style={btn("white", C.rood)} disabled={ctx.bezig} onClick={heropenen}>{tx("↩ Heropenen")}</button>}
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
    if (!v.woning_id || !v.inspectiedatum || !v.deadline || !v.interne_deadline) { alert(tx("Vul woning, inspectiedatum en deadlines in.")); return; }
    const r = await ctx.rpc("snf_inspectie_opslaan", { p_id: insp?.id || null, p_data: { ...v, woning_id: Number(v.woning_id) } }, tx(insp ? "✓ Inspectie opgeslagen" : "✓ Inspectie aangemaakt — voeg nu de herstelpunten toe"));
    if (r) onKlaar(r.id);
  }
  const veld = (k, label, type="text") => (
    <div><label style={lbl}>{tx(label)}</label><input type={type} style={inp} value={v[k] || ""} onChange={e=>zet(k, e.target.value)} /></div>
  );
  return (
    <Kaart>
      <div style={{fontSize:15,fontWeight:800,color:C.text,marginBottom:10}}>{tx(insp ? "Inspectie wijzigen" : "Nieuwe inspectie")}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
        <div>
          <label style={lbl}>{tx("Woning *")}</label>
          <select style={inp} value={v.woning_id} onChange={e=>zet("woning_id", e.target.value)}>
            <option value="">{tx("— kies woning —")}</option>
            {(ctx.houses || []).map(h => <option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
          </select>
        </div>
        {veld("inspectiedatum", "Inspectiedatum *", "date")}
        {veld("rapportnummer", "Rapportnummer")}
        {veld("inspectienummer", "Inspectienummer")}
        {veld("inspectie_instelling", "Inspectie-instelling")}
        {veld("inspecteur", "Inspecteur")}
        <div>
          <label style={lbl}>{tx("Uitslag *")}</label>
          <select style={inp} value={v.uitslag} onChange={e=>zet("uitslag", e.target.value)}>
            <option value="voldoet_niet">{tx("Voldoet niet")}</option><option value="voldoet">{tx("Voldoet")}</option>
          </select>
        </div>
        <div>
          <label style={lbl}>{tx("Vervolgactie")}</label>
          <select style={inp} value={v.vervolgactie} onChange={e=>zet("vervolgactie", e.target.value)}>
            <option value="">—</option><option value="administratief">{tx("Administratief")}</option><option value="herinspectie">{tx("Herinspectie")}</option>
          </select>
        </div>
        {veld("deadline", "Deadline * (standaard +6 weken)", "date")}
        {veld("interne_deadline", "Interne deadline * (standaard −14 dagen)", "date")}
      </div>
      <div style={{marginTop:10}}><label style={lbl}>{tx("Opmerking")}</label><textarea style={{...inp, minHeight:50}} value={v.opmerking || ""} onChange={e=>zet("opmerking", e.target.value)} /></div>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button style={btn(C.groen)} disabled={ctx.bezig} onClick={opslaan}>{tx("💾 Opslaan")}</button>
        <button style={{...btn("white", C.text), border:`1px solid ${C.border}`}} onClick={()=>onKlaar(null)}>{tx("Annuleren")}</button>
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
    if (!v.omschrijving_inspecteur.trim()) { alert(tx("Omschrijving van de inspecteur is verplicht.")); return; }
    const r = await ctx.rpc("snf_herstelpunt_opslaan", { p_id: punt?.id || null,
      p_data: { ...v, inspectie_id: inspectieId, eigenaar_id: v.eigenaar_id ? Number(v.eigenaar_id) : null } }, tx(punt ? "✓ Punt opgeslagen" : "✓ Punt toegevoegd"));
    if (r) onKlaar();
  }
  const veld = (k, label) => <div><label style={lbl}>{tx(label)}</label><input style={inp} value={v[k] || ""} onChange={e=>zet(k, e.target.value)} /></div>;
  return (
    <div>
      <div style={{fontSize:14,fontWeight:800,color:C.text,marginBottom:8}}>{tx(punt ? "Herstelpunt wijzigen" : "Nieuw herstelpunt")}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10}}>
        {veld("normnummer", "Normnummer (bv. 6.3)")}
        <div>
          <label style={lbl}>{tx("Categorie")}</label>
          <input style={inp} list="snf-categorieen" value={v.categorie || ""} onChange={e=>zet("categorie", e.target.value)} />
          <datalist id="snf-categorieen">{CATEGORIEEN.map(c => <option key={c} value={c} />)}</datalist>
        </div>
        <div>
          <label style={lbl}>{tx("Ernst *")}</label>
          <select style={inp} value={v.ernst} onChange={e=>zet("ernst", e.target.value)}><option value="major">Major</option><option value="minor">Minor</option></select>
        </div>
        <div>
          <label style={lbl}>{tx("Eigenaar")}</label>
          <select style={inp} value={v.eigenaar_id || ""} onChange={e=>zet("eigenaar_id", e.target.value)}>
            <option value="">{tx("— niemand —")}</option>
            {kandidaten.map(g => <option key={g.id} value={g.id}>{g.naam} ({g.rol})</option>)}
          </select>
        </div>
      </div>
      <div style={{display:"grid",gap:10,marginTop:10}}>
        <div><label style={lbl}>{tx("Omschrijving inspecteur *")}</label><textarea style={{...inp, minHeight:50}} value={v.omschrijving_inspecteur || ""} onChange={e=>zet("omschrijving_inspecteur", e.target.value)} /></div>
        {veld("actie", "Actie (wat moet er gebeuren)")}
        {veld("vereist_bewijs", "Vereist bewijs")}
        {veld("opmerking", "Opmerking")}
      </div>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button style={btn(C.groen)} disabled={ctx.bezig} onClick={opslaan}>{tx("💾 Opslaan")}</button>
        <button style={{...btn("white", C.text), border:`1px solid ${C.border}`}} onClick={onKlaar}>{tx("Annuleren")}</button>
      </div>
    </div>
  );
}

// ─── 5. KWARTAALCONTROLE (SNF-norm 3A.1) ─────────────────────────────────────
// Min. 4x per jaar controle van woning + omgeving, met logboek: datum, controleur, bevinding,
// oplossing en wie het oploste. Bron: de kwartaalchecklist van de huismeester (tabel checklists,
// type "kwartaal", week_jaar "Q<n>-<jaar>" op basis van ISO-week, zoals in App.js).
// Afwijkingen staan in checklists.items_opmerkingen: { <item_id>: { bevinding, gemeld_door, gemeld_op, oplossing, opgelost_door, opgelost_op } }.

function isoWeek(datum) {
  const d = new Date(datum); d.setHours(0,0,0,0); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return { week: 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7), jaar: d.getFullYear() };
}
function huidigKwartaal() { const { week, jaar } = isoWeek(new Date()); return { q: Math.min(4, Math.ceil(week / 13)), jaar }; }
function vorigKwartaal() { const { q, jaar } = huidigKwartaal(); return q === 1 ? { q:4, jaar: jaar - 1 } : { q: q - 1, jaar }; }

// Week 53 levert in de app "Q5-<jaar>" op: telt mee als Q4
function lijstenVoor(lijsten, woningId, { q, jaar }) {
  const sleutels = q === 4 ? [`Q4-${jaar}`, `Q5-${jaar}`] : [`Q${q}-${jaar}`];
  return lijsten.filter(c => c.woning_id === woningId && sleutels.includes(c.week_jaar));
}
function afwijkingenVan(chk) {
  return Object.entries(chk?.items_opmerkingen || {})
    .filter(([, a]) => a && typeof a === "object" && a.bevinding)
    .map(([id, a]) => ({ itemId: Number(id), ...a }));
}
export function kwartaalStatus(lijsten, items, woningId, periode, huis) {
  const chks = lijstenVoor(lijsten, woningId, periode);
  // Centrale verwarming: ketel-items (alleen_eigen_cv) tellen niet mee voor deze woning
  const actief = items.filter(i => i.actief && !(i.alleen_eigen_cv && huis?.centrale_verwarming));
  const gedaan = new Set(chks.flatMap(c => (c.items || []).filter(i => typeof i === "number")));
  const aantal = actief.filter(i => gedaan.has(i.id)).length;
  const laatste = chks.slice().sort((a,b) => (b.updated_at || "").localeCompare(a.updated_at || ""))[0];
  const afw = chks.flatMap(afwijkingenVan);
  return { chks, aantal, totaal: actief.length, klaar: actief.length > 0 && aantal >= actief.length,
    datum: laatste?.updated_at, controleur: laatste?.bijgewerkt_door || laatste?.aangemaakt_door,
    openAfw: afw.filter(a => !a.opgelost_op).length };
}

function Logboek({ huizen, lijsten, items, ctx, onWijzig }) {
  const nu = huidigKwartaal();
  const jaren = [...new Set([nu.jaar, ...lijsten.map(c => Number((c.week_jaar || "").split("-")[1])).filter(Boolean)])].sort((a,b) => b - a);
  const [jaar, setJaar] = useState(nu.jaar);
  const itemMap = Object.fromEntries(items.map(i => [i.id, i]));
  const magOplossen = ctx.isBackoffice || ctx.gebruiker?.rol === "huismeester";

  const afwijkingen = useMemo(() => {
    const r = [];
    for (const c of lijsten) {
      const [qs, j] = (c.week_jaar || "").split("-");
      if (Number(j) !== jaar) continue;
      for (const a of afwijkingenVan(c)) r.push({ ...a, chk: c, kwartaal: qs === "Q5" ? "Q4" : qs });
    }
    return r.sort((a,b) => (a.opgelost_op ? 1 : 0) - (b.opgelost_op ? 1 : 0) || (b.gemeld_op || "").localeCompare(a.gemeld_op || ""));
  }, [lijsten, jaar]);

  async function oplossen(a) {
    const oplossing = window.prompt(tx("Wat is er gedaan om het op te lossen? (verplicht)"));
    if (!oplossing || !oplossing.trim()) return;
    const door = window.prompt(tx("Opgelost door (naam of bedrijf)"), ctx.gebruiker?.naam || "");
    if (!door || !door.trim()) return;
    const opm = { ...(a.chk.items_opmerkingen || {}) };
    opm[a.itemId] = { ...opm[a.itemId], oplossing: oplossing.trim(), opgelost_door: door.trim(), opgelost_op: new Date().toISOString(), vastgelegd_door: ctx.gebruiker?.naam };
    const { error } = await supabase.from("checklists").update({ items_opmerkingen: opm, bijgewerkt_door: ctx.gebruiker?.naam, updated_at: new Date().toISOString() }).eq("id", a.chk.id);
    if (error) { alert(tx("Opslaan mislukt: ") + error.message); return; }
    onWijzig();
  }

  function exporteer() {
    const cel = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rijen = [["Woning","Kwartaal","Datum controle","Controleur","Items gecontroleerd","Normitem","Bevinding","Gemeld door","Gemeld op","Oplossing","Opgelost door","Opgelost op"]];
    for (const h of huizen) for (const q of [1,2,3,4]) {
      const st = kwartaalStatus(lijsten, items, h.id, { q, jaar }, h);
      if (!st.chks.length) continue;
      const basis = [`${h.adres}, ${h.stad}`, `Q${q} ${jaar}`, st.datum ? fmt(st.datum) : "", st.controleur || "", `${st.aantal}/${st.totaal}`];
      const afw = st.chks.flatMap(afwijkingenVan);
      if (!afw.length) rijen.push([...basis, "", "Geen afwijkingen", "", "", "", "", ""]);
      for (const a of afw) {
        const it = itemMap[a.itemId];
        rijen.push([...basis, it ? `${it.snf_norm ? "SNF " + it.snf_norm + " – " : ""}${it.tekst}` : `#${a.itemId}`, a.bevinding, a.gemeld_door,
          a.gemeld_op ? fmt(a.gemeld_op) : "", a.oplossing || "", a.opgelost_door || "", a.opgelost_op ? fmt(a.opgelost_op) : ""]);
      }
    }
    const blob = new Blob(["﻿" + rijen.map(r => r.map(cel).join(";")).join("\r\n")], { type:"text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a"); el.href = url; el.download = `SNF-logboek-kwartaalcontrole-${jaar}.csv`; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function cel(h, q) {
    const st = kwartaalStatus(lijsten, items, h.id, { q, jaar }, h);
    const voorbij = jaar < nu.jaar || (jaar === nu.jaar && q < nu.q);
    const huidig = jaar === nu.jaar && q === nu.q;
    let kleur = C.grijs, tekst = "—", sub = "";
    if (st.klaar) { kleur = st.openAfw ? C.oranje : C.groen; tekst = `✓ ${fmt(st.datum)}`; sub = st.controleur || ""; }
    else if (st.aantal > 0) { kleur = voorbij ? C.rood : C.oranje; tekst = `${st.aantal}/${st.totaal}`; sub = st.controleur || ""; }
    else if (voorbij) { kleur = C.rood; tekst = tx("niet gedaan"); }
    else if (huidig) { kleur = C.oranje; tekst = tx("nog doen"); }
    return (
      <td key={q} style={{padding:"6px 8px",borderBottom:`1px solid ${C.border}`,textAlign:"center",background:kleur+"14"}}>
        <div style={{fontWeight:700,color:kleur,fontSize:12}}>{tekst}</div>
        {sub && <div style={{fontSize:10.5,color:C.muted}}>{sub}</div>}
        {st.openAfw > 0 && <div style={{fontSize:10.5,color:C.rood,fontWeight:700}}>{txv("⚠ {0} afwijking(en) open", st.openAfw)}</div>}
      </td>
    );
  }

  return (
    <div>
      <Kaart style={{marginBottom:10,fontSize:12.5,color:C.text,lineHeight:1.5}}>
        <b>{tx("SNF-norm 3A.1:")}</b> {tx("minimaal 4× per jaar een controle van woning en omgeving, vastgelegd met datum, controleur, bevinding, oplossing en wie het oploste. Bron: de kwartaalchecklist van de huismeester.")}
      </Kaart>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
        <select style={{...inp, width:"auto"}} value={jaar} onChange={e=>setJaar(Number(e.target.value))}>
          {jaren.map(j => <option key={j} value={j}>{j}</option>)}
        </select>
        <button style={btn(C.blauw)} onClick={exporteer}>{tx("⬇ Exporteren voor auditor (CSV)")}</button>
      </div>
      <div style={{overflowX:"auto",background:C.card,border:`1px solid ${C.border}`,borderRadius:10}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
          <thead><tr style={{background:C.bg}}>
            <th style={{textAlign:"left",padding:"7px 8px"}}>{tx("Woning")}</th>
            {[1,2,3,4].map(q => <th key={q} style={{padding:"7px 8px"}}>Q{q}</th>)}
          </tr></thead>
          <tbody>
            {huizen.map(h => (
              <tr key={h.id}>
                <td style={{padding:"6px 8px",borderBottom:`1px solid ${C.border}`,fontWeight:700,color:C.text}}>{h.adres}, {h.stad}</td>
                {[1,2,3,4].map(q => cel(h, q))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{fontSize:15,fontWeight:800,color:C.text,margin:"16px 0 8px"}}>{txv("Afwijkingen {0} ({1})", jaar, afwijkingen.length)}</div>
      {!afwijkingen.length ? <Kaart style={{color:C.muted,textAlign:"center"}}>{tx("Geen afwijkingen geregistreerd.")}</Kaart> : (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {afwijkingen.map(a => {
            const it = itemMap[a.itemId];
            return (
              <div key={`${a.chk.id}-${a.itemId}`} style={{background:C.card,border:`1px solid ${C.border}`,borderLeft:`6px solid ${a.opgelost_op ? C.groen : C.rood}`,borderRadius:10,padding:"9px 12px",fontSize:12.5,color:C.text}}>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                  <b>{ctx.adresVan(a.chk.woning_id)}</b><span style={{color:C.muted}}>· {a.kwartaal} {jaar}</span>
                  {it?.snf_norm && <Badge kleur={C.rood}>SNF {it.snf_norm}</Badge>}
                  <span style={{color:C.muted}}>{it ? dbTekst(it) : `#${a.itemId}`}</span>
                </div>
                <div style={{marginTop:3}}>⚠ {a.bevinding} <span style={{color:C.muted}}>— {a.gemeld_door}, {a.gemeld_op ? fmt(a.gemeld_op) : ""}</span></div>
                {a.opgelost_op
                  ? <div style={{color:C.groen}}>✓ {a.oplossing} <span style={{color:C.muted}}>— {a.opgelost_door}, {fmt(a.opgelost_op)}</span></div>
                  : magOplossen && <button style={{...btn(C.groen), marginTop:5}} onClick={()=>oplossen(a)}>{tx("✓ Oplossing invullen")}</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 6. KEURINGEN per woning ─────────────────────────────────────────────────
// Brandblusser: onderhoud elke 2 jaar door REOB-bedrijf (norm 7.1), vervangen schuim 5 jr / poeder-CO2 10 jr.
// CV-ketel/gaskachel/geiser: elke 2 jaar aantoonbaar gecontroleerd (norm 6.5).
// Brandmeldinstallatie: jaarlijks (norm 7.5). Signaal: rood = verlopen, oranje = binnen 60 dagen of datum ontbreekt.
const KEURING_SOORTEN = {
  brandblusser:         { label:"Brandblusser (onderhoud)", interval:24, norm:"7.1" },
  cv_geiser:            { label:"CV-ketel / geiser",        interval:24, norm:"6.5" },
  brandmeldinstallatie: { label:"Brandmeldinstallatie",     interval:12, norm:"7.5" },
  overig:               { label:"Overig",                   interval:12, norm:"" },
};
const KEURING_VERPLICHT = ["brandblusser", "cv_geiser"];
// Centrale verwarming (bv. Am Busch): geen eigen CV-ketel in de woning, dus geen CV-keuring per woning
const verplichtVoor = h => KEURING_VERPLICHT.filter(s => !(s === "cv_geiser" && h?.centrale_verwarming));

export function keuringStatus(k) {
  if (k.nvt) return { niveau:"groen", kleur:C.groen, label:tx("n.v.t.") };
  if (!k.laatste_datum) return { niveau:"oranje", kleur:C.oranje, label:tx("datum ontbreekt") };
  const d = Math.min(dagenTot(k.volgende_datum), k.vervangen_uiterlijk ? dagenTot(k.vervangen_uiterlijk) : Infinity);
  if (d < 0) return { niveau:"rood", kleur:C.rood, label:txv("{0} dg verlopen", -d) };
  if (d <= 60) return { niveau:"oranje", kleur:C.oranje, label:txv("nog {0} dg", d) };
  return { niveau:"groen", kleur:C.groen, label:txv("nog {0} dg", d) };
}

function Keuringen({ huizen, keuringen, ctx }) {
  const [form, setForm] = useState(null);   // null | { ...keuring }
  const magBewerken = ctx.isBackoffice || ctx.gebruiker?.rol === "huismeester";
  const perWoning = useMemo(() => {
    const m = {};
    for (const k of keuringen) (m[k.woning_id] ||= []).push(k);
    return m;
  }, [keuringen]);
  async function zetCentraal(h, aan) {
    const { error } = await supabase.from("woningen").update({ centrale_verwarming: aan, bijgewerkt_door: ctx.gebruiker?.naam, updated_at: new Date().toISOString() }).eq("id", h.id);
    if (error) { alert(tx("Opslaan mislukt: ") + error.message); return; }
    h.centrale_verwarming = aan;   // direct tonen; realtime ververst daarna de woningenlijst
    setTick(t => t + 1);
  }
  const [, setTick] = useState(0);
  const nieuw = (woning_id, soort) => setForm({ woning_id: String(woning_id), soort, omschrijving:"", laatste_datum:"", interval_maanden: KEURING_SOORTEN[soort].interval, vervangen_uiterlijk:"", nvt:false, bedrijf:"", opmerking:"" });
  const volgorde = { rood:0, oranje:1, groen:2 };
  const ergste = h => {
    const ks = perWoning[h.id] || [];
    const mist = verplichtVoor(h).some(s => !ks.some(k => k.soort === s));
    return Math.min(mist ? 1 : 3, ...ks.map(k => volgorde[keuringStatus(k).niveau]));
  };

  return (
    <div>
      <Kaart style={{marginBottom:10,fontSize:12.5,color:C.text,lineHeight:1.5}}>
        {tx("Brandblusser: onderhoud elke 2 jaar door een REOB-bedrijf (etiket); schuim vervangen na 5 jaar, poeder/CO2 na 10 jaar. CV-ketel/geiser: elke 2 jaar gekeurd (factuur, rapport of sticker). Vul na elke keuring de nieuwe datum in.")}
      </Kaart>
      {form && <Kaart style={{marginBottom:10}}><KeuringForm v0={form} ctx={ctx} onKlaar={()=>setForm(null)} /></Kaart>}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {[...huizen].sort((a,b) => ergste(a) - ergste(b) || a.adres.localeCompare(b.adres)).map(h => {
          const ks = perWoning[h.id] || [];
          const missend = verplichtVoor(h).filter(s => !ks.some(k => k.soort === s));
          return (
            <Kaart key={h.id}>
              <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap",marginBottom:6}}>
                <b style={{color:C.text,fontSize:14}}>{h.adres}, {h.stad}</b>
                {magBewerken && <button style={btn("white", C.blauw)} onClick={()=>nieuw(h.id, "brandblusser")}>{tx("➕ Keuring")}</button>}
              </div>
              {ctx.isBackoffice ? (
                <label style={{display:"flex",gap:6,alignItems:"center",fontSize:12,color:C.muted,marginBottom:4}}>
                  <input type="checkbox" checked={!!h.centrale_verwarming} onChange={e=>zetCentraal(h, e.target.checked)} />
                  {tx("Centrale verwarming (geen eigen CV-ketel): ketelpunten vervallen in de checklist")}
                </label>
              ) : h.centrale_verwarming ? (
                <div style={{fontSize:12,color:C.muted,marginBottom:4}}>{tx("🔥 Centrale verwarming: geen eigen CV-ketel")}</div>
              ) : null}
              {missend.map(s => (
                <div key={s} style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",fontSize:12.5,padding:"5px 0",borderTop:`1px dashed ${C.border}`}}>
                  <Badge kleur={C.oranje}>{tx("nog niet ingevuld")}</Badge>
                  <span style={{color:C.text}}>{tx(KEURING_SOORTEN[s].label)} <span style={{color:C.muted}}>(SNF {KEURING_SOORTEN[s].norm})</span></span>
                  {magBewerken && <button style={{...btn(C.blauw), padding:"3px 9px", fontSize:11}} onClick={()=>nieuw(h.id, s)}>{tx("Invullen")}</button>}
                </div>
              ))}
              {ks.map(k => {
                const st = keuringStatus(k);
                return (
                  <div key={k.id} style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",fontSize:12.5,padding:"5px 0",borderTop:`1px dashed ${C.border}`}}>
                    <Badge kleur={st.kleur}>{st.label}</Badge>
                    <span style={{color:C.text,fontWeight:700}}>{tx(KEURING_SOORTEN[k.soort]?.label || k.soort)}</span>
                    {k.omschrijving && <span style={{color:C.text}}>{k.omschrijving}</span>}
                    {!k.nvt && <span style={{color:C.muted}}>{txv("laatst {0} · volgende {1}", fmt(k.laatste_datum), fmt(k.volgende_datum))}{k.vervangen_uiterlijk ? ` · ${txv("vervangen uiterlijk {0}", fmt(k.vervangen_uiterlijk))}` : ""}</span>}
                    {k.bedrijf && <span style={{color:C.muted}}>· {k.bedrijf}</span>}
                    {k.opmerking && <span style={{color:C.muted}}>· 📝 {k.opmerking}</span>}
                    {magBewerken && <button style={{...btn("white", C.blauw), padding:"3px 8px", fontSize:11}} onClick={()=>setForm({ ...k, woning_id:String(k.woning_id) })}>✏️</button>}
                  </div>
                );
              })}
            </Kaart>
          );
        })}
      </div>
    </div>
  );
}

function KeuringForm({ v0, ctx, onKlaar }) {
  const [v, setV] = useState(v0);
  const zet = (k, w) => setV(x => ({ ...x, [k]: w, ...(k === "soort" && !x.id ? { interval_maanden: KEURING_SOORTEN[w].interval } : {}) }));
  async function opslaan() {
    if (!v.woning_id || !v.soort) { alert(tx("Kies woning en soort.")); return; }
    if (!v.nvt && !v.laatste_datum) { alert(tx("Vul de datum van de laatste keuring in (of vink n.v.t. aan).")); return; }
    const r = await ctx.rpc("snf_keuring_opslaan", { p_id: v.id || null, p_data: { ...v, woning_id: Number(v.woning_id) } }, tx("✓ Keuring opgeslagen"));
    if (r) onKlaar();
  }
  async function verwijder() {
    if (!window.confirm(tx("Deze keuring verwijderen?"))) return;
    const r = await ctx.rpc("snf_keuring_verwijderen", { p_id: v.id }, tx("Keuring verwijderd"));
    if (r) onKlaar();
  }
  const veld = (k, label, type="text") => <div><label style={lbl}>{tx(label)}</label><input type={type} style={inp} value={v[k] ?? ""} onChange={e=>zet(k, e.target.value)} /></div>;
  return (
    <div>
      <div style={{fontSize:14,fontWeight:800,color:C.text,marginBottom:8}}>{tx(v.id ? "Keuring wijzigen" : "Nieuwe keuring")}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:10}}>
        <div>
          <label style={lbl}>{tx("Woning *")}</label>
          <select style={inp} value={v.woning_id} onChange={e=>zet("woning_id", e.target.value)}>
            <option value="">{tx("— kies woning —")}</option>
            {(ctx.houses || []).filter(h => !h.gearchiveerd).map(h => <option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>{tx("Soort *")}</label>
          <select style={inp} value={v.soort} onChange={e=>zet("soort", e.target.value)}>
            {Object.entries(KEURING_SOORTEN).map(([k, s]) => <option key={k} value={k}>{tx(s.label)}</option>)}
          </select>
        </div>
        {veld("omschrijving", "Omschrijving (bv. blusser keuken 6L schuim)")}
        {veld("laatste_datum", "Laatste keuring *", "date")}
        {veld("interval_maanden", "Interval (maanden)", "number")}
        {v.soort === "brandblusser" && veld("vervangen_uiterlijk", "Vervangen uiterlijk (schuim 5 jr, poeder 10 jr)", "date")}
        {veld("bedrijf", "Keuringsbedrijf")}
        {veld("opmerking", "Opmerking")}
      </div>
      <label style={{display:"flex",gap:6,alignItems:"center",fontSize:12.5,color:C.text,marginTop:10}}>
        <input type="checkbox" checked={!!v.nvt} onChange={e=>zet("nvt", e.target.checked)} />
        {tx("Niet van toepassing in deze woning (bv. geen gastoestel)")}
      </label>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button style={btn(C.groen)} disabled={ctx.bezig} onClick={opslaan}>{tx("💾 Opslaan")}</button>
        <button style={{...btn("white", C.text), border:`1px solid ${C.border}`}} onClick={onKlaar}>{tx("Annuleren")}</button>
        {v.id && ctx.isBackoffice && <button style={{...btn("white", C.rood), marginLeft:"auto"}} onClick={verwijder}>{tx("🗑 Verwijderen")}</button>}
      </div>
    </div>
  );
}
