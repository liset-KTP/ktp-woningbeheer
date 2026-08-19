import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import { BijlageUploader, BijlageWeergave, uploadBijlages } from "./BijlageUploader";
import WeekDatePicker from "./WeekDatePicker";

// ─── EMAILJS ─────────────────────────────────────────────────────────────────
const EMAILJS_SERVICE  = process.env.REACT_APP_EMAILJS_SERVICE  || "";
const EMAILJS_TEMPLATE = process.env.REACT_APP_EMAILJS_TEMPLATE || "";
const EMAILJS_PUBLIC   = process.env.REACT_APP_EMAILJS_PUBLIC   || "";

async function stuurMail(params) {
  try {
    await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id:  EMAILJS_SERVICE,
        template_id: EMAILJS_TEMPLATE,
        user_id:     EMAILJS_PUBLIC,
        template_params: params,
      }),
    });
  } catch (e) { console.error("EmailJS:", e); }
}
const C = {
  blauw:"#1B3A6B", blauwDark:"#132b52", blauwLight:"#2a52a0",
  groen:"#4A9B3C", groenDark:"#357a2b", groenLight:"#5cb84d",
  bg:"#f0f4f8", card:"#ffffff", border:"#d1dbe8",
  text:"#1a2b47", muted:"#6b7a8d", dark:"#0d1f3c",
};
const lbl = {fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"};
const inp = {width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};

const AUTO_STATUSSEN = ["Lopend","Beschikbaar","Gereserveerd","Niet beschikbaar","Moet ingenomen worden","Vakantie"];
const AUTO_STATUS_MAP = {
  "Lopend":                  { bg:"#4A9B3C18", text:"#357a2b", dot:"#4A9B3C" },
  "Beschikbaar":             { bg:"#1B3A6B18", text:"#1B3A6B", dot:"#2a52a0" },
  "Gereserveerd":            { bg:"#f59e0b18", text:"#b45309", dot:"#f59e0b" },
  "Niet beschikbaar":        { bg:"#ef444418", text:"#b91c1c", dot:"#ef4444" },
  "Moet ingenomen worden":   { bg:"#f9731618", text:"#c2410c", dot:"#f97316" },
  "Vakantie":                { bg:"#8b5cf618", text:"#6d28d9", dot:"#8b5cf6" },
};

function fmtDate(d) { if(!d) return ""; const dt=typeof d==="string"?new Date(d):d; return dt.toLocaleDateString("nl-NL",{day:"2-digit",month:"2-digit",year:"numeric"}); }
function fmtTime(d) { if(!d) return ""; const dt=typeof d==="string"?new Date(d):d; return dt.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"}); }
function fmtFull(d) { if(!d) return ""; return `${fmtDate(d)} ${fmtTime(d)}`; }
function todayISO() { return new Date().toISOString().slice(0,10); }
function nowISO() { return new Date().toISOString().slice(0,16); }

function SH({titel,sub,actie}) {
  return <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24}}>
    <div><h2 style={{fontSize:20,fontWeight:800,color:C.blauw,marginBottom:3}}>{titel}</h2>{sub&&<p style={{fontSize:13,color:C.muted}}>{sub}</p>}</div>
    {actie}
  </div>;
}

// ─── HOOFD AUTO MODULE ────────────────────────────────────────────────────────
export function AutoModule({ gebruiker, showToast }) {
  const [autos, setAutos] = useState([]);
  const [gearchiveerdeAutos, setGearchiveerdeAutos] = useState([]);
  const [autoMeldingen, setAutoMeldingen] = useState([]);
  const [subTab, setSubTab] = useState("overzicht");
  const [loading, setLoading] = useState(true);

  const loadAutos = useCallback(async () => {
    const { data, error } = await supabase.from("autos").select("*").order("status").order("kenteken").neq("gearchiveerd", true);
    if (error) { console.error(error); return; }
    setAutos(data || []);
  }, []);

  const loadGearchiveerdeAutos = useCallback(async () => {
    const { data, error } = await supabase.from("autos").select("*").order("kenteken").eq("gearchiveerd", true);
    if (error) { console.error(error); return; }
    setGearchiveerdeAutos(data || []);
  }, []);

  const loadAutoMeldingen = useCallback(async () => {
    const { data, error } = await supabase.from("auto_meldingen").select("*").order("created_at", { ascending: false });
    if (error) { console.error(error); return; }
    setAutoMeldingen(data || []);
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([loadAutos(), loadGearchiveerdeAutos(), loadAutoMeldingen()]);
      setLoading(false);
    }
    init();
  }, [loadAutos, loadAutoMeldingen]);

  useEffect(() => {
    const s1 = supabase.channel("aut-rt").on("postgres_changes",{event:"*",schema:"public",table:"autos"},()=>loadAutos()).subscribe();
    const s2 = supabase.channel("aum-rt").on("postgres_changes",{event:"*",schema:"public",table:"auto_meldingen"},()=>loadAutoMeldingen()).subscribe();
    return () => { supabase.removeChannel(s1); supabase.removeChannel(s2); };
  }, [loadAutos, loadAutoMeldingen]);

  async function addAutoMelding(m) {
    // "afwijkingen" is alleen voor de e-mailtekst — geen kolom in de database
    const { afwijkingen, ...opslagData } = m;
    const { error } = await supabase.from("auto_meldingen").insert([{...opslagData, ingediend_door: gebruiker.naam, status:"open"}]);
    if (error) { showToast("Fout bij opslaan","err"); return false; }

    // Auto status bijwerken
    if (m.kenteken && m.actie !== "geannuleerd") {
      const auto = autos.find(a => a.kenteken === m.kenteken);
      if (auto) {
        const nieuweStatus = m.actie === "uitgifte" ? "Lopend" : m.actie === "storing" ? auto.status : "Beschikbaar";
        await supabase.from("autos").update({
          status: nieuweStatus,
          naam_medewerker: m.actie === "uitgifte" ? m.naam_medewerker : (m.actie === "storing" ? auto.naam_medewerker : null),
          datum_uitgifte: m.actie === "uitgifte" ? (m.datum_tijd ? m.datum_tijd.slice(0,10) : new Date().toISOString().slice(0,10)) : (m.actie === "inname" ? null : undefined),
        }).eq("id", auto.id);
      }
    }

    // ── E-mail sturen ──────────────────────────────────────────────────────
    const actieTekst = {
      uitgifte: "🚗 Auto uitgifte", inname: "🔑 Auto inname",
      storing: "🔧 Auto storing/schade", geannuleerd: "❌ Auto geannuleerd",
    };
    const heeftAfwijking = !!m.afwijking_gevonden && Array.isArray(afwijkingen) && afwijkingen.length > 0;
    stuurMail({
      type:          heeftAfwijking ? `⚠️ ${actieTekst[m.actie] || m.actie} — bijzonderheden!` : (actieTekst[m.actie] || m.actie),
      type_icon:     heeftAfwijking ? "⚠️" : (actieTekst[m.actie]?.split(" ")[0] || "🚗"),
      medewerker:    m.naam_medewerker,
      woning:        `Kenteken: ${m.kenteken}`,
      kamer:         m.locatie ? `Locatie: ${m.locatie}` : "—",
      datum:         m.datum_tijd ? new Date(m.datum_tijd).toLocaleDateString("nl-NL") : "—",
      ingediend_door: gebruiker.naam,
      opmerkingen:   heeftAfwijking ? `${afwijkingen.join(" · ")}${m.opmerkingen ? " · " + m.opmerkingen : ""}` : (m.opmerkingen || "—"),
    });

    showToast(heeftAfwijking ? "⚠️ Ingediend — bijzonderheden gemeld aan backoffice" : "✓ Auto melding ingediend");
    return true;
  }

  async function updateAutoMelding(id, updates) {
    const { error } = await supabase.from("auto_meldingen").update({...updates, afgehandeld_door: gebruiker.naam, afgehandeld_op: new Date().toISOString()}).eq("id", id);
    if (error) showToast("Fout bij updaten","err");
    else showToast("✓ Bijgewerkt");
  }

  async function stuurReactie(melding, tekst) {
    // Opslaan in auto_meldingen (voor weergave in log)
    await supabase.from("auto_meldingen").update({
      backoffice_reactie: tekst,
      reactie_door: gebruiker.naam,
      reactie_op: new Date().toISOString(),
      reactie_gelezen: false,
    }).eq("id", melding.id);

    // OOK opslaan in berichten (centrale berichtenmodule)
    const { error } = await supabase.from("berichten").insert([{
      tekst: tekst,
      van: gebruiker.naam,
      aan: melding.ingediend_door,
      onderwerp: `Reactie op auto-melding: ${melding.kenteken}`,
      koppeling_type: "auto",
      koppeling_id: melding.id,
      koppeling_label: `Auto ${melding.kenteken} — ${melding.naam_medewerker}`,
      gelezen_door: [gebruiker.naam],
    }]);
    if (error) { showToast("Fout bij versturen","err"); return false; }

    stuurMail({
      type: "💬 Reactie op auto-melding",
      type_icon: "💬",
      medewerker: melding.ingediend_door,
      woning: `Auto ${melding.kenteken}`,
      kamer: "—",
      datum: new Date().toISOString().slice(0,10),
      ingediend_door: gebruiker.naam,
      opmerkingen: `Reactie van backoffice: "${tekst}"`,
    });
    showToast("✓ Reactie verstuurd — zichtbaar in Berichten");
    return true;
  }

  async function markeerGelezen(id) {
    await supabase.from("auto_meldingen").update({ reactie_gelezen: true }).eq("id", id);
  }

  async function addAuto(auto) {
    const { error } = await supabase.from("autos").insert([auto]);
    if (error) { showToast("Fout bij toevoegen","err"); return false; }
    showToast("✓ Auto toegevoegd"); return true;
  }

  // Velden die je via het bewerkformulier kunt wijzigen — gebruikt om een leesbare
  // wijzigingslog te bouwen (welk veld ging van wat naar wat).
  const AUTO_AUDIT_VELDEN = [
    { key: "kenteken",       label: "Kenteken" },
    { key: "merk_model",     label: "Merk & model" },
    { key: "kleur",          label: "Kleur" },
    { key: "vestiging",      label: "Vestiging" },
    { key: "naam_medewerker",label: "Medewerker" },
    { key: "apk_datum",      label: "APK datum" },
    { key: "datum_uitgifte", label: "Datum uitgifte" },
    { key: "status",         label: "Status" },
  ];

  function autoWijzigingen(oud, nieuw) {
    return AUTO_AUDIT_VELDEN
      .filter(f => (oud?.[f.key] || "") !== (nieuw?.[f.key] || ""))
      .map(f => `${f.label}: "${oud?.[f.key] || "—"}" → "${nieuw?.[f.key] || "—"}"`);
  }

  async function logAutoActiviteit(type, omschrijving, extra) {
    await supabase.from("activiteiten").insert([{
      type, omschrijving, gedaan_door: gebruiker.naam, extra,
    }]);
  }

  async function updateAuto(id, updates, oudeAuto) {
    const payload = { ...updates, bijgewerkt_door: gebruiker.naam, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("autos").update(payload).eq("id", id);
    if (error) { showToast("Fout bij opslaan","err"); return false; }

    const wijzigingen = autoWijzigingen(oudeAuto, updates);
    if (wijzigingen.length) {
      await logAutoActiviteit(
        "auto_bewerkt",
        `🚗 Auto bewerkt: ${updates.kenteken || oudeAuto?.kenteken} — ${wijzigingen.join(", ")}`,
        { auto_id: id, wijzigingen }
      );
    }
    showToast("✓ Opgeslagen"); return true;
  }

  async function archiveerAuto(id, kenteken) {
    const { error } = await supabase.from("autos").update({ gearchiveerd: true, bijgewerkt_door: gebruiker.naam, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { showToast("Fout bij archiveren","err"); return false; }
    await logAutoActiviteit("auto_gearchiveerd", `🗃 Auto gearchiveerd: ${kenteken || id}`, { auto_id: id });
    showToast("✓ Auto gearchiveerd"); await loadAutos(); await loadGearchiveerdeAutos(); return true;
  }
  async function terugzetAuto(id, kenteken) {
    const { error } = await supabase.from("autos").update({ gearchiveerd: false, bijgewerkt_door: gebruiker.naam, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { showToast("Fout bij terugzetten","err"); return false; }
    await logAutoActiviteit("auto_teruggezet", `↩️ Auto teruggezet uit archief: ${kenteken || id}`, { auto_id: id });
    showToast("✓ Auto teruggezet"); await loadAutos(); await loadGearchiveerdeAutos(); return true;
  }

  const openMeldingen = autoMeldingen.filter(m => m.status === "open");
  const isLiset = gebruiker?.naam === "Liset";
  const isBackoffice = gebruiker?.rol === "backoffice";

  if (loading) return <div style={{textAlign:"center",padding:"60px",color:C.muted}}>⏳ Laden...</div>;

  const tabs = [
    { id:"overzicht", label:"🚗 Overzicht" },
    { id:"melding",   label:"📋 Melding doorgeven" },
    { id:"log",       label:`📝 Log ${openMeldingen.length>0?`(${openMeldingen.length} open)`:""}` },
    ...(isBackoffice ? [{ id:"beheer", label:"⚙️ Auto beheer" }] : []),
    ...(isBackoffice ? [{ id:"boete", label:"🔍 Boete opzoeken" }] : []),
  ];

  return (
    <div>
      <SH titel="🚗 Auto planning" sub={`${autos.length} auto's · ${autos.filter(a=>a.status==="Beschikbaar").length} beschikbaar · ${autos.filter(a=>a.status==="Lopend").length} uitgegeven`} />

      {/* Sub-tabs */}
      <div style={{display:"flex",gap:6,marginBottom:24,borderBottom:`2px solid ${C.border}`,paddingBottom:0}}>
        {tabs.map(t => (
          <button key={t.id} onClick={()=>setSubTab(t.id)}
            style={{background:"none",border:"none",padding:"10px 18px",fontSize:13,fontWeight:700,color:subTab===t.id?C.blauw:C.muted,borderBottom:subTab===t.id?`3px solid ${C.blauw}`:"3px solid transparent",marginBottom:-2,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}
      </div>

      {subTab==="overzicht" && <AutoOverzicht autos={autos} gebruiker={gebruiker} />}
      {subTab==="melding"   && <AutoMeldingForm autos={autos} gebruiker={gebruiker} onSubmit={addAutoMelding} showToast={showToast} />}
      {subTab==="log"       && <AutoLog meldingen={autoMeldingen} autos={autos} onUpdate={updateAutoMelding} gebruiker={gebruiker} isBackoffice={isBackoffice} onReactie={stuurReactie} onMarkeerGelezen={markeerGelezen} showToast={showToast} />}
      {subTab==="beheer" && isBackoffice && <AutoBeheer autos={autos} gearchiveerdeAutos={gearchiveerdeAutos} onAdd={addAuto} onUpdate={updateAuto} onArchiveer={archiveerAuto} onTerugzetten={terugzetAuto} showToast={showToast} />}
      {subTab==="boete" && isBackoffice && <BoeteOpzoeken meldingen={autoMeldingen} autos={autos} />}
    </div>
  );
}

// ─── AUTO OVERZICHT ───────────────────────────────────────────────────────────
function AutoOverzicht({ autos, gebruiker }) {
  const [filterStatus, setFilterStatus] = useState("Alle");
  const [zoek, setZoek] = useState("");
  const isCollega = gebruiker?.rol === "collega";

  const filtered = autos.filter(a => {
    if (filterStatus !== "Alle" && a.status !== filterStatus) return false;
    if (zoek.trim()) {
      const q = zoek.toLowerCase();
      return a.kenteken?.toLowerCase().includes(q) ||
             a.merk_model?.toLowerCase().includes(q) ||
             a.naam_medewerker?.toLowerCase().includes(q);
    }
    return true;
  });

  // APK waarschuwing: binnen 60 dagen
  const apkWaarschuwing = autos.filter(a => {
    if (!a.apk_datum) return false;
    const dagen = Math.ceil((new Date(a.apk_datum) - new Date()) / 86400000);
    return dagen <= 60 && dagen >= 0;
  });

  const verlopen = autos.filter(a => {
    if (!a.apk_datum) return false;
    return new Date(a.apk_datum) < new Date();
  });

  return (
    <div>
      {/* APK waarschuwingen — alleen voor backoffice en huismeester */}
      {!isCollega && (apkWaarschuwing.length > 0 || verlopen.length > 0) && (
        <div style={{marginBottom:20}}>
          {verlopen.length > 0 && (
            <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:12,padding:"12px 18px",marginBottom:10}}>
              <div style={{fontWeight:700,color:"#b91c1c",marginBottom:6}}>🚨 APK verlopen ({verlopen.length})</div>
              {verlopen.map(a => <div key={a.id} style={{fontSize:13,color:"#b91c1c"}}>• {a.kenteken} — {a.merk_model} — verlopen op {fmtDate(a.apk_datum)}</div>)}
            </div>
          )}
          {apkWaarschuwing.length > 0 && (
            <div style={{background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:12,padding:"12px 18px"}}>
              <div style={{fontWeight:700,color:"#b45309",marginBottom:6}}>⚠️ APK bijna verlopen ({apkWaarschuwing.length})</div>
              {apkWaarschuwing.map(a => {
                const dagen = Math.ceil((new Date(a.apk_datum) - new Date()) / 86400000);
                return <div key={a.id} style={{fontSize:13,color:"#b45309"}}>• {a.kenteken} — {a.merk_model} — over {dagen} dagen ({fmtDate(a.apk_datum)})</div>;
              })}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,marginBottom:20}}>
        {[
          {label:"Totaal",     val:autos.length,                                        color:C.muted},
          {label:"Uitgegeven", val:autos.filter(a=>a.status==="Lopend").length,          color:C.groen},
          {label:"Beschikbaar",val:autos.filter(a=>a.status==="Beschikbaar").length,     color:C.blauw},
          {label:"Niet beschikbaar",val:autos.filter(a=>a.status==="Niet beschikbaar").length, color:"#ef4444"},
        ].map(s=>(
          <div key={s.label} className="card" style={{borderTop:`3px solid ${s.color}`,padding:"12px 14px"}}>
            <div style={{fontSize:22,fontWeight:800,color:s.color}}>{s.val}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input value={zoek} onChange={e=>setZoek(e.target.value)} placeholder="🔍 Zoek kenteken, auto, medewerker..."
          style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 14px",fontSize:13,outline:"none",width:260}}/>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {["Alle",...AUTO_STATUSSEN].map(s=>(
            <button key={s} onClick={()=>setFilterStatus(s)}
              style={{background:filterStatus===s?C.blauw:"white",color:filterStatus===s?"white":C.muted,border:`1.5px solid ${filterStatus===s?C.blauw:C.border}`,borderRadius:20,padding:"5px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Auto tabel */}
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"120px 1fr 140px 120px 100px 100px 80px",padding:"10px 16px",fontSize:10,fontWeight:700,color:C.muted,letterSpacing:".6px",textTransform:"uppercase",borderBottom:`1px solid ${C.border}`,background:C.bg}}>
          <span>Kenteken</span><span>Auto</span><span>Medewerker</span><span>Vestiging</span><span>APK datum</span><span>Uitgifte</span><span>Status</span>
        </div>
        {filtered.length === 0 && (
          <div style={{textAlign:"center",padding:"40px",color:C.muted}}>Geen auto's gevonden</div>
        )}
        {filtered.map((a,i) => {
          const c = AUTO_STATUS_MAP[a.status] || {bg:C.bg,text:C.muted,dot:C.muted};
          const apkVerloopt = a.apk_datum && Math.ceil((new Date(a.apk_datum)-new Date())/86400000) <= 60;
          const apkVerlopen = a.apk_datum && new Date(a.apk_datum) < new Date();
          return (
            <div key={a.id} style={{display:"grid",gridTemplateColumns:"120px 1fr 140px 120px 100px 100px 80px",padding:"12px 16px",fontSize:13,borderBottom:i<filtered.length-1?`1px solid ${C.border}`:"none",alignItems:"center",background:i%2===0?"white":C.bg+"40"}}>
              <span style={{fontWeight:800,color:C.blauw,fontFamily:"monospace",fontSize:14}}>{a.kenteken}</span>
              <div>
                <div style={{fontWeight:600,color:C.text}}>{a.merk_model}</div>
                {a.kleur && <div style={{fontSize:11,color:C.muted}}>{a.kleur}</div>}
              </div>
              <span style={{fontSize:12,color:C.text}}>{a.naam_medewerker||<span style={{color:C.muted,fontStyle:"italic"}}>—</span>}</span>
              <span style={{fontSize:12,color:C.muted}}>{a.vestiging||"—"}</span>
              <span style={{fontSize:12,color:apkVerlopen?"#ef4444":apkVerloopt?"#f59e0b":C.muted,fontWeight:apkVerlopen||apkVerloopt?700:400}}>
                {a.apk_datum?fmtDate(a.apk_datum):"—"}
                {apkVerlopen&&" ⚠️"}
              </span>
              <span style={{fontSize:12,color:C.muted}}>{a.datum_uitgifte?fmtDate(a.datum_uitgifte):"—"}</span>
              <span style={{padding:"3px 8px",borderRadius:6,background:c.bg,color:c.text,fontSize:10,fontWeight:700,whiteSpace:"nowrap"}}>{a.status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── HANDTEKENING & SCHADE HELPERS ────────────────────────────────────────────
function dataUrlNaarBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(",");
  const mime = meta.match(/:(.*?);/)[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function uploadHandtekening(dataUrl, naam) {
  if (!dataUrl) return null;
  const blob = dataUrlNaarBlob(dataUrl);
  const pad = `auto-handtekeningen/${Date.now()}_${naam.replace(/[^a-z0-9]/gi,"_")}.png`;
  const { error } = await supabase.storage.from("bijlages").upload(pad, blob, { upsert:false, contentType:"image/png" });
  if (error) { console.error("Handtekening upload fout:", error); return null; }
  const { data } = supabase.storage.from("bijlages").getPublicUrl(pad);
  return data.publicUrl;
}

// ─── HANDTEKENINGPAD (canvas, geen externe library nodig) ─────────────────────
function HandtekeningPad({ label, sub, dataUrl, onChange }) {
  const canvasRef = useRef(null);
  const tekenendRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  function pos(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (cx - rect.left) * (canvas.width / rect.width), y: (cy - rect.top) * (canvas.height / rect.height) };
  }
  function start(e) {
    e.preventDefault();
    tekenendRef.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e) {
    if (!tekenendRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = pos(e);
    ctx.strokeStyle = "#1a2b47"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function eind() {
    if (!tekenendRef.current) return;
    tekenendRef.current = false;
    onChange(canvasRef.current.toDataURL("image/png"));
  }
  function wis() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  }

  return (
    <div>
      <label style={lbl}>{label}</label>
      {sub && <div style={{fontSize:11,color:C.muted,marginBottom:6}}>{sub}</div>}
      <div style={{border:`1.5px solid ${dataUrl?C.groen:C.border}`,borderRadius:8,overflow:"hidden",background:"white"}}>
        <canvas ref={canvasRef} width={560} height={170}
          style={{width:"100%",height:170,display:"block",touchAction:"none",cursor:"crosshair"}}
          onMouseDown={start} onMouseMove={move} onMouseUp={eind} onMouseLeave={eind}
          onTouchStart={start} onTouchMove={move} onTouchEnd={eind} />
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
        <span style={{fontSize:11,color:dataUrl?C.groen:C.muted,fontWeight:600}}>{dataUrl?"✓ Ondertekend":"Teken hierboven met vinger of muis"}</span>
        <button type="button" onClick={wis} style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer",textDecoration:"underline",fontFamily:"inherit"}}>Wissen</button>
      </div>
    </div>
  );
}

// ─── SCHADESCHEMA (klikbaar, gebaseerd op het papieren formulier) ─────────────
const SCHADE_ZONES = [
  { key:"boven",  label:"Bovenaanzicht" },
  { key:"voor",   label:"Voorkant" },
  { key:"achter", label:"Achterkant" },
];

// Eenvoudige lijnschets van de auto per aanzicht, zodat je weet waar je op klikt
function AutoIcon({ zone }) {
  const s = C.border, w = C.text;
  if (zone === "boven") return (
    <svg viewBox="0 0 200 150" style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>
      <rect x="55" y="15" width="90" height="120" rx="24" fill="white" stroke={s} strokeWidth="3"/>
      <rect x="60" y="42" width="80" height="32" rx="8" fill={C.bg} stroke={s} strokeWidth="2"/>
      <line x1="100" y1="42" x2="100" y2="74" stroke={s} strokeWidth="2"/>
      <rect x="40" y="28" width="14" height="26" rx="4" fill={w} opacity=".45"/>
      <rect x="146" y="28" width="14" height="26" rx="4" fill={w} opacity=".45"/>
      <rect x="40" y="96" width="14" height="26" rx="4" fill={w} opacity=".45"/>
      <rect x="146" y="96" width="14" height="26" rx="4" fill={w} opacity=".45"/>
    </svg>
  );
  if (zone === "voor") return (
    <svg viewBox="0 0 200 150" style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>
      <rect x="35" y="35" width="130" height="68" rx="18" fill="white" stroke={s} strokeWidth="3"/>
      <rect x="55" y="14" width="90" height="34" rx="14" fill={C.bg} stroke={s} strokeWidth="2"/>
      <ellipse cx="55" cy="65" rx="12" ry="9" fill={C.bg} stroke={s} strokeWidth="2"/>
      <ellipse cx="145" cy="65" rx="12" ry="9" fill={C.bg} stroke={s} strokeWidth="2"/>
      <rect x="80" y="70" width="40" height="13" rx="3" fill={C.bg} stroke={s} strokeWidth="1.5"/>
      <rect x="28" y="96" width="26" height="16" rx="5" fill={w} opacity=".45"/>
      <rect x="146" y="96" width="26" height="16" rx="5" fill={w} opacity=".45"/>
    </svg>
  );
  return (
    <svg viewBox="0 0 200 150" style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>
      <rect x="35" y="35" width="130" height="68" rx="18" fill="white" stroke={s} strokeWidth="3"/>
      <rect x="55" y="14" width="90" height="34" rx="14" fill={C.bg} stroke={s} strokeWidth="2"/>
      <rect x="42" y="54" width="16" height="24" rx="4" fill="#fca5a5" stroke={s} strokeWidth="2"/>
      <rect x="142" y="54" width="16" height="24" rx="4" fill="#fca5a5" stroke={s} strokeWidth="2"/>
      <rect x="85" y="86" width="30" height="10" rx="3" fill={C.bg} stroke={s} strokeWidth="1.5"/>
      <rect x="28" y="96" width="26" height="16" rx="5" fill={w} opacity=".45"/>
      <rect x="146" y="96" width="26" height="16" rx="5" fill={w} opacity=".45"/>
    </svg>
  );
}

function AutoSchadeSchema({ punten, setPunten }) {
  const laatstToegevoegdeRef = useRef(null);

  // Elke klik zet direct een punt neer (i.p.v. eerst een los bevestigingsvakje) —
  // zo kun je achter elkaar meerdere plekken aanklikken zonder tussenstap.
  function klikOpZone(e, zone) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPunten(prev => {
      const nieuw = [...prev, { zone, x, y, omschrijving: "" }];
      laatstToegevoegdeRef.current = nieuw.length - 1;
      return nieuw;
    });
  }

  function wijzigOmschrijving(i, tekst) {
    setPunten(prev => prev.map((p, idx) => idx === i ? { ...p, omschrijving: tekst } : p));
  }
  function verwijderPunt(i) {
    setPunten(prev => prev.filter((_,idx)=>idx!==i));
  }

  return (
    <div>
      <label style={{...lbl,marginBottom:8}}>🚘 Schade markeren — klik op de plek(ken) op de auto, je kunt er meerdere toevoegen</label>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}}>
        {SCHADE_ZONES.map(z => (
          <div key={z.key}>
            <div style={{fontSize:11,fontWeight:700,color:C.text,marginBottom:6,textAlign:"center"}}>{z.label}</div>
            <div onClick={e=>klikOpZone(e,z.key)}
              style={{position:"relative",background:C.bg,border:`1.5px solid ${C.border}`,borderRadius:10,height:150,cursor:"crosshair",overflow:"hidden"}}>
              <AutoIcon zone={z.key}/>
              {punten.map((p,i) => p.zone===z.key && (
                <div key={i} title={p.omschrijving||"Nog niet omschreven"}
                  style={{position:"absolute",left:`${p.x}%`,top:`${p.y}%`,transform:"translate(-50%,-50%)",width:20,height:20,borderRadius:"50%",background:p.omschrijving.trim()?"#ef4444":"#f59e0b",color:"white",fontSize:11,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 1px 4px rgba(0,0,0,.3)",pointerEvents:"none"}}>
                  {i+1}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {punten.length > 0 && (
        <div style={{marginTop:14}}>
          <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6,textTransform:"uppercase",letterSpacing:".6px"}}>Omschrijf elk gemarkeerd punt *</div>
          {punten.map((p,i) => (
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
              <span style={{width:20,height:20,borderRadius:"50%",background:p.omschrijving.trim()?"#ef4444":"#f59e0b",color:"white",fontSize:11,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{i+1}</span>
              <span style={{fontSize:11,color:C.muted,fontWeight:600,minWidth:72}}>{SCHADE_ZONES.find(z=>z.key===p.zone)?.label}</span>
              <input autoFocus={i===laatstToegevoegdeRef.current} value={p.omschrijving} onChange={e=>wijzigOmschrijving(i,e.target.value)}
                placeholder="bijv. kras 10cm, deuk, steenslag..."
                style={{flex:1,background:"white",border:`1.5px solid ${p.omschrijving.trim()?C.border:"#f59e0b"}`,borderRadius:8,padding:"6px 10px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
              <button onClick={()=>verwijderPunt(i)} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:14}}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── UITGIFTE / INNAME WIZARD (digitaal formulier incl. handtekeningen) ───────
const CHECKLIST_ITEMS = [
  { key:"rijbewijs",    label:"🪪 Rijbewijs gecontroleerd" },
  { key:"olie",         label:"🛢 Olie gecontroleerd" },
  { key:"banden",       label:"🛞 Banden gecontroleerd" },
  { key:"vloeistoffen", label:"💧 Vloeistofniveaus gecontroleerd" },
  { key:"ruiten",       label:"🪟 Ruiten heel" },
  { key:"start_ok",     label:"🔑 Auto start goed" },
];

function AutoHandoverWizard({ autos, gebruiker, actie, onSubmit, showToast }) {
  const [stap, setStap] = useState(1);
  const [kenteken, setKenteken] = useState("");
  const [naamMedewerker, setNaamMedewerker] = useState("");
  const [datumTijd, setDatumTijd] = useState(nowISO());
  const [kilometerstand, setKilometerstand] = useState("");
  const [locatie, setLocatie] = useState("");
  const [tankVol, setTankVol] = useState(null);
  const [schoon, setSchoon] = useState(null);
  const [checklist, setChecklist] = useState({});
  const [exterieurSchade, setExterieurSchade] = useState(null);
  const [interieurSchade, setInterieurSchade] = useState(null);
  const [schadePunten, setSchadePunten] = useState([]);
  const [opmerkingen, setOpmerkingen] = useState("");
  const [documenten, setDocumenten] = useState([]);
  const [akkoordPrive, setAkkoordPrive] = useState(false);
  const [handtekeningKtp, setHandtekeningKtp] = useState(null);
  const [handtekeningBestuurder, setHandtekeningBestuurder] = useState(null);
  const [toelichtingen, setToelichtingen] = useState({});
  const [laatsteUitgifte, setLaatsteUitgifte] = useState(null);
  const [zoekenUitgifte, setZoekenUitgifte] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const kleur = actie === "uitgifte" ? C.groen : C.blauw;
  const titel = actie === "uitgifte" ? "Auto uitgifte" : "Auto inname";

  useEffect(() => {
    async function haalLaatsteUitgifteOp() {
      if (actie !== "inname" || !kenteken) { setLaatsteUitgifte(null); return; }
      setZoekenUitgifte(true);
      const { data } = await supabase.from("auto_meldingen").select("*")
        .eq("kenteken", kenteken).eq("actie", "uitgifte")
        .order("datum_tijd", { ascending:false }).limit(1);
      setLaatsteUitgifte(data && data[0] ? data[0] : null);
      setZoekenUitgifte(false);
    }
    haalLaatsteUitgifteOp();
  }, [actie, kenteken]);

  function setChecklistItem(key, val) { setChecklist(prev => ({ ...prev, [key]: val })); }

  // Regels van de controlelijst incl. welk antwoord een "probleem" is — op één plek
  // gedefinieerd zodat render, validatie en de afwijkingenberekening niet uit de pas lopen.
  const checklistRegels = [
    { key:"__tank",   label:"⛽ Tank vol?",                            val:tankVol,           set:setTankVol,           probleem:"nee", tekst:"Tank niet vol" },
    { key:"__schoon", label:"🧹 Auto schoon (binnen + buiten)?",       val:schoon,             set:setSchoon,            probleem:"nee", tekst:"Auto niet schoon" },
    { key:"__ext",    label:"🚘 Exterieurschade aanwezig?",            val:exterieurSchade,    set:setExterieurSchade,   probleem:"ja",  tekst:"Exterieurschade geconstateerd" },
    { key:"__int",    label:"🪑 Interieurschade aanwezig?",            val:interieurSchade,    set:setInterieurSchade,   probleem:"ja",  tekst:"Interieurschade geconstateerd" },
    ...CHECKLIST_ITEMS.map(c => ({
      key:c.key, label:c.label+" (in orde)?", val:checklist[c.key]||null, set:v=>setChecklistItem(c.key,v),
      probleem:"nee", tekst:`${c.label.replace(/^\S+\s/,"")}: niet in orde`,
    })),
  ];

  function berekenAfwijkingen() {
    const gevonden = [];
    checklistRegels.forEach(r => {
      if (r.val === r.probleem) gevonden.push(toelichtingen[r.key]?.trim() ? `${r.tekst} — ${toelichtingen[r.key].trim()}` : r.tekst);
    });
    if (actie === "inname" && laatsteUitgifte) {
      const kmUitgifte = laatsteUitgifte.kilometerstand;
      const kmInname = parseInt(kilometerstand,10);
      if (kmUitgifte && !isNaN(kmInname) && kmInname < kmUitgifte) gevonden.push(`Kilometerstand lager dan bij uitgifte (${kmUitgifte} → ${kmInname})`);
      const eerdereSchade = (laatsteUitgifte.schade_punten||[]).length;
      if (schadePunten.length > eerdereSchade) gevonden.push(`${schadePunten.length - eerdereSchade} nieuwe schadepunt(en) t.o.v. uitgifte`);
    }
    return gevonden;
  }

  const STAPPEN = ["Gegevens","Checklist","Schade","Foto's","Handtekeningen"];

  function volgende() {
    if (stap === 1) {
      if (!kenteken) { showToast("Selecteer een kenteken","err"); return; }
      if (!naamMedewerker.trim()) { showToast("Vul naam medewerker in","err"); return; }
      if (actie === "inname" && !locatie.trim()) { showToast("Vul de locatie van de auto in","err"); return; }
    }
    if (stap === 2) {
      const onbeantwoord = checklistRegels.some(r => r.val===null || r.val===undefined);
      if (onbeantwoord) { showToast("Vul de volledige controlelijst in","err"); return; }
      const missendeToelichting = checklistRegels.some(r => r.val===r.probleem && !toelichtingen[r.key]?.trim());
      if (missendeToelichting) { showToast("Geef bij elke afwijking (rood) een korte toelichting","err"); return; }
    }
    if (stap === 3) {
      const leeg = schadePunten.some(p => !p.omschrijving.trim());
      if (leeg) { showToast("Omschrijf elk gemarkeerd schadepunt (of verwijder het met ×)","err"); return; }
    }
    if (stap === 4) {
      const afwijkingen = berekenAfwijkingen();
      if (afwijkingen.length > 0 && documenten.length === 0) {
        showToast("Er zijn bijzonderheden gevonden — voeg minimaal 1 foto toe","err"); return;
      }
    }
    setStap(s => Math.min(s+1, 5));
  }
  function vorige() { setStap(s => Math.max(s-1, 1)); }

  async function versturen() {
    if (!handtekeningKtp) { showToast("Handtekening KTP Interflex ontbreekt","err"); return; }
    if (!handtekeningBestuurder) { showToast("Handtekening medewerker ontbreekt","err"); return; }
    if (actie === "uitgifte" && !akkoordPrive) { showToast("Medewerker moet akkoord gaan met het privé-rijverbod","err"); return; }
    setSaving(true);

    let docUrls = [];
    if (documenten.length > 0) docUrls = await uploadBijlages(documenten, "auto-documenten");

    const [ktpUrl, bestuurderUrl] = await Promise.all([
      uploadHandtekening(handtekeningKtp, `ktp_${kenteken}`),
      uploadHandtekening(handtekeningBestuurder, `bestuurder_${kenteken}`),
    ]);
    if (!ktpUrl || !bestuurderUrl) { setSaving(false); showToast("Fout bij opslaan handtekening — probeer opnieuw","err"); return; }

    const afwijkingen = berekenAfwijkingen();

    const ok = await onSubmit({
      actie, kenteken, naam_medewerker: naamMedewerker.trim(),
      datum_tijd: datumTijd, tank_vol: tankVol, schoon,
      formulier_getekend: "ja", rijbewijs_gecontroleerd: checklist.rijbewijs || null,
      kilometerstand: kilometerstand || null, locatie: locatie || null,
      opmerkingen: opmerkingen || null,
      document_urls: docUrls.length > 0 ? JSON.stringify(docUrls) : null,
      handtekening_ktp: ktpUrl, handtekening_bestuurder: bestuurderUrl,
      checklist: { ...checklist, exterieur_schade: exterieurSchade, interieur_schade: interieurSchade, akkoord_prive: akkoordPrive, toelichtingen },
      schade_punten: schadePunten,
      gekoppelde_uitgifte_id: actie === "inname" && laatsteUitgifte ? laatsteUitgifte.id : null,
      afwijking_gevonden: afwijkingen.length > 0,
      afwijkingen,
    });
    setSaving(false);
    if (ok) setSubmitted(true);
  }

  function opnieuw() {
    setStap(1); setKenteken(""); setNaamMedewerker(""); setDatumTijd(nowISO());
    setKilometerstand(""); setLocatie(""); setTankVol(null); setSchoon(null);
    setChecklist({}); setExterieurSchade(null); setInterieurSchade(null); setSchadePunten([]);
    setOpmerkingen(""); setDocumenten([]); setAkkoordPrive(false);
    setHandtekeningKtp(null); setHandtekeningBestuurder(null); setToelichtingen({}); setLaatsteUitgifte(null);
    setSubmitted(false);
  }

  if (submitted) return (
    <div className="card" style={{textAlign:"center",padding:"60px 40px",borderTop:`4px solid ${C.groen}`}}>
      <div style={{fontSize:64,marginBottom:16}}>✅</div>
      <div style={{fontSize:22,fontWeight:800,color:C.groen,marginBottom:8}}>{titel} vastgelegd — inclusief handtekeningen</div>
      <button className="btn-b" onClick={opnieuw}>Nieuwe {actie}</button>
    </div>
  );

  const afwijkingenPreview = stap>=2 ? berekenAfwijkingen() : [];

  return (
    <div>
      {/* Stappen indicator */}
      <div style={{display:"flex",gap:4,marginBottom:20}}>
        {STAPPEN.map((s,i) => (
          <div key={s} style={{flex:1,textAlign:"center"}}>
            <div style={{height:4,borderRadius:2,background:i+1<=stap?kleur:C.border,marginBottom:6}}/>
            <div style={{fontSize:10,fontWeight:700,color:i+1===stap?kleur:C.muted,textTransform:"uppercase",letterSpacing:".4px"}}>{s}</div>
          </div>
        ))}
      </div>

      {/* Stap 1: Gegevens */}
      {stap === 1 && (
        <div className="card" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:16}}>
          <div>
            <label style={lbl}>Kenteken *</label>
            <select style={{...inp,appearance:"none"}} value={kenteken} onChange={e=>setKenteken(e.target.value)}>
              <option value="">Selecteer auto</option>
              {autos.map(a=><option key={a.id} value={a.kenteken}>{a.kenteken} — {a.merk_model} [{a.status}]</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Naam medewerker (bestuurder) *</label>
            <input style={inp} value={naamMedewerker} onChange={e=>setNaamMedewerker(e.target.value)} placeholder="Voor- en achternaam"/>
          </div>
          <div>
            <label style={lbl}>Datum + Tijd *</label>
            <input type="datetime-local" style={inp} value={datumTijd} onChange={e=>setDatumTijd(e.target.value)}/>
          </div>
          <div>
            <label style={lbl}>Kilometerstand (odometer)</label>
            <input style={inp} value={kilometerstand} onChange={e=>setKilometerstand(e.target.value)} placeholder="bijv. 45230" type="number"/>
          </div>
          {actie === "inname" && (
            <div style={{gridColumn:"1 / -1"}}>
              <label style={lbl}>Locatie auto bij inname *</label>
              <input style={inp} value={locatie} onChange={e=>setLocatie(e.target.value)} placeholder="bijv. Parkeerplaats kantoor Enschede"/>
            </div>
          )}
          {actie === "inname" && kenteken && (
            <div style={{gridColumn:"1 / -1"}}>
              {zoekenUitgifte ? (
                <div style={{fontSize:12,color:C.muted}}>⏳ Laatste uitgifte opzoeken...</div>
              ) : laatsteUitgifte ? (
                <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",fontSize:12,color:C.text}}>
                  📋 Laatste uitgifte: {fmtFull(laatsteUitgifte.datum_tijd)} aan {laatsteUitgifte.naam_medewerker}
                  {laatsteUitgifte.kilometerstand && ` · km-stand toen: ${laatsteUitgifte.kilometerstand}`}
                  {(laatsteUitgifte.schade_punten||[]).length>0 && ` · ${laatsteUitgifte.schade_punten.length} bekende schadepunt(en)`}
                </div>
              ) : (
                <div style={{background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#b45309"}}>
                  ⚠️ Geen eerdere uitgifte gevonden voor dit kenteken — vergelijken niet mogelijk
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stap 2: Checklist */}
      {stap === 2 && (
        <div className="card" style={{marginBottom:16}}>
          <label style={{...lbl,marginBottom:12}}>Controlelijst</label>
          {checklistRegels.map(({key,label,val,set,probleem})=>(
            <div key={key} style={{padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{flex:1,fontSize:14,fontWeight:500,color:C.text}}>{label}</span>
                <div style={{display:"flex",gap:8}}>
                  {["ja","nee"].map(v=>(
                    <button key={v} onClick={()=>set(v)}
                      style={{padding:"5px 14px",borderRadius:6,fontSize:12,fontWeight:600,border:"1.5px solid",cursor:"pointer",transition:"all .15s",
                        borderColor:v==="ja"?C.groen:"#ef4444",
                        color:val===v?"white":(v==="ja"?C.groen:"#ef4444"),
                        background:val===v?(v==="ja"?C.groen:"#ef4444"):"white"}}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              {val === probleem && (
                <input value={toelichtingen[key]||""} onChange={e=>setToelichtingen(p=>({...p,[key]:e.target.value}))}
                  placeholder="Verplicht: korte toelichting wat er aan de hand is..."
                  style={{width:"100%",marginTop:8,background:"#fef2f2",border:`1.5px solid ${toelichtingen[key]?.trim()?"#fca5a5":"#ef4444"}`,borderRadius:8,padding:"7px 10px",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
              )}
            </div>
          ))}
          <div style={{marginTop:10,fontSize:11,color:C.muted}}>* Voer de kilometer-/vloeistofcontrole pas als laatste uit, dit voorkomt een vertekend beeld.</div>
        </div>
      )}

      {/* Stap 3: Schadeschema */}
      {stap === 3 && (
        <div className="card" style={{marginBottom:16}}>
          <AutoSchadeSchema punten={schadePunten} setPunten={setSchadePunten} />
          {actie === "inname" && laatsteUitgifte && (laatsteUitgifte.schade_punten||[]).length > 0 && (
            <div style={{marginTop:14,background:C.bg,borderRadius:8,padding:12}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6}}>Bekende schade bij uitgifte:</div>
              {laatsteUitgifte.schade_punten.map((p,i)=>(
                <div key={i} style={{fontSize:12,color:C.text}}>• {SCHADE_ZONES.find(z=>z.key===p.zone)?.label}: {p.omschrijving}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stap 4: Foto's + opmerkingen */}
      {stap === 4 && (
        <div className="card" style={{marginBottom:16}}>
          {afwijkingenPreview.length > 0 && (
            <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#b91c1c",fontWeight:600}}>
              ⚠️ Er zijn bijzonderheden gevonden — voeg hieronder minimaal 1 foto toe voordat je verder kunt.
            </div>
          )}
          <div style={{marginBottom:16}}>
            <BijlageUploader bestanden={documenten} setBestanden={setDocumenten} label="📸 Foto's van de auto toevoegen (verplicht bij schade)"/>
          </div>
          <label style={lbl}>Opmerkingen</label>
          <textarea style={{...inp,resize:"vertical"}} value={opmerkingen} onChange={e=>setOpmerkingen(e.target.value)} placeholder="Eventuele bijzonderheden..." rows={3}/>
        </div>
      )}

      {/* Stap 5: Handtekeningen */}
      {stap === 5 && (
        <div>
          {afwijkingenPreview.length > 0 && (
            <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:12,marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:"#b91c1c",marginBottom:6}}>⚠️ Bijzonderheden geconstateerd — backoffice wordt automatisch geïnformeerd:</div>
              {afwijkingenPreview.map((a,i)=><div key={i} style={{fontSize:12,color:"#b91c1c"}}>• {a}</div>)}
            </div>
          )}
          {actie === "uitgifte" && (
            <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:12,marginBottom:16,fontSize:12,color:C.text}}>
              <label style={{display:"flex",alignItems:"flex-start",gap:8,cursor:"pointer"}}>
                <input type="checkbox" checked={akkoordPrive} onChange={e=>setAkkoordPrive(e.target.checked)} style={{marginTop:2}}/>
                <span>Ik (bestuurder) weet en mij is verteld dat het niet is toegestaan om privé te rijden. De auto is alleen voor woon-werkverkeer.</span>
              </label>
            </div>
          )}
          <div className="card" style={{marginBottom:16}}>
            <HandtekeningPad label="Handtekening KTP Interflex" sub="Uitgevende/innemende collega" dataUrl={handtekeningKtp} onChange={setHandtekeningKtp}/>
          </div>
          <div className="card" style={{marginBottom:16}}>
            <HandtekeningPad label="Handtekening medewerker (bestuurder)" sub={naamMedewerker||"—"} dataUrl={handtekeningBestuurder} onChange={setHandtekeningBestuurder}/>
          </div>
        </div>
      )}

      {/* Navigatie */}
      <div style={{display:"flex",gap:10,marginTop:6}}>
        {stap > 1 && (
          <button onClick={vorige} style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"12px 20px",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>← Vorige</button>
        )}
        {stap < 5 ? (
          <button onClick={volgende} style={{flex:1,background:kleur,color:"white",border:"none",borderRadius:8,padding:14,fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Volgende →</button>
        ) : (
          <button onClick={versturen} disabled={saving} style={{flex:1,background:saving?C.border:kleur,color:"white",border:"none",borderRadius:8,padding:14,fontSize:15,fontWeight:700,cursor:saving?"not-allowed":"pointer",fontFamily:"inherit"}}>
            {saving?"⏳ Opslaan...":`✓ ${titel} bevestigen en ondertekenen`}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── STORING / GEANNULEERD FORM (eenvoudige melding, geen handtekening nodig) ─
function AutoStoringForm({ autos, gebruiker, actie, onSubmit, showToast }) {
  const [kenteken, setKenteken] = useState("");
  const [naamMedewerker, setNaamMedewerker] = useState("");
  const [datumTijd, setDatumTijd] = useState(nowISO());
  const [kilometerstand, setKilometerstand] = useState("");
  const [opmerkingen, setOpmerkingen] = useState("");
  const [documenten, setDocumenten] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!kenteken) { showToast("Selecteer een kenteken","err"); return; }
    if (!naamMedewerker.trim()) { showToast("Vul naam medewerker in","err"); return; }
    setSaving(true);
    let docUrls = [];
    if (documenten.length > 0) docUrls = await uploadBijlages(documenten, "auto-documenten");
    const ok = await onSubmit({
      actie, kenteken, naam_medewerker: naamMedewerker.trim(),
      datum_tijd: datumTijd, kilometerstand: kilometerstand || null,
      opmerkingen: opmerkingen || null,
      document_urls: docUrls.length > 0 ? JSON.stringify(docUrls) : null,
    });
    setSaving(false);
    if (ok) {
      setKenteken(""); setNaamMedewerker(""); setKilometerstand(""); setOpmerkingen(""); setDocumenten([]);
      setSubmitted(true); setTimeout(()=>setSubmitted(false), 2500);
    }
  }

  if (submitted) return (
    <div className="card" style={{textAlign:"center",padding:"60px 40px",borderTop:`4px solid ${C.groen}`}}>
      <div style={{fontSize:64,marginBottom:16}}>✅</div>
      <div style={{fontSize:22,fontWeight:800,color:C.groen,marginBottom:8}}>Auto melding ingediend!</div>
      <button className="btn-b" onClick={()=>setSubmitted(false)}>Nieuwe melding</button>
    </div>
  );

  return (
    <div>
      <div className="card" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:16}}>
        <div>
          <label style={lbl}>Kenteken *</label>
          <select style={{...inp,appearance:"none"}} value={kenteken} onChange={e=>setKenteken(e.target.value)}>
            <option value="">Selecteer auto</option>
            {autos.map(a=><option key={a.id} value={a.kenteken}>{a.kenteken} — {a.merk_model} [{a.status}]</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Naam medewerker *</label>
          <input style={inp} value={naamMedewerker} onChange={e=>setNaamMedewerker(e.target.value)} placeholder="Voor- en achternaam"/>
        </div>
        <div>
          <label style={lbl}>Datum + Tijd *</label>
          <input type="datetime-local" style={inp} value={datumTijd} onChange={e=>setDatumTijd(e.target.value)}/>
        </div>
        <div>
          <label style={lbl}>Kilometerstand</label>
          <input style={inp} value={kilometerstand} onChange={e=>setKilometerstand(e.target.value)} placeholder="bijv. 45230" type="number"/>
        </div>
      </div>

      {actie === "storing" && (
        <div className="card" style={{marginBottom:16,borderTop:`3px solid #f59e0b`}}>
          <label style={{fontSize:11,fontWeight:600,color:"#b45309",letterSpacing:".8px",textTransform:"uppercase",marginBottom:12,display:"block"}}>
            🔧 Wat is er aan de hand?
          </label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            {["Lekke band","Lamp kapot","Motorstoring","Schade / aanrijding","Ruit beschadigd","Accu leeg","Remmen","Overig"].map(opt => {
              const selected = opmerkingen.includes(opt);
              return (
                <button key={opt} onClick={()=>setOpmerkingen(prev => selected ? prev.replace(opt+", ","").replace(", "+opt,"").replace(opt,"").trim() : (prev?prev+", ":"")+opt)}
                  style={{background:selected?"#f59e0b18":"white",border:`1.5px solid ${selected?"#f59e0b":C.border}`,borderRadius:8,padding:"10px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,color:selected?"#b45309":C.text,textAlign:"left",transition:"all .15s"}}>
                  {selected?"✓ ":""}{opt}
                </button>
              );
            })}
          </div>
          <div style={{background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#b45309",fontWeight:500}}>
            ⚠️ De backoffice en huismeester worden direct geïnformeerd
          </div>
        </div>
      )}

      <div className="card" style={{marginBottom:20}}>
        <label style={lbl}>Opmerkingen</label>
        <textarea style={{...inp,resize:"vertical"}} value={opmerkingen} onChange={e=>setOpmerkingen(e.target.value)} placeholder="Eventuele bijzonderheden..." rows={3}/>
      </div>

      <div style={{marginBottom:16}}>
        <BijlageUploader bestanden={documenten} setBestanden={setDocumenten} label="📄 Document toevoegen (schadeformulier, foto)"/>
      </div>

      <button onClick={handleSubmit} disabled={saving}
        style={{width:"100%",background:saving?C.border:C.blauw,color:"white",border:"none",borderRadius:8,padding:14,fontSize:15,fontWeight:700,cursor:saving?"not-allowed":"pointer",fontFamily:"inherit",transition:"background .2s"}}>
        {saving?"⏳ Opslaan...":`✓ ${actie.charAt(0).toUpperCase()+actie.slice(1)} doorgeven`}
      </button>
    </div>
  );
}

// ─── AUTO MELDING FORM (actie-keuze + router naar wizard of eenvoudig formulier) ─
function AutoMeldingForm({ autos, gebruiker, onSubmit, showToast }) {
  const [actie, setActie] = useState("uitgifte");

  const acties = [
    { id:"uitgifte",    icon:"🚗", label:"UITGIFTE",       color:C.groen },
    { id:"inname",      icon:"🔑", label:"INNAME",         color:C.blauw },
    { id:"storing",     icon:"🔧", label:"SCHADE/STORING", color:"#f59e0b" },
    { id:"geannuleerd", icon:"❌", label:"GEANNULEERD",    color:"#ef4444" },
  ];

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <SH titel="Auto formulier" sub={actie==="uitgifte"||actie==="inname" ? "Digitaal uitgifte-/innameformulier — inclusief handtekeningen, vervangt het papieren formulier" : "Geef een storing of annulering door"} />

      {/* Actie kiezen */}
      <div className="card" style={{marginBottom:16,borderTop:`3px solid ${C.blauw}`}}>
        <label style={lbl}>Actie</label>
        <div style={{display:"flex",gap:10}}>
          {acties.map(a => (
            <div key={a.id} onClick={()=>setActie(a.id)}
              style={{flex:1,border:`2px solid ${actie===a.id?a.color:C.border}`,borderRadius:10,padding:"14px",textAlign:"center",cursor:"pointer",background:actie===a.id?a.color+"12":"white",transition:"all .2s"}}>
              <div style={{fontSize:24,marginBottom:6}}>{a.icon}</div>
              <div style={{fontSize:11,fontWeight:700,color:actie===a.id?a.color:C.muted,letterSpacing:".8px"}}>{a.label}</div>
            </div>
          ))}
        </div>
      </div>

      {(actie === "uitgifte" || actie === "inname")
        ? <AutoHandoverWizard key={actie} autos={autos} gebruiker={gebruiker} actie={actie} onSubmit={onSubmit} showToast={showToast} />
        : <AutoStoringForm key={actie} autos={autos} gebruiker={gebruiker} actie={actie} onSubmit={onSubmit} showToast={showToast} />}
    </div>
  );
}

// ─── AUTO LOG ─────────────────────────────────────────────────────────────────
function AutoLog({ meldingen, autos, onUpdate, gebruiker, isBackoffice, onReactie, onMarkeerGelezen, showToast }) {
  const [filter, setFilter] = useState("alle");
  const [notitieMap, setNotitieMap] = useState({});
  const [reactieMap, setReactieMap] = useState({});
  const [toonReactieMap, setToonReactieMap] = useState({});
  const [savingReactie, setSavingReactie] = useState({});
  const [toonDocumentMap, setToonDocumentMap] = useState({});
  const [documentMap, setDocumentMap] = useState({});

  const isCollega = gebruiker?.rol === "collega";
  // Aantal ongelezen reacties voor collega
  const ongelezen = meldingen.filter(m => m.backoffice_reactie && !m.reactie_gelezen && m.ingediend_door === gebruiker?.naam).length;

  const gefilterd = meldingen.filter(m =>
    filter === "alle" ? true :
    filter === "open" ? m.status === "open" :
    filter === "uitgifte" ? m.actie === "uitgifte" :
    filter === "inname" ? m.actie === "inname" :
    filter === "storing" ? m.actie === "storing" :
    filter === "afwijking" ? !!m.afwijking_gevonden : true
  );

  const actiKleur = { uitgifte:C.groen, inname:C.blauw, storing:"#f59e0b", geannuleerd:"#ef4444" };
  const actiIcon  = { uitgifte:"🚗", inname:"🔑", storing:"🔧", geannuleerd:"❌" };

  function exportCSV() {
    let csv = "Datum,Tijd,Actie,Kenteken,Medewerker,Tank vol,Schoon,Formulier,Rijbewijs,KM stand,Locatie,Door,Getekend,Afwijking,Schadepunten,Opmerkingen\n";
    meldingen.forEach(m => {
      const dt = m.created_at ? new Date(m.created_at) : new Date();
      const getekend = m.handtekening_ktp && m.handtekening_bestuurder ? "ja" : "";
      const schadeAantal = (m.schade_punten||[]).length || "";
      csv += `"${fmtDate(dt)}","${fmtTime(dt)}","${m.actie}","${m.kenteken}","${m.naam_medewerker}","${m.tank_vol||""}","${m.schoon||""}","${m.formulier_getekend||""}","${m.rijbewijs_gecontroleerd||""}","${m.kilometerstand||""}","${m.locatie||""}","${m.ingediend_door}","${getekend}","${m.afwijking_gevonden?"ja":""}","${schadeAantal}","${m.opmerkingen||""}"\n`;
    });
    const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`KTP_auto_log_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <h3 style={{fontSize:18,fontWeight:800,color:C.blauw}}>Auto log</h3>
          <p style={{fontSize:13,color:C.muted,marginTop:2}}>{meldingen.length} meldingen totaal</p>
        </div>
        <button onClick={exportCSV}
          style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit"}}>
          ⬇ Exporteer CSV
        </button>
      </div>

      <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
        {[["alle","Alle"],["open","Open"],["uitgifte","Uitgifte"],["inname","Inname"],["storing","Schade/Storing"],["afwijking","⚠️ Met afwijking"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFilter(v)}
            style={{background:filter===v?C.blauw:"white",color:filter===v?"white":C.muted,border:`1.5px solid ${filter===v?C.blauw:C.border}`,borderRadius:20,padding:"6px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            {l}
          </button>
        ))}
      </div>

      {gefilterd.length === 0 ? (
        <div className="card" style={{textAlign:"center",padding:"50px",color:C.muted}}>
          <div style={{fontSize:40,marginBottom:10}}>🚗</div>
          <div>Geen meldingen gevonden</div>
        </div>
      ) : gefilterd.map(m => {
        const checkItem = (val, label) => (
          <span className="badge" style={{background:val==="ja"?C.groen+"18":val==="nee"?"#fef2f2":C.bg, color:val==="ja"?C.groen:val==="nee"?"#ef4444":C.muted, fontSize:11}}>
            {label}: {val||"—"}
          </span>
        );
        return (
          <div key={m.id} style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${m.afwijking_gevonden?"#ef4444":(actiKleur[m.actie]||C.muted)}`,borderRadius:10,padding:16,marginBottom:10,boxShadow:`0 1px 3px rgba(27,58,107,.05)`}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
              <span style={{fontSize:24}}>{actiIcon[m.actie]||"🚗"}</span>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:6}}>
                  <span style={{fontWeight:800,fontSize:15,color:C.text,fontFamily:"monospace"}}>{m.kenteken}</span>
                  <span style={{fontWeight:600,fontSize:14,color:C.text}}>{m.naam_medewerker}</span>
                  <span style={{padding:"3px 10px",borderRadius:20,background:(actiKleur[m.actie]||C.muted)+"18",color:actiKleur[m.actie]||C.muted,fontSize:11,fontWeight:700}}>
                    {(m.actie||"").toUpperCase()}
                  </span>
                  {m.afwijking_gevonden && (
                    <span style={{padding:"3px 10px",borderRadius:20,background:"#fef2f2",color:"#b91c1c",fontSize:11,fontWeight:700}}>⚠️ AFWIJKING</span>
                  )}
                  <span style={{marginLeft:"auto",padding:"3px 10px",borderRadius:20,background:m.status==="open"?C.blauw+"18":"#f0fdf4",color:m.status==="open"?C.blauw:C.groen,fontSize:11,fontWeight:700}}>
                    {(m.status||"").toUpperCase()}
                  </span>
                </div>
                <div style={{fontSize:12,color:C.muted,marginBottom:8}}>
                  📅 {m.datum_tijd?fmtFull(m.datum_tijd):fmtFull(m.created_at)} · Door: {m.ingediend_door}
                  {m.kilometerstand && ` · 🛣 ${m.kilometerstand} km`}
                  {m.locatie && ` · 📍 ${m.locatie}`}
                </div>
                {m.actie !== "geannuleerd" && (
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
                    {checkItem(m.tank_vol,"⛽ Tank vol")}
                    {checkItem(m.schoon,"🧹 Schoon")}
                    {checkItem(m.formulier_getekend,"📝 Formulier")}
                    {checkItem(m.rijbewijs_gecontroleerd,"🪪 Rijbewijs")}
                  </div>
                )}
                {(m.actie === "uitgifte" || m.actie === "inname") && (
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                    <span className="badge" style={{background:m.handtekening_ktp&&m.handtekening_bestuurder?C.groen+"18":"#fef2f2",color:m.handtekening_ktp&&m.handtekening_bestuurder?C.groen:"#ef4444",fontSize:11}}>
                      ✍️ {m.handtekening_ktp&&m.handtekening_bestuurder?"Getekend door beide partijen":"Niet (volledig) getekend"}
                    </span>
                    {(m.schade_punten||[]).length>0 && (
                      <span className="badge" style={{background:"#fef3c7",color:"#b45309",fontSize:11}}>🚘 {m.schade_punten.length} schadepunt(en)</span>
                    )}
                  </div>
                )}
                {(m.handtekening_ktp || m.handtekening_bestuurder) && (
                  <div style={{display:"flex",gap:16,marginBottom:8}}>
                    {m.handtekening_ktp && (
                      <div>
                        <div style={{fontSize:10,color:C.muted,marginBottom:2}}>KTP Interflex</div>
                        <a href={m.handtekening_ktp} target="_blank" rel="noopener noreferrer">
                          <img src={m.handtekening_ktp} alt="Handtekening KTP" style={{height:36,border:`1px solid ${C.border}`,borderRadius:4,background:"white"}}/>
                        </a>
                      </div>
                    )}
                    {m.handtekening_bestuurder && (
                      <div>
                        <div style={{fontSize:10,color:C.muted,marginBottom:2}}>Medewerker</div>
                        <a href={m.handtekening_bestuurder} target="_blank" rel="noopener noreferrer">
                          <img src={m.handtekening_bestuurder} alt="Handtekening medewerker" style={{height:36,border:`1px solid ${C.border}`,borderRadius:4,background:"white"}}/>
                        </a>
                      </div>
                    )}
                  </div>
                )}
                {(m.schade_punten||[]).length>0 && (
                  <div style={{fontSize:12,color:C.text,marginBottom:6}}>
                    {m.schade_punten.map((p,i)=>(
                      <div key={i}>🚘 {SCHADE_ZONES.find(z=>z.key===p.zone)?.label||p.zone}: {p.omschrijving}</div>
                    ))}
                  </div>
                )}
                {m.opmerkingen && <div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>"{m.opmerkingen}"</div>}
                {m.afgehandeld_door && <div style={{fontSize:12,color:C.groen,marginTop:4}}>✓ Afgehandeld door {m.afgehandeld_door}</div>}
                {/* Documenten */}
                {m.document_urls && <BijlageWeergave bijlages={JSON.parse(m.document_urls||"[]")}/>}
                {/* Reactie van backoffice tonen aan collega */}
                {m.backoffice_reactie && (
                  <div style={{marginTop:8,background:m.reactie_gelezen?"#f0fdf4":"#eff6ff",border:`1px solid ${m.reactie_gelezen?"#bbf7d0":"#bfdbfe"}`,borderRadius:8,padding:"10px 12px"}}
                    onClick={()=>{ if(!m.reactie_gelezen && isCollega) onMarkeerGelezen(m.id); }}>
                    <div style={{fontSize:11,fontWeight:700,color:m.reactie_gelezen?C.groen:C.blauw,marginBottom:4}}>
                      {m.reactie_gelezen?"✓":"🔔"} Reactie van backoffice — {m.reactie_door}
                    </div>
                    <div style={{fontSize:13,color:C.text}}>"{m.backoffice_reactie}"</div>
                    {!m.reactie_gelezen && isCollega && <div style={{fontSize:11,color:C.blauw,marginTop:4,fontStyle:"italic"}}>Klik om als gelezen te markeren</div>}
                  </div>
                )}
              </div>
            </div>
            {/* Backoffice: verwerken + reactie sturen */}
            {isBackoffice && (
              <div style={{marginTop:12}}>
                {m.status === "open" && (
                  <div style={{display:"flex",gap:10,marginBottom:8}}>
                    <input value={notitieMap[m.id]||""} onChange={e=>setNotitieMap(p=>({...p,[m.id]:e.target.value}))}
                      placeholder="Notitie (optioneel)..."
                      style={{flex:1,background:C.bg,border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
                    <button onClick={()=>onUpdate(m.id,{status:"verwerkt",notitie:notitieMap[m.id]||null})}
                      style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      ✓ Verwerkt
                    </button>
                  </div>
                )}
                {/* Reactie sturen naar collega */}
                {toonReactieMap[m.id] ? (
                  <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:12}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.blauw,marginBottom:8}}>💬 Reactie sturen naar {m.ingediend_door}</div>
                    <textarea value={reactieMap[m.id]||""} onChange={e=>setReactieMap(p=>({...p,[m.id]:e.target.value}))}
                      placeholder={`bijv. "Borg kunnen we helaas niet meer inhouden omdat..."`}
                      rows={3}
                      style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"inherit",resize:"vertical",boxSizing:"border-box",marginBottom:8}}/>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={async()=>{
                        if(!reactieMap[m.id]?.trim()){return;}
                        setSavingReactie(p=>({...p,[m.id]:true}));
                        await onReactie(m, reactieMap[m.id].trim());
                        setSavingReactie(p=>({...p,[m.id]:false}));
                        setReactieMap(p=>({...p,[m.id]:""}));
                        setToonReactieMap(p=>({...p,[m.id]:false}));
                      }} disabled={savingReactie[m.id]}
                        style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                        {savingReactie[m.id]?"⏳":"📨 Verstuur"}
                      </button>
                      <button onClick={()=>setToonReactieMap(p=>({...p,[m.id]:false}))}
                        style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"8px 12px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                        Annuleren
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <button onClick={()=>setToonReactieMap(p=>({...p,[m.id]:true}))}
                    style={{background:"white",border:`1.5px solid ${C.blauw}`,color:C.blauw,borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                    💬 Reactie sturen naar {m.ingediend_door}
                  </button>
                  {toonDocumentMap[m.id] ? (
                    <div style={{width:"100%",marginTop:8,background:"#f8fafc",border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
                      <div style={{fontWeight:700,fontSize:13,color:C.text,marginBottom:10}}>📄 Document toevoegen</div>
                      <BijlageUploader
                        bestanden={documentMap[m.id]||[]}
                        setBestanden={nieuweFiles => setDocumentMap(p=>({...p,[m.id]: typeof nieuweFiles==="function" ? nieuweFiles(p[m.id]||[]) : nieuweFiles}))}
                        label="Autoformulier, schadeformulier, foto..."
                      />
                      <div style={{display:"flex",gap:8,marginTop:10}}>
                        <button onClick={async()=>{
                          const docs = documentMap[m.id]||[];
                          if(docs.length===0){ alert("Selecteer eerst een bestand"); return;}
                          const urls = await uploadBijlages(docs,"auto-documenten");
                          if(urls.length===0){ alert("Upload mislukt — probeer opnieuw"); return;}
                          const bestaand = m.document_urls ? JSON.parse(m.document_urls) : [];
                          const nieuw = JSON.stringify([...bestaand,...urls]);
                          await supabase.from("auto_meldingen").update({document_urls:nieuw}).eq("id",m.id);
                          showToast("✓ Document toegevoegd");
                          setToonDocumentMap(p=>({...p,[m.id]:false}));
                          setDocumentMap(p=>({...p,[m.id]:[]}));
                        }} style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                          ✓ Uploaden
                        </button>
                        <button onClick={()=>setToonDocumentMap(p=>({...p,[m.id]:false}))}
                          style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"8px 12px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                          Annuleren
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={()=>setToonDocumentMap(p=>({...p,[m.id]:true}))}
                      style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      📄 Document toevoegen
                    </button>
                  )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ─── BOETE OPZOEKEN ───────────────────────────────────────────────────────────
function BoeteOpzoeken({ meldingen, autos }) {
  const [kenteken, setKenteken] = useState("");
  const [datum, setDatum] = useState("");
  const [resultaat, setResultaat] = useState(null);

  function zoek() {
    if (!kenteken || !datum) return;
    const zoekDatum = new Date(datum + "T23:59:59");
    const zoekKenteken = kenteken.trim().toUpperCase().replace(/\s/g,"");

    // Zoek de auto in de autos-tabel
    const auto = autos.find(a => (a.kenteken||"").toUpperCase().replace(/\s/g,"") === zoekKenteken);

    // Filter alle log-meldingen voor dit kenteken
    const autoMeld = meldingen
      .filter(m => (m.kenteken||"").toUpperCase().replace(/\s/g,"") === zoekKenteken)
      .sort((a,b) => new Date(a.created_at) - new Date(b.created_at));

    const vóórDatum = autoMeld.filter(m => new Date(m.created_at) <= zoekDatum);
    const uitgiftes = vóórDatum.filter(m => m.actie === "uitgifte");
    const innames   = vóórDatum.filter(m => m.actie === "inname");

    // STAP 1: Uitgifte-log gevonden vóór de boetedatum
    if (uitgiftes.length > 0) {
      const laagsteUitgifte = uitgiftes[uitgiftes.length - 1];
      const innameNa = innames.find(i => new Date(i.created_at) > new Date(laagsteUitgifte.created_at));
      setResultaat({
        gevonden: !innameNa,
        bestuurder: innameNa ? null : laagsteUitgifte.naam_medewerker,
        uitgifte: laagsteUitgifte,
        inname: innameNa || null,
        auto,
        alleAuto: autoMeld,
      });
      return;
    }

    // STAP 2: Geen log — gebruik datum_uitgifte uit de auto-tabel als fallback
    if (auto && auto.naam_medewerker && auto.datum_uitgifte) {
      const autoDatumUitgifte = new Date(auto.datum_uitgifte);
      if (!isNaN(autoDatumUitgifte) && autoDatumUitgifte <= zoekDatum) {
        // Check of er toch een inname was na die uitgifte maar voor de boetedatum
        const innameNaAutoDatum = innames.find(i => new Date(i.created_at) > autoDatumUitgifte);
        setResultaat({
          gevonden: !innameNaAutoDatum,
          bestuurder: innameNaAutoDatum ? null : auto.naam_medewerker,
          uitgifte: null,
          uitgifteDatumAuto: auto.datum_uitgifte,
          inname: innameNaAutoDatum || null,
          auto,
          alleAuto: autoMeld,
          fallback: true,
        });
        return;
      }
    }

    // STAP 3: Niets gevonden
    setResultaat({
      gevonden: false,
      reden: !auto
        ? "Kenteken niet gevonden in het systeem."
        : autoMeld.length === 0
          ? "Geen uitgifte-registratie gevonden. De auto staat op naam van " + (auto.naam_medewerker||"onbekend") + " maar zonder datum."
          : "Op die datum was de auto niet uitgegeven aan iemand.",
      auto,
      alleAuto: autoMeld,
    });
  }

  const uniekKentekens = [...new Set(autos.map(a => a.kenteken).filter(Boolean))].sort();

  return (
    <div style={{maxWidth:680}}>
      <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:14,padding:28,marginBottom:20,boxShadow:"0 1px 4px rgba(0,0,0,.05)"}}>
        <h3 style={{fontSize:16,fontWeight:800,color:C.blauw,marginBottom:4}}>🔍 Wie reed er op een bepaalde datum?</h3>
        <p style={{fontSize:13,color:C.muted,marginBottom:20}}>Vul het kenteken en de datum van de boete in om te zien wie de auto op dat moment had.</p>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
          <div>
            <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Kenteken</label>
            <select value={kenteken} onChange={e=>setKenteken(e.target.value)}
              style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:8,padding:"10px 14px",fontSize:14,fontFamily:"inherit",color:C.text,background:"white",outline:"none"}}>
              <option value="">— Selecteer kenteken —</option>
              {uniekKentekens.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Datum boete</label>
            <WeekDatePicker value={datum} onChange={v=>setDatum(v)}
              style={{width:"100%",border:`1.5px solid ${C.border}`,borderRadius:8,padding:"10px 14px",fontSize:14,fontFamily:"inherit",color:C.text,background:"white",outline:"none",boxSizing:"border-box"}}/>
          </div>
        </div>

        <button onClick={zoek} disabled={!kenteken||!datum}
          style={{background:kenteken&&datum?C.blauw:C.border,color:"white",border:"none",borderRadius:8,padding:"11px 28px",fontSize:14,fontWeight:700,cursor:kenteken&&datum?"pointer":"not-allowed",fontFamily:"inherit"}}>
          🔍 Zoeken
        </button>
      </div>

      {resultaat && (
        <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:14,padding:28,boxShadow:"0 1px 4px rgba(0,0,0,.05)"}}>
          {resultaat.gevonden ? (
            <>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,padding:"14px 18px",background:"#f0fdf4",border:"1.5px solid #86efac",borderRadius:10}}>
                <span style={{fontSize:28}}>✅</span>
                <div>
                  <div style={{fontSize:13,color:"#166534",fontWeight:600}}>{resultaat.fallback ? "Huidig gekoppelde medewerker (geen uitgifte-log gevonden)" : "Bestuurder gevonden"}</div>
                  <div style={{fontSize:20,fontWeight:800,color:"#14532d",marginTop:2}}>{resultaat.bestuurder}</div>
                  {resultaat.fallback && <div style={{fontSize:11,color:"#166534",marginTop:4}}>⚠️ Geen uitgifte-registratie gevonden voor deze datum — dit is de huidige koppeling.</div>}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
                <div style={{padding:"12px 16px",background:C.bg,borderRadius:8}}>
                  <div style={{fontSize:11,color:C.muted,fontWeight:600,marginBottom:3}}>AUTO</div>
                  <div style={{fontSize:13,fontWeight:700,color:C.text}}>{resultaat.auto?.kenteken}</div>
                  <div style={{fontSize:12,color:C.muted}}>{resultaat.auto?.merk_model||"—"}</div>
                </div>
                <div style={{padding:"12px 16px",background:C.bg,borderRadius:8}}>
                  <div style={{fontSize:11,color:C.muted,fontWeight:600,marginBottom:3}}>UITGEGEVEN OP</div>
                  <div style={{fontSize:13,fontWeight:700,color:C.text}}>{resultaat.fallback ? fmtDate(resultaat.uitgifteDatumAuto) : fmtDate(resultaat.uitgifte.created_at)}</div>
                  <div style={{fontSize:12,color:C.muted}}>{resultaat.fallback ? "datum uit auto-registratie" : fmtTime(resultaat.uitgifte.created_at)}</div>
                </div>
              </div>
            </>
          ) : (
            <div style={{padding:"16px 18px",background:"#fff7ed",border:"1.5px solid #fed7aa",borderRadius:10,marginBottom:resultaat.alleAuto?.length?16:0}}>
              <span style={{fontSize:20}}>⚠️</span>
              <span style={{fontSize:14,color:"#92400e",fontWeight:600,marginLeft:10}}>{resultaat.reden || "Op deze datum was de auto niet uitgegeven."}</span>
              {resultaat.inname && <div style={{fontSize:12,color:C.muted,marginTop:6}}>Auto was al terug ingenomen op {fmtFull(resultaat.inname.created_at)}</div>}
            </div>
          )}

          {/* Historie rond die datum */}
          {resultaat.alleAuto?.length > 0 && (
            <div>
              <div style={{fontSize:12,fontWeight:700,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:10,marginTop:resultaat.gevonden?0:16}}>Historie voor {resultaat.auto?.kenteken||kenteken}</div>
              <div style={{display:"grid",gap:8}}>
                {resultaat.alleAuto.slice(-10).reverse().map((m,i) => {
                  const isUitgifte = m.actie==="uitgifte";
                  const isInname   = m.actie==="inname";
                  const isDatumDag = m.created_at?.slice(0,10) === datum;
                  return (
                    <div key={m.id} style={{display:"flex",gap:12,alignItems:"center",padding:"8px 12px",borderRadius:8,
                      background: isDatumDag?"#fefce8":isUitgifte?"#f0fdf4":isInname?"#f0f9ff":C.bg,
                      border:`1px solid ${isDatumDag?"#fde047":isUitgifte?"#bbf7d0":isInname?"#bae6fd":C.border}`}}>
                      <span style={{fontSize:16}}>{isUitgifte?"🚗":isInname?"🔑":m.actie==="storing"?"⚠️":"📋"}</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:600,color:C.text}}>
                          {isUitgifte?"Uitgegeven aan":isInname?"Ingenomen van":m.actie} {m.naam_medewerker||""}
                        </div>
                        <div style={{fontSize:11,color:C.muted}}>{fmtFull(m.created_at)} · {m.ingediend_door}</div>
                      </div>
                      {isDatumDag && <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:10,background:"#fef08a",color:"#713f12"}}>boetedatum</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AUTO BEHEER ──────────────────────────────────────────────────────────────
function AutoBeheer({ autos, gearchiveerdeAutos=[], onAdd, onUpdate, onArchiveer, onTerugzetten, showToast }) {
  const [toonNieuwe, setToonNieuwe] = useState(false);
  const [nieuw, setNieuw] = useState({kenteken:"",merk_model:"",kleur:"",apk_datum:"",datum_uitgifte:"",vestiging:"",status:"Beschikbaar",naam_medewerker:""});
  const [bewerkId, setBewerkId] = useState(null);
  const [saving, setSaving] = useState(false);

  async function voegToe() {
    if (!nieuw.kenteken.trim() || !nieuw.merk_model.trim()) { showToast("Vul kenteken en auto in","err"); return; }
    setSaving(true);
    await onAdd({...nieuw, kenteken: nieuw.kenteken.toUpperCase().trim()});
    setSaving(false);
    setNieuw({kenteken:"",merk_model:"",kleur:"",apk_datum:"",datum_uitgifte:"",vestiging:"",status:"Beschikbaar",naam_medewerker:""});
    setToonNieuwe(false);
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <h3 style={{fontSize:16,fontWeight:800,color:C.blauw}}>Auto's beheren ({autos.length})</h3>
        <button onClick={()=>setToonNieuwe(!toonNieuwe)}
          style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
          + Auto toevoegen
        </button>
      </div>

      {toonNieuwe && (
        <div className="card" style={{marginBottom:16,borderTop:`3px solid ${C.groen}`}}>
          <div style={{fontWeight:700,fontSize:13,color:C.groen,marginBottom:14}}>Nieuwe auto toevoegen</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
            {[
              {label:"Kenteken *",      key:"kenteken",      ph:"34-GD-HV"},
              {label:"Merk & model *",  key:"merk_model",    ph:"Peugeot 206 Grijs"},
              {label:"Kleur",           key:"kleur",         ph:"Grijs"},
              {label:"Vestiging",       key:"vestiging",     ph:"E / O / L"},
              {label:"Naam medewerker", key:"naam_medewerker",ph:"Wie heeft de auto"},
            ].map(f=>(
              <div key={f.key}>
                <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>{f.label}</label>
                <input value={nieuw[f.key]} onChange={e=>setNieuw(p=>({...p,[f.key]:e.target.value}))} placeholder={f.ph}
                  style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
              </div>
            ))}
            <div>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>APK datum</label>
              <WeekDatePicker value={nieuw.apk_datum} onChange={v=>setNieuw(p=>({...p,apk_datum:v}))}
                style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
            </div>
            <div>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Datum uitgifte</label>
              <WeekDatePicker value={nieuw.datum_uitgifte} onChange={v=>setNieuw(p=>({...p,datum_uitgifte:v}))}
                style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
            </div>
            <div>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Status</label>
              <select value={nieuw.status} onChange={e=>setNieuw(p=>({...p,status:e.target.value}))}
                style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",appearance:"none",fontFamily:"inherit"}}>
                {AUTO_STATUSSEN.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={voegToe} disabled={saving}
              style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"10px 24px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              {saving?"⏳ Opslaan...":"✓ Toevoegen"}
            </button>
            <button onClick={()=>setToonNieuwe(false)}
              style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"10px 16px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
              Annuleren
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"120px 1fr 130px 100px 100px 120px 80px",padding:"10px 16px",fontSize:10,fontWeight:700,color:C.muted,letterSpacing:".6px",textTransform:"uppercase",borderBottom:`1px solid ${C.border}`,background:C.bg}}>
          <span>Kenteken</span><span>Auto</span><span>Medewerker</span><span>Vestiging</span><span>APK</span><span>Status</span><span>Acties</span>
        </div>
        {autos.map((a,i) => {
          const c = AUTO_STATUS_MAP[a.status]||{bg:C.bg,text:C.muted};
          return bewerkId === a.id ? (
            <AutoBewerken key={a.id} auto={a} onSave={async u=>{setSaving(true);await onUpdate(a.id,u,a);setSaving(false);setBewerkId(null);}} onCancel={()=>setBewerkId(null)} saving={saving}/>
          ) : (
            <div key={a.id} style={{display:"grid",gridTemplateColumns:"120px 1fr 130px 100px 100px 120px 80px",padding:"12px 16px",fontSize:12,borderBottom:i<autos.length-1?`1px solid ${C.border}`:"none",alignItems:"center",background:i%2===0?"white":C.bg+"40"}}>
              <span style={{fontWeight:800,color:C.blauw,fontFamily:"monospace"}}>{a.kenteken}</span>
              <div><div style={{fontWeight:600,color:C.text}}>{a.merk_model}</div>{a.kleur&&<div style={{fontSize:11,color:C.muted}}>{a.kleur}</div>}</div>
              <span style={{color:C.muted}}>{a.naam_medewerker||"—"}</span>
              <span style={{color:C.muted}}>{a.vestiging||"—"}</span>
              <span style={{color:a.apk_datum&&new Date(a.apk_datum)<new Date()?"#ef4444":C.muted}}>{a.apk_datum?fmtDate(a.apk_datum):"—"}</span>
              <span style={{padding:"3px 8px",borderRadius:6,background:c.bg,color:c.text,fontSize:10,fontWeight:700}}>{a.status}</span>
              <div style={{display:"flex",gap:4}}>
                <button onClick={()=>setBewerkId(a.id)} style={{background:"white",border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11}}>✏️</button>
                <button onClick={async()=>{if(window.confirm(`${a.kenteken} archiveren?`)){await onArchiveer(a.id,a.kenteken);}}} style={{background:"#f59e0b",color:"white",border:"none",borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11}}>🗃</button>
              </div>
            </div>
          );
        })}
      </div>

      {gearchiveerdeAutos.length > 0 && (
        <div style={{marginTop:24}}>
          <div style={{fontWeight:700,fontSize:13,color:"#6b7280",marginBottom:10,borderTop:"2px dashed #e5e7eb",paddingTop:16}}>
            🗃 Gearchiveerde auto's ({gearchiveerdeAutos.length})
          </div>
          {gearchiveerdeAutos.map(a => (
            <div key={a.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px",background:"#f9fafb",borderRadius:8,marginBottom:6,border:"1px solid #e5e7eb"}}>
              <div>
                <span style={{fontWeight:800,color:"#6b7280",fontFamily:"monospace",marginRight:12}}>{a.kenteken}</span>
                <span style={{fontSize:12,color:"#9ca3af"}}>{a.merk_model}{a.kleur ? " · " + a.kleur : ""}</span>
              </div>
              <button onClick={async()=>{if(window.confirm(a.kenteken + " terugzetten?")){await onTerugzetten(a.id,a.kenteken);}}}
                style={{background:"#10b981",color:"white",border:"none",borderRadius:6,padding:"4px 12px",cursor:"pointer",fontSize:11}}>
                ↩ Terugzetten
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AutoBewerken({ auto, onSave, onCancel, saving }) {
  const [v, setV] = useState({...auto});
  return (
    <div style={{padding:"16px",borderBottom:`1px solid ${C.border}`,background:C.blauw+"08",border:`1.5px solid ${C.blauw}`,borderRadius:8,margin:"4px 8px"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:10}}>
        {[
          {label:"Kenteken",      key:"kenteken"},
          {label:"Merk & model",  key:"merk_model"},
          {label:"Kleur",         key:"kleur"},
          {label:"Vestiging",     key:"vestiging"},
          {label:"Medewerker",    key:"naam_medewerker"},
          {label:"APK datum",     key:"apk_datum",     type:"date"},
          {label:"Datum uitgifte",key:"datum_uitgifte", type:"date"},
        ].map(f=>(
          <div key={f.key}>
            <label style={{fontSize:10,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>{f.label}</label>
            <input type={f.type||"text"} value={v[f.key]||""} onChange={e=>setV(p=>({...p,[f.key]:e.target.value}))}
              style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:6,color:C.text,padding:"7px 10px",fontSize:12,outline:"none",fontFamily:"inherit"}}/>
          </div>
        ))}
        <div>
          <label style={{fontSize:10,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>Status</label>
          <select value={v.status||"Beschikbaar"} onChange={e=>setV(p=>({...p,status:e.target.value}))}
            style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:6,color:C.text,padding:"7px 10px",fontSize:12,outline:"none",appearance:"none",fontFamily:"inherit"}}>
            {AUTO_STATUSSEN.map(s=><option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>onSave(v)} disabled={saving}
          style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"8px 20px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
          {saving?"⏳":"✓ Opslaan"}
        </button>
        <button onClick={onCancel}
          style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
          Annuleren
        </button>
      </div>
    </div>
  );
}
