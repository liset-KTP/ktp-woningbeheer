import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { weekPlusN, getWeekNr } from "./BorgModule";

const C = {
  blauw:"#1B3A6B", blauwDark:"#132b52",
  groen:"#4A9B3C", groenDark:"#357a2b",
  bg:"#f0f4f8", card:"#ffffff", border:"#d1dbe8",
  text:"#1a2b47", muted:"#6b7a8d",
};

function todayISO() { return new Date().toISOString().slice(0,10); }

// Splitst een totaalbedrag op in wekelijkse termijnen van max €50, met een kortere laatste
// week voor het restant. Voorkomt dat een afwijkend (hoger) verkoopbedrag ooit tot een
// verdubbelde weekinhouding leidt — zie de handmatige borg_correctie-fixes (Fischer,
// Cosmin Dan, Gladkowski) die dit tot nu toe steeds achteraf via SQL moesten rechttrekken.
function genereerTermijnBedragen(totaal) {
  const bedragen = [];
  let rest = Math.round(Number(totaal) * 100) / 100;
  while (rest > 0.001) {
    const deel = rest > 50 ? 50 : rest;
    bedragen.push(Math.round(deel * 100) / 100);
    rest = Math.round((rest - deel) * 100) / 100;
  }
  return bedragen.length ? bedragen : [Number(totaal)];
}

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
  const [uitgifte, setUitgifte] = useState({ locatie:"", naam_medewerker:"", nieuweNaam:"", verkoopbedrag:"" });
  const [actievePlannen, setActievePlannen] = useState([]);
  const [nieuweLocatie, setNieuweLocatie] = useState("");
  const [saving, setSaving] = useState(false);

  const isBackoffice = gebruiker?.rol === "backoffice" || gebruiker?.rol === "huismeester";

  const loadFietsen = useCallback(async () => {
    const { data } = await supabase.from("fietsen").select("*").eq("status","Beschikbaar").order("naam_medewerker");
    setFietsen(data || []);
  }, []);

  // Bestaande actieve borgplannen — gebruikt om bij fietsuitgifte een medewerker te KIEZEN
  // i.p.v. de naam vrij te typen. Voorkomt de terugkerende bug waarbij een afwijkende
  // naaminvoer (spatie, of extra tekst zoals "(125 euro verkoop)") de bestaand-plan-lookup
  // mist en een dubbel, losstaand borgplan aanmaakt (zie borg_correctie-log).
  const loadActievePlannen = useCallback(async () => {
    const { data } = await supabase.from("borg_plannen").select("naam_medewerker").eq("status","actief").order("naam_medewerker");
    setActievePlannen(Array.from(new Set((data || []).map(p => p.naam_medewerker).filter(Boolean))));
  }, []);

  useEffect(() => {
    async function init() { setLoading(true); await Promise.all([loadFietsen(), loadActievePlannen()]); setLoading(false); }
    init();
    const s = supabase.channel("fie2-rt").on("postgres_changes",{event:"*",schema:"public",table:"fietsen"},()=>loadFietsen()).subscribe();
    return () => supabase.removeChannel(s);
  }, [loadFietsen, loadActievePlannen]);

  // Ververs de medewerkerslijst elke keer als het uitgifteformulier wordt geopend,
  // zodat net aangemaakte borgplannen ook meteen kiesbaar zijn.
  useEffect(() => { if (toonUitgifte) loadActievePlannen(); }, [toonUitgifte, loadActievePlannen]);

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

    const isNieuw = uitgifte.naam_medewerker === "__nieuw__";
    const naam = (isNieuw ? uitgifte.nieuweNaam : uitgifte.naam_medewerker).trim();
    if (!naam) { showToast(isNieuw ? "Vul de naam van de nieuwe medewerker in" : "Selecteer een medewerker","err"); return; }

    // FIX 2026-09-16: verkoopbedrag is nu een los, expliciet veld i.p.v. tekst-in-de-naam
    // (zoals "Naam (125 euro verkoop)") — dat laatste veroorzaakte zowel gemiste borgplan-
    // matches als een borg die altijd op het hardcoded standaardbedrag €100 bleef staan.
    const bedragRuw = uitgifte.verkoopbedrag.trim().replace(",", ".");
    const bedrag = bedragRuw ? Number(bedragRuw) : 100;
    if (!Number.isFinite(bedrag) || bedrag <= 0) { showToast("Ongeldig verkoopbedrag","err"); return; }

    const beschikbaar = perLocatie[uitgifte.locatie] || [];
    if (beschikbaar.length === 0) { showToast("Geen fiets beschikbaar op die locatie","err"); return; }

    setSaving(true);
    const fiets = beschikbaar[0]; // pak eerste beschikbare fiets van die locatie

    // 1. Markeer fiets als verkocht (verdwijnt uit overzicht)
    await supabase.from("fietsen").update({ status:"Verkocht", naam_medewerker: naam, datum_uitgifte: todayISO() }).eq("id", fiets.id);

    // 2. Log in activiteiten (verschijnt in global Log)
    await supabase.from("activiteiten").insert([{
      type: "fiets_uitgifte",
      omschrijving: `🚲 Fiets uitgegeven aan ${naam} — locatie: ${uitgifte.locatie}${bedrag !== 100 ? ` (verkoopprijs €${bedrag})` : ""}`,
      gedaan_door: gebruiker?.naam || "?",
      extra: { naam, locatie: uitgifte.locatie, fiets_id: fiets.id, verkoopbedrag: bedrag },
    }]);

    // 3. Borg aanmaken of toevoegen — naam komt nu ALTIJD uit de dropdown (exacte match met
    // een bestaand plan) of is expliciet als "nieuwe medewerker" gemarkeerd, dus deze lookup
    // kan niet meer stilzwijgend mismatchen op vrije tekst.
    const { data: bestaandPlan } = await supabase.from("borg_plannen")
      .select("id,heeft_fiets,totaal_borg").eq("naam_medewerker", naam).eq("status","actief").limit(1);

    const deelbedragen = genereerTermijnBedragen(bedrag); // max €50/week, kortere laatste week voor het restant
    let toastBorg = "borg aangemaakt";

    if (!bestaandPlan || bestaandPlan.length === 0) {
      const nu = new Date();
      const start = weekPlusN(getWeekNr(nu), nu.getFullYear(), 1);
      const { data: plan } = await supabase.from("borg_plannen").insert([{
        naam_medewerker: naam, sleutels:0, heeft_fiets:true,
        totaal_borg: bedrag, ingehouden:0, status:"actief",
        aangemaakt_door: gebruiker?.naam || "?", aankomst_datum: todayISO(),
      }]).select().single();
      if (plan) {
        const termijnen = deelbedragen.map((deel, i) => {
          const wk = weekPlusN(start.week, start.jaar, i);
          return { plan_id:plan.id, naam_medewerker:naam, week_nummer:wk.week, jaar:wk.jaar, bedrag:deel, type:"inhouden", omschrijving:`Borg fiets (week ${i+1}/${deelbedragen.length})`, status:"open" };
        });
        await supabase.from("borg_termijnen").insert(termijnen);
      }
    } else {
      const plan = bestaandPlan[0];
      if (!plan.heeft_fiets) {
        const nu = new Date();
        let start = weekPlusN(getWeekNr(nu), nu.getFullYear(), 1);
        // Plan fiets-termijnen ná de laatste bestaande termijn (voorkomt unieke-week-conflict → stille fout)
        const { data: laatste } = await supabase.from("borg_termijnen")
          .select("week_nummer,jaar").eq("plan_id",plan.id)
          .order("jaar",{ascending:false}).order("week_nummer",{ascending:false}).limit(1);
        if (laatste && laatste.length > 0) {
          const na = weekPlusN(laatste[0].week_nummer, laatste[0].jaar, 1);
          if (na.jaar > start.jaar || (na.jaar === start.jaar && na.week > start.week)) start = na;
        }
        const termijnen = deelbedragen.map((deel, i) => {
          const wk = weekPlusN(start.week, start.jaar, i);
          return { plan_id:plan.id, naam_medewerker:naam, week_nummer:wk.week, jaar:wk.jaar, bedrag:deel, type:"inhouden", omschrijving:`Borg sleutel + fiets (week ${i+1}/${deelbedragen.length})`, status:"open" };
        });
        const { error: termijnFout } = await supabase.from("borg_termijnen").insert(termijnen);
        if (termijnFout) {
          toastBorg = "LET OP: fiets-borgtermijnen niet aangemaakt — borgtotaal NIET opgehoogd, controleer handmatig";
        } else {
          const nieuwTotaal = Number(plan.totaal_borg) + bedrag;
          await supabase.from("borg_plannen").update({ heeft_fiets:true, totaal_borg: nieuwTotaal }).eq("id", plan.id);
          toastBorg = `borg opgehoogd naar €${nieuwTotaal.toFixed(0)}`;
        }
      } else {
        // Medewerker had al een fietsborg op dit plan (tweede fiets?) — niet stilzwijgend negeren,
        // want dat verborg voorheen precies dit soort gevallen. Handmatig checken in "Alle plannen".
        toastBorg = "LET OP: had al een fietsborg op dit plan — borg NIET aangepast, controleer handmatig";
      }
    }

    setSaving(false);
    showToast(`✓ Fiets uitgegeven aan ${naam} — ${toastBorg}, gelogd`);
    setToonUitgifte(false);
    setUitgifte({ locatie:"", naam_medewerker:"", nieuweNaam:"", verkoopbedrag:"" });
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
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
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
              <select value={uitgifte.naam_medewerker} onChange={e=>setUitgifte(p=>({...p,naam_medewerker:e.target.value}))}
                style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:uitgifte.naam_medewerker?C.text:C.muted,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",appearance:"none"}}>
                <option value="">Selecteer bestaande medewerker...</option>
                {actievePlannen.map(n => <option key={n} value={n}>{n}</option>)}
                <option value="__nieuw__">+ Nieuwe naam (nog geen borgplan)</option>
              </select>
              {uitgifte.naam_medewerker === "__nieuw__" && (
                <div style={{marginTop:8}}>
                  <Input value={uitgifte.nieuweNaam} onChange={e=>setUitgifte(p=>({...p,nieuweNaam:e.target.value}))} placeholder="Exacte voor- en achternaam" autoFocus/>
                  <div style={{fontSize:11,color:C.muted,marginTop:4}}>⚠️ Typ de naam exact zoals die straks bij aankomst/borgplan gebruikt wordt — anders ontstaat opnieuw een dubbel borgplan.</div>
                </div>
              )}
            </div>
          </div>
          <div style={{maxWidth:260,marginBottom:16}}>
            <Label>Afwijkend verkoopbedrag</Label>
            <Input type="number" min="1" step="1" value={uitgifte.verkoopbedrag} onChange={e=>setUitgifte(p=>({...p,verkoopbedrag:e.target.value}))} placeholder="leeg = standaard €100"/>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <button onClick={geefFietsUit} disabled={saving||!uitgifte.locatie||!uitgifte.naam_medewerker||(uitgifte.naam_medewerker==="__nieuw__"&&!uitgifte.nieuweNaam.trim())}
              style={{background:saving||!uitgifte.locatie||!uitgifte.naam_medewerker||(uitgifte.naam_medewerker==="__nieuw__"&&!uitgifte.nieuweNaam.trim())?"#ccc":C.groen,color:"white",border:"none",borderRadius:8,padding:"11px 24px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {saving?"⏳ Bezig...":"✓ Fiets uitgeven"}
            </button>
            <span style={{fontSize:12,color:C.muted}}>Fiets wordt gelogd + borg automatisch aangemaakt/opgehoogd</span>
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
