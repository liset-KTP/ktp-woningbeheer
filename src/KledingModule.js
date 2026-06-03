import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

const C = {
  blauw:"#1B3A6B", blauwDark:"#132b52", groen:"#4A9B3C",
  bg:"#f0f4f8", card:"#ffffff", border:"#d1dbe8",
  text:"#1a2b47", muted:"#6b7a8d",
  rood:"#ef4444", oranje:"#f59e0b",
};
const VESTIGINGEN = ["Enschede","Ommen","Lichtenvoorde"];

function fmtDate(d) {
  if (!d) return ""; 
  return new Date(d).toLocaleDateString("nl-NL",{day:"2-digit",month:"2-digit",year:"numeric"});
}
function fmtTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"});
}

function SH({titel,sub,actie}) {
  return <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24}}>
    <div><h2 style={{fontSize:20,fontWeight:800,color:C.blauw,marginBottom:3}}>{titel}</h2>
    {sub&&<p style={{fontSize:13,color:C.muted}}>{sub}</p>}</div>
    {actie}
  </div>;
}

export function KledingModule({ gebruiker, showToast }) {
  const [voorraad, setVoorraad] = useState([]);
  const [transacties, setTransacties] = useState([]);
  const [subTab, setSubTab] = useState("overzicht");
  const [loading, setLoading] = useState(true);
  const isBackoffice = gebruiker?.rol === "backoffice";

  const loadVoorraad = useCallback(async () => {
    const { data } = await supabase.from("kleding_voorraad").select("*").order("type").order("maat");
    setVoorraad(data || []);
  }, []);

  const loadTransacties = useCallback(async () => {
    const { data } = await supabase.from("kleding_transacties").select("*").order("created_at",{ascending:false}).limit(300);
    setTransacties(data || []);
  }, []);

  useEffect(() => {
    async function init() { setLoading(true); await Promise.all([loadVoorraad(), loadTransacties()]); setLoading(false); }
    init();
    const s1 = supabase.channel("kv-rt").on("postgres_changes",{event:"*",schema:"public",table:"kleding_voorraad"},()=>loadVoorraad()).subscribe();
    const s2 = supabase.channel("kt-rt").on("postgres_changes",{event:"*",schema:"public",table:"kleding_transacties"},()=>loadTransacties()).subscribe();
    return () => { supabase.removeChannel(s1); supabase.removeChannel(s2); };
  }, [loadVoorraad, loadTransacties]);

  async function registreerUitgifte(vestiging, type, maat, aantal, opmerking, medewerkerNaam, actie="uitgifte") {
    const item = voorraad.find(v=>v.vestiging===vestiging&&v.type===type&&v.maat===maat);
    if (!item) { showToast("Artikel niet gevonden","err"); return false; }
    if (actie==="uitgifte" && item.aantal < aantal) {
      showToast(`Onvoldoende voorraad — nog ${item.aantal} beschikbaar`,"err"); return false;
    }
    const nieuwAantal = actie==="uitgifte" ? item.aantal - aantal : item.aantal + aantal;
    const { error: e1 } = await supabase.from("kleding_voorraad")
      .update({ aantal: nieuwAantal, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    if (e1) { showToast("Fout bij opslaan","err"); return false; }
    await supabase.from("kleding_transacties").insert([{
      vestiging, type, maat, aantal, actie,
      medewerker: medewerkerNaam || gebruiker.naam,
      opmerking: opmerking ? `${opmerking} (door: ${gebruiker.naam})` : `Ingevoerd door: ${gebruiker.naam}`
    }]);
    const msg = actie==="uitgifte"
      ? `✓ ${aantal}x ${type} ${maat} uitgegeven aan ${medewerkerNaam||gebruiker.naam}`
      : `✓ ${aantal}x ${type} ${maat} ingenomen van ${medewerkerNaam||gebruiker.naam}`;
    showToast(msg);
    return true;
  }

  async function registreerBijvulling(vestiging, type, maat, aantal, opmerking) {
    const item = voorraad.find(v=>v.vestiging===vestiging&&v.type===type&&v.maat===maat);
    if (!item) { showToast("Artikel niet gevonden","err"); return false; }
    const { error } = await supabase.from("kleding_voorraad")
      .update({ aantal: item.aantal + aantal, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    if (error) { showToast("Fout bij opslaan","err"); return false; }
    await supabase.from("kleding_transacties").insert([{
      vestiging, type, maat, aantal, actie:"bijvulling",
      medewerker: gebruiker.naam, opmerking: opmerking||null
    }]);
    showToast(`✓ Voorraad bijgevuld: +${aantal}x ${type} ${maat}`);
    return true;
  }

  async function markeerBesteld(id, besteld_aantal, besteld_datum) {
    const { error } = await supabase.from("kleding_voorraad")
      .update({ besteld_aantal, besteld_datum, besteld_door: gebruiker.naam, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { showToast("Fout bij opslaan","err"); return false; }
    showToast(`✓ Bestelling geregistreerd (${besteld_aantal} stuks)`);
    await loadVoorraad(); return true;
  }

  async function markeerOntvangen(id, ontvangen_aantal, vestiging, type, maat) {
    const item = voorraad.find(v=>v.id===id);
    if (!item) return false;
    const nieuwAantal = item.aantal + ontvangen_aantal;
    const { error } = await supabase.from("kleding_voorraad")
      .update({ aantal: nieuwAantal, besteld_aantal: 0, besteld_datum: null, besteld_door: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { showToast("Fout bij opslaan","err"); return false; }
    await supabase.from("kleding_transacties").insert([{
      vestiging, type, maat, aantal: ontvangen_aantal, actie:"bijvulling",
      medewerker: gebruiker.naam, opmerking: "Bestelling ontvangen"
    }]);
    showToast(`✓ Ontvangst verwerkt — voorraad bijgewerkt naar ${nieuwAantal}`);
    await loadVoorraad(); return true;
  }

  async function correctieVoorraad(id, nieuwAantal, vestiging, type, maat) {
    const { error } = await supabase.from("kleding_voorraad")
      .update({ aantal: nieuwAantal, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { showToast("Fout bij correctie","err"); return false; }
    await supabase.from("kleding_transacties").insert([{
      vestiging, type, maat, aantal: nieuwAantal, actie:"correctie",
      medewerker: gebruiker.naam, opmerking:"Handmatige correctie"
    }]);
    showToast("✓ Voorraad gecorrigeerd");
    return true;
  }

  const bijTeBestellenAlles = voorraad.filter(v => v.aantal < v.min_voorraad);
  const bijTeBestellenTotaal = bijTeBestellenAlles.length;

  if (loading) return <div style={{textAlign:"center",padding:60,color:C.muted}}>Voorraad laden...</div>;

  const tabs = [
    { id:"overzicht", label:"👕 Voorraad" },
    { id:"uitgifte",  label:"📤 Uitgifte" },
    { id:"bijbestellen", label:`🛒 Bijbestellen${bijTeBestellenTotaal>0?` (${bijTeBestellenTotaal})`:""}` },
    { id:"historie",  label:"📋 Historie" },
    ...(isBackoffice ? [{ id:"beheer", label:"⚙️ Beheer" }] : []),
  ];

  return (
    <div>
      <SH titel="👕 Kleding voorraad" sub={`${voorraad.length} artikelen · ${bijTeBestellenTotaal} moeten bijbesteld worden`}/>
      <div style={{display:"flex",gap:6,marginBottom:24,borderBottom:`2px solid ${C.border}`,paddingBottom:0,overflowX:"auto"}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setSubTab(t.id)}
            style={{background:"none",border:"none",padding:"10px 18px",fontSize:13,fontWeight:700,
              color:subTab===t.id?C.blauw:C.muted,
              borderBottom:subTab===t.id?`3px solid ${C.blauw}`:"3px solid transparent",
              marginBottom:-2,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}
      </div>
      {subTab==="overzicht"    && <VoorraadOverzicht voorraad={voorraad}/>}
      {subTab==="uitgifte"     && <UitgifteForm voorraad={voorraad} gebruiker={gebruiker} onSubmit={registreerUitgifte} showToast={showToast}/>}
      {subTab==="bijbestellen" && <BijbestellenView voorraad={voorraad} transacties={transacties} isBackoffice={isBackoffice} onBesteld={markeerBesteld} onOntvangen={markeerOntvangen}/>}
      {subTab==="historie"     && <HistorieView transacties={transacties} isBackoffice={isBackoffice}/>}
      {subTab==="beheer"&&isBackoffice && <BeheerVoorraad voorraad={voorraad} onBijvullen={registreerBijvulling} onCorrectie={correctieVoorraad} showToast={showToast}/>}
    </div>
  );
}

// ─── VOORRAAD OVERZICHT ───────────────────────────────────────────────────────
function VoorraadOverzicht({ voorraad }) {
  const [vestiging, setVestiging] = useState("Enschede");
  const [zoek, setZoek] = useState("");

  const items = voorraad.filter(v=>v.vestiging===vestiging && (
    !zoek || v.type.toLowerCase().includes(zoek.toLowerCase()) || v.maat.toLowerCase().includes(zoek.toLowerCase())
  ));
  const types = [...new Set(items.map(v=>v.type))].sort();
  const totaalLaag = voorraad.filter(v=>v.vestiging===vestiging&&v.aantal<v.min_voorraad).length;
  const totaalOp   = voorraad.filter(v=>v.vestiging===vestiging&&v.aantal===0).length;

  function statusKleur(item) {
    if (item.aantal === 0) return { kleur:"#ef4444", label:"OP", bg:"#fef2f2" };
    if (item.aantal < item.min_voorraad) return { kleur:"#f59e0b", label:"LAAG", bg:"#fffbeb" };
    return { kleur:"#16a34a", label:"OK", bg:"white" };
  }

  return (
    <div>
      {/* Vestiging tabs */}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {VESTIGINGEN.map(v=>{
          const laag = voorraad.filter(i=>i.vestiging===v&&i.aantal<i.min_voorraad).length;
          return (
            <button key={v} onClick={()=>setVestiging(v)}
              style={{padding:"8px 20px",borderRadius:20,border:`2px solid ${vestiging===v?C.blauw:C.border}`,
                background:vestiging===v?C.blauw:"white",color:vestiging===v?"white":C.text,
                fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
              {v} {laag>0&&<span style={{marginLeft:6,background:"#ef4444",color:"white",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:800}}>{laag}</span>}
            </button>
          );
        })}
      </div>

      {/* Stats + zoek */}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        {totaalOp>0&&<div style={{padding:"5px 12px",borderRadius:20,background:"#fef2f2",border:"1px solid #fecaca",fontSize:12,fontWeight:700,color:"#b91c1c"}}>🔴 {totaalOp} op</div>}
        {totaalLaag>totaalOp&&<div style={{padding:"5px 12px",borderRadius:20,background:"#fffbeb",border:"1px solid #fde68a",fontSize:12,fontWeight:700,color:"#92400e"}}>🟡 {totaalLaag-totaalOp} laag</div>}
        {totaalLaag===0&&<div style={{padding:"5px 12px",borderRadius:20,background:"#f0fdf4",border:"1px solid #bbf7d0",fontSize:12,fontWeight:700,color:"#166534"}}>✅ Alles op peil</div>}
        <input value={zoek} onChange={e=>setZoek(e.target.value)} placeholder="🔍 Zoek type of maat..."
          style={{marginLeft:"auto",border:`1.5px solid ${C.border}`,borderRadius:8,padding:"7px 12px",fontSize:13,fontFamily:"inherit",outline:"none",minWidth:200}}/>
      </div>

      {/* Tabel per type */}
      {types.map(type=>{
        const typeItems = items.filter(v=>v.type===type);
        const heeftProbleem = typeItems.some(i=>i.aantal<i.min_voorraad);
        return (
          <div key={type} style={{background:"white",border:`1px solid ${C.border}`,borderRadius:10,marginBottom:10,overflow:"hidden"}}>
            <div style={{padding:"10px 16px",background:heeftProbleem?"#fffbeb":C.blauw+"08",borderBottom:`1px solid ${C.border}`,
              display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:4,height:18,borderRadius:2,background:heeftProbleem?"#f59e0b":C.groen}}/>
              <span style={{fontWeight:800,fontSize:14,color:C.text}}>{type}</span>
              {heeftProbleem&&<span style={{fontSize:11,color:"#92400e",background:"#fde68a",padding:"1px 8px",borderRadius:10,fontWeight:700}}>bijbestellen</span>}
            </div>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:C.bg}}>
                  <th style={{padding:"6px 16px",textAlign:"left",fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".5px",textTransform:"uppercase"}}>Maat</th>
                  <th style={{padding:"6px 8px",textAlign:"center",fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".5px",textTransform:"uppercase"}}>Voorraad</th>
                  <th style={{padding:"6px 8px",textAlign:"center",fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".5px",textTransform:"uppercase"}}>Minimum</th>
                  <th style={{padding:"6px 8px",textAlign:"center",fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".5px",textTransform:"uppercase"}}>Status</th>
                  <th style={{padding:"6px 16px",textAlign:"right",fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".5px",textTransform:"uppercase"}}>Tekort</th>
                </tr>
              </thead>
              <tbody>
                {typeItems.map((item,i)=>{
                  const s = statusKleur(item);
                  const tekort = item.min_voorraad - item.aantal;
                  return (
                    <tr key={item.id} style={{borderTop:`1px solid ${C.border}`,background:s.bg}}>
                      <td style={{padding:"9px 16px",fontSize:13,fontWeight:600,color:C.text}}>{item.maat}</td>
                      <td style={{padding:"9px 8px",textAlign:"center",fontSize:15,fontWeight:800,color:s.kleur}}>{item.aantal}</td>
                      <td style={{padding:"9px 8px",textAlign:"center",fontSize:13,color:C.muted}}>{item.min_voorraad}</td>
                      <td style={{padding:"9px 8px",textAlign:"center"}}>
                        <span style={{fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:10,
                          background:s.kleur+"20",color:s.kleur}}>{s.label}</span>
                      </td>
                      <td style={{padding:"9px 16px",textAlign:"right",fontSize:13,fontWeight:700,
                        color:tekort>0?C.blauw:"transparent"}}>{tekort>0?`+${tekort}`:""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {types.length===0&&<div style={{textAlign:"center",padding:40,color:C.muted}}>Geen artikelen gevonden</div>}
    </div>
  );
}

// ─── UITGIFTE FORM ────────────────────────────────────────────────────────────
export function KledingUitgifteInline({ voorraad, gebruiker, onSubmit, showToast }) { return <UitgifteForm voorraad={voorraad} gebruiker={gebruiker} onSubmit={onSubmit} showToast={showToast}/>; }

function UitgifteForm({ voorraad, gebruiker, onSubmit, showToast }) {
  const [vestiging, setVestiging] = useState(gebruiker?.vestiging||"Enschede");
  const [actie, setActie] = useState("uitgifte");
  const [medewerkerNaam, setMedewerkerNaam] = useState("");
  // Huidig te selecteren artikel
  const [type, setType] = useState("");
  const [maat, setMaat] = useState("");
  const [aantal, setAantal] = useState(1);
  // Mandje: lijst van artikelen voor deze registratie
  const [mandje, setMandje] = useState([]);
  const [saving, setSaving] = useState(false);

  const types = [...new Set(voorraad.filter(v=>v.vestiging===vestiging).map(v=>v.type))].sort();
  const maten = voorraad.filter(v=>v.vestiging===vestiging&&v.type===type).sort((a,b)=>a.maat.localeCompare(b.maat));
  const geselecteerd = voorraad.find(v=>v.vestiging===vestiging&&v.type===type&&v.maat===maat);

  // Bereken effectieve beschikbare voorraad (rekening houdend met wat al in mandje zit)
  function beschikbaar(item) {
    const inMandje = mandje.filter(m=>m.vestiging===item.vestiging&&m.type===item.type&&m.maat===item.maat).reduce((s,m)=>s+m.aantal,0);
    return item.aantal - inMandje;
  }

  function voegToeAanMandje() {
    if (!type||!maat||aantal<1) { showToast("Selecteer type en maat","err"); return; }
    const item = voorraad.find(v=>v.vestiging===vestiging&&v.type===type&&v.maat===maat);
    if (!item) return;
    if (actie==="uitgifte" && beschikbaar(item) < aantal) { showToast(`Onvoldoende voorraad — nog ${beschikbaar(item)} beschikbaar`,"err"); return; }
    setMandje(prev=>[...prev, {vestiging, type, maat, aantal, item}]);
    setType(""); setMaat(""); setAantal(1);
    showToast(`✓ ${type} ${maat} toegevoegd aan lijst`);
  }

  function verwijderUitMandje(idx) { setMandje(prev=>prev.filter((_,i)=>i!==idx)); }

  async function submitAlles() {
    if (mandje.length===0) { showToast("Voeg eerst artikelen toe","err"); return; }
    if (!medewerkerNaam.trim()) { showToast("Vul de naam van de medewerker in","err"); return; }
    setSaving(true);
    let allOk = true;
    for (const regel of mandje) {
      const ok = await onSubmit(regel.vestiging, regel.type, regel.maat, regel.aantal, "", medewerkerNaam.trim(), actie);
      if (!ok) { allOk = false; break; }
    }
    setSaving(false);
    if (allOk) {
      showToast(`✓ ${mandje.length} artikel${mandje.length>1?"en":""} geregistreerd voor ${medewerkerNaam}`);
      setMandje([]); setMedewerkerNaam(""); setType(""); setMaat(""); setAantal(1);
    }
  }

  const inp = { width:"100%", border:`1.5px solid ${C.border}`, borderRadius:8, padding:"10px 14px", fontSize:14, fontFamily:"inherit", color:C.text, background:"white", outline:"none", boxSizing:"border-box" };
  const actiekleur = actie==="uitgifte" ? C.groen : "#6366f1";

  return (
    <div style={{maxWidth:580}}>
      <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:14,padding:28}}>
        <h3 style={{fontSize:16,fontWeight:800,color:C.blauw,marginBottom:4}}>👕 Kleding registreren</h3>
        <p style={{fontSize:13,color:C.muted,marginBottom:20}}>Voeg meerdere artikelen toe voor dezelfde medewerker.</p>

        {/* Uitgifte / Inname */}
        <div style={{marginBottom:16}}>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:8,display:"block"}}>Actie *</label>
          <div style={{display:"flex",gap:8}}>
            {[["uitgifte","📤 Uitgifte","Kleding meegeven",C.groen],["inname","📥 Inname","Kleding terugkrijgen","#6366f1"]].map(([v,label,sub,kleur])=>(
              <button key={v} onClick={()=>{setActie(v);setMandje([]);}}
                style={{flex:1,padding:"10px",border:`2px solid ${actie===v?kleur:C.border}`,borderRadius:10,
                  background:actie===v?kleur+"18":"white",cursor:"pointer",fontFamily:"inherit",color:actie===v?kleur:C.muted,fontWeight:700,fontSize:13}}>
                {label}<br/><span style={{fontSize:11,fontWeight:400}}>{sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Naam medewerker */}
        <div style={{marginBottom:16}}>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>
            Naam medewerker * <span style={{fontSize:10,fontWeight:400}}>(wie {actie==="uitgifte"?"de kleding krijgt":"de kleding teruggeeft"})</span>
          </label>
          <input value={medewerkerNaam} onChange={e=>setMedewerkerNaam(e.target.value)}
            placeholder="Voor- en achternaam medewerker"
            style={{...inp, borderColor: medewerkerNaam ? C.groen : C.border}}/>
        </div>

        {/* Vestiging */}
        <div style={{marginBottom:16}}>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Vestiging</label>
          <div style={{display:"flex",gap:8}}>
            {VESTIGINGEN.map(v=>(
              <button key={v} onClick={()=>{setVestiging(v);setType("");setMaat("");}}
                style={{flex:1,padding:"9px",border:`2px solid ${vestiging===v?C.blauw:C.border}`,borderRadius:8,
                  background:vestiging===v?C.blauw+"12":"white",color:vestiging===v?C.blauw:C.muted,
                  fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{v}</button>
            ))}
          </div>
        </div>

        {/* Artikel selectie */}
        <div style={{background:C.bg,borderRadius:10,padding:16,marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:12,textTransform:"uppercase",letterSpacing:".7px"}}>Artikel selecteren</div>
          <div style={{marginBottom:12}}>
            <select value={type} onChange={e=>{setType(e.target.value);setMaat("");}} style={{...inp,marginBottom:0}}>
              <option value="">— Selecteer type —</option>
              {types.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {type && (
            <div style={{marginBottom:12}}>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {maten.map(item=>{
                  const beschik = beschikbaar(item);
                  const isOp = actie==="uitgifte" && beschik<=0;
                  const sel = maat===item.maat;
                  return (
                    <button key={item.id} onClick={()=>!isOp&&setMaat(item.maat)} disabled={isOp}
                      style={{padding:"7px 12px",borderRadius:8,cursor:isOp?"not-allowed":"pointer",fontFamily:"inherit",fontWeight:700,fontSize:13,
                        border:`2px solid ${sel?actiekleur:isOp?"#fecaca":C.border}`,
                        background:sel?actiekleur:isOp?"#fef2f2":"white",
                        color:sel?"white":isOp?"#b91c1c":C.text,opacity:isOp?.5:1}}>
                      {item.maat} <span style={{fontSize:11,opacity:.7}}>({beschik})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {maat && geselecteerd && (
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <button onClick={()=>setAantal(Math.max(1,aantal-1))} style={{width:32,height:32,borderRadius:6,border:`1.5px solid ${C.border}`,background:"white",fontSize:16,cursor:"pointer",fontFamily:"inherit"}}>−</button>
                <input type="number" min={1} value={aantal} onChange={e=>setAantal(Math.max(1,+e.target.value))}
                  style={{width:60,border:`1.5px solid ${C.border}`,borderRadius:6,padding:"5px",fontSize:14,textAlign:"center",fontFamily:"inherit",outline:"none"}}/>
                <button onClick={()=>setAantal(aantal+1)} style={{width:32,height:32,borderRadius:6,border:`1.5px solid ${C.border}`,background:"white",fontSize:16,cursor:"pointer",fontFamily:"inherit"}}>+</button>
              </div>
              <button onClick={voegToeAanMandje}
                style={{background:actiekleur,color:"white",border:"none",borderRadius:8,padding:"8px 20px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginLeft:"auto"}}>
                + Toevoegen aan lijst
              </button>
            </div>
          )}
        </div>

        {/* Mandje */}
        {mandje.length > 0 && (
          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:10,textTransform:"uppercase",letterSpacing:".7px"}}>
              Lijst ({mandje.length} artikel{mandje.length>1?"en":""})
            </div>
            <div style={{display:"grid",gap:6}}>
              {mandje.map((r,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:8,
                  background:actiekleur+"10",border:`1px solid ${actiekleur}30`}}>
                  <span style={{fontSize:18}}>{actie==="uitgifte"?"📤":"📥"}</span>
                  <div style={{flex:1}}>
                    <span style={{fontWeight:700,fontSize:13}}>{r.aantal}x {r.type}</span>
                    <span style={{fontSize:12,color:C.muted}}> — {r.maat} ({r.vestiging})</span>
                  </div>
                  <button onClick={()=>verwijderUitMandje(i)}
                    style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:16,padding:"2px 6px"}}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Opslaan knop */}
        <button onClick={submitAlles} disabled={saving||mandje.length===0||!medewerkerNaam.trim()}
          style={{background:mandje.length>0&&medewerkerNaam.trim()?actiekleur:"#d1dbe8",color:"white",border:"none",borderRadius:8,
            padding:"12px 28px",fontSize:14,fontWeight:700,cursor:mandje.length>0&&medewerkerNaam.trim()?"pointer":"not-allowed",fontFamily:"inherit",width:"100%"}}>
          {saving?"⏳ Bezig...":`${actie==="uitgifte"?"📤":"📥"} ${mandje.length} artikel${mandje.length!==1?"en":""} registreren voor ${medewerkerNaam||"..."}`}
        </button>
      </div>
    </div>
  );
}

// ─── BIJBESTELLEN VIEW ────────────────────────────────────────────────────────
function BijbestellenView({ voorraad, isBackoffice, onBesteld, onOntvangen }) {
  const [vestiging, setVestiging] = useState("alle");
  const [bestellenId, setBestellenId] = useState(null);
  const [bestellenAantal, setBestellenAantal] = useState(1);
  const [bestellenDatum, setBestellenDatum] = useState(new Date().toISOString().slice(0,10));
  const [ontvangenId, setOntvangenId] = useState(null);
  const [ontvangenAantal, setOntvangenAantal] = useState(1);
  const [saving, setSaving] = useState(false);

  const teBestellenItems = voorraad
    .filter(v => v.aantal < v.min_voorraad && (vestiging==="alle" || v.vestiging===vestiging))
    .sort((a,b)=>a.vestiging.localeCompare(b.vestiging)||a.type.localeCompare(b.type));

  const alBesteldItems = voorraad
    .filter(v => v.besteld_aantal > 0 && (vestiging==="alle" || v.vestiging===vestiging))
    .sort((a,b)=>a.vestiging.localeCompare(b.vestiging)||a.type.localeCompare(b.type));

  const perVestiging = VESTIGINGEN.map(v=>({naam:v, items:teBestellenItems.filter(i=>i.vestiging===v)}));

  async function slaBestellingOp(item) {
    if (!bestellenAantal||!bestellenDatum) return;
    setSaving(true);
    await onBesteld(item.id, bestellenAantal, bestellenDatum);
    setSaving(false); setBestellenId(null);
  }

  async function slaOntvangenOp(item) {
    if (!ontvangenAantal) return;
    setSaving(true);
    await onOntvangen(item.id, ontvangenAantal, item.vestiging, item.type, item.maat);
    setSaving(false); setOntvangenId(null);
  }

  const inp = {border:`1.5px solid ${C.border}`,borderRadius:6,padding:"6px 10px",fontSize:13,fontFamily:"inherit",outline:"none"};

  return (
    <div>
      {/* Vestiging filter */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {[["alle","Alle vestigingen"],...VESTIGINGEN.map(v=>[v,v])].map(([v,l])=>(
          <button key={v} onClick={()=>setVestiging(v)}
            style={{padding:"7px 16px",borderRadius:20,border:`2px solid ${vestiging===v?C.blauw:C.border}`,
              background:vestiging===v?C.blauw:"white",color:vestiging===v?"white":C.text,
              fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            {l} {v!=="alle"&&<span style={{opacity:.7}}>({voorraad.filter(i=>i.vestiging===v&&i.aantal<i.min_voorraad).length})</span>}
          </button>
        ))}
      </div>

      {/* Al besteld sectie */}
      {alBesteldItems.length > 0 && (
        <div style={{background:"#f0fdf4",border:"1.5px solid #86efac",borderRadius:12,padding:20,marginBottom:20}}>
          <div style={{fontWeight:800,fontSize:14,color:"#166534",marginBottom:12}}>📦 Onderweg / besteld</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{borderBottom:`1px solid #bbf7d0`}}>
              {["Vestiging","Type","Maat","Besteld","Datum","Door",isBackoffice?"Actie":""].map(h=>(
                <th key={h} style={{textAlign:"left",padding:"5px 8px",fontSize:11,fontWeight:700,color:"#166534",textTransform:"uppercase"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {alBesteldItems.map(item=>(
                <tr key={item.id} style={{borderBottom:"1px solid #dcfce7"}}>
                  <td style={{padding:"8px"}}>{item.vestiging}</td>
                  <td style={{padding:"8px",fontWeight:600}}>{item.type}</td>
                  <td style={{padding:"8px"}}>{item.maat}</td>
                  <td style={{padding:"8px",fontWeight:800,color:"#166534"}}>{item.besteld_aantal}x</td>
                  <td style={{padding:"8px",color:C.muted}}>{item.besteld_datum ? new Date(item.besteld_datum).toLocaleDateString("nl-NL") : "—"}</td>
                  <td style={{padding:"8px",color:C.muted,fontSize:12}}>{item.besteld_door||"—"}</td>
                  {isBackoffice && <td style={{padding:"8px"}}>
                    {ontvangenId===item.id ? (
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <input type="number" min={1} value={ontvangenAantal} onChange={e=>setOntvangenAantal(+e.target.value)}
                          style={{...inp,width:60}} placeholder="Stuks"/>
                        <button onClick={()=>slaOntvangenOp(item)} disabled={saving}
                          style={{background:C.groen,color:"white",border:"none",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                          ✓ Verwerken
                        </button>
                        <button onClick={()=>setOntvangenId(null)}
                          style={{background:"white",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 8px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
                      </div>
                    ) : (
                      <button onClick={()=>{setOntvangenId(item.id);setOntvangenAantal(item.besteld_aantal||1);setBestellenId(null);}}
                        style={{background:C.blauw,color:"white",border:"none",borderRadius:6,padding:"5px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                        📥 Ontvangen
                      </button>
                    )}
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Nog te bestellen */}
      {teBestellenItems.length===0 ? (
        <div style={{textAlign:"center",padding:60,color:C.muted}}>
          <div style={{fontSize:40,marginBottom:12}}>✅</div>
          <div style={{fontWeight:700,fontSize:16}}>Alles op peil!</div>
          <div style={{fontSize:13,marginTop:6}}>Geen artikelen hoeven bijbesteld te worden.</div>
        </div>
      ) : (
        <>
          <div style={{fontWeight:800,fontSize:14,color:C.text,marginBottom:12}}>🛒 Nog te bestellen</div>
          {(vestiging==="alle" ? perVestiging : [{naam:vestiging,items:teBestellenItems}]).map(({naam,items})=>{
            if (items.length===0) return null;
            return (
              <div key={naam} style={{background:"white",border:`1px solid ${C.border}`,borderRadius:12,padding:20,marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                  <h3 style={{fontWeight:800,fontSize:15,color:C.blauw}}>📍 {naam}</h3>
                  <span style={{fontSize:12,color:C.muted,background:C.bg,padding:"3px 10px",borderRadius:10}}>{items.length} artikelen</span>
                </div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead>
                    <tr style={{borderBottom:`2px solid ${C.border}`}}>
                      {["Type","Maat","Huidig","Min","Tekort","Status",isBackoffice?"Actie":""].map(h=>(
                        <th key={h} style={{textAlign:"left",padding:"6px 8px",fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item=>{
                      const tekort = item.min_voorraad - item.aantal;
                      const isBesteld = item.besteld_aantal > 0;
                      return (
                        <React.Fragment key={item.id}>
                          <tr style={{borderBottom: bestellenId===item.id ? "none" : `1px solid ${C.border}`,background:item.aantal===0?"#fef2f2":"#fffbeb"}}>
                            <td style={{padding:"8px",fontWeight:600}}>{item.type}</td>
                            <td style={{padding:"8px"}}>{item.maat}</td>
                            <td style={{padding:"8px",fontWeight:800,color:item.aantal===0?C.rood:C.oranje}}>{item.aantal}</td>
                            <td style={{padding:"8px",color:C.muted}}>{item.min_voorraad}</td>
                            <td style={{padding:"8px"}}><span style={{fontWeight:800,color:C.blauw,background:C.blauw+"12",padding:"2px 8px",borderRadius:8}}>+{tekort}</span></td>
                            <td style={{padding:"8px"}}>
                              {isBesteld
                                ? <span style={{fontSize:11,fontWeight:700,color:"#166534",background:"#dcfce7",padding:"2px 8px",borderRadius:8}}>
                                    ✓ Besteld: {item.besteld_aantal}x ({item.besteld_datum ? new Date(item.besteld_datum).toLocaleDateString("nl-NL") : "—"})
                                  </span>
                                : <span style={{fontSize:11,color:C.muted}}>Nog niet besteld</span>
                              }
                            </td>
                            {isBackoffice && <td style={{padding:"8px"}}>
                              {!isBesteld && (
                                bestellenId===item.id ? null :
                                <button onClick={()=>{setBestellenId(item.id);setBestellenAantal(tekort);setBestellenDatum(new Date().toISOString().slice(0,10));setOntvangenId(null);}}
                                  style={{background:"#fef9c3",border:"1px solid #fde047",color:"#854d0e",borderRadius:6,padding:"5px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                                  🛒 Markeer besteld
                                </button>
                              )}
                            </td>}
                          </tr>
                          {isBackoffice && bestellenId===item.id && (
                            <tr style={{borderBottom:`1px solid ${C.border}`,background:"#fefce8"}}>
                              <td colSpan={7} style={{padding:"12px 8px"}}>
                                <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                                  <div>
                                    <label style={{fontSize:11,color:C.muted,display:"block",marginBottom:3}}>Aantal besteld</label>
                                    <input type="number" min={1} value={bestellenAantal} onChange={e=>setBestellenAantal(+e.target.value)}
                                      style={{...inp,width:80}}/>
                                  </div>
                                  <div>
                                    <label style={{fontSize:11,color:C.muted,display:"block",marginBottom:3}}>Besteldatum</label>
                                    <input type="date" value={bestellenDatum} onChange={e=>setBestellenDatum(e.target.value)} style={{...inp}}/>
                                  </div>
                                  <div style={{marginTop:16,display:"flex",gap:6}}>
                                    <button onClick={()=>slaBestellingOp(item)} disabled={saving}
                                      style={{background:"#ca8a04",color:"white",border:"none",borderRadius:6,padding:"7px 16px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                      {saving?"⏳...":"✓ Opslaan"}
                                    </button>
                                    <button onClick={()=>setBestellenId(null)}
                                      style={{background:"white",border:`1px solid ${C.border}`,borderRadius:6,padding:"7px 12px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Annuleren</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── HISTORIE VIEW ────────────────────────────────────────────────────────────
function HistorieView({ transacties, isBackoffice }) {
  const [vestiging, setVestiging] = useState("alle");
  const [actie, setActie] = useState("alle");

  const gefilterd = transacties.filter(t=>
    (vestiging==="alle"||t.vestiging===vestiging) &&
    (actie==="alle"||t.actie===actie)
  );

  const actiKleur = { uitgifte:"#ef4444", bijvulling:"#16a34a", correctie:"#6b7280" };
  const actiLabel = { uitgifte:"📤 Uitgifte", bijvulling:"📥 Bijvulling", correctie:"✏️ Correctie" };

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {[["alle","Alle vestigingen"],...VESTIGINGEN.map(v=>[v,v])].map(([v,l])=>(
          <button key={v} onClick={()=>setVestiging(v)}
            style={{padding:"6px 14px",borderRadius:20,border:`1.5px solid ${vestiging===v?C.blauw:C.border}`,
              background:vestiging===v?C.blauw:"white",color:vestiging===v?"white":C.text,
              fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
        ))}
        <div style={{flex:1}}/>
        {["alle","uitgifte","bijvulling","correctie"].map(a=>(
          <button key={a} onClick={()=>setActie(a)}
            style={{padding:"6px 14px",borderRadius:20,border:`1.5px solid ${actie===a?(actiKleur[a]||C.blauw):C.border}`,
              background:actie===a?(actiKleur[a]+"18"||C.blauw+"18"):"white",color:actie===a?(actiKleur[a]||C.blauw):C.muted,
              fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            {a==="alle"?"Alle acties":actiLabel[a]||a}
          </button>
        ))}
      </div>
      <div style={{display:"grid",gap:8}}>
        {gefilterd.slice(0,100).map(t=>(
          <div key={t.id} style={{background:"white",border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:actiKleur[t.actie]||C.muted,flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:C.text}}>{t.type} — {t.maat} <span style={{fontWeight:400,color:C.muted}}>({t.vestiging})</span></div>
              <div style={{fontSize:11,color:C.muted,marginTop:1}}>{t.medewerker} · {fmtDate(t.created_at)} {fmtTime(t.created_at)}{t.opmerking&&` · ${t.opmerking}`}</div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:14,fontWeight:800,color:t.actie==="uitgifte"?C.rood:t.actie==="bijvulling"?"#16a34a":C.muted}}>
                {t.actie==="uitgifte"?"-":"+"}{ t.actie==="correctie"?"":""}{t.aantal}
              </div>
              <div style={{fontSize:10,color:actiKleur[t.actie]||C.muted,fontWeight:600}}>{actiLabel[t.actie]||t.actie}</div>
            </div>
          </div>
        ))}
        {gefilterd.length===0&&<div style={{textAlign:"center",padding:40,color:C.muted}}>Geen transacties gevonden</div>}
        {gefilterd.length>100&&<div style={{textAlign:"center",fontSize:12,color:C.muted,padding:8}}>Toont laatste 100 van {gefilterd.length} transacties</div>}
      </div>
    </div>
  );
}

// ─── BEHEER VOORRAAD ─────────────────────────────────────────────────────────
function BeheerVoorraad({ voorraad, onBijvullen, onCorrectie, showToast }) {
  const [vestiging, setVestiging] = useState("Enschede");
  const [bewerkId, setBewerkId] = useState(null);
  const [bewerkVoorraad, setBewerkVoorraad] = useState(0);
  const [bewerkMin, setBewerkMin] = useState(1);
  const [bijvullenId, setBijvullenId] = useState(null);
  const [bijvullenAantal, setBijvullenAantal] = useState(1);
  const [saving, setSaving] = useState(false);
  const [toonNieuw, setToonNieuw] = useState(false);
  const [nieuw, setNieuw] = useState({type:"",typeNieuw:"",maat:"",aantal:0,min_voorraad:1});

  const items = voorraad.filter(v=>v.vestiging===vestiging);
  const alleTypes = [...new Set(voorraad.map(v=>v.type))].sort();
  const types = [...new Set(items.map(v=>v.type))].sort();
  const inp = (extra={}) => ({border:`1.5px solid ${C.border}`,borderRadius:6,padding:"5px 10px",fontSize:13,fontFamily:"inherit",outline:"none",...extra});

  async function voegArtikeltoe() {
    const type = nieuw.typeNieuw.trim() || nieuw.type;
    if (!type || !nieuw.maat.trim()) { showToast("Vul type en maat in","err"); return; }
    const bestaatAl = voorraad.find(v=>v.vestiging===vestiging&&v.type===type&&v.maat===nieuw.maat.trim());
    if (bestaatAl) { showToast("Dit artikel bestaat al voor deze vestiging","err"); return; }
    setSaving(true);
    const { error } = await supabase.from("kleding_voorraad").insert([{
      vestiging, type, maat: nieuw.maat.trim(),
      aantal: nieuw.aantal, min_voorraad: nieuw.min_voorraad
    }]);
    setSaving(false);
    if (error) { showToast("Fout bij toevoegen","err"); return; }
    showToast(`✓ ${type} ${nieuw.maat} toegevoegd aan ${vestiging}`);
    setNieuw({type:"",typeNieuw:"",maat:"",aantal:0,min_voorraad:1});
    setToonNieuw(false);
  }

  async function verwijderArtikel(item) {
    if (!window.confirm(`${item.type} ${item.maat} verwijderen uit ${item.vestiging}?`)) return;
    const { error } = await supabase.from("kleding_voorraad").delete().eq("id", item.id);
    if (error) { showToast("Fout bij verwijderen","err"); return; }
    showToast(`✓ ${item.type} ${item.maat} verwijderd`);
  }

  async function slaCorrectieOp(item) {
    setSaving(true);
    const { error } = await supabase.from("kleding_voorraad")
      .update({ aantal: bewerkVoorraad, min_voorraad: bewerkMin, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    setSaving(false);
    if (!error) { showToast("✓ Opgeslagen"); setBewerkId(null); }
    else showToast("Fout bij opslaan","err");
  }

  return (
    <div>
      {/* Vestiging + Nieuw artikel knop */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        {VESTIGINGEN.map(v=>(
          <button key={v} onClick={()=>{setVestiging(v);setToonNieuw(false);setBewerkId(null);}}
            style={{padding:"8px 20px",borderRadius:20,border:`2px solid ${vestiging===v?C.blauw:C.border}`,
              background:vestiging===v?C.blauw:"white",color:vestiging===v?"white":C.text,
              fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
            {v}
          </button>
        ))}
        <button onClick={()=>setToonNieuw(!toonNieuw)}
          style={{marginLeft:"auto",padding:"8px 18px",borderRadius:20,
            border:`2px solid ${toonNieuw?C.rood:C.groen}`,
            background:toonNieuw?"#fef2f2":"#f0fdf4",
            color:toonNieuw?C.rood:C.groen,
            fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
          {toonNieuw?"✕ Annuleren":"+ Artikel toevoegen"}
        </button>
      </div>

      {/* Nieuw artikel formulier */}
      {toonNieuw && (
        <div style={{background:"white",border:`2px solid ${C.groen}`,borderRadius:12,padding:20,marginBottom:20}}>
          <div style={{fontWeight:800,fontSize:14,color:C.groen,marginBottom:16}}>➕ Nieuw artikel — {vestiging}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:14}}>
            <div>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:".7px",display:"block",marginBottom:5}}>Type *</label>
              <select value={nieuw.type} onChange={e=>setNieuw(p=>({...p,type:e.target.value,typeNieuw:""}))} style={{...inp(),width:"100%",marginBottom:6}}>
                <option value="">— Bestaand type —</option>
                {alleTypes.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
              <input value={nieuw.typeNieuw} onChange={e=>setNieuw(p=>({...p,typeNieuw:e.target.value,type:""}))}
                placeholder="Of nieuw type invullen..." style={{...inp(),width:"100%",boxSizing:"border-box"}}/>
            </div>
            <div>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:".7px",display:"block",marginBottom:5}}>Maat / omschrijving *</label>
              <input value={nieuw.maat} onChange={e=>setNieuw(p=>({...p,maat:e.target.value}))}
                placeholder="Bijv. 42 of XL of Maat 44" style={{...inp(),width:"100%",boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <label style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:".7px",display:"block",marginBottom:5}}>Begin voorraad</label>
                <input type="number" min={0} value={nieuw.aantal} onChange={e=>setNieuw(p=>({...p,aantal:+e.target.value}))} style={{...inp(),width:"100%",boxSizing:"border-box"}}/>
              </div>
              <div>
                <label style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:".7px",display:"block",marginBottom:5}}>Minimum</label>
                <input type="number" min={0} value={nieuw.min_voorraad} onChange={e=>setNieuw(p=>({...p,min_voorraad:+e.target.value}))} style={{...inp(),width:"100%",boxSizing:"border-box"}}/>
              </div>
            </div>
          </div>
          <button onClick={voegArtikeltoe} disabled={saving}
            style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"10px 24px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            {saving?"⏳ Opslaan...":"✓ Artikel toevoegen"}
          </button>
        </div>
      )}

      {/* Bestaande artikelen */}
      {types.map(type=>{
        const typeItems = items.filter(v=>v.type===type);
        return (
          <div key={type} style={{background:"white",border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:12}}>
            <div style={{fontWeight:800,fontSize:14,color:C.text,marginBottom:12}}>{type}</div>
            <div style={{display:"grid",gap:6}}>
              {typeItems.map(item=>(
                <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.border}`,flexWrap:"wrap"}}>
                  <span style={{minWidth:90,fontSize:13,fontWeight:600,color:C.text}}>{item.maat}</span>

                  {bewerkId===item.id ? (
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <label style={{fontSize:11,color:C.muted}}>Voorraad:</label>
                        <input type="number" min={0} value={bewerkVoorraad} onChange={e=>setBewerkVoorraad(+e.target.value)}
                          style={{...inp(),width:65}}/>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <label style={{fontSize:11,color:C.muted}}>Minimum:</label>
                        <input type="number" min={0} value={bewerkMin} onChange={e=>setBewerkMin(+e.target.value)}
                          style={{...inp(),width:65}}/>
                      </div>
                      <button onClick={()=>slaCorrectieOp(item)} disabled={saving}
                        style={{background:C.groen,color:"white",border:"none",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>✓ Opslaan</button>
                      <button onClick={()=>setBewerkId(null)}
                        style={{background:"white",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annuleren</button>
                    </div>
                  ) : bijvullenId===item.id ? (
                    <div style={{display:"flex",gap:8,alignItems:"center",flex:1}}>
                      <span style={{fontSize:13,fontWeight:700,color:C.groen}}>+</span>
                      <input type="number" min={1} value={bijvullenAantal} onChange={e=>setBijvullenAantal(+e.target.value)}
                        style={{...inp(),width:70}}/>
                      <button onClick={async()=>{setSaving(true);await onBijvullen(item.vestiging,item.type,item.maat,bijvullenAantal,"");setSaving(false);setBijvullenId(null);setBijvullenAantal(1);}}
                        style={{background:C.groen,color:"white",border:"none",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>✓ Bijvullen</button>
                      <button onClick={()=>setBijvullenId(null)}
                        style={{background:"white",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annuleren</button>
                    </div>
                  ) : (
                    <>
                      <span style={{fontWeight:800,fontSize:15,color:item.aantal===0?C.rood:item.aantal<item.min_voorraad?C.oranje:C.groen,minWidth:35}}>{item.aantal}</span>
                      <span style={{fontSize:11,color:C.muted,background:C.bg,padding:"2px 8px",borderRadius:8}}>min: {item.min_voorraad}</span>
                      <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                        <button onClick={()=>{setBijvullenId(item.id);setBijvullenAantal(Math.max(1,item.min_voorraad-item.aantal));setBewerkId(null);}}
                          style={{background:"#f0fdf4",border:"1px solid #bbf7d0",color:"#166534",borderRadius:6,padding:"4px 10px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>📥 Bijvullen</button>
                        <button onClick={()=>{setBewerkId(item.id);setBewerkVoorraad(item.aantal);setBewerkMin(item.min_voorraad);setBijvullenId(null);}}
                          style={{background:C.bg,border:`1px solid ${C.border}`,color:C.muted,borderRadius:6,padding:"4px 10px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>✏️ Bewerken</button>
                        <button onClick={()=>verwijderArtikel(item)}
                          style={{background:"#fef2f2",border:"1px solid #fecaca",color:"#b91c1c",borderRadius:6,padding:"4px 8px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>🗑</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {types.length===0&&<div style={{textAlign:"center",padding:40,color:C.muted}}>Geen artikelen voor {vestiging}</div>}
    </div>
  );
}
