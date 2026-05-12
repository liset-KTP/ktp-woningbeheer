import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { BijlageUploader, BijlageWeergave, uploadBijlages } from "./BijlageUploader";

const C = {
  blauw:"#1B3A6B", blauwLight:"#2a52a0",
  groen:"#4A9B3C", groenDark:"#357a2b",
  bg:"#f0f4f8", border:"#d1dbe8",
  text:"#1a2b47", muted:"#6b7a8d",
  rood:"#ef4444", oranje:"#f59e0b",
};

const EMAILJS_SERVICE  = "service_1af258e";
const EMAILJS_TEMPLATE = "template_2mjnbok";
const EMAILJS_PUBLIC   = "CJEVdAOdA03ZQxE28";

async function stuurMail(params) {
  try {
    await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_id: EMAILJS_SERVICE, template_id: EMAILJS_TEMPLATE, user_id: EMAILJS_PUBLIC, template_params: params }),
    });
  } catch(e) { console.error(e); }
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("nl-NL", { day:"2-digit", month:"2-digit", year:"numeric" });
}

function getWeekNr(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function getMaandagVanWeek(week, jaar) {
  const d = new Date(jaar, 0, 1 + (week - 1) * 7);
  const dow = d.getDay();
  const diff = dow <= 4 ? 1 - dow : 8 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}

// Bereken borgplan op basis van sleutels en fiets
function berekenBorgPlan(sleutels, heeftFiets) {
  const termijnen = [];

  // Sleutels
  if (sleutels === 1) {
    termijnen.push({ omschrijving: "Borg sleutel (week 1/2)", bedrag: 50 });
    termijnen.push({ omschrijving: "Borg sleutel (week 2/2)", bedrag: 50 });
  } else if (sleutels === 2) {
    termijnen.push({ omschrijving: "Borg sleutels (week 1/4)", bedrag: 50 });
    termijnen.push({ omschrijving: "Borg sleutels (week 2/4)", bedrag: 50 });
    termijnen.push({ omschrijving: "Borg sleutels (week 3/4)", bedrag: 50 });
    termijnen.push({ omschrijving: "Borg sleutels (week 4/4)", bedrag: 30 });
  }

  // Fiets
  if (heeftFiets) {
    termijnen.push({ omschrijving: "Borg fiets (week 1/2)", bedrag: 50 });
    termijnen.push({ omschrijving: "Borg fiets (week 2/2)", bedrag: 50 });
  }

  const totaal = termijnen.reduce((s, t) => s + t.bedrag, 0);
  return { termijnen, totaal };
}

export function BorgModule({ gebruiker, houses, showToast, readonly = false }) {
  const [plannen, setPlannen] = useState([]);
  const [termijnen, setTermijnen] = useState([]);
  const [extras, setExtras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState("week");
  const [toonNieuw, setToonNieuw] = useState(false);
  const [toonLosseInhouding, setToonLosseInhouding] = useState(false);

  const isBackoffice = gebruiker?.rol === "backoffice" && !readonly;

  const loadAll = useCallback(async () => {
    const [p, t, e] = await Promise.all([
      supabase.from("borg_plannen").select("*").order("created_at", { ascending: false }),
      supabase.from("borg_termijnen").select("*").order("jaar").order("week_nummer"),
      supabase.from("borg_extra").select("*").order("created_at", { ascending: false }),
    ]);
    setPlannen(p.data || []);
    setTermijnen(t.data || []);
    setExtras(e.data || []);
  }, []);

  useEffect(() => {
    async function init() { setLoading(true); await loadAll(); setLoading(false); }
    init();
  }, [loadAll]);

  useEffect(() => {
    const kanalen = ["borg_plannen","borg_termijnen","borg_extra"].map((tbl, i) =>
      supabase.channel(`borg-${i}`).on("postgres_changes",{event:"*",schema:"public",table:tbl},loadAll).subscribe()
    );
    return () => kanalen.forEach(k => supabase.removeChannel(k));
  }, [loadAll]);

  async function maakPlanAan(data) {
    const { termijnen: t, totaal } = berekenBorgPlan(data.sleutels, data.heeft_fiets);
    const nu = new Date();
    const startWeek = getWeekNr(nu) + 1; // Volgende week
    const startJaar = nu.getFullYear();

    // Plan aanmaken
    const { data: plan, error } = await supabase.from("borg_plannen").insert([{
      naam_medewerker: data.naam_medewerker,
      woning_id: data.woning_id || null,
      kamer: data.kamer || null,
      aankomst_datum: data.aankomst_datum || null,
      sleutels: data.sleutels,
      heeft_fiets: data.heeft_fiets,
      totaal_borg: totaal,
      ingehouden: 0,
      status: "actief",
      aangemaakt_door: gebruiker.naam,
    }]).select().single();

    if (error) { showToast("Fout bij aanmaken borgplan", "err"); return false; }

    // Termijnen aanmaken
    const termijnRows = t.map((term, i) => {
      let week = startWeek + i;
      let jaar = startJaar;
      if (week > 52) { week -= 52; jaar++; }
      return {
        plan_id: plan.id,
        naam_medewerker: data.naam_medewerker,
        week_nummer: week,
        jaar,
        bedrag: term.bedrag,
        type: "inhouden",
        omschrijving: term.omschrijving,
        status: "open",
      };
    });

    await supabase.from("borg_termijnen").insert(termijnRows);
    showToast(`✓ Borgplan aangemaakt — €${totaal} in ${t.length} termijnen`);
    await loadAll();
    return true;
  }

  async function verwerkTermijn(id, opmerking) {
    await supabase.from("borg_termijnen").update({
      status: "verwerkt",
      verwerkt_door: gebruiker.naam,
      verwerkt_op: new Date().toISOString(),
      opmerking: opmerking || null,
    }).eq("id", id);

    // Ingehouden bedrag bijwerken op plan
    const termijn = termijnen.find(t => t.id === id);
    if (termijn) {
      const plan = plannen.find(p => p.id === termijn.plan_id);
      if (plan) {
        const nieuwIngehouden = Number(plan.ingehouden) + Number(termijn.bedrag);
        await supabase.from("borg_plannen").update({ ingehouden: nieuwIngehouden }).eq("id", plan.id);
      }
    }
    showToast("✓ Verwerkt");
    await loadAll();
  }

  async function voegExtraToe(planId, omschrijving, bedrag, type, bijlageUrl = null) {
    const plan = plannen.find(p => p.id === planId);
    const isAlIngehouden = type === "al_ingehouden";
    await supabase.from("borg_extra").insert([{
      plan_id: planId,
      naam_medewerker: plan?.naam_medewerker || "—",
      omschrijving,
      bedrag: Number(bedrag),
      type,
      bijlage_url: bijlageUrl || null,
      status: isAlIngehouden ? "verwerkt" : "open",
      verwerkt_door: isAlIngehouden ? gebruiker.naam : null,
      verwerkt_op: isAlIngehouden ? new Date().toISOString() : null,
    }]);
    showToast("✓ Extra post toegevoegd");
    await loadAll();
  }

  async function verwerkExtra(id) {
    await supabase.from("borg_extra").update({
      status: "verwerkt",
      verwerkt_door: gebruiker.naam,
      verwerkt_op: new Date().toISOString(),
    }).eq("id", id);
    showToast("✓ Verwerkt");
    await loadAll();
  }

  async function zetTermijnTerug(id) {
    const termijn = termijnen.find(t => t.id === id);
    if (!termijn) return;
    const plan = plannen.find(p => p.id === termijn.plan_id);
    await supabase.from("borg_termijnen").update({
      status: "open",
      verwerkt_door: null,
      verwerkt_op: null,
      opmerking: null,
    }).eq("id", id);
    // Trek bedrag terug van ingehouden
    if (plan) {
      const nieuwIngehouden = Math.max(0, Number(plan.ingehouden) - Number(termijn.bedrag));
      await supabase.from("borg_plannen").update({ ingehouden: nieuwIngehouden }).eq("id", plan.id);
    }
    showToast("↩ Termijn teruggezet naar open");
    await loadAll();
  }

  async function wijzigTermijn(id, nieuwBedrag, nieuwWeek, nieuwJaar) {
    await supabase.from("borg_termijnen").update({
      bedrag: Number(nieuwBedrag),
      week_nummer: Number(nieuwWeek),
      jaar: Number(nieuwJaar),
    }).eq("id", id);
    showToast("✓ Termijn bijgewerkt");
    await loadAll();
  }

  async function schuifWeekOp(planId) {
    // Verschuif alle open termijnen 1 week later
    const planTermijnen = termijnen.filter(t => t.plan_id === planId && t.status === "open");
    for (const term of planTermijnen) {
      let nieuwWeek = term.week_nummer + 1;
      let nieuwJaar = term.jaar;
      if (nieuwWeek > 52) { nieuwWeek = 1; nieuwJaar++; }
      await supabase.from("borg_termijnen").update({
        week_nummer: nieuwWeek,
        jaar: nieuwJaar,
      }).eq("id", term.id);
    }
    showToast("✓ Alle termijnen 1 week opgeschoven");
    await loadAll();
  }

  async function archiveerPlan(planId, reden) {
    await supabase.from("borg_plannen").update({
      status: "afgesloten",
      opmerkingen: `[Gearchiveerd door ${gebruiker.naam} op ${new Date().toLocaleDateString("nl-NL")}] ${reden}`,
    }).eq("id", planId);
    showToast("✓ Borgplan gearchiveerd");
    await loadAll();
  }

  async function sluitPlanAf(planId, terugbetalen) {
    await supabase.from("borg_plannen").update({
      status: terugbetalen ? "terugbetaald" : "afgesloten",
      vertrek_datum: new Date().toISOString().slice(0,10),
    }).eq("id", planId);
    showToast(terugbetalen ? "✓ Borg terugbetaald" : "✓ Plan afgesloten");
    await loadAll();
  }

  async function voegOpmerkingToe(planId, tekst) {
    const plan = plannen.find(p => p.id === planId);
    const huidig = plan?.opmerkingen || "";
    const datum = new Date().toLocaleDateString("nl-NL");
    const nieuw = huidig ? huidig + `
[${datum} - ${gebruiker.naam}] ${tekst}` : `[${datum} - ${gebruiker.naam}] ${tekst}`;
    await supabase.from("borg_plannen").update({ opmerkingen: nieuw }).eq("id", planId);
    showToast("✓ Opmerking toegevoegd");
    await loadAll();
  }

  if (loading) return <div style={{textAlign:"center",padding:"60px",color:C.muted}}>⏳ Laden...</div>;

  const nu = new Date();
  const huidigeWeek = getWeekNr(nu);
  const huidigJaar = nu.getFullYear();

  // Open termijnen deze en volgende week
  const openTermijnen = termijnen.filter(t => t.status === "open");
  const dezeWeek = openTermijnen.filter(t => t.week_nummer === huidigeWeek && t.jaar === huidigJaar);
  const volgendeWeek = openTermijnen.filter(t => t.week_nummer === huidigeWeek + 1 && t.jaar === huidigJaar);
  const terug = extras.filter(e => e.type === "terugbetalen" && e.status === "open");

  const tabs = [
    { id:"week",      label:`📅 Deze week (${dezeWeek.length})` },
    { id:"wekenoverzicht", label:"📊 Per week overzicht" },
    { id:"plannen",   label:`👤 Alle plannen (${plannen.filter(p=>p.status==="actief").length})` },
    { id:"terug",     label:`💶 Terug te betalen (${terug.length})` },
    { id:"archief",   label:"📋 Archief" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,color:C.blauw,marginBottom:3}}>🛡️ Borgbeheer & inhoudingen</h2>
          <p style={{fontSize:13,color:C.muted}}>
            {plannen.filter(p=>p.status==="actief").length} actieve plannen ·
            {" "}€{plannen.filter(p=>p.status==="actief").reduce((s,p)=>s+Number(p.totaal_borg)-Number(p.ingehouden),0).toFixed(2)} nog in te houden ·
            {" "}{dezeWeek.length} termijnen deze week
          </p>
        </div>
        {isBackoffice && (
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{setToonLosseInhouding(true);setToonNieuw(false);}}
              style={{background:"#f59e0b",color:"white",border:"none",borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              💸 Losse inhouding
            </button>
            <button onClick={()=>{setToonNieuw(true);setToonLosseInhouding(false);}}
              style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              + Nieuw borgplan
            </button>
          </div>
        )}
      </div>

      {/* Alert: termijnen deze week */}
      {dezeWeek.length > 0 && (
        <div style={{background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:12,padding:"14px 18px",marginBottom:20}}>
          <div style={{fontWeight:700,color:"#b45309",marginBottom:4}}>
            ⚠️ Week {huidigeWeek} — {dezeWeek.length} borg termijn{dezeWeek.length>1?"en":""} te verwerken
          </div>
          <div style={{fontSize:13,color:"#b45309"}}>
            Totaal: €{dezeWeek.reduce((s,t)=>s+Number(t.bedrag),0).toFixed(2)} in te houden
          </div>
        </div>
      )}

      {/* Nieuw borgplan form */}
      {toonNieuw && isBackoffice && (
        <NieuwBorgPlan
          houses={houses}
          onSubmit={async(d)=>{ const ok=await maakPlanAan(d); if(ok) setToonNieuw(false); }}
          onAnnuleer={()=>setToonNieuw(false)}
        />
      )}

      {/* Losse inhouding form */}
      {toonLosseInhouding && isBackoffice && (
        <LosseInhoudingForm
          onSubmit={async(d) => {
            // Maak een éénmalig plan aan zonder borgberekening
            const nu = new Date();
            const jaar = nu.getFullYear();
            let week = d.week || (getWeekNr(nu) + 1);
            const { data: plan } = await supabase.from("borg_plannen").insert([{
              naam_medewerker: d.naam_medewerker,
              woning_id: null,
              sleutels: 0,
              heeft_fiets: false,
              totaal_borg: Number(d.bedrag),
              ingehouden: 0,
              status: "actief",
              aangemaakt_door: gebruiker.naam,
              opmerkingen: d.omschrijving,
              bijlage_urls: d.bijlages && d.bijlages.length > 0 ? JSON.stringify(d.bijlages) : null,
            }]).select().single();
            if (plan) {
              await supabase.from("borg_termijnen").insert([{
                plan_id: plan.id,
                naam_medewerker: d.naam_medewerker,
                week_nummer: Number(week),
                jaar: jaar,
                bedrag: Number(d.bedrag),
                type: "inhouden",
                omschrijving: d.omschrijving,
                status: "open",
              }]);
              showToast(`✓ Inhouding van €${d.bedrag} ingepland voor week ${week}`);
              await loadAll();
              setToonLosseInhouding(false);
            }
          }}
          onAnnuleer={() => setToonLosseInhouding(false)}
        />
      )}

      {/* Tabs */}
      <div style={{display:"flex",gap:6,marginBottom:24,borderBottom:`2px solid ${C.border}`}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setSubTab(t.id)}
            style={{background:"none",border:"none",padding:"10px 18px",fontSize:13,fontWeight:700,color:subTab===t.id?C.blauw:C.muted,borderBottom:subTab===t.id?`3px solid ${C.blauw}`:"3px solid transparent",marginBottom:-2,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}
      </div>

      {subTab==="wekenoverzicht" && (
        <WekenOverzicht termijnen={termijnen} plannen={plannen} isBackoffice={isBackoffice} onVerwerk={verwerkTermijn} readonly={readonly}/>
      )}
      {subTab==="week" && (
        <WeekOverzicht
          onZetTerug={zetTermijnTerug}
          dezeWeek={dezeWeek}
          volgendeWeek={volgendeWeek}
          plannen={plannen}
          huidigeWeek={huidigeWeek}
          huidigJaar={huidigJaar}
          isBackoffice={isBackoffice}
          onVerwerk={verwerkTermijn}
          gebruiker={gebruiker}
        />
      )}
      {subTab==="plannen" && (
        <PlannenOverzicht
          plannen={plannen.filter(p=>p.status==="actief")}
          termijnen={termijnen}
          extras={extras}
          houses={houses}
          isBackoffice={isBackoffice}
          onVoegExtraToe={voegExtraToe}
          onSluitAf={sluitPlanAf}
          onVerwerkExtra={verwerkExtra}
          onVerwerk={verwerkTermijn}
          onOpmerking={voegOpmerkingToe}
          onSchuifWeekOp={schuifWeekOp}
          onArchiveer={archiveerPlan}
          onZetTerug={zetTermijnTerug}
          onWijzig={wijzigTermijn}
          readonly={readonly}
          showToast={showToast}
        />
      )}
      {subTab==="terug" && (
        <TerugBetalen
          extras={terug}
          plannen={plannen}
          isBackoffice={isBackoffice}
          onVerwerk={verwerkExtra}
        />
      )}
      {subTab==="archief" && (
        <Archief plannen={plannen.filter(p=>p.status!=="actief")} termijnen={termijnen} extras={extras} houses={houses}/>
      )}
    </div>
  );
}


// ─── WEKEN OVERZICHT (alle weken in één keer) ────────────────────────────────
function WekenOverzicht({ termijnen, plannen, isBackoffice, onVerwerk, readonly }) {
  const nu = new Date();
  const huidigeWeek = getWeekNr(nu);
  const huidigJaar = nu.getFullYear();

  // Groepeer open termijnen per week
  const openTermijnen = termijnen.filter(t => t.status === "open");

  // Verzamel alle unieke weken
  const weken = [];
  const gezien = new Set();
  openTermijnen.forEach(t => {
    const key = `${t.jaar}-${t.week_nummer}`;
    if (!gezien.has(key)) { gezien.add(key); weken.push({ jaar: t.jaar, week: t.week_nummer }); }
  });
  weken.sort((a,b) => a.jaar !== b.jaar ? a.jaar - b.jaar : a.week - b.week);

  if (weken.length === 0) return (
    <div style={{textAlign:"center",padding:"60px",color:C.muted}}>
      <div style={{fontSize:36,marginBottom:8}}>🎉</div>
      <div>Geen openstaande borginhoudingen</div>
    </div>
  );

  return (
    <div>
      <div style={{marginBottom:20}}>
        <h3 style={{fontSize:16,fontWeight:800,color:C.blauw}}>📊 Borginhoudingen per week</h3>
        <p style={{fontSize:13,color:C.muted,marginTop:4}}>
          Totaal openstaand: <strong style={{color:C.oranje}}>€{openTermijnen.reduce((s,t)=>s+Number(t.bedrag),0).toFixed(2)}</strong>
          {" · "}{openTermijnen.length} termijnen · {weken.length} weken
        </p>
      </div>

      {weken.map(({jaar, week}) => {
        const weekTermijnen = openTermijnen.filter(t => t.week_nummer === week && t.jaar === jaar);
        const totaal = weekTermijnen.reduce((s,t) => s+Number(t.bedrag), 0);
        const isDezeWeek = week === huidigeWeek && jaar === huidigJaar;
        const maandag = getMaandagVanWeek(week, jaar);
        const donderdag = new Date(maandag); donderdag.setDate(maandag.getDate() + 3);

        return (
          <div key={`${jaar}-${week}`} style={{marginBottom:20}}>
            {/* Week header */}
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
              <div style={{background:isDezeWeek?C.oranje:C.blauw,color:"white",borderRadius:8,padding:"4px 14px",fontSize:12,fontWeight:700}}>
                Week {week}
              </div>
              {isDezeWeek && <span style={{fontSize:12,fontWeight:700,color:C.oranje}}>← DEZE WEEK</span>}
              <span style={{fontSize:12,color:C.muted}}>
                Ma {fmtDate(maandag)} · Do {fmtDate(donderdag)}
              </span>
              <span style={{fontSize:13,fontWeight:800,color:C.text,marginLeft:"auto"}}>
                Totaal: <span style={{color:C.oranje}}>€{totaal.toFixed(2)}</span>
              </span>
            </div>

            {/* Tabel */}
            <div style={{background:"white",border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 160px 120px 100px",padding:"8px 16px",fontSize:10,fontWeight:700,color:C.muted,letterSpacing:".6px",textTransform:"uppercase",background:C.bg,borderBottom:`1px solid ${C.border}`}}>
                <span>Medewerker</span><span>Omschrijving</span><span>Bedrag</span><span>Actie</span>
              </div>
              {weekTermijnen.map((t,i) => {
                const plan = plannen.find(p=>p.id===t.plan_id);
                return (
                  <div key={t.id} style={{display:"grid",gridTemplateColumns:"1fr 160px 120px 100px",padding:"12px 16px",fontSize:13,borderBottom:i<weekTermijnen.length-1?`1px solid ${C.border}`:"none",alignItems:"center",background:i%2===0?"white":C.bg+"40"}}>
                    <div>
                      <div style={{fontWeight:700,color:C.text}}>{t.naam_medewerker}</div>
                      {plan?.kamer && <div style={{fontSize:11,color:C.muted}}>Kamer {plan.kamer}</div>}
                    </div>
                    <span style={{fontSize:12,color:C.muted}}>{t.omschrijving}</span>
                    <span style={{fontWeight:800,color:C.oranje}}>€{Number(t.bedrag).toFixed(2)}</span>
                    {isBackoffice && !readonly ? (
                      <button onClick={()=>onVerwerk(t.id,"")}
                        style={{background:C.groen,color:"white",border:"none",borderRadius:6,padding:"5px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                        ✓ Verwerkt
                      </button>
                    ) : (
                      <span style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>Openstaand</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── WEEK OVERZICHT ───────────────────────────────────────────────────────────
function WeekOverzicht({ dezeWeek, volgendeWeek, plannen, huidigeWeek, huidigJaar, isBackoffice, onVerwerk, onZetTerug }) {
  const [opmerkingMap, setOpmerkingMap] = useState({});
  const [toonOpmerking, setToonOpmerking] = useState({});

  function TermijnRij({ t, label }) {
    const plan = plannen.find(p=>p.id===t.plan_id);
    return (
      <div style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${t.status==="verwerkt"?C.groen:C.oranje}`,borderRadius:10,padding:"14px 18px",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontWeight:700,fontSize:15,color:C.text}}>{t.naam_medewerker}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>
              {t.omschrijving} · Week {t.week_nummer}/{t.jaar}
              {plan?.kamer && ` · Kamer ${plan.kamer}`}
            </div>
            {t.opmerking && <div style={{fontSize:12,color:C.muted,fontStyle:"italic",marginTop:4}}>💬 "{t.opmerking}"</div>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:22,fontWeight:800,color:C.oranje}}>€{Number(t.bedrag).toFixed(2)}</div>
              <div style={{fontSize:11,color:C.muted}}>inhouden</div>
            </div>
            {t.status==="verwerkt" ? (
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <span style={{background:"#f0fdf4",color:C.groen,fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:20,border:"1px solid #bbf7d0"}}>✓ VERWERKT</span>
                {isBackoffice && <button onClick={()=>onZetTerug(t.id)} title="Terugzetten" style={{background:"white",border:`1px solid ${C.oranje}`,color:C.oranje,borderRadius:6,padding:"4px 8px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>↩</button>}
              </div>
            ) : isBackoffice && (
              <div>
                {toonOpmerking[t.id] ? (
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <input value={opmerkingMap[t.id]||""} onChange={e=>setOpmerkingMap(p=>({...p,[t.id]:e.target.value}))}
                      placeholder="Opmerking (optioneel)..." autoFocus
                      style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"7px 12px",fontSize:13,outline:"none",fontFamily:"inherit",width:200}}/>
                    <button onClick={()=>{ onVerwerk(t.id, opmerkingMap[t.id]); setToonOpmerking(p=>({...p,[t.id]:false})); }}
                      style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      ✓
                    </button>
                  </div>
                ) : (
                  <button onClick={()=>setToonOpmerking(p=>({...p,[t.id]:true}))}
                    style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                    ✓ Verwerkt
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Deze week */}
      <div style={{marginBottom:28}}>
        <h3 style={{fontSize:16,fontWeight:800,color:C.blauw,marginBottom:4}}>
          📅 Week {huidigeWeek} — {dezeWeek.length} termijn{dezeWeek.length!==1?"en":""}
        </h3>
        <div style={{fontSize:13,color:C.muted,marginBottom:16}}>
          Totaal in te houden: <strong style={{color:C.oranje}}>€{dezeWeek.reduce((s,t)=>s+Number(t.bedrag),0).toFixed(2)}</strong>
          {" · "}Al verwerkt: <strong style={{color:C.groen}}>€{dezeWeek.filter(t=>t.status==="verwerkt").reduce((s,t)=>s+Number(t.bedrag),0).toFixed(2)}</strong>
        </div>
        {dezeWeek.length === 0 ? (
          <div style={{textAlign:"center",padding:"40px",color:C.muted,background:"white",borderRadius:12,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:36,marginBottom:8}}>🎉</div>
            <div>Geen borginhoudingen deze week</div>
          </div>
        ) : dezeWeek.map(t => <TermijnRij key={t.id} t={t}/>)}
      </div>

      {/* Volgende week preview */}
      {volgendeWeek.length > 0 && (
        <div>
          <h3 style={{fontSize:16,fontWeight:800,color:C.muted,marginBottom:4}}>
            📅 Week {huidigeWeek+1} — preview
          </h3>
          <div style={{fontSize:13,color:C.muted,marginBottom:16}}>
            Verwacht: <strong>€{volgendeWeek.reduce((s,t)=>s+Number(t.bedrag),0).toFixed(2)}</strong>
          </div>
          {volgendeWeek.map(t => {
            const plan = plannen.find(p=>p.id===t.plan_id);
            return (
              <div key={t.id} style={{background:C.bg,border:`1px solid ${C.border}`,borderLeft:`4px solid ${C.muted}`,borderRadius:10,padding:"12px 18px",marginBottom:8,opacity:.7}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:14,color:C.text}}>{t.naam_medewerker}</div>
                    <div style={{fontSize:12,color:C.muted}}>{t.omschrijving}</div>
                  </div>
                  <div style={{fontWeight:700,fontSize:16,color:C.muted}}>€{Number(t.bedrag).toFixed(2)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── PLANNEN OVERZICHT ────────────────────────────────────────────────────────
function PlannenOverzicht({ plannen, termijnen, extras, houses, isBackoffice, onVoegExtraToe, onSluitAf, onVerwerkExtra, onVerwerk, onOpmerking, onSchuifWeekOp, onArchiveer, onZetTerug, onWijzig, readonly, showToast }) {
  return (
    <div style={{display:"grid",gap:16}}>
      {plannen.length === 0 && (
        <div style={{textAlign:"center",padding:"60px",color:C.muted}}>
          <div style={{fontSize:36,marginBottom:8}}>👤</div>
          <div>Geen actieve borgplannen</div>
        </div>
      )}
      {plannen.map(plan => (
        <PlanKaart
          key={plan.id}
          plan={plan}
          termijnen={termijnen.filter(t=>t.plan_id===plan.id)}
          extras={extras.filter(e=>e.plan_id===plan.id)}
          houses={houses}
          isBackoffice={isBackoffice}
          onVoegExtraToe={onVoegExtraToe}
          onSluitAf={onSluitAf}
          onVerwerkExtra={onVerwerkExtra}
          onVerwerk={onVerwerk}
          onOpmerking={onOpmerking}
          onSchuifWeekOp={onSchuifWeekOp}
          onArchiveer={onArchiveer}
          onZetTerug={onZetTerug}
          onWijzig={onWijzig}
          readonly={readonly}
        />
      ))}
    </div>
  );
}

function PlanKaart({ plan, termijnen, extras, houses, isBackoffice, onVoegExtraToe, onSluitAf, onVerwerkExtra, onVerwerk, onOpmerking, onSchuifWeekOp, onArchiveer, onZetTerug, onWijzig, readonly }) {
  const [toonDetails, setToonDetails] = useState(false);
  const [toonExtra, setToonExtra] = useState(false);
  const [toonOpmerkingForm, setToonOpmerkingForm] = useState(false);
  const [opmerkingTekst, setOpmerkingTekst] = useState("");
  const [extraOmschr, setExtraOmschr] = useState("");
  const [extraBedrag, setExtraBedrag] = useState("");
  const [extraType, setExtraType] = useState("inhouden");
  const [toonArchiveer, setToonArchiveer] = useState(false);
  const [archiveerReden, setArchiveerReden] = useState("");
  const [extraBijlage, setExtraBijlage] = useState(null);
  const [uploadingBijlage, setUploadingBijlage] = useState(false);
  const huis = houses.find(h=>h.id===plan.woning_id);

  const openTermijnen = termijnen.filter(t=>t.status==="open");
  const verwerktTermijnen = termijnen.filter(t=>t.status==="verwerkt");

  // Alles wat al ingehouden is (verwerkte termijnen + al_ingehouden extra posten + verwerkte inhoud extra)
  const totaalIngehouden = verwerktTermijnen.reduce((s,t)=>s+Number(t.bedrag),0)
    + extras.filter(e=>e.type==="al_ingehouden").reduce((s,e)=>s+Number(e.bedrag),0)
    + extras.filter(e=>e.type==="inhouden"&&e.status==="verwerkt").reduce((s,e)=>s+Number(e.bedrag),0);

  // Alles wat nog open staat (open termijnen + open inhoud extra posten)
  const totaalNogOpen = openTermijnen.reduce((s,t)=>s+Number(t.bedrag),0)
    + extras.filter(e=>e.type==="inhouden"&&e.status==="open").reduce((s,e)=>s+Number(e.bedrag),0);

  // Totale schuld = ingehouden + nog open
  const totaalSchuld = totaalIngehouden + totaalNogOpen;
  const nogInTehouden = totaalNogOpen;
  const pct = totaalSchuld > 0 ? Math.min(100, (totaalIngehouden/totaalSchuld)*100) : 0;

  return (
    <div style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${C.blauw}`,borderRadius:12,padding:20}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:16}}>
        <div>
          <div style={{fontWeight:800,fontSize:16,color:C.text}}>{plan.naam_medewerker}</div>
          <div style={{fontSize:12,color:C.muted,marginTop:3}}>
            {huis ? `📍 ${huis.adres}, ${huis.stad}` : ""}
            {plan.kamer ? ` · Kamer ${plan.kamer}` : ""}
            {plan.aankomst_datum ? ` · Aankomst ${fmtDate(plan.aankomst_datum)}` : ""}
          </div>
          <div style={{fontSize:12,color:C.muted,marginTop:2}}>
            🔑 {plan.sleutels} sleutel{plan.sleutels>1?"s":""}
            {plan.heeft_fiets ? " · 🚲 Fiets" : ""}
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:22,fontWeight:800,color:C.blauw}}>€{totaalSchuld.toFixed(2)}</div>
          <div style={{fontSize:11,color:C.muted}}>totale schuld</div>
          <div style={{fontSize:13,color:C.groen,fontWeight:600,marginTop:2}}>€{totaalIngehouden.toFixed(2)} ingehouden</div>
        </div>
      </div>

      {/* Voortgangsbalk */}
      <div style={{marginBottom:16}}>
        <div style={{background:C.bg,borderRadius:99,height:10,overflow:"hidden"}}>
          <div style={{height:"100%",background:pct===100?C.groen:C.blauw,borderRadius:99,width:`${pct}%`,transition:"width .5s"}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,marginTop:4}}>
          <span>{pct.toFixed(0)}% ingehouden</span>
          <span>Nog €{nogInTehouden.toFixed(2)} te gaan</span>
        </div>
      </div>

      {/* Toggle details */}
      <button onClick={()=>setToonDetails(!toonDetails)}
        style={{background:"none",border:"none",color:C.blauw,fontSize:13,cursor:"pointer",fontFamily:"inherit",padding:"4px 0",marginBottom:8,fontWeight:600}}>
        {toonDetails?"▲":"▼"} Termijnen bekijken ({termijnen.length})
      </button>

      {toonDetails && (
        <div style={{marginBottom:12}}>
          {termijnen.map(t=>(
            <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,fontSize:13}}>
              <div>
                <span style={{color:t.status==="verwerkt"?C.groen:C.muted,marginRight:8}}>{t.status==="verwerkt"?"✓":"○"}</span>
                <span style={{color:C.text}}>{t.omschrijving}</span>
                <span style={{color:C.muted,fontSize:11,marginLeft:8}}>Week {t.week_nummer}/{t.jaar}</span>
                {t.opmerking && <span style={{color:C.muted,fontStyle:"italic",marginLeft:8}}>"{t.opmerking}"</span>}
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontWeight:700,color:t.status==="verwerkt"?C.groen:C.oranje}}>€{Number(t.bedrag).toFixed(2)}</span>
                {isBackoffice && (
                  <div style={{display:"flex",gap:4}}>
                    {t.status==="open" ? (
                      <button onClick={()=>onVerwerk(t.id,"")}
                        style={{background:C.groen,color:"white",border:"none",borderRadius:6,padding:"4px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✓</button>
                    ) : (
                      <button onClick={()=>onZetTerug(t.id)}
                        title="Terugzetten naar open"
                        style={{background:"white",border:`1px solid ${C.oranje}`,color:C.oranje,borderRadius:6,padding:"4px 8px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>↩</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Extra posten */}
          {extras.length > 0 && (
            <div style={{marginTop:10}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".6px",textTransform:"uppercase",marginBottom:6}}>Extra posten</div>
              {extras.map(e=>(
                <div key={e.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`,fontSize:13}}>
                  <div>
                    <span style={{color:e.status==="verwerkt"?C.groen:C.muted,marginRight:8}}>{e.status==="verwerkt"?"✓":"○"}</span>
                    <span style={{color:C.text}}>{e.omschrijving}</span>
                    <span style={{fontSize:11,marginLeft:8,color:e.type==="terugbetalen"?C.groen:e.type==="al_ingehouden"?C.groen:e.type==="boete"?"#dc2626":e.type==="tankbon"?"#7c3aed":"#ef4444"}}>
                      {e.type==="terugbetalen"?"↩ terug":e.type==="al_ingehouden"?"✓ al ingehouden":e.type==="boete"?"🚨 boete":e.type==="tankbon"?"⛽ tankbon":"↪ inhouden"}
                    </span>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <div style={{textAlign:"right"}}>
                      <span style={{fontWeight:700,color:e.type==="terugbetalen"?C.groen:e.type==="al_ingehouden"?C.groen:C.rood}}>€{Number(e.bedrag).toFixed(2)}</span>
                      {e.bijlage_url && (
                        <div>
                          <a href={e.bijlage_url} target="_blank" rel="noopener noreferrer"
                            style={{fontSize:11,color:C.blauw,textDecoration:"none"}}>📎 bijlage</a>
                        </div>
                      )}
                    </div>
                    {e.status==="open" && isBackoffice && (
                      <button onClick={()=>onVerwerkExtra(e.id)}
                        style={{background:C.groen,color:"white",border:"none",borderRadius:6,padding:"4px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>✓</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Opmerkingen */}
      {plan.opmerkingen && (
        <div style={{background:C.bg,borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:13,color:C.muted,whiteSpace:"pre-wrap"}}>
          💬 {plan.opmerkingen}
        </div>
      )}
      {plan.bijlage_urls && <BijlageWeergave bijlages={JSON.parse(plan.bijlage_urls||"[]")}/> }

      {/* Opmerking toevoegen — voor iedereen */}
      {toonOpmerkingForm ? (
        <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginBottom:12}}>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Opmerking / vraag toevoegen</label>
          <input value={opmerkingTekst} onChange={e=>setOpmerkingTekst(e.target.value)}
            placeholder="bijv. medewerker heeft gevraagd om uitstel..."
            autoFocus
            style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box",marginBottom:10}}/>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{ if(opmerkingTekst.trim()){ onOpmerking(plan.id, opmerkingTekst.trim()); setOpmerkingTekst(""); setToonOpmerkingForm(false); }}}
              style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              ✓ Opslaan
            </button>
            <button onClick={()=>setToonOpmerkingForm(false)}
              style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"8px 12px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
              Annuleren
            </button>
          </div>
        </div>
      ) : (
        <button onClick={()=>setToonOpmerkingForm(true)}
          style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"7px 14px",fontSize:12,cursor:"pointer",fontFamily:"inherit",marginBottom:12}}>
          💬 Opmerking toevoegen
        </button>
      )}

      {/* Acties backoffice */}
      {isBackoffice && !readonly && (
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
          {!toonExtra ? (
            <button onClick={()=>setToonExtra(true)}
              style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"8px 14px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
              ➕ Extra post
            </button>
          ) : (
            <div style={{width:"100%",background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 120px 120px",gap:10,marginBottom:10}}>
                <input value={extraOmschr} onChange={e=>setExtraOmschr(e.target.value)} placeholder="Omschrijving (bijv. schade deur)"
                  style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
                <input type="number" value={extraBedrag} onChange={e=>setExtraBedrag(e.target.value)} placeholder="€ bedrag"
                  style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
                <select value={extraType} onChange={e=>setExtraType(e.target.value)}
                  style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",appearance:"none",fontFamily:"inherit"}}>
                  <option value="inhouden">↪ Inhouden</option>
                  <option value="terugbetalen">↩ Terugbetalen</option>
                  <option value="al_ingehouden">✓ Al ingehouden</option>
                  <option value="boete">🚨 Boete</option>
                  <option value="tankbon">⛽ Tankbon</option>
                </select>
              </div>
              {/* Bijlage upload */}
              <div style={{marginBottom:10}}>
                <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>BIJLAGE (optioneel)</label>
                <label style={{display:"inline-flex",alignItems:"center",gap:8,cursor:"pointer",background:C.bg,border:`1.5px dashed ${C.border}`,borderRadius:8,padding:"7px 14px",fontSize:12,color:C.muted}}>
                  📎 {extraBijlage ? extraBijlage.name : "Foto of PDF toevoegen"}
                  <input type="file" accept="image/*,.pdf" onChange={e=>setExtraBijlage(e.target.files[0]||null)} style={{display:"none"}}/>
                </label>
                {extraBijlage && <button onClick={()=>setExtraBijlage(null)} style={{marginLeft:8,background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:12}}>× verwijderen</button>}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={async()=>{
                  if(!extraOmschr || !extraBedrag) return;
                  setUploadingBijlage(true);
                  let bijlageUrl = null;
                  if (extraBijlage) {
                    const ext = extraBijlage.name.split(".").pop();
                    const pad = `borg/${Date.now()}.${ext}`;
                    const { error: upErr } = await supabase.storage.from("bijlages").upload(pad, extraBijlage);
                    if (!upErr) {
                      const { data: urlData } = supabase.storage.from("bijlages").getPublicUrl(pad);
                      bijlageUrl = urlData.publicUrl;
                    }
                  }
                  onVoegExtraToe(plan.id, extraOmschr, extraBedrag, extraType, bijlageUrl);
                  setExtraOmschr(""); setExtraBedrag(""); setExtraBijlage(null); setToonExtra(false);
                  setUploadingBijlage(false);
                }} disabled={uploadingBijlage}
                  style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  {uploadingBijlage ? "⏳ Uploaden..." : "✓ Toevoegen"}
                </button>
                <button onClick={()=>setToonExtra(false)}
                  style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"8px 12px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                  Annuleren
                </button>
              </div>
            </div>
          )}
          {/* Week opschuiven */}
          <button onClick={()=>onSchuifWeekOp(plan.id)}
            style={{background:"white",border:`1.5px solid #f59e0b`,color:"#b45309",borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            📅 Week opschuiven
          </button>

          {/* Archiveren met reden */}
          {toonArchiveer ? (
            <div style={{width:"100%",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:14,marginTop:4}}>
              <div style={{fontWeight:700,fontSize:13,color:C.rood,marginBottom:8}}>🗑 Borgplan archiveren</div>
              <input value={archiveerReden} onChange={e=>setArchiveerReden(e.target.value)}
                placeholder="Reden (bijv. test, fout ingevoerd...)" autoFocus
                style={{width:"100%",background:"white",border:"1.5px solid #fecaca",borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box",marginBottom:8}}/>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{ if(archiveerReden.trim()){ onArchiveer(plan.id, archiveerReden.trim()); setToonArchiveer(false); setArchiveerReden(""); }}}
                  style={{background:C.rood,color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                  ✓ Archiveren
                </button>
                <button onClick={()=>setToonArchiveer(false)}
                  style={{background:"white",border:"1px solid #fecaca",color:C.rood,borderRadius:8,padding:"8px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                  Annuleren
                </button>
              </div>
            </div>
          ) : (
            <button onClick={()=>setToonArchiveer(true)}
              style={{background:"white",border:`1.5px solid ${C.rood}`,color:C.rood,borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              🗑 Archiveren
            </button>
          )}

          {pct >= 100 && (
            <>
              <button onClick={()=>{ if(window.confirm(`Borg terugbetalen aan ${plan.naam_medewerker}?`)) onSluitAf(plan.id, true); }}
                style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                💶 Borg terugbetalen
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TERUG TE BETALEN ─────────────────────────────────────────────────────────
function TerugBetalen({ extras, plannen, isBackoffice, onVerwerk }) {
  if (extras.length === 0) return (
    <div style={{textAlign:"center",padding:"60px",color:C.muted}}>
      <div style={{fontSize:36,marginBottom:8}}>🎉</div>
      <div>Geen borg te retourneren</div>
    </div>
  );
  return (
    <div>
      <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:12,padding:"14px 18px",marginBottom:20}}>
        <div style={{fontWeight:700,color:C.groen}}>
          💶 {extras.length} terugbetaling{extras.length>1?"en":""} — Totaal: €{extras.reduce((s,e)=>s+Number(e.bedrag),0).toFixed(2)}
        </div>
      </div>
      {extras.map(e=>{
        const plan = plannen.find(p=>p.id===e.plan_id);
        return (
          <div key={e.id} style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${C.groen}`,borderRadius:10,padding:"16px 20px",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
              <div>
                <div style={{fontWeight:700,fontSize:15,color:C.text}}>{e.naam_medewerker}</div>
                <div style={{fontSize:13,color:C.muted,marginTop:3}}>{e.omschrijving}</div>
                {plan && <div style={{fontSize:12,color:C.muted,marginTop:2}}>Plan aangemaakt door {plan.aangemaakt_door}</div>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:16}}>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:22,fontWeight:800,color:C.groen}}>€{Number(e.bedrag).toFixed(2)}</div>
                  <div style={{fontSize:11,color:C.muted}}>terug te betalen</div>
                </div>
                {isBackoffice && (
                  <button onClick={()=>onVerwerk(e.id)}
                    style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                    ✓ Uitbetaald
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── ARCHIEF ─────────────────────────────────────────────────────────────────
function Archief({ plannen, termijnen, extras, houses }) {
  if (plannen.length === 0) return (
    <div style={{textAlign:"center",padding:"60px",color:C.muted}}>Geen afgesloten plannen</div>
  );
  return (
    <div style={{display:"grid",gap:12}}>
      {plannen.map(plan=>{
        const huis = houses.find(h=>h.id===plan.woning_id);
        const t = termijnen.filter(t=>t.plan_id===plan.id);
        return (
          <div key={plan.id} style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${plan.status==="terugbetaald"?C.groen:C.muted}`,borderRadius:10,padding:"14px 18px",opacity:.8}}>
            <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontWeight:700,fontSize:14,color:C.text}}>{plan.naam_medewerker}</div>
                <div style={{fontSize:12,color:C.muted}}>{huis?`${huis.adres}`:""}{plan.kamer?` K${plan.kamer}`:""}</div>
                <div style={{fontSize:12,color:C.muted}}>🔑 {plan.sleutels} sleutel{plan.sleutels>1?"s":""}{plan.heeft_fiets?" · 🚲 Fiets":""}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontWeight:700,color:plan.status==="terugbetaald"?C.groen:C.muted}}>
                  {plan.status==="terugbetaald"?"💶 Terugbetaald":"Afgesloten"}
                </div>
                <div style={{fontSize:12,color:C.muted}}>€{Number(plan.totaal_borg).toFixed(2)} totaal</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── LOSSE INHOUDING FORMULIER ───────────────────────────────────────────────
function LosseInhoudingForm({ onSubmit, onAnnuleer }) {
  const [naam, setNaam] = useState("");
  const [bedrag, setBedrag] = useState("");
  const [omschrijving, setOmschrijving] = useState("");
  const [bijlages, setBijlages] = useState([]);
  const [week, setWeek] = useState(() => {
    const nu = new Date();
    const j = new Date(Date.UTC(nu.getFullYear(),0,1));
    return Math.ceil((((nu-j)/86400000)+j.getDay()+1)/7) + 1;
  });
  const [jaar] = useState(new Date().getFullYear());
  const [saving, setSaving] = useState(false);

  const maandag = getMaandagVanWeek(week, jaar);
  const donderdag = new Date(maandag); donderdag.setDate(maandag.getDate() + 3);

  async function handleSubmit() {
    if (!naam.trim()) { alert("Vul naam in"); return; }
    if (!bedrag || Number(bedrag) <= 0) { alert("Vul een geldig bedrag in"); return; }
    if (!omschrijving.trim()) { alert("Vul een omschrijving in"); return; }
    setSaving(true);
    let bijlageUrls = [];
    if (bijlages.length > 0) {
      bijlageUrls = await uploadBijlages(bijlages, "inhoudingen");
    }
    await onSubmit({ naam_medewerker: naam.trim(), bedrag, omschrijving: omschrijving.trim(), week, bijlages: bijlageUrls });
    setSaving(false);
  }

  return (
    <div style={{background:"white",border:"2px solid #f59e0b",borderRadius:12,padding:20,marginBottom:20}}>
      <div style={{fontWeight:800,fontSize:15,color:"#b45309",marginBottom:4}}>💸 Losse inhouding toevoegen</div>
      <div style={{fontSize:13,color:"#b45309",marginBottom:16}}>Voor eenmalige inhoudingen zonder borgplan — bijv. boete, schade, terugvordering.</div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
        <div>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Naam medewerker *</label>
          <input value={naam} onChange={e=>setNaam(e.target.value)} placeholder="Voor- en achternaam" autoFocus
            style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
        <div>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Bedrag (€) *</label>
          <input type="number" step="0.01" min="0.01" value={bedrag} onChange={e=>setBedrag(e.target.value)} placeholder="bijv. 75.00"
            style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
        <div style={{gridColumn:"1/-1"}}>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Omschrijving / reden *</label>
          <input value={omschrijving} onChange={e=>setOmschrijving(e.target.value)} placeholder="bijv. Boete te laat, schade kamer, terugvordering..."
            style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
        <div style={{gridColumn:"1/-1"}}>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Inhouden in week</label>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={()=>setWeek(w=>Math.max(1,w-1))}
              style={{background:C.bg,border:`1.5px solid ${C.border}`,borderRadius:8,padding:"8px 14px",fontSize:16,cursor:"pointer",fontFamily:"inherit"}}>‹</button>
            <div style={{textAlign:"center",flex:1}}>
              <div style={{fontWeight:800,fontSize:18,color:"#b45309"}}>Week {week}</div>
              <div style={{fontSize:12,color:C.muted}}>Ma {fmtDate(maandag)} · Do {fmtDate(donderdag)}</div>
            </div>
            <button onClick={()=>setWeek(w=>Math.min(52,w+1))}
              style={{background:C.bg,border:`1.5px solid ${C.border}`,borderRadius:8,padding:"8px 14px",fontSize:16,cursor:"pointer",fontFamily:"inherit"}}>›</button>
          </div>
        </div>
      </div>

      <div style={{marginBottom:14}}>
        <BijlageUploader
          bestanden={bijlages}
          setBestanden={setBijlages}
          label="📎 Bijlage toevoegen (factuur, bon, foto)"
        />
      </div>

      {naam && bedrag && omschrijving && (
        <div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:10,padding:"12px 16px",marginBottom:14,fontSize:13,color:"#b45309"}}>
          💸 <strong>{naam}</strong> — €{bedrag} inhouden in week {week} voor: {omschrijving}
          {bijlages.length > 0 && <span style={{marginLeft:8}}>· 📎 {bijlages.length} bijlage{bijlages.length>1?"s":""}</span>}
        </div>
      )}

      <div style={{display:"flex",gap:10}}>
        <button onClick={handleSubmit} disabled={saving||!naam.trim()||!bedrag||!omschrijving.trim()}
          style={{background:saving||!naam.trim()||!bedrag||!omschrijving.trim()?"#d1d5db":"#f59e0b",color:"white",border:"none",borderRadius:8,padding:"11px 24px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
          {saving?"⏳ Opslaan...":"💸 Inhouding inplannen"}
        </button>
        <button onClick={onAnnuleer}
          style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"11px 18px",fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>
          Annuleren
        </button>
      </div>
    </div>
  );
}

// ─── NIEUW BORGPLAN FORMULIER ─────────────────────────────────────────────────
function NieuwBorgPlan({ houses, onSubmit, onAnnuleer }) {
  const [naam, setNaam] = useState("");
  const [woningId, setWoningId] = useState("");
  const [kamer, setKamer] = useState("");
  const [aankomst, setAankomst] = useState("");
  const [sleutels, setSleutels] = useState(null);
  const [heeftFiets, setHeeftFiets] = useState(false);
  const [saving, setSaving] = useState(false);

  const { termijnen, totaal } = berekenBorgPlan(sleutels, heeftFiets);
  const geselecteerdeHuis = houses.find(h=>h.id===Number(woningId));

  async function handleSubmit() {
    if (!naam.trim()) return;
    if (sleutels === null && !heeftFiets) { alert("Selecteer minimaal 1 sleutel of fiets"); return; }
    setSaving(true);
    await onSubmit({ naam_medewerker: naam.trim(), woning_id: woningId ? Number(woningId) : null, kamer, aankomst_datum: aankomst || null, sleutels: sleutels !== null ? Number(sleutels) : 0, heeft_fiets: heeftFiets });
    setSaving(false);
  }

  return (
    <div style={{background:"white",border:`2px solid ${C.blauw}`,borderRadius:12,padding:20,marginBottom:20}}>
      <div style={{fontWeight:800,fontSize:15,color:C.blauw,marginBottom:16}}>🔐 Nieuw borgplan aanmaken</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
        <div>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Naam medewerker *</label>
          <input value={naam} onChange={e=>setNaam(e.target.value)} placeholder="Voor- en achternaam"
            style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
        <div>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Aankomstdatum</label>
          <input type="date" value={aankomst} onChange={e=>setAankomst(e.target.value)}
            style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
        <div>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Woning</label>
          <select value={woningId} onChange={e=>setWoningId(e.target.value)}
            style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",appearance:"none",fontFamily:"inherit"}}>
            <option value="">Selecteer woning</option>
            {houses.map(h=><option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
          </select>
        </div>
        <div>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Kamer</label>
          <select value={kamer} onChange={e=>setKamer(e.target.value)}
            style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",appearance:"none",fontFamily:"inherit"}}>
            <option value="">Selecteer kamer</option>
            {(geselecteerdeHuis?.kamers||[]).map(k=><option key={k.k} value={k.k}>Kamer {k.k}{k.naam?` — ${k.naam}`:""}</option>)}
          </select>
        </div>
      </div>

      {/* Sleutels + fiets */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
        <div>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:8,display:"block"}}>Aantal sleutels</label>
          <div style={{display:"flex",gap:8}}>
            {[[0,"Geen","🚫","€0"],[1,"1 sleutel","🔑","€100"],[2,"2 sleutels","🔑🔑","€180"]].map(([n,l,icon,prijs])=>(
              <div key={n} onClick={()=>setSleutels(n)}
                style={{flex:1,border:`2px solid ${sleutels===n?C.blauw:C.border}`,borderRadius:10,padding:"12px",textAlign:"center",cursor:"pointer",background:sleutels===n?C.blauw+"10":"white"}}>
                <div style={{fontSize:20,marginBottom:4}}>{icon}</div>
                <div style={{fontWeight:700,fontSize:13,color:sleutels===n?C.blauw:C.muted}}>{l}</div>
                <div style={{fontSize:11,color:C.muted}}>{prijs}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:8,display:"block"}}>Fiets</label>
          <div onClick={()=>setHeeftFiets(!heeftFiets)}
            style={{border:`2px solid ${heeftFiets?C.groen:C.border}`,borderRadius:10,padding:"12px",textAlign:"center",cursor:"pointer",background:heeftFiets?C.groen+"10":"white"}}>
            <div style={{fontSize:20,marginBottom:4}}>🚲</div>
            <div style={{fontWeight:700,fontSize:13,color:heeftFiets?C.groen:C.muted}}>{heeftFiets?"Ja, heeft fiets":"Geen fiets"}</div>
            {heeftFiets && <div style={{fontSize:11,color:C.muted}}>+€100</div>}
          </div>
        </div>
      </div>

      {/* Preview */}
      <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,padding:14,marginBottom:16}}>
        <div style={{fontWeight:700,color:C.blauw,marginBottom:8}}>📋 Borgplan overzicht</div>
        {termijnen.map((t,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"4px 0",borderBottom:i<termijnen.length-1?`1px solid ${C.border}`:"none"}}>
            <span style={{color:C.text}}>Week {i+2} — {t.omschrijving}</span>
            <span style={{fontWeight:700,color:C.blauw}}>€{t.bedrag}</span>
          </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",fontSize:14,fontWeight:800,color:C.blauw,marginTop:10,paddingTop:8,borderTop:`2px solid ${C.blauw}`}}>
          <span>Totaal</span>
          <span>€{totaal}</span>
        </div>
      </div>

      <div style={{display:"flex",gap:10}}>
        <button onClick={handleSubmit} disabled={saving||!naam.trim()}
          style={{background:saving||!naam.trim()?C.border:C.blauw,color:"white",border:"none",borderRadius:8,padding:"11px 24px",fontSize:14,fontWeight:700,cursor:saving||!naam.trim()?"not-allowed":"pointer",fontFamily:"inherit"}}>
          {saving?"⏳ Aanmaken...":"✓ Borgplan aanmaken"}
        </button>
        <button onClick={onAnnuleer}
          style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"11px 18px",fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>
          Annuleren
        </button>
      </div>
    </div>
  );
}
