import { useState, useEffect, useCallback } from "react";
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

  async function registreerUitgifte(vestiging, type, maat, aantal, opmerking) {
    const item = voorraad.find(v=>v.vestiging===vestiging&&v.type===type&&v.maat===maat);
    if (!item) { showToast("Artikel niet gevonden","err"); return false; }
    if (item.aantal < aantal) { showToast(`Onvoldoende voorraad — nog ${item.aantal} beschikbaar`,"err"); return false; }
    const { error: e1 } = await supabase.from("kleding_voorraad")
      .update({ aantal: item.aantal - aantal, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    if (e1) { showToast("Fout bij opslaan","err"); return false; }
    await supabase.from("kleding_transacties").insert([{
      vestiging, type, maat, aantal, actie:"uitgifte",
      medewerker: gebruiker.naam, opmerking: opmerking||null
    }]);
    showToast(`✓ ${aantal}x ${type} ${maat} uitgeschreven`);
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
      {subTab==="bijbestellen" && <BijbestellenView voorraad={voorraad} transacties={transacties}/>}
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
    if (item.aantal === 0) return { bg:"#fef2f2", border:"#fecaca", dot:"#ef4444", label:"Op" };
    if (item.aantal < item.min_voorraad) return { bg:"#fffbeb", border:"#fde68a", dot:"#f59e0b", label:"Laag" };
    return { bg:"#f0fdf4", border:"#bbf7d0", dot:"#16a34a", label:"OK" };
  }

  return (
    <div>
      {/* Vestiging tabs */}
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {VESTIGINGEN.map(v=>{
          const laag = voorraad.filter(i=>i.vestiging===v&&i.aantal<i.min_voorraad).length;
          return (
            <button key={v} onClick={()=>setVestiging(v)}
              style={{padding:"8px 20px",borderRadius:20,border:`2px solid ${vestiging===v?C.blauw:C.border}`,
                background:vestiging===v?C.blauw:"white",color:vestiging===v?"white":C.text,
                fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",position:"relative"}}>
              {v} {laag>0&&<span style={{marginLeft:6,background:"#ef4444",color:"white",borderRadius:10,padding:"1px 6px",fontSize:10}}>{laag}</span>}
            </button>
          );
        })}
      </div>

      {/* Stats */}
      <div style={{display:"flex",gap:12,marginBottom:16}}>
        {totaalOp>0&&<div style={{padding:"6px 14px",borderRadius:20,background:"#fef2f2",border:"1px solid #fecaca",fontSize:12,fontWeight:700,color:"#b91c1c"}}>🔴 {totaalOp} artikelen op</div>}
        {totaalLaag>0&&<div style={{padding:"6px 14px",borderRadius:20,background:"#fffbeb",border:"1px solid #fde68a",fontSize:12,fontWeight:700,color:"#92400e"}}>🟡 {totaalLaag} onder minimum</div>}
        {totaalLaag===0&&<div style={{padding:"6px 14px",borderRadius:20,background:"#f0fdf4",border:"1px solid #bbf7d0",fontSize:12,fontWeight:700,color:"#166534"}}>✅ Alles op peil</div>}
      </div>

      <input value={zoek} onChange={e=>setZoek(e.target.value)} placeholder="🔍 Zoek type of maat..."
        style={{width:"100%",maxWidth:300,border:`1.5px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:13,marginBottom:16,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>

      {/* Per type */}
      {types.map(type=>{
        const typeItems = items.filter(v=>v.type===type);
        const heeftProbleem = typeItems.some(i=>i.aantal<i.min_voorraad);
        return (
          <div key={type} style={{background:"white",border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:12,
            borderLeft:`4px solid ${heeftProbleem?"#f59e0b":C.groen}`}}>
            <div style={{fontWeight:800,fontSize:14,color:C.text,marginBottom:12}}>{type}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {typeItems.map(item=>{
                const s = statusKleur(item);
                return (
                  <div key={item.id} style={{padding:"8px 14px",borderRadius:8,background:s.bg,border:`1.5px solid ${s.border}`,minWidth:90,textAlign:"center"}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:2}}>{item.maat}</div>
                    <div style={{fontSize:20,fontWeight:800,color:s.dot}}>{item.aantal}</div>
                    <div style={{fontSize:10,color:s.dot,fontWeight:600}}>{s.label}</div>
                    <div style={{fontSize:10,color:C.muted}}>min: {item.min_voorraad}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {types.length===0&&<div style={{textAlign:"center",padding:40,color:C.muted}}>Geen artikelen gevonden</div>}
    </div>
  );
}

// ─── UITGIFTE FORM ────────────────────────────────────────────────────────────
function UitgifteForm({ voorraad, gebruiker, onSubmit, showToast }) {
  const [vestiging, setVestiging] = useState(gebruiker?.vestiging||"Enschede");
  const [type, setType] = useState("");
  const [maat, setMaat] = useState("");
  const [aantal, setAantal] = useState(1);
  const [opmerking, setOpmerking] = useState("");
  const [saving, setSaving] = useState(false);

  const types = [...new Set(voorraad.filter(v=>v.vestiging===vestiging).map(v=>v.type))].sort();
  const maten = voorraad.filter(v=>v.vestiging===vestiging&&v.type===type).sort((a,b)=>a.maat.localeCompare(b.maat));
  const geselecteerd = voorraad.find(v=>v.vestiging===vestiging&&v.type===type&&v.maat===maat);

  async function submit() {
    if (!type||!maat||aantal<1) { showToast("Vul alle velden in","err"); return; }
    setSaving(true);
    const ok = await onSubmit(vestiging, type, maat, aantal, opmerking);
    setSaving(false);
    if (ok) { setType(""); setMaat(""); setAantal(1); setOpmerking(""); }
  }

  const inp = { width:"100%", border:`1.5px solid ${C.border}`, borderRadius:8, padding:"10px 14px", fontSize:14, fontFamily:"inherit", color:C.text, background:"white", outline:"none", boxSizing:"border-box" };

  return (
    <div style={{maxWidth:520}}>
      <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:14,padding:28}}>
        <h3 style={{fontSize:16,fontWeight:800,color:C.blauw,marginBottom:4}}>📤 Kleding uitschrijven</h3>
        <p style={{fontSize:13,color:C.muted,marginBottom:20}}>Geef door welke kleding je hebt meegenomen.</p>

        <div style={{marginBottom:14}}>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Vestiging</label>
          <div style={{display:"flex",gap:8}}>
            {VESTIGINGEN.map(v=>(
              <button key={v} onClick={()=>{setVestiging(v);setType("");setMaat("");}}
                style={{flex:1,padding:"10px",border:`2px solid ${vestiging===v?C.blauw:C.border}`,borderRadius:8,
                  background:vestiging===v?C.blauw+"12":"white",color:vestiging===v?C.blauw:C.muted,
                  fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                {v}
              </button>
            ))}
          </div>
        </div>

        <div style={{marginBottom:14}}>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Type kleding *</label>
          <select value={type} onChange={e=>{setType(e.target.value);setMaat("");}} style={inp}>
            <option value="">— Selecteer type —</option>
            {types.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {type && (
          <div style={{marginBottom:14}}>
            <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Maat *</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {maten.map(item=>{
                const isOp = item.aantal===0;
                const isLaag = item.aantal>0&&item.aantal<item.min_voorraad;
                const geselecteerdItem = maat===item.maat;
                return (
                  <button key={item.id} onClick={()=>!isOp&&setMaat(item.maat)} disabled={isOp}
                    style={{padding:"8px 14px",borderRadius:8,cursor:isOp?"not-allowed":"pointer",fontFamily:"inherit",fontWeight:700,fontSize:13,
                      border:`2px solid ${geselecteerdItem?C.blauw:isOp?"#fecaca":isLaag?"#fde68a":C.border}`,
                      background:geselecteerdItem?C.blauw:isOp?"#fef2f2":isLaag?"#fffbeb":"white",
                      color:geselecteerdItem?"white":isOp?"#b91c1c":isLaag?"#92400e":C.text,
                      opacity:isOp?.5:1}}>
                    {item.maat} <span style={{fontSize:11,opacity:.7}}>({item.aantal})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {maat && geselecteerd && (
          <>
            <div style={{marginBottom:14,padding:"10px 14px",borderRadius:8,background:geselecteerd.aantal<geselecteerd.min_voorraad?"#fffbeb":"#f0fdf4",border:`1px solid ${geselecteerd.aantal<geselecteerd.min_voorraad?"#fde68a":"#bbf7d0"}`}}>
              <span style={{fontSize:13,fontWeight:600}}>Beschikbaar: <strong>{geselecteerd.aantal}</strong> stuks · Minimum: {geselecteerd.min_voorraad}</span>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Aantal *</label>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={()=>setAantal(Math.max(1,aantal-1))} style={{width:36,height:36,borderRadius:8,border:`1.5px solid ${C.border}`,background:"white",fontSize:18,cursor:"pointer",fontFamily:"inherit"}}>−</button>
                <input type="number" min={1} max={geselecteerd.aantal} value={aantal} onChange={e=>setAantal(Math.max(1,Math.min(geselecteerd.aantal,+e.target.value)))}
                  style={{...inp,width:80,textAlign:"center"}}/>
                <button onClick={()=>setAantal(Math.min(geselecteerd.aantal,aantal+1))} style={{width:36,height:36,borderRadius:8,border:`1.5px solid ${C.border}`,background:"white",fontSize:18,cursor:"pointer",fontFamily:"inherit"}}>+</button>
              </div>
            </div>
            <div style={{marginBottom:20}}>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Opmerking (optioneel)</label>
              <input value={opmerking} onChange={e=>setOpmerking(e.target.value)} placeholder="Bijv. voor nieuwe medewerker" style={inp}/>
            </div>
            <button onClick={submit} disabled={saving}
              style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"12px 28px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",width:"100%"}}>
              {saving?"⏳ Opslaan...":"📤 Uitschrijven"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── BIJBESTELLEN VIEW ────────────────────────────────────────────────────────
function BijbestellenView({ voorraad }) {
  const [vestiging, setVestiging] = useState("alle");

  const teBestellenItems = voorraad
    .filter(v => v.aantal < v.min_voorraad && (vestiging==="alle" || v.vestiging===vestiging))
    .sort((a,b)=>a.vestiging.localeCompare(b.vestiging)||a.type.localeCompare(b.type));

  const perVestiging = VESTIGINGEN.map(v=>({
    naam:v,
    items: teBestellenItems.filter(i=>i.vestiging===v)
  }));

  return (
    <div>
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

      {teBestellenItems.length===0 ? (
        <div style={{textAlign:"center",padding:60,color:C.muted}}>
          <div style={{fontSize:40,marginBottom:12}}>✅</div>
          <div style={{fontWeight:700,fontSize:16}}>Alles op peil!</div>
          <div style={{fontSize:13,marginTop:6}}>Geen artikelen hoeven bijbesteld te worden.</div>
        </div>
      ) : (
        (vestiging==="alle" ? perVestiging : [{naam:vestiging,items:teBestellenItems}]).map(({naam,items})=>{
          if (items.length===0) return null;
          return (
            <div key={naam} style={{background:"white",border:`1px solid ${C.border}`,borderRadius:12,padding:20,marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                <h3 style={{fontWeight:800,fontSize:15,color:C.blauw}}>📍 {naam}</h3>
                <span style={{fontSize:12,color:C.muted,background:C.bg,padding:"3px 10px",borderRadius:10}}>{items.length} artikelen</span>
              </div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:`2px solid ${C.border}`}}>
                    {["Type","Maat","Op dit moment","Minimum","Bestellen"].map(h=>(
                      <th key={h} style={{textAlign:"left",padding:"6px 10px",fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".5px"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map(item=>{
                    const tekort = item.min_voorraad - item.aantal;
                    return (
                      <tr key={item.id} style={{borderBottom:`1px solid ${C.border}`,background:item.aantal===0?"#fef2f2":"#fffbeb"}}>
                        <td style={{padding:"8px 10px",fontWeight:600}}>{item.type}</td>
                        <td style={{padding:"8px 10px"}}>{item.maat}</td>
                        <td style={{padding:"8px 10px"}}>
                          <span style={{fontWeight:800,color:item.aantal===0?C.rood:C.oranje}}>{item.aantal}</span>
                          {item.aantal===0&&<span style={{marginLeft:6,fontSize:10,background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"1px 6px",color:"#b91c1c",fontWeight:700}}>OP</span>}
                        </td>
                        <td style={{padding:"8px 10px",color:C.muted}}>{item.min_voorraad}</td>
                        <td style={{padding:"8px 10px"}}>
                          <span style={{fontWeight:800,color:C.blauw,background:C.blauw+"12",padding:"2px 10px",borderRadius:10}}>+{tekort}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })
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
  const [bewerkWaarde, setBewerkWaarde] = useState(0);
  const [bijvullenId, setBijvullenId] = useState(null);
  const [bijvullenAantal, setBijvullenAantal] = useState(1);
  const [saving, setSaving] = useState(false);

  const items = voorraad.filter(v=>v.vestiging===vestiging);
  const types = [...new Set(items.map(v=>v.type))].sort();

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        {VESTIGINGEN.map(v=>(
          <button key={v} onClick={()=>setVestiging(v)}
            style={{padding:"8px 20px",borderRadius:20,border:`2px solid ${vestiging===v?C.blauw:C.border}`,
              background:vestiging===v?C.blauw:"white",color:vestiging===v?"white":C.text,
              fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
            {v}
          </button>
        ))}
      </div>
      {types.map(type=>{
        const typeItems = items.filter(v=>v.type===type);
        return (
          <div key={type} style={{background:"white",border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:12}}>
            <div style={{fontWeight:800,fontSize:14,color:C.text,marginBottom:12}}>{type}</div>
            <div style={{display:"grid",gap:8}}>
              {typeItems.map(item=>(
                <div key={item.id} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                  <span style={{minWidth:80,fontSize:13,color:C.muted}}>{item.maat}</span>
                  {bewerkId===item.id ? (
                    <>
                      <input type="number" min={0} value={bewerkWaarde} onChange={e=>setBewerkWaarde(+e.target.value)}
                        style={{width:70,border:`1.5px solid ${C.blauw}`,borderRadius:6,padding:"4px 8px",fontSize:13,fontFamily:"inherit"}}/>
                      <button onClick={async()=>{setSaving(true);await onCorrectie(item.id,bewerkWaarde,item.vestiging,item.type,item.maat);setSaving(false);setBewerkId(null);}}
                        style={{background:C.groen,color:"white",border:"none",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>✓ Opslaan</button>
                      <button onClick={()=>setBewerkId(null)}
                        style={{background:"white",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annuleren</button>
                    </>
                  ) : bijvullenId===item.id ? (
                    <>
                      <span style={{fontSize:13,fontWeight:700}}>+</span>
                      <input type="number" min={1} value={bijvullenAantal} onChange={e=>setBijvullenAantal(+e.target.value)}
                        style={{width:70,border:`1.5px solid ${C.groen}`,borderRadius:6,padding:"4px 8px",fontSize:13,fontFamily:"inherit"}}/>
                      <button onClick={async()=>{setSaving(true);await onBijvullen(item.vestiging,item.type,item.maat,bijvullenAantal,"");setSaving(false);setBijvullenId(null);setBijvullenAantal(1);}}
                        style={{background:C.groen,color:"white",border:"none",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>✓ Bijvullen</button>
                      <button onClick={()=>setBijvullenId(null)}
                        style={{background:"white",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Annuleren</button>
                    </>
                  ) : (
                    <>
                      <span style={{fontWeight:800,fontSize:16,color:item.aantal===0?C.rood:item.aantal<item.min_voorraad?C.oranje:C.groen,minWidth:40}}>{item.aantal}</span>
                      <span style={{fontSize:11,color:C.muted}}>min:{item.min_voorraad}</span>
                      <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                        <button onClick={()=>{setBijvullenId(item.id);setBijvullenAantal(item.min_voorraad-item.aantal>0?item.min_voorraad-item.aantal:1);setBewerkId(null);}}
                          style={{background:"#f0fdf4",border:"1px solid #bbf7d0",color:"#166534",borderRadius:6,padding:"4px 10px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>📥 Bijvullen</button>
                        <button onClick={()=>{setBewerkId(item.id);setBewerkWaarde(item.aantal);setBijvullenId(null);}}
                          style={{background:C.bg,border:`1px solid ${C.border}`,color:C.muted,borderRadius:6,padding:"4px 10px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>✏️ Corrigeren</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
