import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

const C = {
  blauw:"#1B3A6B", blauwDark:"#132b52",
  groen:"#4A9B3C", groenDark:"#357a2b",
  bg:"#f0f4f8", card:"#ffffff", border:"#d1dbe8",
  text:"#1a2b47", muted:"#6b7a8d",
};

function todayISO() { return new Date().toISOString().slice(0,10); }

function Label({ children }) {
  return <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>{children}</label>;
}
function Input(props) {
  return <input style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}} {...props}/>;
}

export function FietsModule({ gebruiker, showToast }) {
  const [fietsen, setFietsen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toonUitgifte, setToonUitgifte] = useState(false);
  const [toonToevoegen, setToonToevoegen] = useState(false);
  const [uitgifte, setUitgifte] = useState({ locatie:"", naam_medewerker:"" });
  const [nieuweLocatie, setNieuweLocatie] = useState("");
  const [saving, setSaving] = useState(false);

  const isBackoffice = gebruiker?.rol === "backoffice" || gebruiker?.rol === "huismeester";

  const loadFietsen = useCallback(async () => {
    const { data } = await supabase.from("fietsen").select("*").eq("status","Beschikbaar").order("naam_medewerker");
    setFietsen(data || []);
  }, []);

  useEffect(() => {
    async function init() { setLoading(true); await loadFietsen(); setLoading(false); }
    init();
    const s = supabase.channel("fie2-rt").on("postgres_changes",{event:"*",schema:"public",table:"fietsen"},()=>loadFietsen()).subscribe();
    return () => supabase.removeChannel(s);
  }, [loadFietsen]);

  // Groepeer fietsen per locatie
  const perLocatie = fietsen.reduce((acc, f) => {
    const loc = f.naam_medewerker || "Onbekend";
    if (!acc[loc]) acc[loc] = [];
    acc[loc].push(f);
    return acc;
  }, {});
  const locaties = Object.keys(perLocatie).sort();

  async function geefFietsUit() {
    if (!uitgifte.locatie) { showToast("Selecteer een locatie","err"); return; }
    if (!uitgifte.naam_medewerker.trim()) { showToast("Vul naam medewerker in","err"); return; }

    const beschikbaar = perLocatie[uitgifte.locatie] || [];
    if (beschikbaar.length === 0) { showToast("Geen fiets beschikbaar op die locatie","err"); return; }

    setSaving(true);
    const fiets = beschikbaar[0]; // pak eerste beschikbare fiets van die locatie

    // 1. Markeer fiets als verkocht (verdwijnt uit overzicht)
    await supabase.from("fietsen").update({ status:"Verkocht", naam_medewerker: uitgifte.naam_medewerker, datum_uitgifte: todayISO() }).eq("id", fiets.id);

    // 2. Log in activiteiten (verschijnt in global Log)
    await supabase.from("activiteiten").insert([{
      type: "fiets_uitgifte",
      omschrijving: `🚲 Fiets uitgegeven aan ${uitgifte.naam_medewerker} — locatie: ${uitgifte.locatie}`,
      gedaan_door: gebruiker?.naam || "?",
      extra: { naam: uitgifte.naam_medewerker, locatie: uitgifte.locatie, fiets_id: fiets.id },
    }]);

    // 3. Borg aanmaken of toevoegen
    const { data: bestaandPlan } = await supabase.from("borg_plannen")
      .select("id,heeft_fiets,totaal_borg").eq("naam_medewerker", uitgifte.naam_medewerker).eq("status","actief").limit(1);

    if (!bestaandPlan || bestaandPlan.length === 0) {
      const nu = new Date();
      const j = new Date(Date.UTC(nu.getFullYear(),0,1));
      const startWeek = Math.ceil((((nu-j)/86400000)+j.getDay()+1)/7)+1;
      const { data: plan } = await supabase.from("borg_plannen").insert([{
        naam_medewerker: uitgifte.naam_medewerker, sleutels:0, heeft_fiets:true,
        totaal_borg:100, ingehouden:0, status:"actief",
        aangemaakt_door: gebruiker?.naam || "?", aankomst_datum: todayISO(),
      }]).select().single();
      if (plan) {
        const w2 = startWeek+1>52?1:startWeek+1;
        const jaar = nu.getFullYear();
        await supabase.from("borg_termijnen").insert([
          { plan_id:plan.id, naam_medewerker:uitgifte.naam_medewerker, week_nummer:startWeek, jaar, bedrag:50, type:"inhouden", omschrijving:"Borg fiets (week 1/2)", status:"open" },
          { plan_id:plan.id, naam_medewerker:uitgifte.naam_medewerker, week_nummer:w2, jaar: w2===1?jaar+1:jaar, bedrag:50, type:"inhouden", omschrijving:"Borg fiets (week 2/2)", status:"open" },
        ]);
      }
    } else {
      const plan = bestaandPlan[0];
      if (!plan.heeft_fiets) {
        await supabase.from("borg_plannen").update({ heeft_fiets:true, totaal_borg: Number(plan.totaal_borg)+100 }).eq("id", plan.id);
        const nu = new Date();
        const j = new Date(Date.UTC(nu.getFullYear(),0,1));
        const sw = Math.ceil((((nu-j)/86400000)+j.getDay()+1)/7)+1;
        const w2 = sw+1>52?1:sw+1;
        const jaar = nu.getFullYear();
        await supabase.from("borg_termijnen").insert([
          { plan_id:plan.id, naam_medewerker:uitgifte.naam_medewerker, week_nummer:sw, jaar, bedrag:50, type:"inhouden", omschrijving:"Borg fiets (week 1/2)", status:"open" },
          { plan_id:plan.id, naam_medewerker:uitgifte.naam_medewerker, week_nummer:w2, jaar: w2===1?jaar+1:jaar, bedrag:50, type:"inhouden", omschrijving:"Borg fiets (week 2/2)", status:"open" },
        ]);
      }
    }

    setSaving(false);
    showToast(`✓ Fiets uitgegeven aan ${uitgifte.naam_medewerker} — borg aangemaakt, gelogd`);
    setToonUitgifte(false);
    setUitgifte({ locatie:"", naam_medewerker:"" });
  }

  async function voegFietsToe() {
    if (!nieuweLocatie.trim()) { showToast("Vul een locatie in","err"); return; }
    setSaving(true);
    await supabase.from("fietsen").insert([{
      fietsnummer: String(Date.now()).slice(-4), // intern ID, niet zichtbaar
      status: "Beschikbaar",
      naam_medewerker: nieuweLocatie.trim(),
    }]);
    setSaving(false);
    showToast("✓ Fiets toegevoegd");
    setNieuweLocatie(""); setToonToevoegen(false);
  }

  if (loading) return <div style={{textAlign:"center",padding:"60px",color:C.muted}}>⏳ Laden...</div>;

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,color:C.blauw,marginBottom:3}}>🚲 Beschikbare fietsen</h2>
          <p style={{fontSize:13,color:C.muted}}>{fietsen.length} beschikbaar · {locaties.length} locatie{locaties.length!==1?"s":""}</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>{setToonUitgifte(!toonUitgifte);setToonToevoegen(false);}}
            style={{background:toonUitgifte?"white":C.groen,color:toonUitgifte?C.groen:"white",border:`2px solid ${C.groen}`,borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            {toonUitgifte?"✕ Annuleren":"🚲 Fiets uitgeven"}
          </button>
          {isBackoffice && (
            <button onClick={()=>{setToonToevoegen(!toonToevoegen);setToonUitgifte(false);}}
              style={{background:toonToevoegen?"white":C.blauw,color:toonToevoegen?C.blauw:"white",border:`2px solid ${C.blauw}`,borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {toonToevoegen?"✕ Annuleren":"+ Fiets toevoegen"}
            </button>
          )}
        </div>
      </div>

      {/* Uitgifte form */}
      {toonUitgifte && (
        <div style={{background:"white",border:`2px solid ${C.groen}`,borderRadius:12,padding:20,marginBottom:20}}>
          <div style={{fontWeight:700,fontSize:15,color:C.groen,marginBottom:16}}>🚲 Fiets uitgeven aan medewerker</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
            <div>
              <Label>Locatie *</Label>
              <select value={uitgifte.locatie} onChange={e=>setUitgifte(p=>({...p,locatie:e.target.value}))}
                style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:uitgifte.locatie?C.text:C.muted,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",appearance:"none"}}>
                <option value="">Selecteer locatie...</option>
                {locaties.map(l => (
                  <option key={l} value={l}>{l} ({(perLocatie[l]||[]).length} beschikbaar)</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Naam medewerker *</Label>
              <Input value={uitgifte.naam_medewerker} onChange={e=>setUitgifte(p=>({...p,naam_medewerker:e.target.value}))} placeholder="Voor- en achternaam" autoFocus/>
            </div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <button onClick={geefFietsUit} disabled={saving||!uitgifte.locatie||!uitgifte.naam_medewerker}
              style={{background:saving||!uitgifte.locatie||!uitgifte.naam_medewerker?"#ccc":C.groen,color:"white",border:"none",borderRadius:8,padding:"11px 24px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {saving?"⏳ Bezig...":"✓ Fiets uitgeven"}
            </button>
            <span style={{fontSize:12,color:C.muted}}>Fiets wordt gelogd + borg automatisch aangemaakt</span>
          </div>
        </div>
      )}

      {/* Toevoegen form */}
      {toonToevoegen && isBackoffice && (
        <div style={{background:"white",border:`2px solid ${C.blauw}`,borderRadius:12,padding:20,marginBottom:20}}>
          <div style={{fontWeight:700,fontSize:15,color:C.blauw,marginBottom:16}}>+ Fiets toevoegen aan voorraad</div>
          <div style={{maxWidth:340,marginBottom:16}}>
            <Label>Locatie *</Label>
            <Input value={nieuweLocatie} onChange={e=>setNieuweLocatie(e.target.value)}
              placeholder="bijv. Kantoor Enschede" list="locatie-lijst" autoFocus/>
            <datalist id="locatie-lijst">
              {locaties.map(l => <option key={l} value={l}/>)}
            </datalist>
          </div>
          <button onClick={voegFietsToe} disabled={saving||!nieuweLocatie.trim()}
            style={{background:saving||!nieuweLocatie.trim()?"#ccc":C.blauw,color:"white",border:"none",borderRadius:8,padding:"10px 22px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            {saving?"⏳ Opslaan...":"✓ Toevoegen"}
          </button>
        </div>
      )}

      {/* Overzicht per locatie */}
      {fietsen.length === 0 ? (
        <div style={{textAlign:"center",padding:"60px",color:C.muted,background:"white",borderRadius:12,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:48,marginBottom:12}}>🚲</div>
          <div style={{fontWeight:600,fontSize:16,marginBottom:6}}>Geen beschikbare fietsen</div>
          <div style={{fontSize:13}}>Voeg fietsen toe via de knop hierboven</div>
        </div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:16}}>
          {locaties.map(loc => {
            const aantal = (perLocatie[loc]||[]).length;
            const kleur = aantal === 0 ? C.muted : aantal <= 1 ? "#f59e0b" : C.groen;
            return (
              <div key={loc} style={{background:"white",border:`1px solid ${C.border}`,borderTop:`4px solid ${kleur}`,borderRadius:12,padding:20,boxShadow:"0 1px 4px rgba(27,58,107,.06)"}}>
                <div style={{fontSize:13,fontWeight:700,color:C.muted,marginBottom:8,textTransform:"uppercase",letterSpacing:".5px"}}>📍 {loc}</div>
                <div style={{fontSize:48,fontWeight:900,color:kleur,lineHeight:1,marginBottom:6}}>{aantal}</div>
                <div style={{fontSize:13,color:C.muted}}>fiets{aantal!==1?"en":""} beschikbaar</div>
                {aantal <= 1 && aantal > 0 && (
                  <div style={{marginTop:8,fontSize:11,fontWeight:700,color:"#b45309",background:"#fef3c7",borderRadius:6,padding:"4px 8px",display:"inline-block"}}>⚠️ Bijna op</div>
                )}
                {aantal === 0 && (
                  <div style={{marginTop:8,fontSize:11,fontWeight:700,color:"#dc2626",background:"#fef2f2",borderRadius:6,padding:"4px 8px",display:"inline-block"}}>❌ Geen voorraad</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
