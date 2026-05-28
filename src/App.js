import { useState, useEffect, useCallback, useMemo, Component } from "react";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:40,fontFamily:"monospace",background:"#fff0f0",minHeight:"100vh"}}>
          <h2 style={{color:"#dc2626"}}>App fout gevonden:</h2>
          <pre style={{background:"#fee2e2",padding:20,borderRadius:8,overflow:"auto",fontSize:13,color:"#7f1d1d"}}>
            {this.state.error.toString() + "\n\n" + (this.state.error.stack || "")}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
import { supabase } from "./supabaseClient";
import { t as vertaal, TALEN } from "./translations";
import { AutoModule } from "./AutoModule";
import { FietsModule } from "./FietsModule";
import { HuurbetalingenModule } from "./HuurbetalingenModule";
import { BijlageUploader, BijlageWeergave, uploadBijlages } from "./BijlageUploader";
import { BerichtenModule } from "./BerichtenModule";
import { BorgModule } from "./BorgModule";
import { HandleidingModule } from "./HandleidingModule";

// ─── EMAILJS ──────────────────────────────────────────────────────────────────
const EMAILJS_SERVICE  = "service_1af258e";
const EMAILJS_TEMPLATE = "template_2mjnbok";
const EMAILJS_PUBLIC   = "CJEVdAOdA03ZQxE28";

async function stuurMail(params) {
  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id:  EMAILJS_SERVICE,
        template_id: EMAILJS_TEMPLATE,
        user_id:     EMAILJS_PUBLIC,
        template_params: params,
      }),
    });
    if (!res.ok) console.error("EmailJS fout:", await res.text());
  } catch (e) {
    console.error("EmailJS fout:", e);
  }
}

// ─── KLEUREN HUISSTIJL ────────────────────────────────────────────────────────
const C = {
  blauw:     "#1B3A6B", blauwDark: "#132b52", blauwLight:"#2a52a0",
  groen:     "#4A9B3C", groenDark: "#357a2b", groenLight:"#5cb84d",
  bg:        "#f0f4f8", card: "#ffffff", border: "#d1dbe8",
  text:      "#1a2b47", muted: "#6b7a8d", dark: "#0d1f3c",
};

// Gebruikers komen uit Supabase — geen localStorage meer

// ─── STATUS KLEUREN ───────────────────────────────────────────────────────────
const STATUS_MAP = {
  "Lopend":            { bg:"#4A9B3C18", text:"#357a2b", dot:"#4A9B3C" },
  "Beschikbaar":       { bg:"#1B3A6B18", text:"#1B3A6B", dot:"#2a52a0" },
  "Gereserveerd":      { bg:"#f59e0b18", text:"#b45309", dot:"#f59e0b" },
  "Controle":          { bg:"#ef444418", text:"#b91c1c", dot:"#ef4444" },
  "Niet beschikbaar":  { bg:"#8b5cf618", text:"#6d28d9", dot:"#8b5cf6" },
  "Moet aan het werk": { bg:"#f9731618", text:"#c2410c", dot:"#f97316" },
  "Vertrokken":        { bg:"#71717a18", text:"#3f3f46", dot:"#71717a" },
};
const STATUSSEN = Object.keys(STATUS_MAP);

// ─── CHECKLIST FALLBACK (worden geladen uit Supabase) ────────────────────────
// Items worden dynamisch geladen — hier alleen lege arrays als fallback
const CHECKLIST_WEKELIJKS_FB = [];
const CHECKLIST_4WEKELIJKS_FB = [];
const CHECKLIST_KWARTAAL_FB = [];

// ─── DAGINDELING HUISMEESTER ──────────────────────────────────────────────────
const DAGPLANNING = {
  ma: { label: "Maandag", kleur: C.blauw,    icon: "🔍", focus: "Kamers controleren & meldingen verwerken", taken: ["Openstaande meldingen doornemen in de app", "Vertrokken kamers controleren en vrijgeven", "Schade of problemen documenteren via de app", "Planning week doornemen"] },
  di: { label: "Dinsdag", kleur: "#7c3aed",  icon: "🔧", focus: "Kleine klusjes – Noord omgeving", taken: ["Lamp vervangen indien gemeld", "Rookmelders controleren", "Kleine reparaties afhandelen", "Woningen: Coevorden, De Krim, Rijssen"] },
  wo: { label: "Woensdag", kleur: C.groen,   icon: "🔧", focus: "Kleine klusjes – Midden omgeving", taken: ["Lamp vervangen indien gemeld", "Lekkages/vocht controleren", "Kleine reparaties afhandelen", "Woningen: Goor, Rijssen"] },
  do: { label: "Donderdag", kleur: "#f59e0b", icon: "🔧", focus: "Kleine klusjes – Zuid omgeving", taken: ["Lamp vervangen indien gemeld", "Sloten en deuren controleren", "Kleine reparaties afhandelen", "Woningen: Almelo, Enschede"] },
  vr: { label: "Vrijdag", kleur: "#ef4444",  icon: "✅", focus: "Controles & administratie", taken: ["Wekelijkse checklist afvinken", "Meldingen afsluiten in de app", "Weekrapportage bijwerken", "Nieuwe aankomsten voorbereiden voor volgende week"] },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function fmtDate(d) { const dt = typeof d==="string"?new Date(d):d; return dt.toLocaleDateString("nl-NL",{day:"2-digit",month:"2-digit"}); }
function fmtTime(d) { const dt = typeof d==="string"?new Date(d):d; return dt.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"}); }
function fmtFull(d) { return `${fmtDate(d)} ${fmtTime(d)}`; }
function todayISO() { return new Date().toISOString().slice(0,10); }
function dagVanDeWeek() { return ["zo","ma","di","wo","do","vr","za"][new Date().getDay()]; }

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function App() {
  const [gebruiker, setGebruiker] = useState(() => {
    try { const g = localStorage.getItem("ktp_sessie"); return g ? JSON.parse(g) : null; } catch { return null; }
  });
  const [taal, setTaal] = useState(() => { try { return localStorage.getItem("ktp_taal")||"nl"; } catch { return "nl"; } });
  const [gebruikers, setGebruikers] = useState([]);
  const [houses, setHouses] = useState([]);
  const [meldingen, setMeldingen] = useState([]);
  const [taken, setTaken] = useState([]);
  const [checklists, setChecklists] = useState([]);
  const [checklistItems, setChecklistItems] = useState([]);
  const [activiteiten, setActiviteiten] = useState([]);
  const [dagplanningDB, setDagplanningDB] = useState([]);
  const [autoMeldingenApp, setAutoMeldingenApp] = useState([]);
  const [ongelzenAutoReacties, setOngelzenAutoReacties] = useState(0);
  const [ongelzenBerichten, setOngelzenBerichten] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTabState] = useState("melding");
  function setTab(t) {
    try { localStorage.setItem("ktp_tab", t); } catch {}
    setTabState(t);
  }
  const [toast, setToast] = useState(null);

  // Herstel tab na refresh op basis van opgeslagen waarde
  useEffect(() => {
    try {
      const opgeslagenTab = localStorage.getItem("ktp_tab");
      if (opgeslagenTab) setTabState(opgeslagenTab);
    } catch {}
  }, []);

  const loadChecklistItems = useCallback(async () => {
    const { data, error } = await supabase.from("checklist_items").select("*").eq("actief", true).order("type").order("volgorde");
    if (error) { console.error("checklist_items:", error); return; }
    setChecklistItems(data || []);
  }, []);

  const loadActiviteiten = useCallback(async () => {
    const { data, error } = await supabase.from("activiteiten").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) { console.error("activiteiten:", error); return; }
    setActiviteiten(data || []);
  }, []);

  const loadOngelzenBerichten = useCallback(async (naam) => {
    if (!naam) return;
    const { data } = await supabase.from("berichten").select("id, gelezen_door, aan, van")
      .or(`aan.is.null,aan.eq.${naam},van.eq.${naam}`);
    const ongelezen = (data || []).filter(b => !(b.gelezen_door || []).includes(naam)).length;
    setOngelzenBerichten(ongelezen);
  }, []);

  const loadAutoMeldingenApp = useCallback(async () => {
    try {
      const { data } = await supabase.from("auto_meldingen")
        .select("*")
        .in("actie", ["storing", "reservering"])
        .eq("status", "open")
        .order("created_at", { ascending: false });
      setAutoMeldingenApp(data || []);
    } catch(e) { /* niet kritiek, app blijft werken */ }
  }, []);

  const loadOngelzenAutoReacties = useCallback(async (naam) => {
    const { data } = await supabase.from("auto_meldingen")
      .select("id").eq("reactie_gelezen", false).not("backoffice_reactie", "is", null).eq("ingediend_door", naam||"");
    setOngelzenAutoReacties(data?.length || 0);
  }, []);

  // Keep-alive: ping database elke 3 dagen zodat Supabase niet pauzeert
  useEffect(() => {
    const keepAlive = async () => {
      try {
        await supabase.from("gebruikers").select("id").limit(1);
        console.log("✓ Supabase keep-alive ping");
      } catch(e) { console.log("Keep-alive mislukt:", e); }
    };
    keepAlive(); // Direct bij opstarten
    const interval = setInterval(keepAlive, 1000 * 60 * 60 * 24 * 3); // elke 3 dagen
    return () => clearInterval(interval);
  }, []);

  const loadDagplanning = useCallback(async () => {
    const { data, error } = await supabase.from("dagplanning").select("*").order("volgorde");
    if (error) { console.error("dagplanning:", error); return; }
    setDagplanningDB(data || []);
  }, []);

  const loadGebruikers = useCallback(async () => {
    const { data, error } = await supabase.from("gebruikers").select("*").eq("actief", true).order("rol").order("naam");
    if (error) { console.error("gebruikers:", error); return; }
    setGebruikers(data || []);
  }, []);

  const loadHouses = useCallback(async () => {
    const { data, error } = await supabase.from("woningen").select("*").order("stad").order("adres");
    if (error) { console.error(error); return; }
    setHouses(data.map(h => ({ ...h, kamers: h.kamers || [] })));
  }, []);

  const loadMeldingen = useCallback(async () => {
    const { data, error } = await supabase.from("meldingen").select("*").order("created_at", { ascending: false });
    if (error) { console.error(error); return; }
    setMeldingen(data);
  }, []);

  const loadTaken = useCallback(async () => {
    const { data, error } = await supabase.from("taken").select("*").order("created_at", { ascending: false });
    if (error) { console.error("taken:", error); return; }
    setTaken(data || []);
  }, []);

  const loadChecklists = useCallback(async () => {
    const { data, error } = await supabase.from("checklists").select("*").order("created_at", { ascending: false });
    if (error) { console.error("checklists:", error); return; }
    setChecklists(data || []);
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        await Promise.all([loadGebruikers(), loadHouses(), loadMeldingen(), loadTaken(), loadChecklists(), loadChecklistItems(), loadActiviteiten(), loadDagplanning()]);
      } catch(e) {
        console.error("Init fout:", e);
      }
      setLoading(false);
      loadAutoMeldingenApp();
    }
    init();
  }, [loadGebruikers, loadHouses, loadMeldingen, loadTaken, loadChecklists, loadChecklistItems, loadActiviteiten, loadAutoMeldingenApp]);

  useEffect(() => {
    const s1 = supabase.channel("mel-rt").on("postgres_changes",{event:"*",schema:"public",table:"meldingen"},()=>loadMeldingen()).subscribe();
    const s2 = supabase.channel("won-rt").on("postgres_changes",{event:"*",schema:"public",table:"woningen"},()=>loadHouses()).subscribe();
    const s3 = supabase.channel("tak-rt").on("postgres_changes",{event:"*",schema:"public",table:"taken"},()=>loadTaken()).subscribe();
    const s4 = supabase.channel("chk-rt").on("postgres_changes",{event:"*",schema:"public",table:"checklists"},()=>loadChecklists()).subscribe();
    const s5 = supabase.channel("gbr-rt").on("postgres_changes",{event:"*",schema:"public",table:"gebruikers"},()=>loadGebruikers()).subscribe();
    const s6 = supabase.channel("chi-rt").on("postgres_changes",{event:"*",schema:"public",table:"checklist_items"},()=>loadChecklistItems()).subscribe();
    const s7 = supabase.channel("act-rt").on("postgres_changes",{event:"*",schema:"public",table:"activiteiten"},()=>loadActiviteiten()).subscribe();
    const s8 = supabase.channel("dag-rt").on("postgres_changes",{event:"*",schema:"public",table:"dagplanning"},()=>loadDagplanning()).subscribe();
    return () => { supabase.removeChannel(s1); supabase.removeChannel(s2); supabase.removeChannel(s3); supabase.removeChannel(s4); supabase.removeChannel(s5); supabase.removeChannel(s6); supabase.removeChannel(s7); supabase.removeChannel(s8); };
  }, [loadHouses, loadMeldingen, loadTaken, loadChecklists, loadGebruikers, loadChecklistItems, loadActiviteiten, loadDagplanning, loadOngelzenAutoReacties, loadAutoMeldingenApp]);

  function showToast(msg, type="ok") { setToast({msg,type}); setTimeout(()=>setToast(null),3500); }

  function login(g) {
    try { localStorage.setItem("ktp_sessie", JSON.stringify(g)); } catch {}
    setGebruiker(g);
    setTab(g.rol==="collega"||g.rol==="financieel"?"taken":g.rol==="huismeester"?"dagplanning":"taken");
    loadOngelzenAutoReacties(g.naam);
    loadOngelzenBerichten(g.naam);
  }

  function wisselTaal(nieuweTaal) {
    setTaal(nieuweTaal);
    try { localStorage.setItem("ktp_taal", nieuweTaal); } catch {}
  }
  function logout() {
    try { localStorage.removeItem("ktp_sessie"); localStorage.removeItem("ktp_tab"); } catch {}
    setGebruiker(null);
  }
  async function voegGebruikerToe(g) {
    const { error } = await supabase.from("gebruikers").insert([g]);
    if (error) { showToast("Fout bij toevoegen gebruiker", "err"); return false; }
    showToast(`✓ ${g.naam} toegevoegd`); await loadGebruikers(); return true;
  }

  async function updateGebruiker(id, updates) {
    const { error } = await supabase.from("gebruikers").update(updates).eq("id", id);
    if (error) { showToast("Fout bij opslaan", "err"); return false; }
    showToast("✓ Opgeslagen"); await loadGebruikers(); return true;
  }

  async function verwijderGebruiker(id) {
    const { error } = await supabase.from("gebruikers").update({ actief: false }).eq("id", id);
    if (error) { showToast("Fout bij verwijderen", "err"); return false; }
    showToast("✓ Gebruiker verwijderd"); await loadGebruikers(); return true;
  }

  async function addMelding(m) {
    const { error } = await supabase.from("meldingen").insert([{
      type:m.type, medewerker:m.medewerker, datum:m.datum, woning_id:m.huisId,
      kamer:m.kamer, wie_regelt:m.wieRegelt||null, sleutel_terug:m.sleutelTerug||null,
      kamer_schoon:m.kamerSchoon||null, sleutel_aantal:m.sleutelAantal||null,
      opmerkingen:m.opmerkingen||null, ingediend_door:gebruiker.naam, status:"open",
      voor_rol:m.voor_rol||"backoffice",
    }]);
    if (error) { showToast("Fout bij opslaan","err"); return; }

    // Bij aankomst: taak voor huismeester (sleutel uitreiken) en backoffice (verwerken)
    if (m.type === "aankomst" && m.medewerker) {
      const sleutels = m.sleutelAantal || 1;
      await supabase.from("taken").insert([
        {
          titel: `Aankomst begeleiden — ${m.medewerker}`,
          omschrijving: `${m.medewerker} komt aan op ${m.datum}. Reik ${sleutels} sleutel${sleutels>1?"s":""} uit en begeleid de aankomst.`,
          woning_id: m.huisId || null,
          kamer: m.kamer || null,
          prioriteit: "hoog",
          voor_rol: "huismeester",
          status: "open",
          aangemaakt_door: gebruiker.naam,
        },
        {
          titel: `Aankomst verwerken in administratie — ${m.medewerker}`,
          omschrijving: `${m.medewerker} komt aan op ${m.datum}. Verwerk in systemen: huurcontract, borgplan, kamerstatus.`,
          woning_id: m.huisId || null,
          kamer: m.kamer || null,
          prioriteit: "hoog",
          voor_rol: "backoffice",
          status: "open",
          aangemaakt_door: gebruiker.naam,
        }
      ]);
    }

    // Bij aankomst: automatisch openstaande reservering voor zelfde persoon/kamer verwerken
    if (m.type === "aankomst" && m.huisId && m.kamer) {
      await supabase.from("meldingen").update({
        status: "verwerkt",
        afgehandeld_door: gebruiker.naam,
        afgehandeld_op: new Date().toISOString(),
        notitie: "Automatisch verwerkt bij aankomst",
      }).eq("type", "reservering")
        .eq("woning_id", m.huisId)
        .eq("kamer", m.kamer)
        .eq("status", "open");
    }

    // Bij aankomst: direct borgplan aanmaken
    if (m.type === "aankomst" && m.medewerker) {
      const { data: bestaand } = await supabase.from("borg_plannen")
        .select("id").eq("naam_medewerker", m.medewerker).eq("status","actief").limit(1);
      if (!bestaand || bestaand.length === 0) {
        const sleutels = m.sleutelAantal || 1;
        const { data: fietsen } = await supabase.from("fietsen")
          .select("id").eq("naam_medewerker", m.medewerker).eq("status","In gebruik").limit(1);
        const heeftFiets = fietsen && fietsen.length > 0;
        const nu2 = new Date();
        const startWeek = (() => { const d=new Date(); const j=new Date(Date.UTC(d.getFullYear(),0,1)); return Math.ceil((((d-j)/86400000)+j.getDay()+1)/7)+1; })();
        const startJaar = nu2.getFullYear();
        const termijnData = [];
        if (sleutels === 1) {
          termijnData.push({omschrijving:"Borg sleutel (week 1/2)",bedrag:50});
          termijnData.push({omschrijving:"Borg sleutel (week 2/2)",bedrag:50});
        } else if (sleutels >= 2) {
          termijnData.push({omschrijving:"Borg sleutels (week 1/4)",bedrag:50});
          termijnData.push({omschrijving:"Borg sleutels (week 2/4)",bedrag:50});
          termijnData.push({omschrijving:"Borg sleutels (week 3/4)",bedrag:50});
          termijnData.push({omschrijving:"Borg sleutels (week 4/4)",bedrag:30});
        }
        if (heeftFiets) {
          termijnData.push({omschrijving:"Borg fiets (week 1/2)",bedrag:50});
          termijnData.push({omschrijving:"Borg fiets (week 2/2)",bedrag:50});
        }
        const totaalBorg = termijnData.reduce((s,t)=>s+t.bedrag,0);
        if (totaalBorg > 0) {
          const { data: plan2 } = await supabase.from("borg_plannen").insert([{
            naam_medewerker: m.medewerker,
            woning_id: m.huisId || null,
            kamer: m.kamer || null,
            aankomst_datum: m.datum || null,
            sleutels: sleutels,
            heeft_fiets: heeftFiets,
            totaal_borg: totaalBorg,
            ingehouden: 0,
            status: "actief",
            aangemaakt_door: gebruiker.naam,
            opmerkingen: `Aankomst ingediend door: ${gebruiker.naam}`,
          }]).select().single();
          if (plan2) {
            const rows = termijnData.map((termijn,i) => {
              let week = startWeek + i; let jaar = startJaar;
              if (week > 52) { week -= 52; jaar++; }
              return { plan_id: plan2.id, naam_medewerker: m.medewerker, week_nummer: week, jaar, bedrag: termijn.bedrag, type: "inhouden", omschrijving: termijn.omschrijving, status: "open" };
            });
            await supabase.from("borg_termijnen").insert(rows);
            await supabase.from("berichten").insert([{
              tekst: `Borgplan aangemaakt voor ${m.medewerker}: €${totaalBorg} in ${termijnData.length} termijnen. Ingediend door: ${gebruiker.naam}.`,
              van: "Systeem", aan: null,
              onderwerp: `🔐 Borgplan aangemaakt — ${m.medewerker}`,
              koppeling_type: "melding",
              koppeling_label: `Aankomst ${m.medewerker}`,
              gelezen_door: [],
            }]);
          }
        }
      }
    }

    // Kamerstatus bijwerken
    const huis = houses.find(h=>h.id===m.huisId);
    if (huis) {
      const nk = huis.kamers.map(k => {
        if (k.k!==m.kamer) return k;
        if (m.type==="aankomst")    return {...k,naam:m.medewerker,status:"Lopend"};
        if (m.type==="reservering") return {...k,naam:m.medewerker,status:"Gereserveerd"};
        if (m.type==="vertrek") { return {...k,status:"Controle"}; } // Altijd Controle tot huismeester heeft afgevinkt
        if (m.type==="vertrek_aankondiging") { return {...k,status:"Gereserveerd"}; } // Aankondiging = gereserveerd
        return k;
      });
      await supabase.from("woningen").update({kamers:nk}).eq("id",m.huisId);
    }

    // ── E-mail sturen ──────────────────────────────────────────────────────
    const typeIcons = {
      aankomst:"🚗 Aankomst", vertrek:"🧳 Vertrek",
      reservering:"📅 Reservering", verhuizing:"📦 Verhuizing",
      overig:"💬 Overig",
    };
    const huisNaam = huis ? `${huis.adres}, ${huis.stad}` : "Onbekend";
    let opmerkingenTxt = m.opmerkingen || "—";
    if (m.type==="vertrek") {
      opmerkingenTxt += `\nSleutel terug: ${m.sleutelTerug||"?"}`;
      opmerkingenTxt += `\nKamer schoon: ${m.kamerSchoon||"?"}`;
    }
    stuurMail({
      type:         typeIcons[m.type] || m.type,
      type_icon:    typeIcons[m.type]?.split(" ")[0] || "📋",
      medewerker:   m.medewerker,
      woning:       huisNaam,
      kamer:        `Kamer ${m.kamer}`,
      datum:        m.datum,
      ingediend_door: gebruiker.naam,
      opmerkingen:  opmerkingenTxt,
    });

    // Bij verhuizing: automatisch TWee taken aanmaken — één voor huismeester, één voor backoffice
    if (m.type === "verhuizing") {
      const vanHuis = houses.find(h => h.id === m.vanHuisId);
      const naarHuisVerh = houses.find(h => h.id === m.huisId);
      const sleutelAantal = m.sleutelAantal || 1;
      const context = `${m.medewerker} | Van: ${vanHuis?.adres||"?"} K${m.vanKamer} → Naar: ${naarHuisVerh?.adres||"?"} K${m.kamer}`;

      await supabase.from("taken").insert([
        // Taak 1: Huismeester — fysieke controle kamer + sleutels
        {
          titel: `Kamer controleren na verhuizing — ${m.medewerker}`,
          omschrijving: `${context}. Controleer: kamer schoon + ${sleutelAantal} sleutel${sleutelAantal>1?"s":""} ingeleverd.`,
          woning_id: m.vanHuisId || null,
          kamer: m.vanKamer || null,
          prioriteit: "hoog",
          voor_rol: "huismeester",
          status: "open",
          aangemaakt_door: gebruiker.naam,
          huismeester_opmerking: `Verwacht: ${sleutelAantal} sleutel${sleutelAantal>1?"s":""}. Kamer schoon afvinken voor afronding.`,
        },
        // Taak 2: Backoffice — administratieve verwerking
        {
          titel: `Verhuizing verwerken in administratie — ${m.medewerker}`,
          omschrijving: `${context}. Verwerk: huurcontract, borgplan, kamerstatus bijwerken in systemen. Check of extra borg of km-vergoeding aanpassing nodig is.`,
          woning_id: m.huisId || null,
          kamer: m.kamer || null,
          prioriteit: "hoog",
          voor_rol: "backoffice",
          status: "open",
          aangemaakt_door: gebruiker.naam,
        },
        // Taak 3: Huismeester — sleutel uitreiken bij nieuwe kamer
        {
          titel: `Verhuizing voltooid — sleutel uitreiken ${m.medewerker}`,
          omschrijving: `${m.medewerker} trekt in bij ${naarHuisVerh?.adres||""} K${m.kamer}. Reik sleutel(s) uit en controleer of alles klaar is.`,
          woning_id: m.huisId || null,
          kamer: m.kamer || null,
          prioriteit: "hoog",
          voor_rol: "huismeester",
          status: "open",
          aangemaakt_door: gebruiker.naam,
          huismeester_opmerking: `Sleutels uitreiken bij nieuwe kamer. Noteer hoeveel sleutels (1 of 2).`,
        },
      ]);
    }

    // Bij vertrek aankondiging: taak voor huismeester om in te plannen
    if (m.type === "vertrek_aankondiging") {
      await supabase.from("taken").insert([{
        titel: `Vertrek inplannen — ${m.medewerker}`,
        omschrijving: `${m.medewerker} gaat vertrekken op ${m.datum}. Plan de kamercontrole in en begeleid het vertrekproces.`,
        woning_id: m.huisId || null,
        kamer: m.kamer || null,
        prioriteit: "middel",
        voor_rol: "huismeester",
        status: "open",
        aangemaakt_door: gebruiker.naam,
      }]);
    }

    // Bij daadwerkelijk vertrek: automatisch controletaak voor huismeester
    if (m.type === "vertrek") {
      const sleutels = m.sleutelAantal || 1;
      await supabase.from("taken").insert([{
        titel: `Kamer controleren na vertrek — ${m.medewerker}`,
        omschrijving: `${m.medewerker} is vertrokken uit K${m.kamer}. Controleer: kamer schoon + ${sleutels} sleutel${sleutels>1?"s":""} ingeleverd. Daarna kamer op Beschikbaar zetten.`,
        woning_id: m.huisId || null,
        kamer: m.kamer || null,
        prioriteit: "hoog",
        voor_rol: "huismeester",
        status: "open",
        aangemaakt_door: gebruiker.naam,
      }]);
    }

    showToast("✓ Melding verzonden");
  }

  async function logActiviteit(type, omschrijving, extra={}) {
    await supabase.from("activiteiten").insert([{ type, omschrijving, gedaan_door: gebruiker.naam, extra }]);
    await loadActiviteiten();
  }

  async function updateMeldingStatus(id, newStatus, notitie="") {
    const m = meldingen.find(m=>m.id===id);
    const huis = houses.find(h=>h.id===m?.woning_id);
    const { error } = await supabase.from("meldingen").update({status:newStatus,afgehandeld_door:gebruiker.naam,afgehandeld_op:new Date().toISOString(),notitie:notitie||null}).eq("id",id);
    if (error) showToast("Fout bij updaten","err");
    else {
      showToast("✓ Status bijgewerkt");
      await loadMeldingen();
      const statusTekst = newStatus==="afgehandeld"?"✅ Afgehandeld":newStatus==="verwerkt"?"📋 Verwerkt":newStatus==="in_behandeling"?"🔄 In behandeling":"📝 Status gewijzigd";
      logActiviteit("melding_status", `${statusTekst}: ${m?.medewerker||"?"} — ${m?.type||""} — ${huis?.adres||"?"} K${m?.kamer||"?"}${notitie?` (${notitie})`:""}`, {melding_id:id, status:newStatus});

      // Als aankomst verwerkt wordt → ook openstaande reservering sluiten
      if ((newStatus==="verwerkt"||newStatus==="afgehandeld") && m?.type==="aankomst" && m?.woning_id && m?.kamer) {
        await supabase.from("meldingen").update({
          status: "verwerkt",
          afgehandeld_door: gebruiker.naam,
          afgehandeld_op: new Date().toISOString(),
          notitie: "Automatisch verwerkt bij aankomst",
        }).eq("type", "reservering")
          .eq("woning_id", m.woning_id)
          .eq("kamer", m.kamer)
          .eq("status", "open");
      }

      // Als aankomst verwerkt wordt → automatisch borgplan aanmaken
      if ((newStatus==="verwerkt"||newStatus==="afgehandeld") && m?.type==="aankomst") {
        const sleutels = m.sleutel_aantal || 1;
        // Check of er al een borgplan bestaat voor deze persoon + kamer
        const { data: bestaand } = await supabase.from("borg_plannen")
          .select("id").eq("naam_medewerker", m.medewerker).eq("status","actief").limit(1);
        if (bestaand && bestaand.length > 0) {
          // Al een borgplan (bijv. van fiets) — voeg sleutels toe als termijnen
          const bestaandPlanId = bestaand[0].id;
          const sleutelTermijnen = [];
          if (sleutels === 1) {
            sleutelTermijnen.push({omschrijving:"Borg sleutel (week 1/2)",bedrag:50});
            sleutelTermijnen.push({omschrijving:"Borg sleutel (week 2/2)",bedrag:50});
          } else if (sleutels >= 2) {
            sleutelTermijnen.push({omschrijving:"Borg sleutels (week 1/4)",bedrag:50});
            sleutelTermijnen.push({omschrijving:"Borg sleutels (week 2/4)",bedrag:50});
            sleutelTermijnen.push({omschrijving:"Borg sleutels (week 3/4)",bedrag:50});
            sleutelTermijnen.push({omschrijving:"Borg sleutels (week 4/4)",bedrag:30});
          }
          if (sleutelTermijnen.length > 0) {
            const nu3 = new Date();
            const sw = (() => { const d=new Date(); const j=new Date(Date.UTC(d.getFullYear(),0,1)); return Math.ceil((((d-j)/86400000)+j.getDay()+1)/7)+1; })();
            const extraTotaal = sleutelTermijnen.reduce((s,t)=>s+t.bedrag,0);
            // Zoek laatste week van bestaande termijnen zodat we daarna plannen
            const { data: bestaandeTermijnen } = await supabase.from("borg_termijnen")
              .select("week_nummer,jaar").eq("plan_id",bestaandPlanId).order("jaar").order("week_nummer");
            let startWeekSleutel = sw;
            if (bestaandeTermijnen && bestaandeTermijnen.length > 0) {
              const laatste = bestaandeTermijnen[bestaandeTermijnen.length-1];
              startWeekSleutel = laatste.week_nummer + 1;
              if (startWeekSleutel > 52) startWeekSleutel = 1;
            }
            const rows = sleutelTermijnen.map((t,i) => {
              let week = startWeekSleutel+i; let jaar = nu3.getFullYear();
              if (week > 52) { week -= 52; jaar++; }
              return { plan_id: bestaandPlanId, naam_medewerker: m.medewerker, week_nummer: week, jaar, bedrag: t.bedrag, type: "inhouden", omschrijving: t.omschrijving, status: "open" };
            });
            await supabase.from("borg_termijnen").insert(rows);
            // Update totaal_borg en sleutels op bestaand plan
            const { data: huidigPlan } = await supabase.from("borg_plannen").select("totaal_borg,sleutels").eq("id",bestaandPlanId).single();
            if (huidigPlan) {
              await supabase.from("borg_plannen").update({
                totaal_borg: Number(huidigPlan.totaal_borg) + extraTotaal,
                sleutels: sleutels,
              }).eq("id", bestaandPlanId);
            }
          }
        } else {
          // Nog geen borgplan — maak nieuw aan
          // Check of persoon een fiets heeft
          const { data: fietsen } = await supabase.from("fietsen")
            .select("id").eq("naam_medewerker", m.medewerker).eq("status","In gebruik").limit(1);
          const heeftFiets = fietsen && fietsen.length > 0;
          // Bereken termijnen
          const nu2 = new Date();
          const startWeek = (() => { const d=new Date(); const j=new Date(Date.UTC(d.getFullYear(),0,1)); return Math.ceil((((d-j)/86400000)+j.getDay()+1)/7)+1; })();
          const startJaar = nu2.getFullYear();
          const termijnData = [];
          if (sleutels === 1) {
            termijnData.push({omschrijving:"Borg sleutel (week 1/2)",bedrag:50});
            termijnData.push({omschrijving:"Borg sleutel (week 2/2)",bedrag:50});
          } else if (sleutels >= 2) {
            termijnData.push({omschrijving:"Borg sleutels (week 1/4)",bedrag:50});
            termijnData.push({omschrijving:"Borg sleutels (week 2/4)",bedrag:50});
            termijnData.push({omschrijving:"Borg sleutels (week 3/4)",bedrag:50});
            termijnData.push({omschrijving:"Borg sleutels (week 4/4)",bedrag:30});
          }
          if (heeftFiets) {
            termijnData.push({omschrijving:"Borg fiets (week 1/2)",bedrag:50});
            termijnData.push({omschrijving:"Borg fiets (week 2/2)",bedrag:50});
          }
          const totaalBorg = termijnData.reduce((s,t)=>s+t.bedrag,0);
          if (totaalBorg > 0) {
            const { data: plan2 } = await supabase.from("borg_plannen").insert([{
              naam_medewerker: m.medewerker,
              woning_id: m.woning_id || null,
              kamer: m.kamer || null,
              aankomst_datum: m.datum || null,
              sleutels: sleutels,
              heeft_fiets: heeftFiets,
              totaal_borg: totaalBorg,
              ingehouden: 0,
              status: "actief",
              aangemaakt_door: gebruiker.naam,
              opmerkingen: `Aankomst ingediend door: ${m.ingediend_door || gebruiker.naam}`,
            }]).select().single();
            if (plan2) {
              const rows = termijnData.map((termijn,i) => {
                let week = startWeek + i; let jaar = startJaar;
                if (week > 52) { week -= 52; jaar++; }
                return { plan_id: plan2.id, naam_medewerker: m.medewerker, week_nummer: week, jaar, bedrag: termijn.bedrag, type: "inhouden", omschrijving: termijn.omschrijving, status: "open" };
              });
              await supabase.from("borg_termijnen").insert(rows);

              // Stuur bericht naar backoffice dat borgplan aangemaakt is
              await supabase.from("berichten").insert([{
                tekst: `Borgplan aangemaakt voor ${m.medewerker}: €${totaalBorg} in ${termijnData.length} termijnen. Aankomst ingediend door: ${m.ingediend_door || gebruiker.naam}.`,
                van: "Systeem",
                aan: null,
                onderwerp: `🔐 Borgplan aangemaakt — ${m.medewerker}`,
                koppeling_type: "melding",
                koppeling_id: id,
                koppeling_label: `Aankomst ${m.medewerker} — ${huis?.adres||""}${m.kamer?` K${m.kamer}`:""}`,
                gelezen_door: [],
              }]);
            }
          }
        } // end if bestaand else
      }

      // Als er een notitie is → stuur bericht naar collega die de melding heeft ingediend
      if (notitie && notitie.trim() && m?.ingediend_door && m.ingediend_door !== gebruiker.naam) {
        const typeLabel = m.type==="aankomst"?"Aankomst":m.type==="vertrek"?"Vertrek":m.type==="reservering"?"Reservering":"Melding";
        await supabase.from("berichten").insert([{
          tekst: notitie.trim(),
          van: gebruiker.naam,
          aan: m.ingediend_door,
          onderwerp: `${statusTekst} — ${typeLabel} ${m.medewerker}`,
          koppeling_type: "melding",
          koppeling_id: id,
          koppeling_label: `${typeLabel} — ${m.medewerker} — ${huis?.adres||""}${m.kamer?` K${m.kamer}`:""}`,
          gelezen_door: [gebruiker.naam],
        }]);
        stuurMail({
          type: `💬 Reactie op ${typeLabel.toLowerCase()}melding`,
          type_icon: "💬",
          medewerker: m.ingediend_door,
          woning: huis ? `${huis.adres}, ${huis.stad}` : "—",
          kamer: m.kamer ? `Kamer ${m.kamer}` : "—",
          datum: new Date().toISOString().slice(0,10),
          ingediend_door: gebruiker.naam,
          opmerkingen: notitie.trim(),
        });
      }

      // Als vertrek verwerkt wordt: zet kamerstatus terug naar Beschikbaar
      if ((newStatus==="verwerkt"||newStatus==="afgehandeld") && m?.type==="vertrek" && huis) {
        const kamer = huis.kamers.find(k=>k.k===m.kamer);
        if (kamer && kamer.status==="Controle") {
          const nk = huis.kamers.map(k=>k.k===m.kamer?{...k,status:"Beschikbaar",naam:""}:k);
          await supabase.from("woningen").update({kamers:nk}).eq("id",huis.id);
          await loadHouses();
        }
      }
    }
  }

  async function addTaak(taak) {
    const { error } = await supabase.from("taken").insert([{...taak, aangemaakt_door: gebruiker.naam, status:"open"}]);
    if (error) { showToast("Fout bij opslaan taak","err"); return false; }
    showToast("✓ Taak toegevoegd"); await loadTaken(); return true;
  }

  async function updateTaak(id, updates) {
    const t = taken.find(t=>t.id===id);
    const huis = houses.find(h=>h.id===t?.woning_id);
    // Verwijder notitie uit updates als de kolom niet bestaat
    const safeUpdates = {...updates};
    const { error } = await supabase.from("taken").update(safeUpdates).eq("id",id);
    if (error) {
      // Probeer nogmaals zonder notitie veld als fallback
      const { notitie, ...updates2 } = safeUpdates;
      const { error: error2 } = await supabase.from("taken").update(updates2).eq("id",id);
      if (error2) { showToast("Fout","err"); return; }
    }
    showToast("✓ Opgeslagen"); await loadTaken();
    if (updates.status==="gedaan") {
      logActiviteit("taak_gedaan", `✅ Taak gedaan: ${t?.titel||"?"}${updates.notitie?` — "${updates.notitie}"`:""}${huis?` — ${huis.adres}`:" — Algemeen"}${t?.kamer?` K${t.kamer}`:""}`, {taak_id:id, notitie:updates.notitie||null});
      stuurMail({
        type: "✅ Taak afgevinkt",
        type_icon: "✅",
        medewerker: updates.afgehandeld_door || "—",
        woning: huis ? `${huis.adres}, ${huis.stad}` : "Algemeen",
        kamer: t?.kamer ? `Kamer ${t.kamer}` : "—",
        datum: new Date().toISOString().slice(0,10),
        ingediend_door: updates.afgehandeld_door || gebruiker.naam,
        opmerkingen: `Taak: ${t?.titel||"?"}${updates.notitie ? `. Opmerking: ${updates.notitie}` : ""}`,
      });
    }
  }

  async function addWoning(w) {
    const { error } = await supabase.from("woningen").insert([w]);
    if (error) { showToast("Fout bij toevoegen woning","err"); return false; }
    showToast("✓ Woning toegevoegd"); await loadHouses(); return true;
  }

  async function updateWoning(id, updates) {
    const { error } = await supabase.from("woningen").update(updates).eq("id",id);
    if (error) { showToast("Fout bij opslaan","err"); return false; }
    showToast("✓ Opgeslagen"); await loadHouses(); return true;
  }

  async function deleteWoning(id) {
    const { error } = await supabase.from("woningen").delete().eq("id",id);
    if (error) { showToast("Fout bij verwijderen","err"); return false; }
    showToast("✓ Woning verwijderd"); await loadHouses(); return true;
  }

  async function slaChecklistOp(type, week, items, huisId) {
    const key = `${type}_${week}_${huisId||"all"}`;
    const bestaand = checklists.find(c=>c.sleutel===key);
    const huis = houses.find(h=>h.id===huisId);
    if (bestaand) {
      await supabase.from("checklists").update({items,bijgewerkt_door:gebruiker.naam,updated_at:new Date().toISOString()}).eq("id",bestaand.id);
    } else {
      await supabase.from("checklists").insert([{sleutel:key,type,week_jaar:week,woning_id:huisId||null,items,aangemaakt_door:gebruiker.naam}]);
    }
    await loadChecklists();
    const typeLabel = type==="wekelijks"?"📋 Wekelijkse":type==="4wekelijks"?"📅 4-wekelijkse":"🏆 Kwartaal";
    logActiviteit("checklist", `${typeLabel} checklist opgeslagen: ${items.length} items afgevinkt${huis?` — ${huis.adres}`:""}`, {type, week, items_count: items.length});
  }

  const openMeldingen = meldingen.filter(m=>m.status==="open" && (gebruiker?.rol!=="backoffice" || m.voor_rol==="backoffice"));
  const rol = gebruiker?.rol;
  const openTaken = taken.filter(t=>t.status==="open" && (rol==="backoffice" ? t.voor_rol==="backoffice" : t.voor_rol==="iedereen" || t.voor_rol===rol || !t.voor_rol));
  const mijnMeldingen = meldingen.filter(m=>m.ingediend_door===gebruiker?.naam);
  const naam = gebruiker?.naam;
  const isLiset = naam==="Liset" || naam==="Warscha";

  if (loading) return <LoadingScreen />;
  if (!gebruiker) return <LoginScreen gebruikers={gebruikers} onLogin={login} taal={taal} onTaalWissel={wisselTaal}/>;

  const rolIcon = rol==="backoffice"?"📊":rol==="huismeester"?"🏠":rol==="financieel"?"💶":"👤";
  const totalNotifs = openMeldingen.length + openTaken.length;

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Inter','Segoe UI',sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:${C.bg}} ::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
        button{cursor:pointer;font-family:inherit} input,textarea,select{font-family:inherit}
        .fl{font-size:11px;font-weight:600;color:${C.muted};letter-spacing:.8px;text-transform:uppercase;margin-bottom:6px;display:block}
        .fi{width:100%;background:white;border:1.5px solid ${C.border};border-radius:8px;color:${C.text};padding:10px 14px;font-size:14px;outline:none;transition:border .2s}
        .fi:focus{border-color:${C.blauw};box-shadow:0 0 0 3px ${C.blauw}18}
        .fs{width:100%;background:white;border:1.5px solid ${C.border};border-radius:8px;color:${C.text};padding:10px 14px;font-size:14px;outline:none;appearance:none}
        .card{background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:22px;box-shadow:0 1px 4px rgba(27,58,107,.06)}
        .btn-b{background:${C.blauw};color:white;border:none;border-radius:8px;padding:11px 22px;font-size:14px;font-weight:600;transition:background .2s}
        .btn-b:hover{background:${C.blauwLight}} .btn-b:disabled{background:#aab4c4;cursor:not-allowed}
        .btn-g{background:${C.groen};color:white;border:none;border-radius:8px;padding:11px 22px;font-size:14px;font-weight:600;transition:background .2s}
        .btn-g:hover{background:${C.groenLight}} .btn-g:disabled{background:#aab4c4;cursor:not-allowed}
        .btn-out{background:transparent;border:1.5px solid ${C.border};color:${C.muted};border-radius:8px;padding:9px 18px;font-size:13px;font-weight:500;transition:all .2s}
        .btn-out:hover{border-color:${C.blauw};color:${C.blauw}}
        .btn-r{background:#dc2626;color:white;border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600}
        .btn-r:hover{background:#b91c1c}
        .tp{background:none;border:none;color:rgba(255,255,255,.7);padding:8px 14px;border-radius:20px;font-size:13px;font-weight:500;transition:all .2s;white-space:nowrap}
        .tp.act{background:${C.groen};color:white;font-weight:700}
        .tp:hover{color:white}
        .badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
        .mc{background:white;border:1px solid ${C.border};border-radius:10px;padding:14px;margin-bottom:10px;box-shadow:0 1px 3px rgba(27,58,107,.05)}
        .rt{border:2px solid ${C.border};border-radius:10px;padding:10px 6px;text-align:center;cursor:pointer;transition:all .2s;flex:1;background:white;min-width:0}
        .rt.sel{border-color:${C.blauw};background:${C.blauw}10}
        .cr{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid ${C.border};flex-wrap:wrap}
        .cr:last-child{border-bottom:none}
        .cb{padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;border:1.5px solid;cursor:pointer;background:white}
        .cb.ja{border-color:${C.groen};color:${C.groen}} .cb.ja.s{background:${C.groen};color:white}
        .cb.nee{border-color:#ef4444;color:#ef4444} .cb.nee.s{background:#ef4444;color:white}
        .br{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;border:1px solid ${C.border};margin-bottom:6px;background:${C.bg};flex-wrap:wrap}
        .chk-item{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:8px;margin-bottom:6px;background:${C.bg};border:1px solid ${C.border};cursor:pointer;transition:all .15s}
        .chk-item.done{background:#f0fdf4;border-color:${C.groen}40}
        .chk-item:hover{border-color:${C.blauw}60}
        .taak-card{background:white;border:1px solid ${C.border};border-radius:10px;padding:14px;margin-bottom:8px;border-left:4px solid ${C.groen}}
        .taak-card.urgent{border-left-color:#ef4444}
        .taak-card.gedaan{border-left-color:#aab4c4;opacity:.7}
        .upload-zone{border:2px dashed ${C.border};border-radius:10px;padding:16px;text-align:center;cursor:pointer;transition:all .2s;background:${C.bg}}
        .upload-zone:hover,.upload-zone.dragover{border-color:${C.blauw};background:${C.blauw}08}
        .bijlage-chip{display:inline-flex;align-items:center;gap:6px;background:${C.bg};border:1px solid ${C.border};border-radius:20px;padding:4px 10px;font-size:12px;margin:3px}
        @media(max-width:700px){
          .card{padding:14px;border-radius:10px}
          .fi,.fs{padding:10px 12px;font-size:16px}
          .g2col{grid-template-columns:1fr!important}
          .g4col{grid-template-columns:1fr 1fr!important}
          .hide-mobile{display:none!important}
        }
      `}</style>

      {toast && <div style={{position:"fixed",bottom:16,right:16,left:16,zIndex:9999,background:toast.type==="ok"?C.groen:"#dc2626",color:"white",padding:"12px 18px",borderRadius:10,fontWeight:600,fontSize:14,boxShadow:"0 8px 30px rgba(0,0,0,.2)",textAlign:"center"}}>{toast.msg}</div>}

      {/* TOPBAR — mobiel scrollbaar */}
      <div style={{background:C.blauw,borderBottom:`2px solid ${C.groen}`,position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 12px rgba(27,58,107,.3)"}}>
        <div style={{maxWidth:1400,margin:"0 auto",padding:"0 12px"}}>
          {/* Logo + user rij */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:48,gap:8}}>
            <div style={{background:"white",borderRadius:7,padding:"3px 9px",display:"flex",alignItems:"center",flexShrink:0}}>
              <span style={{fontWeight:900,fontSize:13,color:C.blauw}}>KTP</span>
              <span style={{fontWeight:900,fontSize:13,color:C.groen,marginLeft:3}}>INTERFLEX</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
              {/* Taalschakelaar */}
              <div style={{display:"flex",gap:2}}>
                {Object.entries(TALEN).map(([code, info])=>(
                  <button key={code} onClick={()=>wisselTaal(code)}
                    style={{background:taal===code?"rgba(255,255,255,.35)":"rgba(255,255,255,.1)",border:"none",borderRadius:6,padding:"4px 7px",fontSize:11,fontWeight:700,color:"white",cursor:"pointer",fontFamily:"inherit",opacity:taal===code?1:.7}}>
                    {info.label}
                  </button>
                ))}
              </div>
              <div style={{background:"rgba(255,255,255,.15)",borderRadius:16,padding:"4px 10px",display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:12}}>{rolIcon}</span>
                <span style={{fontSize:12,color:"white",fontWeight:600}}>{naam}</span>
              </div>
              <button style={{background:"rgba(255,255,255,.15)",border:"none",borderRadius:7,padding:"5px 10px",fontSize:12,color:"white",cursor:"pointer",fontFamily:"inherit"}} onClick={logout}>↩</button>
            </div>
          </div>
          {/* Tab navigatie — horizontaal scrollbaar op mobiel */}
          <div style={{display:"flex",gap:2,overflowX:"auto",paddingBottom:6,scrollbarWidth:"none",msOverflowStyle:"none"}}>
            {rol==="collega" && (<>
              <button className={`tp ${tab==="taken"?"act":""}`} onClick={()=>setTab("taken")}>📋 Taken & Meldingen {(openTaken.length+mijnMeldingen.length)>0&&<Notif n={openTaken.length+mijnMeldingen.length}/>}</button>
              <button className={`tp ${tab==="woningen"?"act":""}`} onClick={()=>setTab("woningen")}>🏠 Woningen</button>
              <button className={`tp ${tab==="autos"?"act":""}`} onClick={()=>setTab("autos")}>🚗 Auto's {ongelzenAutoReacties>0&&<Notif n={ongelzenAutoReacties}/>}</button>
              <button className={`tp ${tab==="fietsen"?"act":""}`} onClick={()=>setTab("fietsen")}>🚲 Fietsen</button>
              <button className={`tp ${tab==="huurbetalingen"?"act":""}`} onClick={()=>setTab("huurbetalingen")}>💶 Huur</button>
              <button className={`tp ${tab==="huismeesterplanning"?"act":""}`} onClick={()=>setTab("huismeesterplanning")}>📅 Planning Cristian</button>
              <button className={`tp ${tab==="borg"?"act":""}`} onClick={()=>setTab("borg")}>🛡️ Inhoudingen</button>
              <button className={`tp ${tab==="medewerker360"?"act":""}`} onClick={()=>setTab("medewerker360")}>👤 Medewerker</button>
              <button className={`tp ${tab==="berichten"?"act":""}`} onClick={()=>setTab("berichten")}>💬 Berichten {ongelzenBerichten>0&&<Notif n={ongelzenBerichten}/>}</button>
              <button className={`tp ${tab==="handleiding"?"act":""}`} onClick={()=>setTab("handleiding")}>📖 Handleiding</button>
            </>)}
            {rol==="huismeester" && (<>
              <button className={`tp ${tab==="dagplanning"?"act":""}`} onClick={()=>setTab("dagplanning")}>📅 Mijn dag {totalNotifs>0&&<Notif n={totalNotifs}/>}</button>
              <button className={`tp ${tab==="taken"?"act":""}`} onClick={()=>setTab("taken")}>📋 Taken & Meldingen {(openTaken.length+openMeldingen.filter(m=>m.voor_rol==="huismeester"||!m.voor_rol).length)>0&&<Notif n={openTaken.length+openMeldingen.filter(m=>m.voor_rol==="huismeester"||!m.voor_rol).length}/>}</button>
              <button className={`tp ${tab==="woningen"?"act":""}`} onClick={()=>setTab("woningen")}>🏠 Woningen</button>
              <button className={`tp ${tab==="autos"?"act":""}`} onClick={()=>setTab("autos")}>🚗 Auto's {ongelzenAutoReacties>0&&<Notif n={ongelzenAutoReacties}/>}</button>
              <button className={`tp ${tab==="fietsen"?"act":""}`} onClick={()=>setTab("fietsen")}>🚲 Fietsen</button>
              <button className={`tp ${tab==="huurbetalingen"?"act":""}`} onClick={()=>setTab("huurbetalingen")}>💶 Huur</button>
              <button className={`tp ${tab==="borg"?"act":""}`} onClick={()=>setTab("borg")}>🛡️ Inhoudingen</button>
              <button className={`tp ${tab==="medewerker360"?"act":""}`} onClick={()=>setTab("medewerker360")}>👤 Medewerker</button>
              <button className={`tp ${tab==="berichten"?"act":""}`} onClick={()=>setTab("berichten")}>💬 Berichten {ongelzenBerichten>0&&<Notif n={ongelzenBerichten}/>}</button>
              <button className={`tp ${tab==="handleiding"?"act":""}`} onClick={()=>setTab("handleiding")}>📖 Handleiding</button>
            </>)}
            {rol==="financieel" && (<>
              <button className={`tp ${tab==="taken"?"act":""}`} onClick={()=>setTab("taken")}>📋 Taken & Meldingen {(openTaken.length+mijnMeldingen.length)>0&&<Notif n={openTaken.length+mijnMeldingen.length}/>}</button>
              <button className={`tp ${tab==="huurbetalingen"?"act":""}`} onClick={()=>setTab("huurbetalingen")}>💶 Huurbetalingen</button>
              <button className={`tp ${tab==="woningen"?"act":""}`} onClick={()=>setTab("woningen")}>🏠 Woningen</button>
              <button className={`tp ${tab==="autos"?"act":""}`} onClick={()=>setTab("autos")}>🚗 Auto's</button>
              <button className={`tp ${tab==="fietsen"?"act":""}`} onClick={()=>setTab("fietsen")}>🚲 Fietsen</button>
              <button className={`tp ${tab==="huismeesterplanning"?"act":""}`} onClick={()=>setTab("huismeesterplanning")}>📅 Planning Cristian</button>
              <button className={`tp ${tab==="borg"?"act":""}`} onClick={()=>setTab("borg")}>🛡️ Inhoudingen</button>
              <button className={`tp ${tab==="medewerker360"?"act":""}`} onClick={()=>setTab("medewerker360")}>👤 Medewerker</button>
              <button className={`tp ${tab==="berichten"?"act":""}`} onClick={()=>setTab("berichten")}>💬 Berichten {ongelzenBerichten>0&&<Notif n={ongelzenBerichten}/>}</button>
              <button className={`tp ${tab==="handleiding"?"act":""}`} onClick={()=>setTab("handleiding")}>📖 Handleiding</button>
            </>)}
            {rol==="backoffice" && (<>
              <button className={`tp ${tab==="taken"?"act":""}`} onClick={()=>setTab("taken")}>📋 Taken & Meldingen {(openTaken.length+openMeldingen.length)>0&&<Notif n={openTaken.length+openMeldingen.length}/>}</button>
              <button className={`tp ${tab==="woningen"?"act":""}`} onClick={()=>setTab("woningen")}>🏠 Woningen</button>
              <button className={`tp ${tab==="autos"?"act":""}`} onClick={()=>setTab("autos")}>🚗 Auto's</button>
              <button className={`tp ${tab==="fietsen"?"act":""}`} onClick={()=>setTab("fietsen")}>🚲 Fietsen</button>
              <button className={`tp ${tab==="huurbetalingen"?"act":""}`} onClick={()=>setTab("huurbetalingen")}>💶 Huurbetalingen</button>
              <button className={`tp ${tab==="borg"?"act":""}`} onClick={()=>setTab("borg")}>🛡️ Inhoudingen</button>
              <button className={`tp ${tab==="log"?"act":""}`} onClick={()=>setTab("log")}>📝 Log</button>
              <button className={`tp ${tab==="huismeesterplanning"?"act":""}`} onClick={()=>setTab("huismeesterplanning")}>📅 Planning Cristian</button>
              <button className={`tp ${tab==="medewerker360"?"act":""}`} onClick={()=>setTab("medewerker360")}>👤 Medewerker</button>
              <button className={`tp ${tab==="berichten"?"act":""}`} onClick={()=>setTab("berichten")}>💬 Berichten {ongelzenBerichten>0&&<Notif n={ongelzenBerichten}/>}</button>
              <button className={`tp ${tab==="handleiding"?"act":""}`} onClick={()=>setTab("handleiding")}>📖 Handleiding</button>
              {isLiset&&<button className={`tp ${tab==="beheer"?"act":""}`} onClick={()=>setTab("beheer")}>⚙️ Beheer</button>}
            </>)}
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{maxWidth:1400,margin:"0 auto",padding:"20px 12px"}}>
        {tab==="taken"&&<TakenMeldingenView taken={taken} meldingen={meldingen} houses={houses} gebruiker={gebruiker} onAddTaak={addTaak} onUpdateTaak={updateTaak} onAddMelding={addMelding} onUpdateMelding={updateMeldingStatus} showToast={showToast} taal={taal}/>}
        {tab==="woningen"&&<WoningenDetail houses={houses} onUpdateWoning={rol==="backoffice"||rol==="huismeester"?updateWoning:null}/>}
        {tab==="autos"&&<AutoModule gebruiker={gebruiker} showToast={showToast}/>}
        {tab==="fietsen"&&<FietsModule gebruiker={gebruiker} showToast={showToast} houses={houses} onMeldingIndienen={addMelding}/>}
        {rol==="huismeester"&&tab==="dagplanning"&&<DagplanningView meldingen={meldingen} taken={taken} houses={houses} onUpdate={updateMeldingStatus} onUpdateTaak={updateTaak} naam={naam} dagplanningDB={dagplanningDB} checklistItems={checklistItems} checklists={checklists} autoMeldingen={autoMeldingenApp}/>}
        {rol==="backoffice"&&tab==="log"&&<LogView meldingen={meldingen} houses={houses} activiteiten={activiteiten}/>}
        {tab==="huurbetalingen"&&<HuurbetalingenModule gebruiker={gebruiker} showToast={showToast} readonly={rol!=="backoffice"&&rol!=="financieel"}/>}
        {tab==="berichten"&&<BerichtenModule gebruiker={gebruiker} houses={houses} taken={taken} meldingen={meldingen} autos={[]}/>}
        {tab==="borg"&&<BorgModule gebruiker={gebruiker} houses={houses} showToast={showToast} readonly={rol!=="backoffice"}/>}
        {tab==="handleiding"&&<HandleidingModule gebruiker={gebruiker}/>}
        {tab==="medewerker360"&&<Medewerker360View houses={houses} gebruiker={gebruiker} showToast={showToast} onAddTaak={addTaak}/>}
        {tab==="huismeesterplanning"&&<HuismeesterPlanningView dagplanningDB={dagplanningDB} houses={houses} taken={taken} meldingen={meldingen} checklists={checklists} checklistItems={checklistItems}/>}
        {rol==="backoffice"&&isLiset&&tab==="beheer"&&<BeheerView houses={houses} onAdd={addWoning} onUpdate={updateWoning} onDelete={deleteWoning} showToast={showToast} gebruikers={gebruikers} onAddGebruiker={voegGebruikerToe} onUpdateGebruiker={updateGebruiker} onDeleteGebruiker={verwijderGebruiker} checklistItems={checklistItems} dagplanningDB={dagplanningDB}/>}
      </div>
    </div>
  );
}


// ─── MEDEWERKER 360° OVERZICHT ───────────────────────────────────────────────
function Medewerker360View({ houses, gebruiker, showToast, onAddTaak }) {
  const [zoek, setZoek] = useState("");
  const [gekozen, setGekozen] = useState(null);
  const [data, setData] = useState(null);
  const [laden, setLaden] = useState(false);
  const [notitie, setNotitie] = useState("");
  const [notities, setNotities] = useState([]);
  const [taakTitel, setTaakTitel] = useState("");
  const [taakOmschr, setTaakOmschr] = useState("");
  const [showTaakForm, setShowTaakForm] = useState(false);
  const [showHuurForm, setShowHuurForm] = useState(false);
  const [huurBedrag, setHuurBedrag] = useState("");
  const [huurDatum, setHuurDatum] = useState(new Date().toISOString().slice(0,10));
  const [huurSchuldId, setHuurSchuldId] = useState(null);
  const [showBorgForm, setShowBorgForm] = useState(false);
  const [borgActie, setBorgActie] = useState("inhouden");
  const [borgBedrag, setBorgBedrag] = useState("");
  const [borgPlanId, setBorgPlanId] = useState(null);
  const [borgOmschr, setBorgOmschr] = useState("");
  const isReadonly = gebruiker?.rol === "huismeester" || gebruiker?.rol === "collega";

  const alleMedewerkers = useMemo(() => {
    const namen = new Set();
    houses.forEach(h => (h.kamers||[]).forEach(k => { if (k.naam && k.naam.trim()) namen.add(k.naam.trim()); }));
    return [...namen].sort((a,b) => a.localeCompare(b));
  }, [houses]);

  const gefilterd = zoek.trim()
    ? alleMedewerkers.filter(n => n.toLowerCase().includes(zoek.toLowerCase()))
    : alleMedewerkers;

  async function laad(naam) {
    setGekozen(naam); setLaden(true); setData(null);
    setShowTaakForm(false); setShowHuurForm(false); setShowBorgForm(false);
    try {
      const [autoRes, fietsRes, borgRes, huurRes, autoMeldRes, notitieRes] = await Promise.all([
        supabase.from("autos").select("*").eq("naam_medewerker", naam),
        supabase.from("fietsen").select("*").eq("naam_medewerker", naam).order("created_at",{ascending:false}),
        supabase.from("borg_plannen").select("*").eq("naam_medewerker", naam).order("created_at",{ascending:false}),
        supabase.from("huurschulden").select("*, huurbetalingen(*)").eq("naam_medewerker", naam).order("created_at",{ascending:false}),
        supabase.from("auto_meldingen").select("*").eq("naam_medewerker", naam).order("created_at",{ascending:false}).limit(5),
        supabase.from("activiteiten").select("*").eq("type","medewerker_notitie").filter("omschrijving","like",`%[${naam}]%`).order("created_at",{ascending:false}).limit(20),
      ]);
      const kamers = [];
      houses.forEach(h => (h.kamers||[]).forEach(k => { if (k.naam === naam) kamers.push({huis:h, kamer:k}); }));
      const huurdata = huurRes.data||[];
      const actieveSchuld = huurdata.find(h=>h.actief);
      setHuurSchuldId(actieveSchuld?.id||null);
      const actieveBorg = (borgRes.data||[]).find(b=>b.status==="actief");
      setBorgPlanId(actieveBorg?.id||null);
      setData({ kamers, autos: autoRes.data||[], fietsen: fietsRes.data||[], borgPlannen: borgRes.data||[], huurschulden: huurdata, autoMeldingen: autoMeldRes.data||[] });
      setNotities(notitieRes.data||[]);
    } catch(e) { console.error(e); }
    setLaden(false);
  }

  async function slaNotitieOp() {
    if (!notitie.trim()) return;
    await supabase.from("activiteiten").insert([{ type:"medewerker_notitie", omschrijving:`[${gekozen}] ${notitie.trim()}`, gedaan_door: gebruiker?.naam||"?", extra:{medewerker:gekozen} }]);
    setNotitie("");
    const { data } = await supabase.from("activiteiten").select("*").eq("type","medewerker_notitie").filter("omschrijving","like",`%[${gekozen}]%`).order("created_at",{ascending:false}).limit(20);
    setNotities(data||[]);
    showToast("✓ Notitie opgeslagen");
  }

  async function maakTaak() {
    if (!taakTitel.trim()) return;
    await onAddTaak({ titel: taakTitel, omschrijving: taakOmschr||null, voor_rol:"huismeester", status:"open", prioriteit:"normaal", extra_info: gekozen });
    setTaakTitel(""); setTaakOmschr(""); setShowTaakForm(false);
    showToast("✓ Taak aangemaakt voor huismeester");
  }

  async function registreerHuurbetaling() {
    if (!huurBedrag || !huurSchuldId) return;
    const { error } = await supabase.from("huurbetalingen").insert([{ schuld_id: huurSchuldId, bedrag: parseFloat(huurBedrag), datum: huurDatum, opmerking:`Geregistreerd via medewerker overzicht`, geregistreerd_door: gebruiker?.naam||"?" }]);
    if (error) { showToast("Fout bij opslaan betaling","err"); return; }
    setHuurBedrag(""); setShowHuurForm(false);
    showToast("✓ Huurbetaling geregistreerd");
    laad(gekozen);
  }

  async function verwerkBorg() {
    if (!borgBedrag || !borgPlanId) return;
    const bedrag = parseFloat(borgBedrag);
    const plan = data?.borgPlannen?.find(b=>b.id===borgPlanId);
    if (!plan) return;
    const nieuwIngehouden = borgActie==="inhouden" ? (plan.ingehouden||0)+bedrag : Math.max(0,(plan.ingehouden||0)-bedrag);
    const { error } = await supabase.from("borg_plannen").update({ ingehouden: nieuwIngehouden }).eq("id", borgPlanId);
    if (!error) {
      await supabase.from("activiteiten").insert([{ type:"borg_update", omschrijving:`${borgActie==="inhouden"?"💸 Ingehouden":"💚 Teruggegeven"}: €${bedrag.toFixed(2)} — ${borgOmschr||"Geen omschrijving"} (${gekozen})`, gedaan_door: gebruiker?.naam||"?" }]);
    }
    if (error) { showToast("Fout","err"); return; }
    setBorgBedrag(""); setBorgOmschr(""); setShowBorgForm(false);
    showToast(`✓ Borg ${borgActie==="inhouden"?"ingehouden":"teruggegeven"}`);
    laad(gekozen);
  }

  const S = {
    card: (kleur) => ({background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${kleur}`,borderRadius:10,padding:"14px 16px",marginBottom:12}),
    titel: (kleur) => ({fontSize:11,fontWeight:700,color:kleur,letterSpacing:".7px",textTransform:"uppercase",marginBottom:10}),
    rij: {display:"flex",gap:8,padding:"5px 0",borderBottom:`1px solid ${C.border}`,fontSize:13,alignItems:"flex-start"},
    lbl: {fontSize:11,color:C.muted,minWidth:90,flexShrink:0,paddingTop:2},
    val: {fontWeight:600,color:C.text},
    badge: (bg,fg="white") => ({background:bg,color:fg,borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:600,display:"inline-block"}),
    actieBtn: (kleur) => ({background:kleur,color:"white",border:"none",borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}),
  };

  return (
    <div style={{display:"flex",gap:20,alignItems:"flex-start"}}>
      {/* ── Linker kolom ── */}
      <div style={{width:230,flexShrink:0}}>
        <div className="card" style={{padding:14,position:"sticky",top:80}}>
          <div style={{fontWeight:800,fontSize:15,color:C.blauw,marginBottom:12}}>👤 Medewerker</div>
          <input className="fi" value={zoek} onChange={e=>setZoek(e.target.value)}
            placeholder="Naam zoeken..." style={{marginBottom:10,fontSize:13,padding:"8px 12px"}}/>
          <div style={{maxHeight:480,overflowY:"auto"}}>
            {gefilterd.length === 0
              ? <div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>Geen resultaten</div>
              : gefilterd.map(naam => (
                <div key={naam} onClick={()=>laad(naam)}
                  style={{padding:"8px 10px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:gekozen===naam?700:400,
                    background:gekozen===naam?C.blauw+"18":"transparent",color:gekozen===naam?C.blauw:C.text,
                    borderLeft:gekozen===naam?`3px solid ${C.blauw}`:"3px solid transparent",marginBottom:2,transition:"all .15s"}}>
                  {naam}
                </div>
              ))}
          </div>
          <div style={{fontSize:11,color:C.muted,marginTop:8}}>{alleMedewerkers.length} medewerkers</div>
        </div>
      </div>

      {/* ── Rechter kolom ── */}
      <div style={{flex:1,minWidth:0}}>
        {!gekozen && (
          <div style={{textAlign:"center",padding:"60px 20px",color:C.muted}}>
            <div style={{fontSize:48,marginBottom:12}}>👤</div>
            <div style={{fontWeight:700,fontSize:16,color:C.text,marginBottom:6}}>Selecteer een medewerker</div>
            <div style={{fontSize:13}}>Klik links op een naam voor het volledige overzicht</div>
          </div>
        )}
        {laden && <div style={{textAlign:"center",padding:40,color:C.muted}}><div style={{fontSize:28,marginBottom:8}}>⏳</div>Laden...</div>}

        {data && !laden && (
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
              <h2 style={{fontWeight:800,fontSize:22,color:C.text}}>{gekozen}</h2>
              {!isReadonly && (
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <button style={S.actieBtn(C.groen)} onClick={()=>{setShowTaakForm(!showTaakForm);setShowHuurForm(false);setShowBorgForm(false);}}>+ Taak huismeester</button>
                  {huurSchuldId && <button style={S.actieBtn("#f59e0b")} onClick={()=>{setShowHuurForm(!showHuurForm);setShowTaakForm(false);setShowBorgForm(false);}}>💶 Huur afstrepen</button>}
                  {borgPlanId && <button style={S.actieBtn("#7c3aed")} onClick={()=>{setShowBorgForm(!showBorgForm);setShowTaakForm(false);setShowHuurForm(false);}}>📋 Borg aanpassen</button>}
                </div>
              )}
            </div>

            {/* Taak form */}
            {showTaakForm && (
              <div style={{...S.card(C.groen),marginBottom:12}}>
                <div style={S.titel(C.groen)}>+ Nieuwe taak voor huismeester</div>
                <input className="fi" placeholder="Taakomschrijving *" value={taakTitel} onChange={e=>setTaakTitel(e.target.value)} style={{marginBottom:8,fontSize:13}}/>
                <textarea className="fi" placeholder="Extra info (optioneel)" value={taakOmschr} onChange={e=>setTaakOmschr(e.target.value)} rows={2} style={{marginBottom:10,fontSize:13,resize:"vertical"}}/>
                <div style={{display:"flex",gap:8}}>
                  <button style={S.actieBtn(C.groen)} onClick={maakTaak}>✓ Aanmaken</button>
                  <button style={{...S.actieBtn("#9ca3af")}} onClick={()=>setShowTaakForm(false)}>Annuleer</button>
                </div>
              </div>
            )}

            {/* Huur form */}
            {showHuurForm && (
              <div style={{...S.card("#f59e0b"),marginBottom:12}}>
                <div style={S.titel("#f59e0b")}>💶 Huurbetaling registreren</div>
                <div style={{display:"flex",gap:10,marginBottom:10,flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:120}}>
                    <label className="fl">Bedrag (€)</label>
                    <input className="fi" type="number" placeholder="0.00" value={huurBedrag} onChange={e=>setHuurBedrag(e.target.value)} style={{fontSize:13}}/>
                  </div>
                  <div style={{flex:1,minWidth:140}}>
                    <label className="fl">Datum</label>
                    <input className="fi" type="date" value={huurDatum} onChange={e=>setHuurDatum(e.target.value)} style={{fontSize:13}}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button style={S.actieBtn("#f59e0b")} onClick={registreerHuurbetaling}>✓ Opslaan</button>
                  <button style={S.actieBtn("#9ca3af")} onClick={()=>setShowHuurForm(false)}>Annuleer</button>
                </div>
              </div>
            )}

            {/* Borg form */}
            {showBorgForm && (
              <div style={{...S.card("#7c3aed"),marginBottom:12}}>
                <div style={S.titel("#7c3aed")}>📋 Borg aanpassen</div>
                <div style={{display:"flex",gap:8,marginBottom:10}}>
                  {["inhouden","teruggeven"].map(a=>(
                    <button key={a} onClick={()=>setBorgActie(a)}
                      style={{flex:1,padding:"8px",borderRadius:7,border:`2px solid ${borgActie===a?"#7c3aed":C.border}`,background:borgActie===a?"#7c3aed":"white",color:borgActie===a?"white":C.text,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      {a==="inhouden"?"💸 Inhouden":"💚 Teruggeven"}
                    </button>
                  ))}
                </div>
                <div style={{display:"flex",gap:10,marginBottom:8,flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:120}}>
                    <label className="fl">Bedrag (€)</label>
                    <input className="fi" type="number" placeholder="0.00" value={borgBedrag} onChange={e=>setBorgBedrag(e.target.value)} style={{fontSize:13}}/>
                  </div>
                  <div style={{flex:2,minWidth:200}}>
                    <label className="fl">Omschrijving</label>
                    <input className="fi" placeholder="Reden..." value={borgOmschr} onChange={e=>setBorgOmschr(e.target.value)} style={{fontSize:13}}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button style={S.actieBtn("#7c3aed")} onClick={verwerkBorg}>✓ Opslaan</button>
                  <button style={S.actieBtn("#9ca3af")} onClick={()=>setShowBorgForm(false)}>Annuleer</button>
                </div>
              </div>
            )}

            {/* 🏠 Kamer */}
            <div style={S.card(C.blauw)}>
              <div style={S.titel(C.blauw)}>🏠 Kamer</div>
              {data.kamers.length === 0 ? <div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>Geen kamer gevonden</div>
                : data.kamers.map((item,i) => (
                <div key={i} style={{paddingBottom:6,marginBottom:6,borderBottom:`1px solid ${C.border}`}}>
                  <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{item.huis.adres}, {item.huis.stad} — Kamer {item.kamer.k}</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    <span style={S.badge(item.kamer.status==="Lopend"?C.groen:"#f59e0b")}>{item.kamer.status}</span>
                    {item.kamer.bedrijf&&<span style={S.badge(C.blauw+"22",C.blauw)}>{item.kamer.bedrijf}</span>}
                    {item.kamer.huurtype&&<span style={S.badge("#f5f3ff","#7c3aed")}>{item.kamer.huurtype}</span>}
                    {item.kamer.vestiging&&<span style={{fontSize:11,color:C.muted,paddingTop:3}}>Vestiging: {item.kamer.vestiging}</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* 🚗 Auto */}
            <div style={S.card("#0891b2")}>
              <div style={S.titel("#0891b2")}>🚗 Auto</div>
              {data.autos.length === 0 ? <div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>Geen auto toegewezen</div>
                : data.autos.map(a => (
                <div key={a.id}>
                  <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:6}}>
                    <span style={{fontWeight:700,fontSize:15}}>{a.kenteken}</span>
                    <span style={S.badge(a.status==="In gebruik"?"#0891b2":a.status==="Beschikbaar"?C.groen:"#9ca3af")}>{a.status}</span>
                  </div>
                  {a.merk_model&&<div style={S.rij}><span style={S.lbl}>Model</span><span style={S.val}>{a.merk_model}</span></div>}
                  {a.apk_datum&&<div style={S.rij}><span style={S.lbl}>APK</span><span style={{...S.val,color:new Date(a.apk_datum)<new Date()?"#dc2626":C.text}}>{fmtDate(a.apk_datum)}{new Date(a.apk_datum)<new Date()?" ⚠️ VERLOPEN":""}</span></div>}
                </div>
              ))}
              {data.autoMeldingen.filter(m=>m.actie==="storing"&&m.status==="open").map(m=>(
                <div key={m.id} style={{marginTop:8,background:"#fee2e2",borderRadius:6,padding:"8px 10px",fontSize:12}}>⚠️ Open storing: {m.opmerkingen}</div>
              ))}
            </div>

            {/* 🚲 Fiets */}
            <div style={S.card(C.groen)}>
              <div style={S.titel(C.groen)}>🚲 Fiets</div>
              {data.fietsen.length === 0 ? <div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>Geen fiets geregistreerd</div>
                : data.fietsen.map(f => (
                <div key={f.id} style={{...S.rij}}>
                  <div style={{flex:1}}><span style={{fontWeight:700}}>#{f.fietsnummer}</span>{f.merk?` — ${f.merk}`:""}</div>
                  <span style={S.badge(f.status==="In gebruik"?C.groen:f.status==="Beschikbaar"?"#9ca3af":"#f59e0b")}>{f.status}</span>
                  {f.datum_uitgifte&&<span style={{fontSize:11,color:C.muted}}>{fmtDate(f.datum_uitgifte)}</span>}
                </div>
              ))}
            </div>

            {/* 📋 Borg */}
            <div style={S.card("#7c3aed")}>
              <div style={S.titel("#7c3aed")}>📋 Borg & inhouding</div>
              {data.borgPlannen.length === 0 ? <div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>Geen borgplan gevonden</div>
                : data.borgPlannen.slice(0,3).map(b => (
                <div key={b.id} style={{marginBottom:10,paddingBottom:10,borderBottom:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
                    <span style={{fontWeight:700,fontSize:13}}>Kamer {b.kamer}</span>
                    <span style={S.badge(b.status==="actief"?"#7c3aed":b.status==="afgerond"?C.groen:"#9ca3af")}>{b.status||"?"}</span>
                    {b.id===borgPlanId&&<span style={{fontSize:11,color:"#7c3aed",fontStyle:"italic"}}>← actief plan</span>}
                  </div>
                  <div style={S.rij}><span style={S.lbl}>Totaal borg</span><span style={S.val}>€{(b.totaal_borg||0).toFixed(2)}</span></div>
                  <div style={S.rij}><span style={S.lbl}>Ingehouden</span><span style={{...S.val,color:(b.ingehouden||0)>0?"#dc2626":C.groen}}>€{(b.ingehouden||0).toFixed(2)}</span></div>
                  <div style={S.rij}><span style={S.lbl}>Restant</span><span style={{...S.val,color:C.groen}}>€{((b.totaal_borg||0)-(b.ingehouden||0)).toFixed(2)}</span></div>
                  {b.aankomst_datum&&<div style={S.rij}><span style={S.lbl}>Aankomst</span><span style={S.val}>{fmtDate(b.aankomst_datum)}</span></div>}
                  {b.vertrek_datum&&<div style={S.rij}><span style={S.lbl}>Vertrek</span><span style={S.val}>{fmtDate(b.vertrek_datum)}</span></div>}
                </div>
              ))}
            </div>

            {/* 💶 Huur */}
            <div style={S.card("#f59e0b")}>
              <div style={S.titel("#f59e0b")}>💶 Huurschuld</div>
              {data.huurschulden.length === 0 ? <div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>Geen huurschuld gevonden</div>
                : data.huurschulden.slice(0,2).map(h => {
                  const betalingen = h.huurbetalingen||[];
                  const totaalBetaald = betalingen.reduce((s,b)=>s+parseFloat(b.bedrag||0),0);
                  return (
                  <div key={h.id} style={{marginBottom:10,paddingBottom:10,borderBottom:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
                      <span style={S.badge(h.actief?"#f59e0b":"#9ca3af")}>{h.actief?"Actief":"Afgesloten"}</span>
                      {h.id===huurSchuldId&&<span style={{fontSize:11,color:"#f59e0b",fontStyle:"italic"}}>← actief</span>}
                      {h.startdatum&&<span style={{fontSize:12,color:C.muted}}>Vanaf {fmtDate(h.startdatum)}</span>}
                    </div>
                    <div style={S.rij}><span style={S.lbl}>Beginsaldo</span><span style={S.val}>€{(h.beginsaldo||0).toFixed(2)}</span></div>
                    <div style={S.rij}><span style={S.lbl}>Betaald</span><span style={{...S.val,color:C.groen}}>€{totaalBetaald.toFixed(2)} ({betalingen.length}x)</span></div>
                    <div style={S.rij}><span style={S.lbl}>Openstaand</span><span style={{...S.val,color:(h.beginsaldo||0)-totaalBetaald>0?"#dc2626":C.groen}}>€{((h.beginsaldo||0)-totaalBetaald).toFixed(2)}</span></div>
                    <div style={S.rij}><span style={S.lbl}>Tarief</span><span style={S.val}>€{(h.tarief_bedrag||0).toFixed(2)} / {h.tarief_dagen||7} d</span></div>
                    {betalingen.length>0&&(
                      <div style={{marginTop:6,fontSize:11,color:C.muted}}>
                        Laatste betaling: {fmtDate(betalingen.sort((a,b)=>b.datum>a.datum?1:-1)[0]?.datum)} — €{parseFloat(betalingen[0]?.bedrag||0).toFixed(2)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 📝 Notities */}
            <div style={S.card(C.muted)}>
              <div style={S.titel(C.muted)}>📝 Notities</div>
              <div style={{display:"flex",gap:8,marginBottom:12}}>
                <input className="fi" placeholder="Voeg een notitie toe..." value={notitie} onChange={e=>setNotitie(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&slaNotitieOp()} style={{flex:1,fontSize:13}}/>
                <button onClick={slaNotitieOp} style={{...S.actieBtn(C.blauw),whiteSpace:"nowrap"}}>+ Opslaan</button>
              </div>
              {notities.length === 0
                ? <div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>Nog geen notities</div>
                : notities.map(n => (
                  <div key={n.id} style={{padding:"8px 10px",background:C.bg,borderRadius:7,marginBottom:6,fontSize:13}}>
                    <div style={{color:C.text}}>{n.omschrijving.replace(`[${gekozen}] `,"")}</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:3}}>{n.gedaan_door} · {fmtDate(n.created_at)}</div>
                  </div>
                ))
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function Notif({n}) { return <span style={{background:"#ef4444",color:"white",borderRadius:10,padding:"1px 6px",fontSize:11,marginLeft:4}}>{n}</span>; }

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({ gebruikers, onLogin, taal="nl", onTaalWissel }) {
  const [rolFilter, setRolFilter] = useState(null);
  const [geselecteerd, setGeselecteerd] = useState(null);
  const [pin, setPin] = useState("");
  const [fout, setFout] = useState("");

  const rollen = [
    { id:"collega",      icon:"👤", label:"Collega",      kleur:C.muted },
    { id:"huismeester",  icon:"🏠", label:"Huismeester",  kleur:C.groen },
    { id:"financieel",   icon:"💶", label:"Financieel",   kleur:"#f59e0b" },
    { id:"backoffice",   icon:"📊", label:"Backoffice",   kleur:C.blauw },
  ];

  const gefilterd = rolFilter ? gebruikers.filter(g=>g.rol===rolFilter) : [];
  const rolKleur  = { backoffice:C.blauw, huismeester:C.groen, collega:C.muted };

  function probeerLogin() {
    if (!geselecteerd) return;
    if (pin===geselecteerd.pin) { onLogin(geselecteerd); }
    else { setFout(vertaal("fout_pin",taal)+", probeer opnieuw"); setPin(""); }
  }

  return (
    <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${C.blauw} 0%,${C.blauwDark} 60%,${C.dark} 100%)`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',sans-serif",padding:20}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap'); *{box-sizing:border-box;margin:0;padding:0}`}</style>
      <div style={{marginBottom:28,textAlign:"center"}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:16,background:"rgba(255,255,255,.1)",borderRadius:16,padding:"14px 28px",border:"1px solid rgba(255,255,255,.2)"}}>
          <span style={{fontWeight:900,fontSize:26,color:"white",letterSpacing:"-1px"}}>KTP</span>
          <span style={{fontWeight:900,fontSize:26,color:C.groen,letterSpacing:"-1px",marginLeft:6}}>INTERFLEX</span>
          <div style={{width:1,height:24,background:"rgba(255,255,255,.3)",marginLeft:8}}/>
          <div style={{fontSize:11,color:"rgba(255,255,255,.6)",letterSpacing:"2px",textTransform:"uppercase",fontWeight:600}}>Woningbeheer</div>
        </div>
      </div>

      <div style={{width:"100%",maxWidth:460,background:"white",borderRadius:20,boxShadow:"0 40px 80px rgba(0,0,0,.4)",overflow:"hidden"}}>
        <div style={{background:C.groen,padding:"16px 28px"}}>
          <div style={{fontSize:14,fontWeight:700,color:"white"}}>
            {!rolFilter ? "Selecteer je rol" : !geselecteerd ? `${rollen.find(r=>r.id===rolFilter)?.label} — Wie ben jij?` : `Inloggen als ${geselecteerd.naam}`}
          </div>
        </div>
        <div style={{padding:"24px 28px 28px"}}>

          {/* Stap 1: Rol kiezen */}
          {!rolFilter && (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {rollen.map(r=>(
                <button key={r.id} onClick={()=>setRolFilter(r.id)}
                  style={{background:C.bg,border:`2px solid ${C.border}`,borderRadius:12,padding:"16px 20px",color:C.text,display:"flex",alignItems:"center",gap:14,textAlign:"left",transition:"all .15s",cursor:"pointer"}}>
                  <div style={{width:44,height:44,borderRadius:12,background:r.kleur+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{r.icon}</div>
                  <div>
                    <div style={{fontWeight:700,fontSize:16}}>{r.label}</div>
                    <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                      {r.id==="collega"?"Melding doorgeven & woningen bekijken":r.id==="huismeester"?"Taken & checklists afhandelen":r.id==="financieel"?"Huurbetalingen & financieel overzicht":"Planning, inbox & beheer"}
                    </div>
                  </div>
                  <div style={{marginLeft:"auto",color:C.border,fontSize:20}}>›</div>
                </button>
              ))}
            </div>
          )}

          {/* Stap 2: Naam kiezen */}
          {rolFilter && !geselecteerd && (
            <>
              <button onClick={()=>setRolFilter(null)} style={{background:"none",border:"none",color:C.muted,fontSize:13,marginBottom:16,display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontFamily:"inherit"}}>← Terug</button>
              <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:320,overflowY:"auto"}}>
                {gefilterd.map(g=>(
                  <button key={g.naam} onClick={()=>{setGeselecteerd(g);setFout("");setPin("");}}
                    style={{background:C.bg,border:`1.5px solid ${C.border}`,borderRadius:10,padding:"12px 16px",color:C.text,display:"flex",alignItems:"center",gap:12,textAlign:"left",transition:"all .15s",cursor:"pointer"}}>
                    <div style={{width:36,height:36,borderRadius:10,background:rolKleur[g.rol]+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                      {g.rol==="backoffice"?"📊":g.rol==="huismeester"?"🏠":"👤"}
                    </div>
                    <span style={{fontWeight:700,fontSize:15}}>{g.naam}</span>
                    <div style={{marginLeft:"auto",color:C.border,fontSize:18}}>›</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Stap 3: Pincode */}
          {geselecteerd && (
            <>
              <button onClick={()=>{setGeselecteerd(null);setPin("");setFout("");}} style={{background:"none",border:"none",color:C.muted,fontSize:13,marginBottom:20,display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontFamily:"inherit"}}>← Terug</button>
              <div style={{textAlign:"center",marginBottom:24}}>
                <div style={{width:60,height:60,borderRadius:16,background:rolKleur[geselecteerd.rol]+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,margin:"0 auto 10px"}}>
                  {geselecteerd.rol==="backoffice"?"📊":geselecteerd.rol==="huismeester"?"🏠":"👤"}
                </div>
                <div style={{fontWeight:800,fontSize:20,color:C.text}}>{geselecteerd.naam}</div>
              </div>
              <label style={{display:"block",fontSize:11,fontWeight:700,color:C.muted,letterSpacing:"1px",textTransform:"uppercase",marginBottom:8}}>Pincode</label>
              <input type="password" value={pin} onChange={e=>{setPin(e.target.value);setFout("");}} onKeyDown={e=>e.key==="Enter"&&probeerLogin()} placeholder="••••" maxLength={8}
                style={{width:"100%",background:C.bg,border:`2px solid ${fout?"#ef4444":C.border}`,borderRadius:10,color:C.text,padding:"16px",fontSize:26,outline:"none",letterSpacing:10,textAlign:"center",marginBottom:10,transition:"border .2s"}}/>
              {fout&&<div style={{color:"#ef4444",fontSize:13,marginBottom:12,textAlign:"center",fontWeight:500}}>⚠ {fout}</div>}
              <button onClick={probeerLogin} disabled={!pin}
                style={{width:"100%",background:pin?C.blauw:C.border,color:"white",border:"none",borderRadius:10,padding:14,fontSize:15,fontWeight:700,cursor:pin?"pointer":"not-allowed",fontFamily:"inherit",transition:"background .2s"}}>
                Inloggen →
              </button>
            </>
          )}
        </div>
      </div>
      <div style={{marginTop:20,fontSize:12,color:"rgba(255,255,255,.4)"}}>KTP Interflex · Woningbeheer systeem</div>
    </div>
  );
}

function LoadingScreen() {
  return <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${C.blauw} 0%,${C.dark} 100%)`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Inter,sans-serif"}}><div style={{textAlign:"center",color:"white"}}><div style={{fontSize:36,marginBottom:16}}>⏳</div><div style={{fontWeight:700,fontSize:16,marginBottom:6}}>KTP Interflex</div><div style={{fontSize:13,opacity:.6}}>Verbinden met database...</div></div></div>;
}

function SH({titel,sub,actie}) {
  return <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:24}}><div><h2 style={{fontSize:20,fontWeight:800,color:C.blauw,marginBottom:3}}>{titel}</h2>{sub&&<p style={{fontSize:13,color:C.muted}}>{sub}</p>}</div>{actie}</div>;
}

function SK({label,val,color}) {
  return <div className="card" style={{borderTop:`3px solid ${color}`,padding:"14px 16px"}}><div style={{fontSize:26,fontWeight:800,color}}>{val}</div><div style={{fontSize:11,color:C.muted,marginTop:3}}>{label}</div></div>;
}

// ─── DAGPLANNING HUISMEESTER ──────────────────────────────────────────────────
function DagplanningView({ meldingen, taken, houses, onUpdate, onUpdateTaak, naam, dagplanningDB = [], checklistItems = [], checklists = [], autoMeldingen = [] }) {
  const dag = dagVanDeWeek();
  const planningMap = dagplanningDB.length > 0
    ? Object.fromEntries(dagplanningDB.map(d => [d.dag, { label: d.label, kleur: d.kleur, icon: d.icon, focus: d.focus, taken: d.taken, woning_ids: d.woning_ids||[] }]))
    : DAGPLANNING;
  const vandaag = planningMap[dag];
  const dagNamen = dagplanningDB.length > 0 ? dagplanningDB.map(d => d.dag) : ["ma","di","wo","do","vr"];
  const [gekozenDag, setGekozenDag] = useState(dag in planningMap ? dag : "ma");
  const getoondeDag = planningMap[gekozenDag] || { label: gekozenDag, kleur: C.muted, icon: "🔧", focus: "", woning_ids: [], taken: [] };

  // Week navigatie
  const [weekOffset, setWeekOffset] = useState(0);

  function getMaandagVanWeek(offset) {
    const nu = new Date();
    const m = new Date(nu);
    m.setDate(nu.getDate() - ((nu.getDay() + 6) % 7) + offset * 7);
    m.setHours(0,0,0,0);
    return m;
  }
  function getWeekInfo(offset) {
    const ma = getMaandagVanWeek(offset);
    const zo = new Date(ma); zo.setDate(ma.getDate() + 6);
    const d = new Date(ma); d.setDate(d.getDate() + 3);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNr = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    const mnd = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];
    const s = dt => `${dt.getDate()} ${mnd[dt.getMonth()]}`;
    return { weekNr, jaar: d.getFullYear(), key: `${weekNr}-${d.getFullYear()}`, label: `Week ${weekNr} · ${s(ma)} – ${s(zo)} ${d.getFullYear()}`, start: ma.toISOString().slice(0,10), eind: zo.toISOString().slice(0,10) };
  }
  function dagDatumVoorOffset(dagNaam, offset) {
    const ma = getMaandagVanWeek(offset);
    const dagIdxMap = {"ma":0,"di":1,"wo":2,"do":3,"vr":4,"za":5,"zo":6};
    const idx = dagIdxMap[dagNaam] ?? 0;
    const d = new Date(ma); d.setDate(ma.getDate() + idx);
    return d.toISOString().slice(0,10);
  }

  const weekInfo = getWeekInfo(weekOffset);
  const isHuidigeWeek = weekOffset === 0;
  const isVerledenWeek = weekOffset < 0;

  const weekTaken = taken.filter(t => {
    if (t.ingepland_op) return t.ingepland_op >= weekInfo.start && t.ingepland_op <= weekInfo.eind;
    return isHuidigeWeek && t.status === "open";
  });
  const openTaken = weekTaken.filter(t => t.status === "open");
  const openMeldingen = meldingen.filter(m=>m.status==="open");

  const [toonNieuwKlusje, setToonNieuwKlusje] = useState(false);
  const [nieuwKlusje, setNieuwKlusje] = useState({titel:"",omschrijving:"",woning_id:"",kamer:"",prioriteit:"middel",ingepland_op:""});
  const [savingKlusje, setSavingKlusje] = useState(false);
  const dagDatumVoorKlusje = dagDatumVoorOffset(gekozenDag, weekOffset);

  async function voegKlusjeIn() {
    if (!nieuwKlusje.titel.trim()) return;
    setSavingKlusje(true);
    await supabase.from("taken").insert([{
      titel: nieuwKlusje.titel.trim(),
      omschrijving: nieuwKlusje.omschrijving || null,
      woning_id: nieuwKlusje.woning_id ? Number(nieuwKlusje.woning_id) : null,
      kamer: nieuwKlusje.kamer || null,
      prioriteit: nieuwKlusje.prioriteit,
      voor_rol: "huismeester",
      status: "open",
      ingepland_op: nieuwKlusje.ingepland_op || dagDatumVoorKlusje,
      aangemaakt_door: naam,
    }]);
    setSavingKlusje(false);
    setToonNieuwKlusje(false);
    setNieuwKlusje({titel:"",omschrijving:"",woning_id:"",kamer:"",prioriteit:"middel",ingepland_op:""});
  }

  const geselecteerdeHuisKlusje = houses.find(h=>h.id===Number(nieuwKlusje.woning_id));

  return (
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:4}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,color:C.blauw,marginBottom:3}}>📅 Mijn werkdag</h2>
          <p style={{fontSize:13,color:C.muted}}>{vandaag ? vandaag.focus : "Geniet van je vrije dag!"}</p>
        </div>
        <button onClick={()=>setToonNieuwKlusje(!toonNieuwKlusje)}
          style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"9px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
          + Klusje inplannen
        </button>
      </div>

      {/* Week navigatie */}
      <div style={{display:"flex",alignItems:"center",gap:10,margin:"12px 0 16px",background:"white",borderRadius:10,padding:"10px 14px",border:`1px solid ${C.border}`,justifyContent:"space-between"}}>
        <button onClick={()=>setWeekOffset(w=>w-1)}
          style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,padding:"7px 14px",fontSize:13,fontWeight:600,cursor:"pointer",color:C.blauw,fontFamily:"inherit"}}>
          ← Vorige week
        </button>
        <div style={{textAlign:"center"}}>
          <div style={{fontWeight:700,fontSize:14,color:isHuidigeWeek?C.groen:isVerledenWeek?"#b45309":C.blauw}}>{weekInfo.label}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>
            {isHuidigeWeek ? "✓ Huidige week" : isVerledenWeek ? "Verleden week" : "Toekomstige week"}
          </div>
        </div>
        <button onClick={()=>setWeekOffset(w=>w+1)}
          style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,padding:"7px 14px",fontSize:13,fontWeight:600,cursor:"pointer",color:C.blauw,fontFamily:"inherit"}}>
          Volgende week →
        </button>
      </div>

      {/* Nieuw klusje form */}
      {toonNieuwKlusje && (
        <div className="card" style={{marginBottom:20,borderTop:`3px solid ${C.groen}`}}>
          <div style={{fontWeight:700,fontSize:13,color:C.groen,marginBottom:14}}>🔧 Klusje inplannen</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div style={{gridColumn:"1/-1"}}>
              <label className="fl">Omschrijving *</label>
              <input className="fi" value={nieuwKlusje.titel} onChange={e=>setNieuwKlusje(p=>({...p,titel:e.target.value}))}
                placeholder="bijv. Lamp vervangen badkamer" autoFocus/>
            </div>
            <div>
              <label className="fl">Woning</label>
              <select className="fs" value={nieuwKlusje.woning_id} onChange={e=>setNieuwKlusje(p=>({...p,woning_id:e.target.value,kamer:""}))}>
                <option value="">Geen specifieke woning</option>
                {houses.map(h=><option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
              </select>
            </div>
            <div>
              <label className="fl">Kamer</label>
              <select className="fs" value={nieuwKlusje.kamer} onChange={e=>setNieuwKlusje(p=>({...p,kamer:e.target.value}))} disabled={!nieuwKlusje.woning_id}>
                <option value="">Selecteer kamer</option>
                {(geselecteerdeHuisKlusje?.kamers||[]).map(k=><option key={k.k} value={k.k}>Kamer {k.k}{k.naam?` — ${k.naam}`:""}</option>)}
              </select>
            </div>
            <div>
              <label className="fl">Inplannen op dag</label>
              <input type="date" className="fi" value={nieuwKlusje.ingepland_op || dagDatumVoorKlusje}
                onChange={e=>setNieuwKlusje(p=>({...p,ingepland_op:e.target.value}))}/>
            </div>
            <div>
              <label className="fl">Prioriteit</label>
              <select className="fs" value={nieuwKlusje.prioriteit} onChange={e=>setNieuwKlusje(p=>({...p,prioriteit:e.target.value}))}>
                <option value="hoog">Hoog</option>
                <option value="middel">Middel</option>
                <option value="laag">Laag</option>
              </select>
            </div>
            <div>
              <label className="fl">Toelichting</label>
              <input className="fi" value={nieuwKlusje.omschrijving} onChange={e=>setNieuwKlusje(p=>({...p,omschrijving:e.target.value}))} placeholder="Optioneel..."/>
            </div>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button className="btn-g" style={{padding:"9px 20px"}} onClick={voegKlusjeIn} disabled={savingKlusje||!nieuwKlusje.titel.trim()}>
              {savingKlusje?"Opslaan...":"Inplannen"}
            </button>
            <button className="btn-out" onClick={()=>setToonNieuwKlusje(false)}>Annuleren</button>
          </div>
        </div>
      )}

      {/* Dagknoppen */}
      <div style={{display:"flex",gap:8,marginBottom:24,flexWrap:"wrap"}}>
        {dagNamen.map(d=>{
          const info = planningMap[d];
          const isVandaag = d===dag && isHuidigeWeek;
          const dagISO = dagDatumVoorOffset(d, weekOffset);
          const dagTaken = weekTaken.filter(t => t.ingepland_op === dagISO);
          const heeftOpen = dagTaken.some(t => t.status === "open");
          const heeftGedaan = dagTaken.length > 0 && dagTaken.every(t => t.status === "gedaan");
          return (
            <button key={d} onClick={()=>setGekozenDag(d)}
              style={{flex:1,minWidth:100,background:gekozenDag===d?info.kleur:"white",color:gekozenDag===d?"white":C.text,border:`2px solid ${gekozenDag===d?info.kleur:C.border}`,borderRadius:12,padding:"12px 10px",cursor:"pointer",fontFamily:"inherit",transition:"all .2s"}}>
              <div style={{fontSize:18,marginBottom:4}}>{info.icon}</div>
              <div style={{fontWeight:700,fontSize:13}}>{info.label}</div>
              {isVandaag&&<div style={{fontSize:10,marginTop:3,opacity:.8,fontWeight:600}}>VANDAAG</div>}
              {heeftOpen&&<div style={{fontSize:10,marginTop:3,color:gekozenDag===d?"rgba(255,255,255,.8)":"#ef4444",fontWeight:700}}>openstaand</div>}
              {heeftGedaan&&!heeftOpen&&<div style={{fontSize:10,marginTop:3,color:gekozenDag===d?"rgba(255,255,255,.8)":"#16a34a",fontWeight:700}}>klaar</div>}
            </button>
          );
        })}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        {/* Dagtaken + woningen */}
        <div className="card" style={{borderTop:`4px solid ${getoondeDag.kleur}`}}>
          <div style={{fontWeight:800,fontSize:15,color:getoondeDag.kleur,marginBottom:4}}>{getoondeDag.icon} {getoondeDag.label}</div>
          <div style={{fontSize:13,color:C.muted,marginBottom:12}}>{getoondeDag.focus}</div>

          {/* Woningen vandaag */}
          {(getoondeDag.woning_ids||[]).length > 0 && (
            <div style={{marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".6px",textTransform:"uppercase",marginBottom:8}}>Woningen vandaag</div>
              {(getoondeDag.woning_ids||[]).map(id=>{
                const h = houses.find(h=>h.id===id);
                if (!h) return null;
                const hMeldingen = openMeldingen.filter(m=>m.woning_id===h.id && m.type!=="aankomst" && m.type!=="vertrek");
                const hTaken = weekTaken.filter(t=>t.woning_id===h.id);
                return (
                  <WoningKaartDag
                    key={id}
                    huis={h}
                    kleur={getoondeDag.kleur}
                    hTaken={hTaken}
                    hMeldingen={hMeldingen}
                    checklistItems={checklistItems}
                    checklists={checklists}
                    naam={naam}
                    onUpdateTaak={onUpdateTaak}
                    gekozenDag={gekozenDag}
                    weekJaar={weekInfo.key}
                    weekOffset={weekOffset}
                  />
                );
              })}
            </div>
          )}

          {/* Ingeplande taken voor gekozen dag */}
          {(() => {
            const dagISO = dagDatumVoorOffset(gekozenDag, weekOffset);
            const ingeplandDag = weekTaken.filter(t => t.ingepland_op === dagISO);
            const openIngepland = ingeplandDag.filter(t => t.status === "open");
            const gedaanIngepland = ingeplandDag.filter(t => t.status === "gedaan");
            const aankomstenVandaag = meldingen.filter(m =>
              (m.type === "aankomst" || m.type === "reservering") && m.datum === dagISO
            );
            if (ingeplandDag.length === 0 && aankomstenVandaag.length === 0) return null;
            return (
              <div style={{marginBottom:16}}>
                {aankomstenVandaag.length > 0 && (
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:11,fontWeight:700,color:C.groen,letterSpacing:".6px",textTransform:"uppercase",marginBottom:8}}>Aankomsten op deze dag ({aankomstenVandaag.length})</div>
                    {aankomstenVandaag.map(m => {
                      const h = houses.find(h=>h.id===m.woning_id);
                      return (
                        <div key={m.id} style={{background:"#f0fdf4",borderRadius:10,padding:"10px 14px",marginBottom:8,border:"1px solid #bbf7d0"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <span style={{fontSize:16}}>{m.type==="reservering"?"📅":"🏠"}</span>
                            <div>
                              <div style={{fontWeight:700,fontSize:13,color:C.groen}}>{m.medewerker}</div>
                              <div style={{fontSize:12,color:C.muted}}>{h?`${h.adres}, ${h.stad}`:""}{m.kamer?` · K${m.kamer}`:""}</div>
                              {m.opmerkingen && <div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>"{m.opmerkingen}"</div>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {openIngepland.length > 0 && (
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#7c3aed",letterSpacing:".6px",textTransform:"uppercase",marginBottom:8}}>Ingepland — open ({openIngepland.length})</div>
                    {openIngepland.map(t => {
                      const h = houses.find(h=>h.id===t.woning_id);
                      return (
                        <div key={t.id} style={{background:"#f5f3ff",borderRadius:10,padding:"10px 14px",marginBottom:8,border:"1px solid #ddd6fe",display:"flex",alignItems:"flex-start",gap:10}}>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700,fontSize:13,color:"#7c3aed"}}>{t.titel}</div>
                            {h && <div style={{fontSize:12,color:C.muted}}>📍 {h.adres}, {h.stad}{t.kamer?` · K${t.kamer}`:""}</div>}
                            {t.huismeester_opmerking && <div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>"{t.huismeester_opmerking}"</div>}
                          </div>
                          <button onClick={()=>onUpdateTaak(t.id,{status:"gedaan",afgehandeld_door:naam,afgehandeld_op:new Date().toISOString()})}
                            style={{background:C.groen,color:"white",border:"none",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
                            Gedaan
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {gedaanIngepland.length > 0 && (
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:C.groen,letterSpacing:".6px",textTransform:"uppercase",marginBottom:8}}>Afgerond ({gedaanIngepland.length})</div>
                    {gedaanIngepland.map(t => {
                      const h = houses.find(h=>h.id===t.woning_id);
                      return (
                        <div key={t.id} style={{background:"#f0fdf4",borderRadius:10,padding:"10px 14px",marginBottom:8,border:"1px solid #bbf7d0",display:"flex",alignItems:"flex-start",gap:10}}>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700,fontSize:13,color:C.groen,textDecoration:"line-through"}}>{t.titel}</div>
                            {h && <div style={{fontSize:12,color:C.muted}}>📍 {h.adres}{t.kamer?` · K${t.kamer}`:""}</div>}
                            {t.afgehandeld_door && <div style={{fontSize:11,color:C.groen,marginTop:2}}>✓ {t.afgehandeld_door}{t.afgehandeld_op?` · ${fmtDate(t.afgehandeld_op)}`:""}</div>}
                          </div>
                          <button onClick={()=>onUpdateTaak(t.id,{status:"open",afgehandeld_door:null,afgehandeld_op:null})}
                            title="Terugzetten naar open"
                            style={{background:"#fee2e2",color:"#b91c1c",border:"1px solid #fca5a5",borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
                            ↩
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Vaste taken */}
          <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".6px",textTransform:"uppercase",marginBottom:8}}>Vaste taken</div>
          {(getoondeDag.taken||[]).map((t,i)=>(
            <div key={i} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:i<(getoondeDag.taken||[]).length-1?`1px solid ${C.border}`:"none",alignItems:"flex-start"}}>
              <div style={{width:22,height:22,borderRadius:6,background:getoondeDag.kleur+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:getoondeDag.kleur,flexShrink:0,marginTop:1}}>{i+1}</div>
              <span style={{fontSize:13,color:C.text}}>{t}</span>
            </div>
          ))}
        </div>

        {/* Open meldingen & taken overzicht */}
        <div>
          <div className="card" style={{marginBottom:16,borderTop:`4px solid #ef4444`}}>
            <div style={{fontWeight:800,fontSize:15,color:"#ef4444",marginBottom:12}}>Open meldingen ({openMeldingen.length})</div>
            {openMeldingen.length===0
              ? <div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>Geen openstaande meldingen</div>
              : openMeldingen.slice(0,5).map(m=>{
                const huis=houses.find(h=>h.id===m.woning_id);
                const typeLabel = m.type==="aankomst"?"Aankomst":m.type==="vertrek"?"Vertrek":m.type==="vertrek_aankondiging"?"Vertrek aankondiging":m.type==="reservering"?"Reservering":m.type==="verhuizing"?"Verhuizing":"Melding";
                const typeKleur = m.type==="aankomst"?C.groen:m.type==="vertrek"?"#7c3aed":m.type==="reservering"?C.blauw:"#f59e0b";
                return (
                  <div key={m.id} style={{padding:"10px 0",borderBottom:`1px solid ${C.border}`,display:"flex",gap:10,alignItems:"flex-start"}}>
                    <span style={{fontSize:18}}>{m.type==="aankomst"?"🚗":m.type==="vertrek"?"🧳":"📅"}</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:13,color:C.text}}>{m.medewerker}</div>
                      <div style={{fontSize:11,color:"white",background:typeKleur,borderRadius:6,padding:"1px 7px",display:"inline-block",marginTop:2,marginBottom:3}}>{typeLabel}</div>
                      <div style={{fontSize:12,color:C.muted}}>{huis?.adres||""}{m.kamer?` · K${m.kamer}`:""}</div>
                      {m.datum && <div style={{fontSize:12,fontWeight:700,color:typeKleur,marginTop:2}}>📅 {typeLabel}: {fmtDate(m.datum)}</div>}
                    </div>
                    <button className="btn-g" style={{padding:"5px 12px",fontSize:11}} onClick={()=>onUpdate(m.id,"afgehandeld","")}>✓</button>
                  </div>
                );
              })}
            {openMeldingen.length>5&&<div style={{fontSize:12,color:C.muted,marginTop:8,fontStyle:"italic"}}>+{openMeldingen.length-5} meer</div>}
          </div>

          {/* Auto meldingen: storingen + reserveringen */}
          {autoMeldingen.length > 0 && (
            <div className="card" style={{marginBottom:16,borderTop:"4px solid #7c3aed"}}>
              <div style={{fontWeight:800,fontSize:15,color:"#7c3aed",marginBottom:12}}>🚗 Auto meldingen ({autoMeldingen.length})</div>
              {autoMeldingen.map(a => (
                <div key={a.id} style={{padding:"10px 0",borderBottom:`1px solid ${C.border}`,display:"flex",gap:10,alignItems:"flex-start"}}>
                  <span style={{fontSize:18}}>{a.actie==="storing"?"🔧":"📅"}</span>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:3}}>
                      <span style={{fontWeight:700,fontSize:13,color:C.text}}>{a.kenteken||"?"}</span>
                      <span style={{fontSize:11,color:"white",background:a.actie==="storing"?"#dc2626":"#7c3aed",borderRadius:6,padding:"1px 7px",fontWeight:600}}>
                        {a.actie==="storing"?"STORING":"RESERVERING"}
                      </span>
                    </div>
                    {a.naam_medewerker&&a.naam_medewerker!=="-"&&<div style={{fontSize:12,color:C.muted}}>👤 {a.naam_medewerker}</div>}
                    {a.opmerkingen&&<div style={{fontSize:12,color:C.text,marginTop:2,fontStyle:"italic"}}>"{a.opmerkingen}"</div>}
                    {a.datum_tijd&&<div style={{fontSize:12,fontWeight:700,color:"#7c3aed",marginTop:2}}>📅 {fmtDate(a.datum_tijd)}</div>}
                    <div style={{fontSize:11,color:C.muted,marginTop:2}}>Door: {a.ingediend_door||"?"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card" style={{borderTop:`4px solid ${C.groen}`}}>
            <div style={{fontWeight:800,fontSize:15,color:C.groen,marginBottom:12}}>
              {isHuidigeWeek ? "Openstaande to-do's" : `To-do's ${weekInfo.label}`} ({weekTaken.length})
            </div>
            {weekTaken.length===0
              ? <div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>{isVerledenWeek ? "Geen taken voor deze week" : "Geen open taken"}</div>
              : weekTaken.slice(0,8).map(t=>{
                const huis=houses.find(h=>h.id===t.woning_id);
                const isDone = t.status === "gedaan";
                return (
                  <div key={t.id} style={{padding:"10px 0",borderBottom:`1px solid ${C.border}`,display:"flex",gap:10,alignItems:"flex-start",opacity:isDone?.75:1}}>
                    <span style={{fontSize:16,marginTop:2}}>{isDone?"✅":t.prioriteit==="hoog"?"🔴":t.prioriteit==="middel"?"🟡":"🟢"}</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:13,color:isDone?C.groen:C.text,textDecoration:isDone?"line-through":"none"}}>{t.titel}</div>
                      <div style={{fontSize:12,color:C.muted}}>{huis?.adres||"Algemeen"}{t.kamer?` · K${t.kamer}`:""}</div>
                      {t.ingepland_op && <div style={{fontSize:12,fontWeight:700,color:"#7c3aed",marginTop:2}}>📅 {fmtDate(t.ingepland_op)}</div>}
                      {isDone && t.afgehandeld_door && <div style={{fontSize:11,color:C.groen,marginTop:1}}>✓ {t.afgehandeld_door}</div>}
                    </div>
                    {!isDone ? (
                      <button className="btn-b" style={{padding:"5px 12px",fontSize:11}} onClick={()=>onUpdateTaak(t.id,{status:"gedaan",afgehandeld_door:naam,afgehandeld_op:new Date().toISOString(),notitie:null})}>✓</button>
                    ) : (
                      <button onClick={()=>onUpdateTaak(t.id,{status:"open",afgehandeld_door:null,afgehandeld_op:null})}
                        title="Terugzetten naar open"
                        style={{background:"#fee2e2",color:"#b91c1c",border:"1px solid #fca5a5",borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
                        ↩
                      </button>
                    )}
                  </div>
                );
              })}
            {weekTaken.length>8&&<div style={{fontSize:12,color:C.muted,marginTop:8,fontStyle:"italic"}}>+{weekTaken.length-8} meer</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── WONING KAART DAG (uitklapbaar met inline checklist) ─────────────────────
function WoningKaartDag({ huis, kleur, hTaken, hMeldingen, checklistItems, checklists, naam, onUpdateTaak, gekozenDag, weekJaar: weekJaarProp, weekOffset=0 }) {
  const [open, setOpen] = useState(false);
  const [checklistTab, setChecklistTab] = useState("wekelijks");
  const [saving, setSaving] = useState(false);
  const [toonOpmerkingItem, setToonOpmerkingItem] = useState({});
  const [opmerkingItem, setOpmerkingItem] = useState({});

  // Week/jaar — gebruik prop als meegegeven, anders huidige week
  const weekJaar = weekJaarProp || (() => {
    const nu = new Date();
    const d = new Date(nu); d.setHours(0,0,0,0); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNr = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${weekNr}-${d.getFullYear()}`;
  })();

  // Periode keys afleiden uit weekJaar (bijv "21-2026")
  const [wnStr, jaarStr] = weekJaar.split("-");
  const wnNum = parseInt(wnStr) || 1;
  const jaarNum = parseInt(jaarStr) || new Date().getFullYear();
  // 4-wekelijkse periode: week 1-4 = P1, 5-8 = P2, 9-12 = P3 ...
  const periode4W = `4W${Math.ceil(wnNum / 4)}-${jaarNum}`;
  // Kwartaal: week 1-13 = Q1, 14-26 = Q2, 27-39 = Q3, 40-52 = Q4
  const periodeQ  = `Q${Math.ceil(wnNum / 13)}-${jaarNum}`;

  // ─── Items per type ───────────────────────────────────────────────────────
  const weekItems = checklistItems.filter(i => i.type === "wekelijks"   && i.actief);
  const items4W   = checklistItems.filter(i => i.type === "4wekelijks"  && i.actief);
  const itemsQ    = checklistItems.filter(i => i.type === "kwartaal"    && i.actief);

  // ─── Bestaande checklists ─────────────────────────────────────────────────
  const chkWeek = checklists.find(c => c.woning_id === huis.id && c.week_jaar === weekJaar  && c.type === "wekelijks");
  const chk4W   = checklists.find(c => c.woning_id === huis.id && c.week_jaar === periode4W && c.type === "4wekelijks");
  const chkQ    = checklists.find(c => c.woning_id === huis.id && c.week_jaar === periodeQ  && c.type === "kwartaal");

  const afgWeek = chkWeek?.items || [];
  const afg4W   = chk4W?.items   || [];
  const afgQ    = chkQ?.items    || [];
  const opmWeek = chkWeek?.items_opmerkingen || {};

  // ─── Klaar-flags ─────────────────────────────────────────────────────────
  const weekKlaar = weekItems.length > 0 && weekItems.every(i => afgWeek.includes(i.id));
  const w4Klaar   = items4W.length  > 0 && items4W.every(i  => afg4W.includes(i.id));
  const qKlaar    = itemsQ.length   > 0 && itemsQ.every(i   => afgQ.includes(i.id));

  // Badge counts voor header
  const openTakenCount  = hTaken.filter(t => t.status === "open").length;
  const openCheckWeek   = weekItems.filter(i => !afgWeek.includes(i.id)).length;
  const allesKlaar      = openTakenCount === 0 && hMeldingen.length === 0 && weekKlaar && w4Klaar && qKlaar;

  // ─── Toggle helpers ───────────────────────────────────────────────────────
  async function toggleItem(type, periodeKey, bestaand, afgevinkt, itemId) {
    setSaving(true);
    const nieuw = afgevinkt.includes(itemId) ? afgevinkt.filter(i => i !== itemId) : [...afgevinkt, itemId];
    const sleutel = `${huis.id}-${type}-${periodeKey}`;
    if (bestaand) {
      await supabase.from("checklists").update({ items: nieuw, bijgewerkt_door: naam, updated_at: new Date().toISOString() }).eq("id", bestaand.id);
    } else {
      await supabase.from("checklists").insert([{ sleutel, type, week_jaar: periodeKey, woning_id: huis.id, items: nieuw, items_opmerkingen: {}, aangemaakt_door: naam, bijgewerkt_door: naam }]);
    }
    setSaving(false);
  }

  async function slaOpmerkingOp(itemId, tekst) {
    setSaving(true);
    const nieuweOpm = { ...opmWeek, [itemId]: tekst };
    const sleutel = `${huis.id}-wekelijks-${weekJaar}`;
    if (chkWeek) {
      await supabase.from("checklists").update({ items_opmerkingen: nieuweOpm, bijgewerkt_door: naam, updated_at: new Date().toISOString() }).eq("id", chkWeek.id);
    } else {
      await supabase.from("checklists").insert([{ sleutel, type: "wekelijks", week_jaar: weekJaar, woning_id: huis.id, items: [], items_opmerkingen: nieuweOpm, aangemaakt_door: naam, bijgewerkt_door: naam }]);
    }
    setSaving(false);
    setToonOpmerkingItem(p => ({...p, [itemId]: false}));
  }

  const typeConfig = {
    wekelijks:  { label: "Wekelijks",   icon: "📋", kleur: C.blauw,    items: weekItems, bestaand: chkWeek, afgevinkt: afgWeek, periodeKey: weekJaar,  klaarFlag: weekKlaar,  periodeLabel: `Week ${wnNum}` },
    "4wekelijks":{ label: "4-wekelijks", icon: "📅", kleur: "#7c3aed", items: items4W,   bestaand: chk4W,   afgevinkt: afg4W,  periodeKey: periode4W, klaarFlag: w4Klaar,   periodeLabel: `Periode ${Math.ceil(wnNum/4)} (wk ${(Math.ceil(wnNum/4)-1)*4+1}–${Math.ceil(wnNum/4)*4})` },
    kwartaal:   { label: "Kwartaal",    icon: "🏆", kleur: "#f59e0b",  items: itemsQ,   bestaand: chkQ,    afgevinkt: afgQ,   periodeKey: periodeQ,  klaarFlag: qKlaar,    periodeLabel: `Q${Math.ceil(wnNum/13)} ${jaarNum}` },
  };
  const actieveConfig = typeConfig[checklistTab];

  return (
    <div style={{
      background: allesKlaar ? "#f0fdf4" : "white",
      borderRadius: 10, marginBottom: 8,
      border: `1px solid ${allesKlaar ? "#bbf7d0" : C.border}`,
      borderLeft: `4px solid ${allesKlaar ? C.groen : kleur}`,
      overflow: "hidden",
    }}>
      {/* ─── Header (klikbaar) ─── */}
      <div onClick={() => setOpen(!open)} style={{padding:"12px 14px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:13,color:allesKlaar?C.groen:kleur}}>
            📍 {huis.adres}, {huis.stad}
          </div>
          <div style={{fontSize:11,color:C.muted,marginTop:3,display:"flex",gap:8,flexWrap:"wrap"}}>
            {openTakenCount > 0 && <span style={{color:"#f59e0b"}}>🔧 {openTakenCount} taak{openTakenCount>1?"en":""}</span>}
            {hMeldingen.length > 0 && <span style={{color:"#ef4444"}}>⚠️ {hMeldingen.length} melding{hMeldingen.length>1?"en":""}</span>}
            {weekKlaar  ? <span style={{color:C.groen}}>📋 ✓</span> : openCheckWeek > 0 ? <span style={{color:C.muted}}>📋 {weekItems.length - openCheckWeek}/{weekItems.length}</span> : null}
            {w4Klaar    ? <span style={{color:C.groen}}>📅 ✓</span> : items4W.length > 0 ? <span style={{color:"#7c3aed"}}>📅 {afg4W.length}/{items4W.length}</span> : null}
            {qKlaar     ? <span style={{color:C.groen}}>🏆 ✓</span> : itemsQ.length  > 0 ? <span style={{color:"#f59e0b"}}>🏆 {afgQ.length}/{itemsQ.length}</span>  : null}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {allesKlaar && <span style={{fontSize:11,fontWeight:700,color:C.groen}}>✅ Klaar</span>}
          <span style={{color:C.muted,fontSize:14}}>{open?"▲":"▼"}</span>
        </div>
      </div>

      {/* ─── Uitklapbaar ─── */}
      {open && (
        <div style={{borderTop:`1px solid ${C.border}`,padding:"12px 14px"}}>

          {/* Taken */}
          {hTaken.length > 0 && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:"#f59e0b",letterSpacing:".6px",textTransform:"uppercase",marginBottom:8}}>🔧 Taken</div>
              {hTaken.map(t => (
                <div key={t.id} style={{display:"flex",gap:10,padding:"7px 0",borderBottom:`1px solid ${C.border}`,alignItems:"center"}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:t.status==="gedaan"?C.groen:C.text,textDecoration:t.status==="gedaan"?"line-through":"none"}}>{t.titel}</div>
                    {t.omschrijving&&<div style={{fontSize:11,color:C.muted,marginTop:1}}>{t.omschrijving}</div>}
                    {t.status==="gedaan"&&t.afgehandeld_door&&<div style={{fontSize:11,color:C.groen,marginTop:1}}>✓ {t.afgehandeld_door}</div>}
                  </div>
                  {t.status !== "gedaan" ? (
                    <button onClick={()=>onUpdateTaak(t.id,{status:"gedaan",afgehandeld_door:naam,afgehandeld_op:new Date().toISOString()})}
                      style={{background:C.groen,color:"white",border:"none",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
                      ✓ Gedaan
                    </button>
                  ) : (
                    <button onClick={()=>onUpdateTaak(t.id,{status:"open",afgehandeld_door:null,afgehandeld_op:null})}
                      title="Terugzetten naar open"
                      style={{background:"#fee2e2",color:"#b91c1c",border:"1px solid #fca5a5",borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
                      ↩ Terugzetten
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Meldingen */}
          {hMeldingen.length > 0 && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:"#ef4444",letterSpacing:".6px",textTransform:"uppercase",marginBottom:8}}>⚠️ Meldingen</div>
              {hMeldingen.map(m=>(
                <div key={m.id} style={{padding:"7px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                  <div style={{fontWeight:600,color:C.text}}>{m.medewerker} — {m.type}</div>
                  {m.opmerkingen&&<div style={{color:C.muted,marginTop:1}}>{m.opmerkingen}</div>}
                </div>
              ))}
            </div>
          )}

          {/* ─── Checklist tabs ─── */}
          <div>
            {/* Tab knoppen */}
            <div style={{display:"flex",gap:6,marginBottom:12}}>
              {Object.entries(typeConfig).map(([key, cfg]) => {
                const isActief = checklistTab === key;
                const done = cfg.klaarFlag;
                return (
                  <button key={key} onClick={()=>setChecklistTab(key)}
                    style={{flex:1,background:isActief?cfg.kleur:"white",color:isActief?"white":done?C.groen:C.text,border:`2px solid ${isActief?cfg.kleur:done?"#bbf7d0":C.border}`,borderRadius:8,padding:"7px 8px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"all .15s",position:"relative"}}>
                    {cfg.icon} {cfg.label}
                    {done && !isActief && <span style={{marginLeft:4,color:C.groen}}>✓</span>}
                    {!done && cfg.items.length > 0 && cfg.afgevinkt.length > 0 && !isActief && (
                      <span style={{marginLeft:4,fontSize:10,opacity:.7}}>{cfg.afgevinkt.length}/{cfg.items.length}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Periode label */}
            <div style={{fontSize:11,color:C.muted,marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
              <span>{actieveConfig.periodeLabel}</span>
              {saving && <span>⏳</span>}
              {actieveConfig.klaarFlag && <span style={{color:C.groen,fontWeight:700}}>✓ Alles afgerond voor deze periode</span>}
            </div>

            {/* Items */}
            {actieveConfig.klaarFlag ? (
              <div style={{background:"#f0fdf4",borderRadius:8,padding:"12px 14px",fontSize:13,color:C.groen,fontWeight:600,textAlign:"center"}}>
                ✅ Alle {actieveConfig.label.toLowerCase()} items zijn afgevinkt voor {actieveConfig.periodeLabel}.<br/>
                <span style={{fontSize:11,fontWeight:400,color:C.muted}}>Verschijnt weer bij de volgende periode.</span>
              </div>
            ) : actieveConfig.items.length === 0 ? (
              <div style={{background:C.bg,borderRadius:8,padding:"12px 14px",fontSize:13,color:C.muted,textAlign:"center"}}>
                Nog geen items voor <strong>{actieveConfig.label}</strong>.<br/>
                <span style={{fontSize:12}}>Voeg toe via <strong>⚙️ Beheer → Checklists</strong></span>
              </div>
            ) : (
              <div>
                {actieveConfig.items.map(item => {
                  const gedaan = actieveConfig.afgevinkt.includes(item.id);
                  const opmerking = checklistTab === "wekelijks" ? (opmWeek[item.id] || "") : "";
                  const toonOpm = toonOpmerkingItem[item.id];
                  return (
                    <div key={item.id} style={{borderBottom:`1px solid ${C.border}`}}>
                      <div style={{display:"flex",gap:10,padding:"9px 0",alignItems:"flex-start"}}>
                        <div onClick={() => toggleItem(checklistTab, actieveConfig.periodeKey, actieveConfig.bestaand, actieveConfig.afgevinkt, item.id)}
                          style={{width:22,height:22,borderRadius:5,border:`2px solid ${gedaan?actieveConfig.kleur:C.border}`,background:gedaan?actieveConfig.kleur:"white",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1,cursor:"pointer",transition:"all .15s"}}>
                          {gedaan&&<span style={{color:"white",fontSize:12,fontWeight:700}}>✓</span>}
                        </div>
                        <div style={{flex:1}}>
                          <span onClick={() => toggleItem(checklistTab, actieveConfig.periodeKey, actieveConfig.bestaand, actieveConfig.afgevinkt, item.id)}
                            style={{fontSize:13,color:gedaan?actieveConfig.kleur:C.text,textDecoration:gedaan?"line-through":"none",lineHeight:1.4,cursor:"pointer"}}>
                            {item.tekst}
                          </span>
                          {opmerking && !toonOpm && <div style={{fontSize:11,color:C.blauw,marginTop:2,fontStyle:"italic"}}>💬 {opmerking}</div>}
                        </div>
                        {checklistTab === "wekelijks" && (
                          <button onClick={()=>{ setToonOpmerkingItem(p=>({...p,[item.id]:!p[item.id]})); setOpmerkingItem(p=>({...p,[item.id]:opmerking})); }}
                            style={{background:"none",border:"none",color:opmerking?C.blauw:C.muted,fontSize:14,cursor:"pointer",padding:"2px 6px",flexShrink:0}}>💬</button>
                        )}
                      </div>
                      {checklistTab === "wekelijks" && toonOpm && (
                        <div style={{paddingBottom:8,paddingLeft:32}}>
                          <input value={opmerkingItem[item.id]||""} onChange={e=>setOpmerkingItem(p=>({...p,[item.id]:e.target.value}))}
                            placeholder={`Opmerking bij "${item.tekst.slice(0,30)}..."`} autoFocus
                            style={{width:"100%",background:"white",border:`1.5px solid ${C.blauw}`,borderRadius:8,color:C.text,padding:"6px 10px",fontSize:12,outline:"none",fontFamily:"inherit",boxSizing:"border-box",marginBottom:6}}/>
                          <div style={{display:"flex",gap:6}}>
                            <button onClick={()=>slaOpmerkingOp(item.id, opmerkingItem[item.id]||"")}
                              style={{background:C.blauw,color:"white",border:"none",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>✓ Opslaan</button>
                            {opmerking&&<button onClick={()=>slaOpmerkingOp(item.id,"")}
                              style={{background:"white",border:"1px solid #fecaca",color:"#ef4444",borderRadius:6,padding:"5px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>🗑</button>}
                            <button onClick={()=>setToonOpmerkingItem(p=>({...p,[item.id]:false}))}
                              style={{background:"white",border:`1px solid ${C.border}`,color:C.muted,borderRadius:6,padding:"5px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Annuleren</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── GECOMBINEERDE TAKEN & MELDINGEN VIEW ────────────────────────────────────
function TakenMeldingenView({ taken, meldingen, houses, gebruiker, onAddTaak, onUpdateTaak, onAddMelding, onUpdateMelding, showToast, taal="nl" }) {
  const rol = gebruiker?.rol;
  const isBackoffice = rol === "backoffice";
  const isHuismeester = rol === "huismeester";
  const isCollega = rol === "collega" || rol === "financieel";

  const [subTab, setSubTab] = useState("overzicht");
  const [filter, setFilter] = useState("open");
  const [zoek, setZoek] = useState("");
  const [sorteer, setSorteer] = useState("datum_nieuw"); // datum_nieuw | datum_oud | prioriteit | naam

  // Rol-gebaseerde filtering
  const mijnMeldingen = meldingen.filter(m => m.ingediend_door === gebruiker?.naam);

  const relevanteMeldingen = meldingen.filter(m => {
    if (isBackoffice) return m.voor_rol === "backoffice";
    if (isHuismeester) return true; // huismeester ziet alles
    if (isCollega) return m.ingediend_door === gebruiker?.naam;
    return false;
  }).filter(m => {
    // Huismeester: "open" toont alleen open/ingepland, "afgehandeld" toont verwerkte
    if (filter === "open") return m.status === "open" || m.status === "geaccepteerd";
    if (filter === "gedaan") return m.status !== "open" && m.status !== "geaccepteerd";
    return true;
  }).sort((a,b) => {
    const da = a.datum || a.created_at || "";
    const db = b.datum || b.created_at || "";
    return da.localeCompare(db);
  });

  const relevanteTaken = taken.filter(t => {
    if (isBackoffice) return t.voor_rol === "backoffice";
    if (isHuismeester) return t.voor_rol === "huismeester" || t.voor_rol === "iedereen" || !t.voor_rol;
    if (isCollega) return t.voor_rol === "iedereen" || !t.voor_rol;
    return false;
  }).filter(t => filter === "open" ? (t.status === "open" || t.status === "geaccepteerd") : filter === "gedaan" ? t.status === "gedaan" : true);

  const openCount = meldingen.filter(m => { if(isBackoffice) return m.voor_rol==="backoffice"&&m.status==="open"; if(isHuismeester) return m.status==="open"||m.status==="geaccepteerd"; if(isCollega) return m.ingediend_door===gebruiker?.naam&&m.status==="open"; return false; }).length + taken.filter(t => { if(isBackoffice) return t.voor_rol==="backoffice"&&(t.status==="open"||t.status==="geaccepteerd"); if(isHuismeester) return (t.voor_rol==="huismeester"||t.voor_rol==="iedereen"||!t.voor_rol)&&(t.status==="open"||t.status==="geaccepteerd"); if(isCollega) return (t.voor_rol==="iedereen"||!t.voor_rol)&&t.status==="open"; return false; }).length;

  // Zoek filter
  function zoekFilter(item, isMelding) {
    if (!zoek.trim()) return true;
    const q = zoek.toLowerCase();
    if (isMelding) {
      return (item.medewerker||"").toLowerCase().includes(q) ||
             (item.type||"").toLowerCase().includes(q) ||
             (item.opmerkingen||"").toLowerCase().includes(q) ||
             (houses.find(h=>h.id===item.woning_id)?.adres||"").toLowerCase().includes(q);
    } else {
      return (item.titel||"").toLowerCase().includes(q) ||
             (item.omschrijving||"").toLowerCase().includes(q) ||
             (item.aangemaakt_door||"").toLowerCase().includes(q) ||
             (houses.find(h=>h.id===item.woning_id)?.adres||"").toLowerCase().includes(q);
    }
  }

  // Sorteer functie
  function sorteerItems(items, isMelding) {
    return [...items].sort((a, b) => {
      if (sorteer === "datum_nieuw") return new Date(b.created_at||0) - new Date(a.created_at||0);
      if (sorteer === "datum_oud")  return new Date(a.created_at||0) - new Date(b.created_at||0);
      if (sorteer === "naam") return (isMelding ? a.medewerker : a.titel||"").localeCompare(isMelding ? b.medewerker : b.titel||"");
      if (sorteer === "prioriteit" && !isMelding) {
        const p = {hoog:0,middel:1,laag:2};
        return (p[a.prioriteit]??1) - (p[b.prioriteit]??1);
      }
      return 0;
    });
  }

  const gefilterdeMeldingen = sorteerItems(relevanteMeldingen.filter(m => zoekFilter(m, true)), true);
  const gefilterdetaken = sorteerItems(relevanteTaken.filter(t => zoekFilter(t, false)), false);

  const subTabs = [
    { id:"overzicht", label:`📋 Overzicht (${openCount})` },
    ...(isCollega ? [{ id:"nieuw", label:"+ Nieuwe melding/taak" }] : []),
    ...(isBackoffice || isHuismeester ? [{ id:"nieuw_taak", label:"+ Taak toevoegen" }] : []),
  ];

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,color:C.blauw,marginBottom:3}}>📋 Taken & Meldingen</h2>
          <p style={{fontSize:13,color:C.muted}}>{openCount} openstaand</p>
        </div>
      </div>

      {/* Sub tabs */}
      <div style={{display:"flex",gap:6,marginBottom:20,borderBottom:`2px solid ${C.border}`}}>
        {subTabs.map(t=>(
          <button key={t.id} onClick={()=>setSubTab(t.id)}
            style={{background:"none",border:"none",padding:"10px 18px",fontSize:13,fontWeight:700,color:subTab===t.id?C.blauw:C.muted,borderBottom:subTab===t.id?`3px solid ${C.blauw}`:"3px solid transparent",marginBottom:-2,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters + zoek + sorteer */}
      {subTab === "overzicht" && (
        <div style={{marginBottom:16}}>
          <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
            {[["open",vertaal("open",taal)],["gedaan",vertaal("afgehandeld",taal)],["alle",vertaal("alle",taal)]].map(([v,l])=>(
              <button key={v} onClick={()=>setFilter(v)}
                style={{background:filter===v?C.blauw:"white",color:filter===v?"white":C.muted,border:`1.5px solid ${filter===v?C.blauw:C.border}`,borderRadius:20,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                {l}
              </button>
            ))}
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <input value={zoek} onChange={e=>setZoek(e.target.value)}
              placeholder={`🔍 ${vertaal("zoek_placeholder",taal)}`}
              style={{flex:1,minWidth:200,background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 14px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
            <select value={sorteer} onChange={e=>setSorteer(e.target.value)}
              style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 14px",fontSize:13,outline:"none",fontFamily:"inherit",cursor:"pointer"}}>
              <option value="datum_nieuw">{`📅 ${vertaal("nieuwste_eerst",taal)}`}</option>
              <option value="datum_oud">{`📅 ${vertaal("oudste_eerst",taal)}`}</option>
              <option value="naam">{`🔤 ${vertaal("op_naam",taal)}`}</option>
              <option value="prioriteit">{`🔴 ${vertaal("op_prioriteit",taal)}`}</option>
            </select>
          </div>
        </div>
      )}

      {/* Overzicht */}
      {subTab === "overzicht" && (
        <div>
          {/* Meldingen sectie */}
          {gefilterdeMeldingen.length > 0 && (
            <div style={{marginBottom:24}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:10}}>
                📬 Meldingen ({gefilterdeMeldingen.length}){zoek&&relevanteMeldingen.length!==gefilterdeMeldingen.length&&<span style={{color:C.muted,fontWeight:400}}> — {relevanteMeldingen.length} totaal</span>}
              </div>
              {gefilterdeMeldingen.map(m => (
                <MeldingKaartCombined key={m.id} melding={m} houses={houses} gebruiker={gebruiker}
                  isBackoffice={isBackoffice} isHuismeester={isHuismeester}
                  onUpdate={onUpdateMelding} showToast={showToast} taal={taal}/>
              ))}
            </div>
          )}

          {/* Taken sectie */}
          {gefilterdetaken.length > 0 && (
            <div>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:10}}>
                🔧 Taken ({gefilterdetaken.length}){zoek&&relevanteTaken.length!==gefilterdetaken.length&&<span style={{color:C.muted,fontWeight:400}}> — {relevanteTaken.length} totaal</span>}
              </div>
              <TakenView taken={gefilterdetaken} houses={houses} gebruiker={gebruiker} onAdd={onAddTaak} onUpdate={onUpdateTaak} showToast={showToast} inlineMode/>
            </div>
          )}

          {gefilterdeMeldingen.length === 0 && gefilterdetaken.length === 0 && (
            <div style={{textAlign:"center",padding:"60px",color:C.muted}}>
              <div style={{fontSize:40,marginBottom:10}}>🎉</div>
              <div>Alles afgehandeld!</div>
            </div>
          )}
        </div>
      )}

      {/* Nieuwe melding (collega) */}
      {subTab === "nieuw" && isCollega && (
        <MeldingForm houses={houses} onSubmit={async(d)=>{ await onAddMelding(d); setSubTab("overzicht"); }} showToast={showToast} taal={taal}/>
      )}

      {/* Nieuwe taak (backoffice/huismeester) */}
      {subTab === "nieuw_taak" && (isBackoffice || isHuismeester) && (
        <NieuwesTaakForm houses={houses} gebruiker={gebruiker} onAdd={async(d)=>{ await onAddTaak(d); setSubTab("overzicht"); showToast("✓ Taak toegevoegd"); }} showToast={showToast}/>
      )}
    </div>
  );
}

// ─── FOTO UPLOAD MELDING ─────────────────────────────────────────────────────
function FotoUploadMelding({ melding: m, gebruiker }) {
  const [bestanden, setBestanden] = useState([]);
  const [uploading, setUploading] = useState(false);

  async function upload() {
    if (!bestanden.length) return;
    setUploading(true);
    const urls = await uploadBijlages(bestanden, `meldingen/${m.id}`);
    const bestaand = m.bijlages || [];
    await supabase.from("meldingen").update({ bijlages: [...bestaand, ...urls] }).eq("id", m.id);
    setBestanden([]);
    setUploading(false);
  }

  return (
    <div style={{marginTop:6}}>
      <BijlageUploader bestanden={bestanden} setBestanden={setBestanden} label="📷 Foto/document toevoegen"/>
      {bestanden.length > 0 && (
        <button onClick={upload} disabled={uploading}
          style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"7px 16px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",marginTop:8}}>
          {uploading ? "⏳ Uploaden..." : `⬆ ${bestanden.length} bestand${bestanden.length>1?"en":""} uploaden`}
        </button>
      )}
      {(m.bijlages||[]).length > 0 && (
        <div style={{marginTop:6}}>
          <BijlageWeergave bijlages={m.bijlages}/>
        </div>
      )}
    </div>
  );
}

// ─── MELDING KAART COMBINED ───────────────────────────────────────────────────
function MeldingKaartCombined({ melding: m, houses, gebruiker, isBackoffice, isHuismeester, onUpdate, showToast, taal="nl" }) {
  const huis = houses.find(h=>h.id===m.woning_id);
  const [toonNotitie, setToonNotitie] = useState(false);
  const [notitie, setNotitie] = useState("");
  const [toonInplannen, setToonInplannen] = useState(false);
  const [inplandatum, setInplandatum] = useState("");
  const [inplanOpmerking, setInplanOpmerking] = useState("");
  const [toonOpmerkingCollega, setToonOpmerkingCollega] = useState(false);
  const [opmerkingCollega, setOpmerkingCollega] = useState("");
  const [toonBewerk, setToonBewerk] = useState(false);
  const [bewerkData, setBewerkData] = useState({});

  const typeKleur = {aankomst:C.groen,vertrek:"#ef4444",vertrek_aankondiging:"#f59e0b",reservering:C.blauw,overig:C.oranje,verhuizing:"#0891b2"};
  const typeIcon = {aankomst:"🏠",vertrek:"🧳",vertrek_aankondiging:"📢",reservering:"📅",overig:"📝",verhuizing:"🔄"};
  const kleur = typeKleur[m.type] || C.muted;
  const isOpen = m.status === "open";
  const isIngepland = m.status === "geaccepteerd" || m.ingepland_op;

  return (
    <div style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${isOpen?kleur:C.muted}`,borderRadius:10,padding:"14px 18px",marginBottom:10,opacity:isOpen?1:.8}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{fontSize:18}}>{typeIcon[m.type]||"📝"}</span>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span style={{fontWeight:700,fontSize:14,color:C.text}}>{m.medewerker}</span>
              <span style={{padding:"2px 8px",borderRadius:10,background:kleur+"18",color:kleur,fontSize:11,fontWeight:700}}>{m.type?.toUpperCase()}</span>
              {isBackoffice ? (
                <select value={m.voor_rol||"backoffice"}
                  onChange={async e => { await supabase.from("meldingen").update({voor_rol:e.target.value}).eq("id",m.id); }}
                  onClick={e=>e.stopPropagation()}
                  style={{fontSize:11,fontWeight:700,borderRadius:10,padding:"2px 8px",border:"none",cursor:"pointer",fontFamily:"inherit",
                    background:m.voor_rol==="huismeester"?"#f0fdf4":C.blauw+"15",
                    color:m.voor_rol==="huismeester"?C.groen:C.blauw}}>
                  <option value="huismeester">🏠 Huismeester</option>
                  <option value="backoffice">📊 Backoffice</option>
                  <option value="iedereen">👥 Iedereen</option>
                </select>
              ) : (
                <span>
                  {m.voor_rol==="huismeester"&&<span style={{padding:"2px 8px",borderRadius:10,background:"#f0fdf4",color:C.groen,fontSize:11,fontWeight:700}}>🏠 Huismeester</span>}
                  {m.voor_rol==="backoffice"&&<span style={{padding:"2px 8px",borderRadius:10,background:C.blauw+"15",color:C.blauw,fontSize:11,fontWeight:700}}>📊 Backoffice</span>}
                </span>
              )}
              {!isOpen&&<span style={{padding:"2px 8px",borderRadius:10,background:"#f0fdf4",color:C.groen,fontSize:11,fontWeight:700}}>✓ AFGEHANDELD</span>}
            </div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>
              {huis?`📍 ${huis.adres}, ${huis.stad}`:""}{m.kamer?` · K${m.kamer}`:""}
            </div>
            {m.datum && (
              <div style={{fontSize:13,fontWeight:700,color:kleur,marginTop:3}}>
                📅 {m.type==="aankomst"?"Aankomst":m.type==="vertrek"?"Vertrek":m.type==="reservering"?"Aankomst (reservering)":"Datum"}: {fmtDate(m.datum)}
              </div>
            )}
            <div style={{fontSize:11,color:C.muted,marginTop:1}}>
              Ingediend: {m.created_at?fmtFull(m.created_at):"—"}
            </div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>Door: {m.ingediend_door}</div>
          </div>
        </div>
      </div>
      {m.opmerkingen&&<div style={{fontSize:13,color:C.muted,fontStyle:"italic",marginBottom:8}}>"{m.opmerkingen}"</div>}
      {m.ingepland_op&&<div style={{fontSize:12,color:C.groen,fontWeight:600,marginBottom:6}}>📅 Ingepland op {fmtDate(m.ingepland_op)} door {m.geaccepteerd_door}</div>}
      {m.notitie&&<div style={{fontSize:13,color:C.blauw,background:C.blauw+"08",border:`1px solid ${C.blauw}20`,borderRadius:8,padding:"6px 10px",marginBottom:8}}>💬 {m.notitie}</div>}

      {isOpen && (isBackoffice || isHuismeester) && (
        <div style={{marginTop:8,display:"flex",gap:8,flexWrap:"wrap"}}>
          {/* Huismeester kan inplannen */}
          {isHuismeester && !toonNotitie && (
            toonInplannen ? (
              <div style={{width:"100%",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:14}}>
                <div style={{fontWeight:700,color:C.groen,fontSize:13,marginBottom:10}}>📅 Melding inplannen</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <div>
                    <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>DATUM</label>
                    <input type="date" value={inplandatum} onChange={e=>setInplandatum(e.target.value)} autoFocus
                      style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
                  </div>
                  <div>
                    <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>OPMERKING</label>
                    <input value={inplanOpmerking} onChange={e=>setInplanOpmerking(e.target.value)} placeholder="bijv. pak dit dinsdag op"
                      style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={async()=>{
                    await onUpdate(m.id,"geaccepteerd",inplanOpmerking);
                    if(inplandatum) await supabase.from("meldingen").update({ingepland_op:inplandatum,geaccepteerd_door:gebruiker.naam}).eq("id",m.id);
                    setToonInplannen(false);
                  }} style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                    ✓ Inplannen
                  </button>
                  <button onClick={()=>setToonInplannen(false)} style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"8px 12px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Annuleren</button>
                </div>
              </div>
            ) : (
              <button onClick={()=>setToonInplannen(true)} style={{background:"#f0fdf4",border:`1.5px solid ${C.groen}`,color:C.groen,borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                📅 Inplannen
              </button>
            )
          )}
          {/* Backoffice kan verwerken + notitie */}
          {isBackoffice && !toonInplannen && m.type !== "vertrek_aankondiging" && (
            toonNotitie ? (
              <div style={{width:"100%",background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
                <input value={notitie} onChange={e=>setNotitie(e.target.value)} placeholder="Notitie bij verwerking..." autoFocus
                  style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box",marginBottom:10}}/>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{ onUpdate(m.id,"verwerkt",notitie); setToonNotitie(false); }}
                    style={{background:C.groen,color:"white",border:"none",borderRadius:8,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>✓ Verwerkt</button>
                  <button onClick={()=>setToonNotitie(false)} style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"8px 12px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Annuleren</button>
                </div>
              </div>
            ) : (
              <button onClick={()=>setToonNotitie(true)} style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                ✓ Verwerkt in administratie
              </button>
            )
          )}
        </div>
      )}
      {/* Bewerken knop */}
      <div style={{marginTop:6}}>
        {toonBewerk ? (
          <div style={{background:C.bg,border:`1.5px solid ${C.blauw}`,borderRadius:12,padding:14,marginBottom:8}}>
            <div style={{fontWeight:700,fontSize:13,color:C.blauw,marginBottom:12}}>✏️ Melding bewerken</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div>
                <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>Type</label>
                <select value={bewerkData.type||m.type} onChange={e=>setBewerkData(p=>({...p,type:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,fontFamily:"inherit",background:"white",color:C.text}}>
                  {["aankomst","vertrek_aankondiging","vertrek","reservering","verhuizing","overig"].map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>Datum</label>
                <input type="date" value={bewerkData.datum||m.datum||""} onChange={e=>setBewerkData(p=>({...p,datum:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,fontFamily:"inherit",background:"white",color:C.text,boxSizing:"border-box"}}/>
              </div>
              <div>
                <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>Naam medewerker</label>
                <input value={bewerkData.medewerker??m.medewerker} onChange={e=>setBewerkData(p=>({...p,medewerker:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,fontFamily:"inherit",background:"white",color:C.text,boxSizing:"border-box"}}/>
              </div>
              <div>
                <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>Kamer</label>
                <input value={bewerkData.kamer??m.kamer} onChange={e=>setBewerkData(p=>({...p,kamer:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,fontFamily:"inherit",background:"white",color:C.text,boxSizing:"border-box"}}/>
              </div>
              <div>
                <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>Woning</label>
                <select value={bewerkData.woning_id||m.woning_id||""} onChange={e=>setBewerkData(p=>({...p,woning_id:Number(e.target.value)}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,fontFamily:"inherit",background:"white",color:C.text}}>
                  <option value="">— Geen woning —</option>
                  {houses.map(h=><option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>Sleutels</label>
                <select value={bewerkData.sleutel_aantal??m.sleutel_aantal??1} onChange={e=>setBewerkData(p=>({...p,sleutel_aantal:Number(e.target.value)}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,fontFamily:"inherit",background:"white",color:C.text}}>
                  <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option>
                </select>
              </div>
            </div>
            <div style={{marginBottom:10}}>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>Opmerkingen</label>
              <textarea value={bewerkData.opmerkingen??m.opmerkingen??""} onChange={e=>setBewerkData(p=>({...p,opmerkingen:e.target.value}))}
                rows={2} style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,fontFamily:"inherit",background:"white",color:C.text,resize:"vertical",boxSizing:"border-box"}}/>
            </div>
            <div style={{marginBottom:10}}>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>Reden wijziging *</label>
              <input value={bewerkData._reden||""} onChange={e=>setBewerkData(p=>({...p,_reden:e.target.value}))}
                placeholder="bijv. verkeerde kamer ingevuld, datum gecorrigeerd..." autoFocus
                style={{width:"100%",padding:"8px 10px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,fontFamily:"inherit",background:"white",color:C.text,boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={async()=>{
                if(!bewerkData._reden?.trim()){alert("Vul een reden in voor de wijziging");return;}
                const nu = new Date();
                const datum = nu.toLocaleDateString("nl-NL");
                const tijd = nu.toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"});
                // Bouw wijziging log
                const oudeWijzigingen = m.wijzigingen || [];
                const wijzigingEntry = {
                  door: gebruiker.naam,
                  op: `${datum} ${tijd}`,
                  reden: bewerkData._reden.trim(),
                  oud: {type:m.type,datum:m.datum,medewerker:m.medewerker,kamer:m.kamer,woning_id:m.woning_id,opmerkingen:m.opmerkingen,sleutel_aantal:m.sleutel_aantal},
                };
                const {_reden, ...updates} = bewerkData;
                await supabase.from("meldingen").update({
                  ...updates,
                  wijzigingen: [...oudeWijzigingen, wijzigingEntry],
                }).eq("id",m.id);
                setToonBewerk(false);
                setBewerkData({});
              }}
                style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                ✓ Opslaan
              </button>
              <button onClick={()=>{setToonBewerk(false);setBewerkData({});}}
                style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                Annuleren
              </button>
            </div>
            {/* Wijzigingshistorie */}
            {(m.wijzigingen||[]).length > 0 && (
              <div style={{marginTop:14,borderTop:`1px solid ${C.border}`,paddingTop:10}}>
                <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6}}>📋 WIJZIGINGSHISTORIE</div>
                {[...(m.wijzigingen||[])].reverse().map((w,i)=>(
                  <div key={i} style={{fontSize:11,color:C.muted,padding:"4px 0",borderBottom:`1px solid ${C.border}`}}>
                    <span style={{fontWeight:600,color:C.text}}>{w.door}</span> · {w.op} · {w.reden}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{display:"flex",gap:12,alignItems:"center"}}>
            <button onClick={()=>{setToonBewerk(true);setBewerkData({});}}
              style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer",fontFamily:"inherit",padding:"4px 0",textDecoration:"underline"}}>
              ✏️ Bewerken
            </button>
            {(m.wijzigingen||[]).length > 0 && (
              <span style={{fontSize:11,color:C.muted}}>({m.wijzigingen.length}x gewijzigd)</span>
            )}
          </div>
        )}
      </div>

      {/* Foto toevoegen */}
      <FotoUploadMelding melding={m} gebruiker={gebruiker}/>

      {/* Opmerking toevoegen — voor iedereen, ook na afhandeling */}
      <div style={{marginTop:8}}>
        {toonOpmerkingCollega ? (
          <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:12}}>
            <input value={opmerkingCollega} onChange={e=>setOpmerkingCollega(e.target.value)}
              placeholder="Voeg een opmerking of aanvulling toe..." autoFocus
              style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box",marginBottom:8}}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={async()=>{
                if(!opmerkingCollega.trim()) return;
                const datum = new Date().toLocaleDateString("nl-NL");
                const oud = m.opmerkingen || "";
                const nieuw2 = oud ? oud + `\n[${datum} - ${gebruiker.naam}] ${opmerkingCollega.trim()}` : `[${datum} - ${gebruiker.naam}] ${opmerkingCollega.trim()}`;
                await supabase.from("meldingen").update({opmerkingen: nieuw2}).eq("id", m.id);
                showToast("✓ Opmerking toegevoegd");
                setOpmerkingCollega("");
                setToonOpmerkingCollega(false);
              }} style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"7px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                ✓ Opslaan
              </button>
              <button onClick={()=>setToonOpmerkingCollega(false)}
                style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"7px 12px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                Annuleren
              </button>
            </div>
          </div>
        ) : (
          <button onClick={()=>setToonOpmerkingCollega(true)}
            style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer",fontFamily:"inherit",padding:"4px 0",textDecoration:"underline"}}>
            💬 Opmerking toevoegen
          </button>
        )}
      </div>
    </div>
  );
}

function NieuwesTaakForm({ houses, gebruiker, onAdd, showToast }) {
  const [nieuw, setNieuw] = useState({titel:"",omschrijving:"",woning_id:"",kamer:"",prioriteit:"middel",voor_rol:"huismeester"});
  const [saving, setSaving] = useState(false);
  const selectedHouse = houses.find(h=>h.id===Number(nieuw.woning_id));

  async function submit() {
    if (!nieuw.titel.trim()) { showToast("Vul een titel in","err"); return; }
    setSaving(true);
    await onAdd({titel:nieuw.titel.trim(),omschrijving:nieuw.omschrijving||null,woning_id:nieuw.woning_id?Number(nieuw.woning_id):null,kamer:nieuw.kamer||null,prioriteit:nieuw.prioriteit,voor_rol:nieuw.voor_rol||"huismeester"});
    setSaving(false);
    setNieuw({titel:"",omschrijving:"",woning_id:"",kamer:"",prioriteit:"middel",voor_rol:"huismeester"});
  }

  return (
    <div className="card" style={{maxWidth:700,borderTop:`3px solid ${C.blauw}`}}>
      <h3 style={{fontSize:15,fontWeight:800,color:C.blauw,marginBottom:16}}>+ Nieuwe taak toevoegen</h3>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
        <div style={{gridColumn:"1/-1"}}>
          <label className="fl">Titel *</label>
          <input className="fi" value={nieuw.titel} onChange={e=>setNieuw(p=>({...p,titel:e.target.value}))} placeholder="bijv. Wasmachine repareren" autoFocus/>
        </div>
        <div>
          <label className="fl">Woning</label>
          <select className="fs" value={nieuw.woning_id} onChange={e=>setNieuw(p=>({...p,woning_id:e.target.value,kamer:""}))}>
            <option value="">Geen woning</option>
            {houses.map(h=><option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
          </select>
        </div>
        <div>
          <label className="fl">Kamer</label>
          <select className="fs" value={nieuw.kamer} onChange={e=>setNieuw(p=>({...p,kamer:e.target.value}))} disabled={!nieuw.woning_id}>
            <option value="">Selecteer kamer</option>
            {(selectedHouse?.kamers||[]).map(k=><option key={k.k} value={k.k}>Kamer {k.k}{k.naam?` — ${k.naam}`:""}</option>)}
          </select>
        </div>
        <div>
          <label className="fl">Prioriteit</label>
          <select className="fs" value={nieuw.prioriteit} onChange={e=>setNieuw(p=>({...p,prioriteit:e.target.value}))}>
            <option value="hoog">🔴 Hoog</option>
            <option value="middel">🟡 Middel</option>
            <option value="laag">🟢 Laag</option>
          </select>
        </div>
        <div>
          <label className="fl">Voor wie?</label>
          <div style={{display:"flex",gap:8}}>
            {[["huismeester","🏠 Huismeester"],["backoffice","📊 Backoffice"],["iedereen","👥 Iedereen"]].map(([v,l])=>(
              <div key={v} onClick={()=>setNieuw(p=>({...p,voor_rol:v}))}
                style={{flex:1,border:`2px solid ${nieuw.voor_rol===v?C.blauw:C.border}`,borderRadius:8,padding:"8px 4px",textAlign:"center",cursor:"pointer",background:nieuw.voor_rol===v?C.blauw+"10":"white",fontSize:11,fontWeight:600,color:nieuw.voor_rol===v?C.blauw:C.muted}}>
                {l}
              </div>
            ))}
          </div>
        </div>
        <div style={{gridColumn:"1/-1"}}>
          <label className="fl">Toelichting</label>
          <input className="fi" value={nieuw.omschrijving} onChange={e=>setNieuw(p=>({...p,omschrijving:e.target.value}))} placeholder="Optioneel..."/>
        </div>
      </div>
      <button className="btn-g" style={{padding:"10px 24px"}} onClick={submit} disabled={saving}>
        {saving?"⏳ Opslaan...":"✓ Taak toevoegen"}
      </button>
    </div>
  );
}

// ─── TAKEN / TO-DO ────────────────────────────────────────────────────────────
function TakenView({ taken, houses, gebruiker, onAdd, onUpdate, showToast }) {
  const [toonNieuwe, setToonNieuwe] = useState(false);
  const [filter, setFilter] = useState("open");
  const [nieuw, setNieuw] = useState({titel:"",omschrijving:"",woning_id:"",kamer:"",prioriteit:"middel",voor_rol:"iedereen"});
  const [saving, setSaving] = useState(false);
  const [notitieMap, setNotitieMap] = useState({});
  const [bevestigMap, setBevestigMap] = useState({});
  const [fotoMap, setFotoMap] = useState({});
  const [opmerkingMap, setOpmerkingMap] = useState({});
  const [planningMap2, setPlanningMap2] = useState({});
  const [toonOpmerkingMap, setToonOpmerkingMap] = useState({});

  const isHuismeester = gebruiker?.rol === "huismeester";
  const isBackoffice = gebruiker?.rol === "backoffice";
  const isCollega = gebruiker?.rol === "collega" || gebruiker?.rol === "financieel";
  const rolNaam = gebruiker?.rol;
  const [accepteerMap, setAccepteerMap] = useState({});
  const [toonAccepteerMap, setToonAccepteerMap] = useState({});
  const [toonNaOpmerkingMap, setToonNaOpmerkingMap] = useState({});
  const [naOpmerkingMap, setNaOpmerkingMap] = useState({});
  const [toonBlokkadeMap, setToonBlokkadeMap] = useState({});
  const [blokkadeMap, setBlokkadeMap] = useState({});

  // Filter taken op basis van rol
  const gefilterd = taken
    .filter(t => {
      if (t.voor_rol === "huismeester" && rolNaam !== "huismeester" && rolNaam !== "backoffice") return false;
      if (t.voor_rol === "backoffice" && rolNaam !== "backoffice") return false;
      if (filter === "open") return t.status === "open" || t.status === "geaccepteerd" || t.status === "bezig";
      if (filter === "geaccepteerd") return t.status === "geaccepteerd";
      if (filter === "gedaan") return t.status === "gedaan";
      return true;
    });

  async function accepteerTaak(taak, datum, opmerking) {
    await onUpdate(taak.id, {
      status: "geaccepteerd",
      geaccepteerd_op: datum,
      geaccepteerd_door: gebruiker.naam,
      geaccepteerd_opmerking: opmerking || null,
    });
    // Bericht naar aanmaker
    if (taak.aangemaakt_door && taak.aangemaakt_door !== gebruiker.naam) {
      const huis = houses.find(h=>h.id===taak.woning_id);
      await supabase.from("berichten").insert([{
        tekst: `Ik heb jouw taak opgepakt en ingepland op ${datum ? new Date(datum).toLocaleDateString("nl-NL") : "een nader te bepalen datum"}.${opmerking ? " " + opmerking : ""}`,
        van: gebruiker.naam,
        aan: taak.aangemaakt_door,
        onderwerp: `✅ Taak ingepland: ${taak.titel}`,
        koppeling_type: "taak",
        koppeling_id: taak.id,
        koppeling_label: taak.titel,
        gelezen_door: [gebruiker.naam],
      }]);
      stuurMail({
        type: "📅 Taak ingepland door huismeester",
        type_icon: "📅",
        medewerker: taak.aangemaakt_door,
        woning: huis ? `${huis.adres}, ${huis.stad}` : "—",
        kamer: taak.kamer ? `Kamer ${taak.kamer}` : "—",
        datum: datum || new Date().toISOString().slice(0,10),
        ingediend_door: gebruiker.naam,
        opmerkingen: `Taak "${taak.titel}" is ingepland op ${datum ? new Date(datum).toLocaleDateString("nl-NL") : "nader te bepalen"}.${opmerking ? " Opmerking: " + opmerking : ""}`,
      });
    }
    showToast("✓ Taak geaccepteerd & collega geïnformeerd");
    setToonAccepteerMap(p=>({...p,[taak.id]:false}));
    setAccepteerMap(p=>({...p,[taak.id]:{datum:"",opmerking:""}}));
  }
  const selectedHouse = houses.find(h=>h.id===Number(nieuw.woning_id));

  async function voegToe() {
    if (!nieuw.titel.trim()) { showToast("Vul een titel in","err"); return; }
    setSaving(true);
    await onAdd({titel:nieuw.titel.trim(),omschrijving:nieuw.omschrijving||null,woning_id:nieuw.woning_id?Number(nieuw.woning_id):null,kamer:nieuw.kamer||null,prioriteit:nieuw.prioriteit,voor_rol:nieuw.voor_rol||"iedereen"});
    setSaving(false);
    setNieuw({titel:"",omschrijving:"",woning_id:"",kamer:"",prioriteit:"middel",voor_rol:"iedereen"});
    setToonNieuwe(false);
  }

  const prioKleur={hoog:"#ef4444",middel:"#f59e0b",laag:C.groen};
  const prioIcon={hoog:"🔴",middel:"🟡",laag:"🟢"};

  return (
    <div>
      <SH titel="📌 To-do lijst" sub="Meld problemen of klusjes per woning/kamer"
        actie={<button className="btn-b" style={{padding:"9px 18px",fontSize:13}} onClick={()=>setToonNieuwe(!toonNieuwe)}>+ Taak toevoegen</button>} />

      {toonNieuwe && (
        <div className="card" style={{marginBottom:20,borderTop:`3px solid ${C.groen}`}}>
          <div style={{fontWeight:700,fontSize:14,color:C.groen,marginBottom:16}}>Nieuwe taak / melding</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
            <div style={{gridColumn:"1/-1"}}>
              <label className="fl">Omschrijving probleem / taak *</label>
              <input className="fi" value={nieuw.titel} onChange={e=>setNieuw(p=>({...p,titel:e.target.value}))} placeholder="bijv. Lamp kapot in keuken, Kraan lekt, Rookmelder piept..." />
            </div>
            <div>
              <label className="fl">Woning</label>
              <select className="fs" value={nieuw.woning_id} onChange={e=>setNieuw(p=>({...p,woning_id:e.target.value,kamer:""}))}>
                <option value="">Algemeen / niet specifiek</option>
                {houses.map(h=><option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
              </select>
            </div>
            <div>
              <label className="fl">Kamer</label>
              <select className="fs" value={nieuw.kamer} onChange={e=>setNieuw(p=>({...p,kamer:e.target.value}))} disabled={!nieuw.woning_id}>
                <option value="">Geen specifieke kamer</option>
                {selectedHouse?.kamers.map(k=><option key={k.k} value={k.k}>Kamer {k.k}{k.naam?` – ${k.naam}`:""}</option>)}
              </select>
            </div>
            <div>
              <label className="fl">Prioriteit</label>
              <select className="fs" value={nieuw.prioriteit} onChange={e=>setNieuw(p=>({...p,prioriteit:e.target.value}))}>
                <option value="hoog">🔴 Hoog – spoedeisend</option>
                <option value="middel">🟡 Middel – deze week</option>
                <option value="laag">🟢 Laag – wanneer mogelijk</option>
              </select>
            </div>
            <div>
              <label className="fl">Voor wie?</label>
              <div style={{display:"flex",gap:8}}>
                {[["iedereen","👥 Iedereen"],["huismeester","🏠 Huismeester"],["backoffice","📊 Backoffice"]].map(([v,l])=>(
                  <div key={v} onClick={()=>setNieuw(p=>({...p,voor_rol:v}))}
                    style={{flex:1,border:`2px solid ${nieuw.voor_rol===v?C.blauw:C.border}`,borderRadius:8,padding:"8px",textAlign:"center",cursor:"pointer",background:nieuw.voor_rol===v?C.blauw+"10":"white",fontSize:12,fontWeight:600,color:nieuw.voor_rol===v?C.blauw:C.muted}}>
                    {l}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="fl">Extra toelichting</label>
              <input className="fi" value={nieuw.omschrijving} onChange={e=>setNieuw(p=>({...p,omschrijving:e.target.value}))} placeholder="Optioneel..." />
            </div>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button className="btn-g" style={{flex:1,padding:"10px"}} onClick={voegToe} disabled={saving}>{saving?"⏳ Opslaan...":"✓ Taak toevoegen"}</button>
            <button className="btn-out" onClick={()=>setToonNieuwe(false)}>Annuleren</button>
          </div>
        </div>
      )}

      <div style={{display:"flex",gap:6,marginBottom:20}}>
        {[["open","Open & Ingepland"],["geaccepteerd","📅 Ingepland"],["gedaan","Gedaan"],["alle","Alle"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFilter(v)}
            style={{background:filter===v?C.blauw:"white",color:filter===v?"white":C.muted,border:`1.5px solid ${filter===v?C.blauw:C.border}`,borderRadius:20,padding:"6px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            {l} {v==="open"&&<span style={{background:"#ef444430",color:"#ef4444",borderRadius:10,padding:"1px 6px",fontSize:11,marginLeft:4}}>{taken.filter(t=>t.status==="open").length}</span>}
          </button>
        ))}
      </div>

      {gefilterd.length===0 ? (
        <div className="card" style={{textAlign:"center",padding:"50px 20px"}}>
          <div style={{fontSize:40,marginBottom:10}}>📭</div>
          <div style={{color:C.muted}}>Geen taken in deze categorie</div>
        </div>
      ) : gefilterd.map(t=>{
        const huis=houses.find(h=>h.id===t.woning_id);
        const gedaan=t.status==="gedaan";
        return (
          <div key={t.id} className={`taak-card ${t.prioriteit==="hoog"?"urgent":""} ${gedaan?"gedaan":""}`}>
            <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
              <span style={{fontSize:20,marginTop:2}}>{prioIcon[t.prioriteit]||"🟢"}</span>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:4}}>
                  <span style={{fontWeight:700,fontSize:15,color:gedaan?C.muted:C.text,textDecoration:gedaan?"line-through":"none"}}>{t.titel}</span>
                  <span className="badge" style={{background:prioKleur[t.prioriteit]+"18",color:prioKleur[t.prioriteit]}}>{t.prioriteit?.toUpperCase()}</span>
                  {gedaan&&<span className="badge" style={{background:"#f0fdf4",color:C.groen}}>GEDAAN</span>}
                  {t.status==="geaccepteerd"&&<span className="badge" style={{background:"#f0fdf4",color:C.groen}}>📅 INGEPLAND</span>}
                  {t.status==="bezig"&&<span className="badge" style={{background:"#fffbeb",color:"#b45309"}}>🔄 BEZIG</span>}
                  {t.geblokkeerd&&<span className="badge" style={{background:"#fef2f2",color:"#ef4444"}}>🚫 GEBLOKKEERD</span>}
                  {/* Voor_rol badge — klikbaar voor backoffice om te wijzigen */}
                  {isBackoffice ? (
                    <select value={t.voor_rol||"iedereen"}
                      onChange={e=>onUpdate(t.id,{voor_rol:e.target.value})}
                      onClick={e=>e.stopPropagation()}
                      style={{fontSize:11,fontWeight:700,borderRadius:10,padding:"2px 8px",border:"none",cursor:"pointer",fontFamily:"inherit",
                        background:t.voor_rol==="huismeester"?"#f0fdf4":t.voor_rol==="backoffice"?C.blauw+"15":"#f0f4f8",
                        color:t.voor_rol==="huismeester"?C.groen:t.voor_rol==="backoffice"?C.blauw:C.muted}}>
                      <option value="huismeester">🏠 Huismeester</option>
                      <option value="backoffice">📊 Backoffice</option>
                      <option value="iedereen">👥 Iedereen</option>
                    </select>
                  ) : (
                    <span>
                      {t.voor_rol==="huismeester"&&<span className="badge" style={{background:"#f0fdf4",color:C.groen}}>🏠 Huismeester</span>}
                      {t.voor_rol==="backoffice"&&<span className="badge" style={{background:C.blauw+"15",color:C.blauw}}>📊 Backoffice</span>}
                    </span>
                  )}
                </div>
                <div style={{fontSize:12,color:C.muted}}>
                  {huis?`📍 ${huis.adres}, ${huis.stad}`:"📋 Algemeen"}{t.kamer?` · Kamer ${t.kamer}`:""}
                  {" · "}Toegevoegd door {t.aangemaakt_door}{t.created_at?` · ${fmtFull(t.created_at)}`:""}
                </div>
                {t.ingepland_op && t.status!=="geaccepteerd" && (
                  <div style={{fontSize:12,fontWeight:700,color:"#7c3aed",marginTop:3}}>
                    📅 Gepland voor: {fmtDate(t.ingepland_op)}
                  </div>
                )}
                {t.geblokkeerd && t.blokkade_reden && (
                  <div style={{fontSize:12,color:"#ef4444",marginTop:4,background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"6px 10px"}}>
                    🚫 {t.blokkade_reden}
                  </div>
                )}
                {t.omschrijving&&<div style={{fontSize:13,color:C.muted,marginTop:4,fontStyle:"italic"}}>"{t.omschrijving}"</div>}
                {t.status==="geaccepteerd" && (
                  <div style={{marginTop:6,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"8px 12px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.groen}}>📅 Opgepakt door {t.geaccepteerd_door}</div>
                    {t.geaccepteerd_op && <div style={{fontSize:12,color:C.groen,marginTop:2}}>Ingepland op {fmtDate(t.geaccepteerd_op)}</div>}
                    {t.geaccepteerd_opmerking && <div style={{fontSize:12,color:C.muted,fontStyle:"italic",marginTop:2}}>"{t.geaccepteerd_opmerking}"</div>}
                  </div>
                )}
                {/* Controle checkboxes voor verhuizing taken */}
                {(t.titel?.includes("Kamer controleren") || t.titel?.includes("Verhuizing voltooid")) && isHuismeester && !gedaan && (
                  <div style={{marginTop:10,background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:10,padding:"12px 14px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#b45309",marginBottom:10}}>✅ Controlepunten afvinken</div>
                    {(t.titel?.includes("Verhuizing voltooid") ? [
                      {key:"sleutel1", label:"🔑 Sleutel 1 uitgereikt"},
                      {key:"sleutel2", label:"🔑 Sleutel 2 uitgereikt (indien 2 sleutels)"},
                      {key:"kamer_klaar", label:"🏠 Kamer klaar voor bewoning"},
                    ] : [
                      {key:"schoon", label:"🧹 Kamer schoon"},
                      {key:"sleutel1", label:"🔑 Sleutel 1 ingeleverd"},
                      {key:"sleutel2", label:"🔑 Sleutel 2 ingeleverd (indien van toepassing)"},
                    ]).map(({key, label}) => {
                      const checked = (t.notitie||"").includes(`[✓ ${key}]`);
                      return (
                        <div key={key} onClick={async()=>{
                          if(checked) return;
                          const oud = t.notitie||"";
                          const nieuwNotitie = oud ? oud+" [✓ "+key+"]" : "[✓ "+key+"]";
                          await onUpdate(t.id, {notitie: nieuwNotitie});
                          // Check of nu alles afgevinkt is
                          const alleKeys = t.titel?.includes("Verhuizing voltooid") ? ["sleutel1","kamer_klaar"] : ["schoon","sleutel1"];
                          const alleAfgevinkt = alleKeys.every(k => nieuwNotitie.includes("[✓ "+k+"]"));
                          if (alleAfgevinkt) {
                            const isVertrek = t.titel?.includes("na vertrek");
                            const isVerhuizingVoltooid = t.titel?.includes("Verhuizing voltooid");
                            const medewerkerNaam = t.titel
                              ?.replace("Kamer controleren na verhuizing — ","")
                              .replace("Kamer controleren na vertrek — ","")
                              .replace("Verhuizing voltooid — sleutel uitreiken ","") || "";
                            
                            // Bij vertrek: kamer op Beschikbaar zetten
                            if (isVertrek && t.woning_id && t.kamer) {
                              const woning = houses.find(h=>h.id===t.woning_id);
                              if (woning) {
                                const nk = woning.kamers.map(k=>k.k===t.kamer?{...k,status:"Beschikbaar",naam:""}:k);
                                await supabase.from("woningen").update({kamers:nk}).eq("id",woning.id);
                              }
                            }

                            // 1. Bericht naar backoffice
                            const berichtTekst = isVerhuizingVoltooid
                              ? `Verhuizing voltooid voor ${medewerkerNaam}: sleutel(s) uitgereikt ✓, kamer klaar ✓. Check of extra borg of km-vergoeding aanpassing nodig is.`
                              : `Kamer ${t.kamer||""} is gecontroleerd en klaar: kamer schoon ✓, sleutel(s) ingeleverd ✓. Borg kan worden terugbetaald.`;
                            await supabase.from("berichten").insert([{
                              tekst: berichtTekst,
                              van: gebruiker?.naam||"Huismeester",
                              aan: null,
                              onderwerp: `✅ Kamer klaar + borg terugbetalen — ${medewerkerNaam}`,
                              koppeling_type: "taak",
                              koppeling_id: t.id,
                              koppeling_label: t.titel,
                              gelezen_door: [gebruiker?.naam||"Huismeester"],
                            }]);

                            // 2. Borgplan zoeken voor deze medewerker en extra "terugbetalen" post toevoegen
                            if (medewerkerNaam) {
                              const { data: borgPlan } = await supabase.from("borg_plannen")
                                .select("id, naam_medewerker, totaal_borg, ingehouden")
                                .eq("naam_medewerker", medewerkerNaam)
                                .eq("status", "actief")
                                .limit(1);
                              if (borgPlan && borgPlan.length > 0) {
                                const plan = borgPlan[0];
                                const terug = Number(plan.ingehouden);
                                if (terug > 0) {
                                  await supabase.from("borg_extra").insert([{
                                    plan_id: plan.id,
                                    naam_medewerker: medewerkerNaam,
                                    omschrijving: `Borg terugbetalen — kamer schoon + sleutels ingeleverd (K${t.kamer||""})`,
                                    bedrag: terug,
                                    type: "terugbetalen",
                                    status: "open",
                                  }]);
                                }
                              }
                            }

                            // 3. Mail sturen
                            stuurMail({
                              type: "✅ Kamer klaar + borg terugbetalen",
                              type_icon: "✅",
                              medewerker: medewerkerNaam || "—",
                              woning: huis ? `${huis.adres}, ${huis.stad}` : "—",
                              kamer: `Kamer ${t.kamer||""}`,
                              datum: new Date().toISOString().slice(0,10),
                              ingediend_door: gebruiker?.naam||"Huismeester",
                              opmerkingen: "Kamer schoon ✓ · Sleutel(s) ingeleverd ✓ · Borg terugbetalen aan medewerker",
                            });
                          }
                        }} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid #fcd34d",cursor:checked?"default":"pointer"}}>
                          <div style={{width:20,height:20,borderRadius:4,border:`2px solid ${checked?"#4A9B3C":"#f59e0b"}`,background:checked?"#4A9B3C":"white",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                            {checked && <span style={{color:"white",fontSize:12,fontWeight:700}}>✓</span>}
                          </div>
                          <span style={{fontSize:13,color:checked?C.groen:C.text,fontWeight:checked?600:400,textDecoration:checked?"line-through":"none"}}>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {t.ingepland_op&&<div style={{fontSize:12,color:"#7c3aed",fontWeight:600,marginTop:4}}>📅 Ingepland op {fmtDate(t.ingepland_op)}</div>}
                {t.huismeester_opmerking&&<div style={{fontSize:13,color:C.blauw,marginTop:4,background:C.blauw+"08",border:`1px solid ${C.blauw}20`,borderRadius:8,padding:"6px 10px"}}>💬 {t.huismeester_opmerking}</div>}
                {gedaan&&t.afgehandeld_door&&(
                  <div style={{marginTop:6}}>
                    <div style={{fontSize:12,color:C.groen}}>✓ Afgehandeld door {t.afgehandeld_door}{t.afgehandeld_op?` · ${fmtFull(t.afgehandeld_op)}`:""}</div>
                    {t.notitie&&<div style={{fontSize:13,color:C.muted,marginTop:3,fontStyle:"italic"}}>💬 "{t.notitie}"</div>}
                    {t.bijlages&&<BijlageWeergave bijlages={JSON.parse(t.bijlages||"[]")}/>}
                  </div>
                )}
                {gedaan&&(
                  <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
                    {isHuismeester&&(
                      <button onClick={()=>onUpdate(t.id,{status:"open",afgehandeld_door:null,afgehandeld_op:null})}
                        style={{background:"white",border:`1.5px solid ${C.oranje}`,color:C.oranje,borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                        ↩ Terugzetten naar open
                      </button>
                    )}
                    {toonNaOpmerkingMap[t.id] ? (
                      <div style={{width:"100%",background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:12,marginTop:4}}>
                        <input value={naOpmerkingMap[t.id]||""} onChange={e=>setNaOpmerkingMap(p=>({...p,[t.id]:e.target.value}))}
                          placeholder="Voeg een opmerking toe..." autoFocus
                          style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box",marginBottom:8}}/>
                        <div style={{display:"flex",gap:8}}>
                          <button onClick={()=>{
                            if(naOpmerkingMap[t.id]?.trim()) {
                              const bestaand = t.notitie || "";
                              const nieuw = bestaand ? bestaand + " | " + naOpmerkingMap[t.id].trim() : naOpmerkingMap[t.id].trim();
                              onUpdate(t.id,{notitie: nieuw});
                              setNaOpmerkingMap(p=>({...p,[t.id]:""}));
                              setToonNaOpmerkingMap(p=>({...p,[t.id]:false}));
                            }
                          }} style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"7px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                            ✓ Opslaan
                          </button>
                          <button onClick={()=>setToonNaOpmerkingMap(p=>({...p,[t.id]:false}))}
                            style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"7px 12px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                            Annuleren
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={()=>setToonNaOpmerkingMap(p=>({...p,[t.id]:true}))}
                        style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                        💬 Opmerking toevoegen
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {!gedaan&&(
              bevestigMap[t.id] ? (
                <div style={{marginTop:12,padding:"12px",background:C.groen+"08",border:`1px solid ${C.groen}30`,borderRadius:10}}>
                  <label className="fl">Opmerking bij afhandeling (optioneel)</label>
                  <input className="fi" value={notitieMap[t.id]||""} onChange={e=>setNotitieMap(p=>({...p,[t.id]:e.target.value}))}
                    placeholder="bijv. Lamp vervangen, kraan gerepareerd..." style={{marginBottom:10}}
                    autoFocus/>
                  <div style={{marginBottom:12}}>
                    <BijlageUploader bestanden={fotoMap[t.id]||[]} setBestanden={v=>setFotoMap(p=>({...p,[t.id]:typeof v==="function"?v(p[t.id]||[]):v}))} label="📸 Foto's toevoegen (optioneel)"/>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn-g" style={{flex:1,padding:"9px"}}
                      onClick={async()=>{
                        const fotos = fotoMap[t.id]||[];
                        let fotoUrls = [];
                        if(fotos.length>0) fotoUrls = await uploadBijlages(fotos, "taken");
                        onUpdate(t.id,{status:"gedaan",afgehandeld_door:gebruiker.naam,afgehandeld_op:new Date().toISOString(),notitie:notitieMap[t.id]||null,bijlages:fotoUrls.length>0?JSON.stringify(fotoUrls):null});
                        setFotoMap(p=>({...p,[t.id]:[]}));
                      }}>
                      ✓ Bevestig als gedaan
                    </button>
                    <button className="btn-out" style={{padding:"9px 14px"}} onClick={()=>setBevestigMap(p=>({...p,[t.id]:false}))}>Annuleren</button>
                  </div>
                </div>
              ) : toonAccepteerMap[t.id] ? (
                <div style={{marginTop:12,padding:"14px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10}}>
                  <div style={{fontWeight:700,fontSize:13,color:C.groen,marginBottom:12}}>📅 Taak accepteren & inplannen</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                    <div>
                      <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>INPLANNEN OP DATUM</label>
                      <input type="date" className="fi"
                        value={accepteerMap[t.id]?.datum||""}
                        onChange={e=>setAccepteerMap(p=>({...p,[t.id]:{...p[t.id],datum:e.target.value}}))}
                        autoFocus/>
                    </div>
                    <div>
                      <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>OPMERKING NAAR COLLEGA</label>
                      <input className="fi"
                        value={accepteerMap[t.id]?.opmerking||""}
                        onChange={e=>setAccepteerMap(p=>({...p,[t.id]:{...p[t.id],opmerking:e.target.value}}))}
                        placeholder="bijv. pak dit dinsdag op na woning Almelo"/>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn-g" style={{flex:1,padding:"9px"}}
                      onClick={()=>accepteerTaak(t, accepteerMap[t.id]?.datum||null, accepteerMap[t.id]?.opmerking||"")}>
                      ✓ Accepteren & inplannen
                    </button>
                    <button className="btn-out" style={{padding:"9px 14px"}}
                      onClick={()=>setToonAccepteerMap(p=>({...p,[t.id]:false}))}>
                      Annuleren
                    </button>
                  </div>
                </div>
              ) : toonOpmerkingMap[t.id] ? (
                <div style={{marginTop:12,padding:"12px",background:C.blauw+"08",border:`1px solid ${C.blauw}20`,borderRadius:10}}>
                  <div style={{fontWeight:700,fontSize:13,color:C.blauw,marginBottom:10}}>📝 Opmerking & planning</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                    <div>
                      <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>OPMERKING</label>
                      <input className="fi" value={opmerkingMap[t.id]||""} onChange={e=>setOpmerkingMap(p=>({...p,[t.id]:e.target.value}))}
                        placeholder="bijv. onderdelen besteld, duurt 3 dagen..." autoFocus/>
                    </div>
                    <div>
                      <label style={{fontSize:11,fontWeight:600,color:C.muted,display:"block",marginBottom:4}}>INPLANNEN OP</label>
                      <input type="date" className="fi" value={planningMap2[t.id]||""} onChange={e=>setPlanningMap2(p=>({...p,[t.id]:e.target.value}))}/>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn-b" style={{flex:1,padding:"9px"}}
                      onClick={async()=>{
                        const updates = {};
                        if(opmerkingMap[t.id]) updates.huismeester_opmerking = opmerkingMap[t.id];
                        if(planningMap2[t.id]) updates.ingepland_op = planningMap2[t.id];
                        if(Object.keys(updates).length > 0) {
                          await onUpdate(t.id, updates);
                          stuurMail({
                            type: "💬 Opmerking op taak",
                            type_icon: "💬",
                            medewerker: gebruiker.naam,
                            woning: houses.find(h=>h.id===t.woning_id)?.adres || "Algemeen",
                            kamer: t.kamer ? `Kamer ${t.kamer}` : "—",
                            datum: new Date().toISOString().slice(0,10),
                            ingediend_door: gebruiker.naam,
                            opmerkingen: `Taak: ${t.titel}${opmerkingMap[t.id]?`. Opmerking: ${opmerkingMap[t.id]}`:""}${planningMap2[t.id]?`. Ingepland op: ${planningMap2[t.id]}`:""}`,
                          });
                          setToonOpmerkingMap(p=>({...p,[t.id]:false}));
                          setOpmerkingMap(p=>({...p,[t.id]:""}));
                          setPlanningMap2(p=>({...p,[t.id]:""}));
                        }
                      }}>
                      ✓ Opslaan
                    </button>
                    <button className="btn-out" style={{padding:"9px 14px"}} onClick={()=>setToonOpmerkingMap(p=>({...p,[t.id]:false}))}>Annuleren</button>
                  </div>
                </div>
              ) : toonBlokkadeMap[t.id] ? (
                <div style={{marginTop:12,padding:"12px 14px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10}}>
                  <div style={{fontWeight:700,fontSize:13,color:"#ef4444",marginBottom:10}}>🚫 Waarom lukt het niet?</div>
                  <input value={blokkadeMap[t.id]||""} onChange={e=>setBlokkadeMap(p=>({...p,[t.id]:e.target.value}))}
                    placeholder="bijv. onderdeel niet beschikbaar, toegang geweigerd..." autoFocus
                    style={{width:"100%",background:"white",border:"1.5px solid #fecaca",borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box",marginBottom:10}}/>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={async()=>{
                      if(!blokkadeMap[t.id]?.trim()) return;
                      await onUpdate(t.id,{
                        status:"open",
                        geblokkeerd:true,
                        blokkade_reden:blokkadeMap[t.id].trim(),
                        huismeester_opmerking: blokkadeMap[t.id].trim(),
                      });
                      stuurMail({
                        type:"🚫 Taak geblokkeerd",type_icon:"🚫",
                        medewerker:gebruiker?.naam,
                        woning:huis?`${huis.adres}, ${huis.stad}`:"—",
                        kamer:t.kamer?`Kamer ${t.kamer}`:"—",
                        datum:new Date().toISOString().slice(0,10),
                        ingediend_door:gebruiker?.naam,
                        opmerkingen:`Taak "${t.titel}" is geblokkeerd: ${blokkadeMap[t.id].trim()}`,
                      });
                      setToonBlokkadeMap(p=>({...p,[t.id]:false}));
                      setBlokkadeMap(p=>({...p,[t.id]:""}));
                    }} style={{background:"#ef4444",color:"white",border:"none",borderRadius:8,padding:"8px 18px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      🚫 Opslaan & backoffice informeren
                    </button>
                    <button onClick={()=>setToonBlokkadeMap(p=>({...p,[t.id]:false}))}
                      style={{background:"white",border:"1.5px solid #fecaca",color:"#ef4444",borderRadius:8,padding:"8px 12px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                      Annuleren
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{marginTop:8,display:"flex",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}>
                  {/* Bezig/kan niet alleen voor eigen rol */}
                  {(t.voor_rol==="huismeester" ? isHuismeester : t.voor_rol==="backoffice" ? isBackoffice : true) && t.status !== "bezig" ? (
                    <button onClick={()=>onUpdate(t.id,{status:"bezig"})}
                      style={{background:"#fffbeb",border:"1.5px solid #f59e0b",color:"#b45309",borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      🔄 Mee bezig
                    </button>
                  ) : (
                    <span style={{background:"#fffbeb",border:"1.5px solid #f59e0b",color:"#b45309",borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:600}}>
                      🔄 Mee bezig
                    </span>
                  )}
                  {(t.voor_rol==="huismeester" ? isHuismeester : t.voor_rol==="backoffice" ? isBackoffice : true) && <button onClick={()=>setToonBlokkadeMap(p=>({...p,[t.id]:true}))}
                    style={{background:"#fef2f2",border:"1.5px solid #fecaca",color:"#ef4444",borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                    🚫 Kan niet
                  </button>}
                  {isHuismeester && t.status !== "geaccepteerd" && (
                    <button style={{background:"#f0fdf4",border:`1.5px solid ${C.groen}`,color:C.groen,borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}
                      onClick={()=>setToonAccepteerMap(p=>({...p,[t.id]:true}))}>
                      📅 Inplannen
                    </button>
                  )}
                  {isHuismeester && (
                    <button style={{background:"white",border:`1.5px solid ${C.blauw}`,color:C.blauw,borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}
                      onClick={()=>setToonOpmerkingMap(p=>({...p,[t.id]:true}))}>
                      💬 Opmerking
                    </button>
                  )}
                  {/* Backoffice mag altijd afvinken, anderen alleen hun eigen rol */}
                  {(isBackoffice || (t.voor_rol === "huismeester" ? isHuismeester : t.voor_rol === "backoffice" ? isBackoffice : true)) && (
                    <button className="btn-g" style={{padding:"8px 16px",fontSize:13}}
                      onClick={()=>setBevestigMap(p=>({...p,[t.id]:true}))}>
                      ✓ Gedaan
                    </button>
                  )}
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── CHECKLISTS ───────────────────────────────────────────────────────────────
function ChecklistView({ houses, checklists, checklistItems, onSave, gebruiker }) {
  const weekNr = () => { const d=new Date(); const j=new Date(Date.UTC(d.getFullYear(),0,1)); return Math.ceil((((d-j)/86400000)+j.getDay()+1)/7); };
  const kwartaal = () => Math.ceil((new Date().getMonth()+1)/3);
  const jaar = new Date().getFullYear();

  const isBackoffice = gebruiker?.rol==="backoffice";
  const isHuismeester = gebruiker?.rol==="huismeester";

  const [actief, setActief] = useState("wekelijks");
  const [geselecteerdeWoning, setGeselecteerdeWoning] = useState(isHuismeester ? (houses[0]?.id?.toString()||"all") : "all");
  const [saving, setSaving] = useState(false);
  const [toonHistorie, setToonHistorie] = useState(false);

  const weekSleutel = `${jaar}-W${weekNr()}`;
  const maandSleutel = `${jaar}-4W${Math.ceil(weekNr()/4)}`;
  const kwartaalSleutel = `${jaar}-Q${kwartaal()}`;

  function huidigeSleutel() {
    if (actief==="wekelijks") return weekSleutel;
    if (actief==="4wekelijks") return maandSleutel;
    return kwartaalSleutel;
  }

  const lijst = checklistItems.filter(i => i.type === actief).map(i => i.tekst);
  const dbSleutel = `${actief}_${huidigeSleutel()}_${geselecteerdeWoning}`;
  const bestaand = checklists.find(c=>c.sleutel===dbSleutel);
  const [afgevinkt, setAfgevinkt] = useState(bestaand?.items||[]);

  useEffect(()=>{
    const b=checklists.find(c=>c.sleutel===dbSleutel);
    setAfgevinkt(b?.items||[]);
  },[actief,geselecteerdeWoning,dbSleutel,checklists]);

  function toggleItem(item) {
    setAfgevinkt(prev=>prev.includes(item)?prev.filter(i=>i!==item):[...prev,item]);
  }

  async function opslaan() {
    setSaving(true);
    await onSave(actief, huidigeSleutel(), afgevinkt, geselecteerdeWoning==="all"?null:Number(geselecteerdeWoning));
    setSaving(false);
  }

  const pct = lijst.length > 0 ? Math.round((afgevinkt.length/lijst.length)*100) : 0;

  const typeInfo = {
    wekelijks:   {label:"Wekelijks",   icon:"📋", kleur:C.blauw,   periode:`Week ${weekNr()}, ${jaar}`},
    "4wekelijks":{label:"4-wekelijks", icon:"📅", kleur:C.groen,   periode:`Periode ${Math.ceil(weekNr()/4)}, ${jaar}`},
    kwartaal:    {label:"Kwartaal",    icon:"🏆", kleur:"#7c3aed", periode:`Q${kwartaal()} ${jaar}`},
  };

  // Historie: alle opgeslagen checklists voor huidige woning + type, gesorteerd op datum
  const historieItems = checklists
    .filter(c => {
      const woningMatch = geselecteerdeWoning==="all" ? !c.woning_id : c.woning_id===Number(geselecteerdeWoning);
      return c.sleutel?.startsWith(actief) && woningMatch && c.sleutel !== dbSleutel;
    })
    .sort((a,b) => new Date(b.updated_at||b.created_at) - new Date(a.updated_at||a.created_at))
    .slice(0, 10);

  const geselecteerdeHuis = houses.find(h=>h.id===Number(geselecteerdeWoning));


  return (
    <div>
      <SH titel="✅ Checklists" sub="SNF-gecertificeerde controles per woning" />

      

      {/* Type selector */}
      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        {Object.entries(typeInfo).map(([k,v])=>(
          <button key={k} onClick={()=>setActief(k)}
            style={{flex:1,minWidth:140,background:actief===k?v.kleur:"white",color:actief===k?"white":C.text,border:`2px solid ${actief===k?v.kleur:C.border}`,borderRadius:12,padding:"12px 16px",cursor:"pointer",fontFamily:"inherit",transition:"all .2s",textAlign:"left"}}>
            <div style={{fontSize:20,marginBottom:4}}>{v.icon}</div>
            <div style={{fontWeight:700,fontSize:14}}>{v.label}</div>
            <div style={{fontSize:11,opacity:.8,marginTop:2}}>{v.periode}</div>
            <div style={{fontSize:11,opacity:.6,marginTop:1}}>{checklistItems.filter(i=>i.type===k).length} items</div>
          </button>
        ))}
      </div>

      {/* Woning selector — altijd zichtbaar voor huismeester en backoffice */}
      <div style={{marginBottom:20}}>
        <label className="fl">Woning selecteren</label>
        <select className="fs" style={{maxWidth:400}} value={geselecteerdeWoning} onChange={e=>setGeselecteerdeWoning(e.target.value)}>
          {isBackoffice && <option value="all">Alle woningen (overzicht)</option>}
          {houses.map(h=><option key={h.id} value={h.id}>{h.adres}, {h.stad}</option>)}
        </select>
      </div>

      {/* Checklist voor geselecteerde woning */}
      <div className="card" style={{borderTop:`4px solid ${typeInfo[actief]?.kleur||C.blauw}`,marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div>
            <div style={{fontWeight:800,fontSize:16,color:typeInfo[actief]?.kleur||C.blauw}}>{typeInfo[actief]?.icon||"📋"} {typeInfo[actief]?.label||actief} — {typeInfo[actief]?.periode||""}</div>
            <div style={{fontSize:13,color:C.muted,marginTop:2}}>
              {geselecteerdeHuis ? `${geselecteerdeHuis.adres}, ${geselecteerdeHuis.stad}` : "Alle woningen"}
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:28,fontWeight:800,color:pct===100?C.groen:typeInfo[actief]?.kleur||C.blauw}}>{pct}%</div>
            <div style={{fontSize:11,color:C.muted}}>{afgevinkt.length}/{lijst.length} gedaan</div>
          </div>
        </div>

        <div style={{background:C.bg,borderRadius:99,height:8,marginBottom:20,overflow:"hidden"}}>
          <div style={{height:"100%",background:pct===100?C.groen:typeInfo[actief]?.kleur||C.blauw,borderRadius:99,width:`${pct}%`,transition:"width .3s"}}/>
        </div>

        {lijst.length === 0 ? (
          <div style={{textAlign:"center",padding:"30px",color:C.muted,fontSize:13}}>
            Nog geen items voor dit type checklist.
            {isBackoffice && " Voeg items toe via Beheer → Checklists."}
          </div>
        ) : lijst.map((item,i)=>{
          const checked=afgevinkt.includes(item);
          return (
            <div key={i} className={`chk-item ${checked?"done":""}`}
              onClick={()=>toggleItem(item)}
              style={{cursor:"pointer"}}>
              <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${checked?C.groen:C.border}`,background:checked?C.groen:"white",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .15s"}}>
                {checked&&<span style={{color:"white",fontSize:13,fontWeight:700}}>✓</span>}
              </div>
              <span style={{fontSize:13,color:checked?C.groenDark:C.text,textDecoration:checked?"line-through":"none",fontWeight:checked?500:400}}>{item}</span>
            </div>
          );
        })}

        {lijst.length>0&&(
          <div style={{marginTop:20,display:"flex",gap:10}}>
            <button className="btn-g" style={{flex:1,padding:12}} onClick={opslaan} disabled={saving}>
              {saving?"⏳ Opslaan...":"💾 Voortgang opslaan"}
            </button>
            {afgevinkt.length>0&&<button className="btn-out" onClick={()=>setAfgevinkt([])}>Reset</button>}
          </div>
        )}

        {bestaand&&<div style={{marginTop:12,fontSize:12,color:C.muted}}>Laatst opgeslagen door {bestaand.aangemaakt_door} — {bestaand.updated_at?fmtFull(bestaand.updated_at):fmtFull(bestaand.created_at)}</div>}
      </div>

      {/* Historie */}
      {historieItems.length > 0 && (
        <div>
          <button onClick={()=>setToonHistorie(!toonHistorie)}
            style={{background:"none",border:"none",color:C.blauw,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",padding:"4px 0",marginBottom:10}}>
            {toonHistorie?"▲":"▼"} Vorige weken bekijken ({historieItems.length})
          </button>
          {toonHistorie && (
            <div style={{display:"grid",gap:10}}>
              {historieItems.map((c,i)=>{
                const itemsLijst = checklistItems.filter(it=>it.type===actief);
                const totaal = itemsLijst.length;
                const gedaan = (c.items||[]).length;
                const p = totaal>0?Math.round((gedaan/totaal)*100):0;
                const periode = c.sleutel?.split("_")?.[1]||"?";
                return (
                  <div key={i} className="card" style={{padding:"14px 18px",opacity:.85}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:13,color:C.text}}>{periode}</div>
                        <div style={{fontSize:12,color:C.muted}}>Opgeslagen door {c.aangemaakt_door} — {fmtFull(c.updated_at||c.created_at)}</div>
                      </div>
                      <div style={{fontWeight:800,fontSize:18,color:p===100?C.groen:p>50?"#f59e0b":C.rood||"#ef4444"}}>{p}%</div>
                    </div>
                    <div style={{background:C.bg,borderRadius:99,height:6,overflow:"hidden"}}>
                      <div style={{height:"100%",background:p===100?C.groen:p>50?"#f59e0b":"#ef4444",borderRadius:99,width:`${p}%`}}/>
                    </div>
                    <div style={{marginTop:8,fontSize:12,color:C.muted}}>
                      {gedaan}/{totaal} afgevinkt
                      {(c.items||[]).length>0 && (
                        <span style={{marginLeft:10}}>— ✓ {(c.items||[]).join(", ").slice(0,80)}{(c.items||[]).join(", ").length>80?"...":""}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── WEEKPLANNING CRISTIAN (voor collega's) ───────────────────────────────────────────────────────────────────────────────────────
function HuismeesterPlanningView({ dagplanningDB, houses, taken=[], meldingen=[], checklists=[], checklistItems=[] }) {
  const dag = dagVanDeWeek();
  const [weekOffset, setWeekOffset] = useState(0);

  function getMaandagVanWeek(offset) {
    const nu = new Date();
    const m = new Date(nu);
    m.setDate(nu.getDate() - ((nu.getDay() + 6) % 7) + offset * 7);
    m.setHours(0,0,0,0);
    return m;
  }
  function getWeekInfo(offset) {
    const ma = getMaandagVanWeek(offset);
    const zo = new Date(ma); zo.setDate(ma.getDate() + 6);
    const d = new Date(ma); d.setDate(d.getDate() + 3);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNr = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    const mnd = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];
    const s = dt => `${dt.getDate()} ${mnd[dt.getMonth()]}`;
    return { weekNr, jaar: d.getFullYear(), key: `${weekNr}-${d.getFullYear()}`, label: `Week ${weekNr} · ${s(ma)} – ${s(zo)} ${d.getFullYear()}`, start: ma.toISOString().slice(0,10), eind: zo.toISOString().slice(0,10) };
  }
  function dagDatumVoorOffset(dagNaam, offset) {
    const ma = getMaandagVanWeek(offset);
    const dagIdxMap = {"ma":0,"di":1,"wo":2,"do":3,"vr":4,"za":5,"zo":6};
    const idx = dagIdxMap[dagNaam] ?? 0;
    const d = new Date(ma); d.setDate(ma.getDate() + idx);
    return d.toISOString().slice(0,10);
  }

  const weekInfo = getWeekInfo(weekOffset);
  const isHuidigeWeek = weekOffset === 0;
  const isVerledenWeek = weekOffset < 0;

  const openMeldingen = meldingen.filter(m => m.status === "open");
  const weekTaken = taken.filter(t => {
    if (t.ingepland_op) return t.ingepland_op >= weekInfo.start && t.ingepland_op <= weekInfo.eind;
    return isHuidigeWeek && t.status === "open";
  });
  const openTaken = weekTaken.filter(t => t.status === "open");

  function exporteerCSV() {
    const rows = [["Week","Dag","Datum","Woning","Taak","Type","Status","Afgehandeld door","Afgehandeld op","Opmerking"]];
    dagplanningDB.forEach(d => {
      const dagDatum = dagDatumVoorOffset(d.dag, weekOffset);
      const woningen = (d.woning_ids||[]).map(id => houses.find(h=>h.id===id)).filter(Boolean);
      woningen.forEach(h => {
        const wTaken = weekTaken.filter(t => t.woning_id === h.id);
        if (wTaken.length > 0) {
          wTaken.forEach(t => {
            rows.push([weekInfo.key, d.label, t.ingepland_op||dagDatum, `${h.adres} ${h.stad}`, t.titel, "Taak", t.status==="gedaan"?"Gedaan":"Open", t.afgehandeld_door||"", t.afgehandeld_op?t.afgehandeld_op.slice(0,10):"", t.omschrijving||""]);
          });
        } else {
          rows.push([weekInfo.key, d.label, dagDatum, `${h.adres} ${h.stad}`, "(geen specifieke taken)", "Bezoek", "—", "", "", ""]);
        }
        openMeldingen.filter(m => m.woning_id === h.id && m.type !== "aankomst" && m.type !== "vertrek").forEach(m => {
          rows.push([weekInfo.key, d.label, dagDatum, `${h.adres} ${h.stad}`, `${m.type}: ${m.medewerker}`, "Melding", m.status, "", "", m.opmerkingen||""]);
        });
      });
      weekTaken.filter(t => t.ingepland_op === dagDatum && !(d.woning_ids||[]).includes(t.woning_id)).forEach(t => {
        const h = houses.find(h=>h.id===t.woning_id);
        rows.push([weekInfo.key, d.label, dagDatum, h?`${h.adres} ${h.stad}`:"Algemeen", t.titel, "Extra taak", t.status==="gedaan"?"Gedaan":"Open", t.afgehandeld_door||"", t.afgehandeld_op?t.afgehandeld_op.slice(0,10):"", t.omschrijving||""]);
      });
    });

    // Wekelijkse checklist per woning
    const weekItems = checklistItems.filter(i => i.type === "wekelijks" && i.actief);
    const items4W = checklistItems.filter(i => i.type === "4wekelijks" && i.actief);
    const itemsQ = checklistItems.filter(i => i.type === "kwartaal" && i.actief);
    const [wnStr, jaarStr] = weekInfo.key.split("-");
    const wnNum = parseInt(wnStr)||1; const jaarNum = parseInt(jaarStr)||2026;
    const periode4W = `4W${Math.ceil(wnNum/4)}-${jaarNum}`;
    const periodeQ = `Q${Math.ceil(wnNum/13)}-${jaarNum}`;

    houses.forEach(h => {
      if (weekItems.length > 0) {
        const chk = checklists.find(c => c.woning_id === h.id && c.week_jaar === weekInfo.key && c.type === "wekelijks");
        const afg = chk?.items || [];
        weekItems.forEach(item => {
          rows.push([weekInfo.key, "Wekelijks", weekInfo.start, `${h.adres} ${h.stad}`, item.tekst, "Wekelijkse checklist", afg.includes(item.id)?"Gedaan":"Open", chk?.bijgewerkt_door||"", chk?.updated_at?chk.updated_at.slice(0,10):"", ""]);
        });
      }
      if (items4W.length > 0) {
        const chk = checklists.find(c => c.woning_id === h.id && c.week_jaar === periode4W && c.type === "4wekelijks");
        const afg = chk?.items || [];
        items4W.forEach(item => {
          rows.push([weekInfo.key, "4-wekelijks", weekInfo.start, `${h.adres} ${h.stad}`, item.tekst, "4-wekelijkse checklist", afg.includes(item.id)?"Gedaan":"Open", chk?.bijgewerkt_door||"", chk?.updated_at?chk.updated_at.slice(0,10):"", ""]);
        });
      }
      if (itemsQ.length > 0) {
        const chk = checklists.find(c => c.woning_id === h.id && c.week_jaar === periodeQ && c.type === "kwartaal");
        const afg = chk?.items || [];
        itemsQ.forEach(item => {
          rows.push([weekInfo.key, "Kwartaal", weekInfo.start, `${h.adres} ${h.stad}`, item.tekst, "Kwartaalchecklist", afg.includes(item.id)?"Gedaan":"Open", chk?.bijgewerkt_door||"", chk?.updated_at?chk.updated_at.slice(0,10):"", ""]);
        });
      }
    });

    const csv = "sep=;\n" + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿"+csv], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `planning-cristian-${weekInfo.key}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <SH titel="📅 Planning Cristian" sub="Overzicht welke woningen welke dag, inclusief status klusjes" />
        <button onClick={exporteerCSV}
          style={{background:"white",border:`2px solid ${C.blauw}`,color:C.blauw,borderRadius:8,padding:"9px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
          📥 Export CSV
        </button>
      </div>

      {/* Week navigatie */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,background:"white",borderRadius:10,padding:"10px 14px",border:`1px solid ${C.border}`,justifyContent:"space-between"}}>
        <button onClick={()=>setWeekOffset(w=>w-1)}
          style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,padding:"7px 14px",fontSize:13,fontWeight:600,cursor:"pointer",color:C.blauw,fontFamily:"inherit"}}>
          ← Vorige week
        </button>
        <div style={{textAlign:"center"}}>
          <div style={{fontWeight:700,fontSize:14,color:isHuidigeWeek?C.groen:isVerledenWeek?"#b45309":C.blauw}}>{weekInfo.label}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>
            {isHuidigeWeek?"Huidige week":isVerledenWeek?"Verleden week":"Toekomstige week"}
            {" · "}{openTaken.length} open · {weekTaken.filter(t=>t.status==="gedaan").length} gedaan
          </div>
        </div>
        <button onClick={()=>setWeekOffset(w=>w+1)}
          style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,padding:"7px 14px",fontSize:13,fontWeight:600,cursor:"pointer",color:C.blauw,fontFamily:"inherit"}}>
          Volgende week →
        </button>
      </div>

      <div style={{display:"grid",gap:12}}>
        {dagplanningDB.map(d => {
          const isVandaag = d.dag === dag && isHuidigeWeek;
          const dagDatum = dagDatumVoorOffset(d.dag, weekOffset);
          const woningen = (d.woning_ids||[]).map(id => houses.find(h=>h.id===id)).filter(Boolean);
          const dagItems = woningen.map(h => ({
            huis: h,
            taken: weekTaken.filter(t => t.woning_id === h.id),
            meldingen: openMeldingen.filter(m => m.woning_id === h.id && m.type !== "aankomst" && m.type !== "vertrek"),
          }));
          const extraIngepland = weekTaken.filter(t => t.ingepland_op === dagDatum && !(d.woning_ids||[]).includes(t.woning_id));
          const aankomstenOpDag = meldingen.filter(m => (m.type === "aankomst" || m.type === "reservering") && m.datum === dagDatum);
          const openItems = dagItems.reduce((s,w) => s + w.taken.filter(t=>t.status==="open").length + w.meldingen.length, 0) + extraIngepland.filter(t=>t.status==="open").length + aankomstenOpDag.length;
          const gedaanItems = dagItems.reduce((s,w) => s + w.taken.filter(t=>t.status==="gedaan").length, 0) + extraIngepland.filter(t=>t.status==="gedaan").length;

          return (
            <div key={d.id} style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${d.kleur}`,borderRadius:12,padding:"16px 20px",boxShadow:isVandaag?"0 0 0 2px "+d.kleur:"none"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:woningen.length>0?12:0}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <span style={{fontSize:22}}>{d.icon}</span>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <span style={{fontWeight:800,fontSize:15,color:d.kleur}}>{d.label}</span>
                      <span style={{fontSize:11,color:C.muted}}>{dagDatum}</span>
                      {isVandaag && <span style={{background:d.kleur,color:"white",fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:10}}>VANDAAG</span>}
                    </div>
                    <div style={{fontSize:12,color:C.muted,marginTop:2}}>{d.focus}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  {openItems > 0 && <span style={{background:"#fef3c7",color:"#b45309",fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:20,border:"1px solid #fcd34d"}}>{openItems} open</span>}
                  {gedaanItems > 0 && <span style={{background:"#f0fdf4",color:C.groen,fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:20,border:"1px solid #bbf7d0"}}>✓ {gedaanItems} gedaan</span>}
                  {openItems === 0 && gedaanItems === 0 && woningen.length > 0 && <span style={{background:"#f0fdf4",color:C.groen,fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:20,border:"1px solid #bbf7d0"}}>✓ Alles klaar</span>}
                </div>
              </div>

              {woningen.length > 0 ? (
                <div style={{display:"grid",gap:8}}>
                  {dagItems.map(({huis: h, taken: wTaken, meldingen: wMeldingen}) => {
                    const openW = wTaken.filter(t=>t.status==="open").length + wMeldingen.length;
                    const gedaanW = wTaken.filter(t=>t.status==="gedaan").length;
                    return (
                      <div key={h.id} style={{background:openW===0&&gedaanW>0?"#f0fdf4":C.bg,borderRadius:10,padding:"10px 14px",border:`1px solid ${openW===0&&gedaanW>0?"#bbf7d0":C.border}`}}>
                        <div style={{fontWeight:700,fontSize:13,color:openW===0&&gedaanW>0?C.groen:d.kleur,marginBottom:wTaken.length+wMeldingen.length>0?8:0}}>
                          📍 {h.adres}, {h.stad}
                          {openW===0&&gedaanW>0&&<span style={{marginLeft:8,fontSize:11,color:C.groen}}>✓ afgerond</span>}
                          {openW===0&&gedaanW===0&&<span style={{marginLeft:8,fontSize:11,color:C.muted}}>geen specifieke taken</span>}
                        </div>
                        {wTaken.map(t => (
                          <div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"5px 0",borderTop:`1px solid ${C.border}`,fontSize:12}}>
                            <span style={{color:t.status==="gedaan"?C.groen:"#f59e0b",fontWeight:700,flexShrink:0}}>{t.status==="gedaan"?"✅":"🔧"}</span>
                            <div style={{flex:1}}>
                              <div style={{fontWeight:600,color:t.status==="gedaan"?C.groen:C.text,textDecoration:t.status==="gedaan"?"line-through":"none"}}>{t.titel}</div>
                              {t.omschrijving&&<div style={{color:C.muted,fontSize:11}}>{t.omschrijving.slice(0,80)}</div>}
                              {t.status==="gedaan"&&t.afgehandeld_door&&<div style={{color:C.groen,fontSize:11,marginTop:1}}>✓ {t.afgehandeld_door}{t.afgehandeld_op?` · ${fmtDate(t.afgehandeld_op)}`:""}</div>}
                            </div>
                          </div>
                        ))}
                        {wMeldingen.map(m => (
                          <div key={m.id} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"5px 0",borderTop:`1px solid ${C.border}`,fontSize:12}}>
                            <span style={{color:"#ef4444",fontWeight:700,flexShrink:0}}>⚠️</span>
                            <div><div style={{fontWeight:600,color:C.text}}>{m.type} — {m.medewerker}</div>{m.opmerkingen&&<div style={{color:C.muted,fontSize:11}}>{m.opmerkingen.slice(0,80)}</div>}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>Nog geen woningen ingepland</div>
              )}

              {aankomstenOpDag.length > 0 && (
                <div style={{marginTop:12}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.groen,letterSpacing:".6px",textTransform:"uppercase",marginBottom:8}}>Aankomsten ({aankomstenOpDag.length})</div>
                  {aankomstenOpDag.map(m => {
                    const h = houses.find(h=>h.id===m.woning_id);
                    return (
                      <div key={m.id} style={{background:"#f0fdf4",borderRadius:10,padding:"10px 14px",marginBottom:8,border:"1px solid #bbf7d0"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span>{m.type==="reservering"?"📅":"🏠"}</span>
                          <div>
                            <div style={{fontWeight:700,fontSize:13,color:C.groen}}>{m.medewerker}</div>
                            <div style={{fontSize:12,color:C.muted}}>{h?`${h.adres}`:""}{m.kamer?` · K${m.kamer}`:""}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {extraIngepland.length > 0 && (
                <div style={{marginTop:12}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#7c3aed",letterSpacing:".6px",textTransform:"uppercase",marginBottom:8}}>Extra ingepland ({extraIngepland.length})</div>
                  {extraIngepland.map(t => {
                    const h = houses.find(h=>h.id===t.woning_id);
                    return (
                      <div key={t.id} style={{background:t.status==="gedaan"?"#f0fdf4":"#f5f3ff",borderRadius:10,padding:"10px 14px",marginBottom:8,border:`1px solid ${t.status==="gedaan"?"#bbf7d0":"#ddd6fe"}`}}>
                        <div style={{fontWeight:700,fontSize:13,color:t.status==="gedaan"?C.groen:"#7c3aed",textDecoration:t.status==="gedaan"?"line-through":"none"}}>{t.titel}</div>
                        {h&&<div style={{fontSize:12,color:C.muted}}>📍 {h.adres}{t.kamer?` · K${t.kamer}`:""}</div>}
                        {t.status==="gedaan"&&t.afgehandeld_door&&<div style={{fontSize:11,color:C.groen,marginTop:2}}>✓ {t.afgehandeld_door}{t.afgehandeld_op?` · ${fmtDate(t.afgehandeld_op)}`:""}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


function MeldingForm({ houses, onSubmit, showToast, taal="nl" }) {
  const [type,setType]=useState("aankomst");
  const [medewerker,setMedewerker]=useState("");
  const [datum,setDatum]=useState(todayISO());
  const [huisId,setHuisId]=useState(houses[0]?.id||1);
  const [kamer,setKamer]=useState("");
  const [wieRegelt,setWieRegelt]=useState("");
  const [voorRol,setVoorRol]=useState("backoffice");
  const [sleutelTerug,setSleutelTerug]=useState(null);
  const [kamerSchoon,setKamerSchoon]=useState(null);
  const [sleutelAantal,setSleutelAantal]=useState(1);
  const [opmerkingen,setOpmerkingen]=useState("");
  // Verhuizing extra velden
  const [vanHuisId,setVanHuisId]=useState("");
  const [vanKamer,setVanKamer]=useState("");
  const [naarHuisId,setNaarHuisId]=useState("");
  const [naarKamer,setNaarKamer]=useState("");
  // Bijlages
  const [bijlages,setBijlages]=useState([]);
  const [submitted,setSubmitted]=useState(false);
  const [saving,setSaving]=useState(false);
  const selectedHouse=houses.find(h=>h.id===Number(huisId));
  const vanHuis=houses.find(h=>h.id===Number(vanHuisId));
  const naarHuis=houses.find(h=>h.id===Number(naarHuisId));

  async function handleSubmit() {
    if(!medewerker.trim()){showToast("Vul naam medewerker in","err");return;}
    if(type==="verhuizing"){
      if(!vanHuisId||!vanKamer){showToast("Vul de huidige woning/kamer in","err");return;}
      if(!naarHuisId||!naarKamer){showToast("Vul de nieuwe woning/kamer in","err");return;}
    } else {
      if(!kamer){showToast("Selecteer een kamer","err");return;}
      if(type==="vertrek"&&(sleutelTerug===null||kamerSchoon===null)){showToast("Vul sleutel & schoonmaak in","err");return;}
    }
    setSaving(true);
    // Automatische voor_rol per type
    const autoRol = {
      reservering: "huismeester",
      aankomst: "iedereen",      // Beide rollen zien het
      verhuizing: "iedereen",
      vertrek_aankondiging: "huismeester",
      vertrek: "huismeester",
      overig: voorRol,
    };
    const meldingData = {
      type, medewerker:medewerker.trim(), datum,
      huisId: type==="verhuizing" ? Number(naarHuisId) : Number(huisId),
      kamer: type==="verhuizing" ? naarKamer : kamer,
      vanHuisId: type==="verhuizing" ? Number(vanHuisId) : null,
      vanKamer: type==="verhuizing" ? vanKamer : null,
      wieRegelt, sleutelTerug, kamerSchoon, sleutelAantal, voor_rol: autoRol[type]||voorRol,
      opmerkingen: type==="verhuizing"
        ? `Verhuizing van ${vanHuis?.adres} K${vanKamer} naar ${naarHuis?.adres} K${naarKamer}${opmerkingen?". "+opmerkingen:""}`
        : opmerkingen,
      sleutel_aantal: sleutelAantal || 1,
      bijlages,
    };
    await onSubmit(meldingData);
    setSaving(false);
    setMedewerker("");setOpmerkingen("");setKamer("");setSleutelTerug(null);setKamerSchoon(null);setWieRegelt("");setVoorRol("backoffice");
    setVanHuisId("");setVanKamer("");setNaarHuisId("");setNaarKamer("");setBijlages([]);
    setSubmitted(true);setTimeout(()=>setSubmitted(false),2500);
  }

  if(submitted) return (
    <div className="card" style={{textAlign:"center",padding:"80px 40px",maxWidth:600,margin:"0 auto",borderTop:`4px solid ${C.groen}`}}>
      <div style={{fontSize:64,marginBottom:16}}>✅</div>
      <div style={{fontSize:22,fontWeight:800,color:C.groen,marginBottom:8}}>Melding verzonden!</div>
      <div style={{fontSize:14,color:C.muted,marginBottom:24}}>De huismeester en backoffice zijn op de hoogte gebracht.</div>
      <button className="btn-b" onClick={()=>setSubmitted(false)}>Nieuwe melding</button>
    </div>
  );

  const types=[
    {id:"reservering",          icon:"📅", label:"RESERVERING",           color:C.blauw},
    {id:"aankomst",             icon:"🚗", label:"AANKOMST",              color:C.groen},
    {id:"verhuizing",           icon:"📦", label:"VERHUIZING",            color:"#7c3aed"},
    {id:"vertrek_aankondiging", icon:"📢", label:"VERTREK AANKONDIGING",  color:"#f59e0b"},
    {id:"vertrek",              icon:"🧳", label:"DAADWERKELIJK VERTREK", color:"#ef4444"},
    {id:"overig",               icon:"💬", label:"OVERIG",                color:C.muted},
  ];

  function handleBijlage(e) {
    const files = Array.from(e.target.files||[]);
    setBijlages(prev=>[...prev,...files.map(f=>({naam:f.name,type:f.type,grootte:f.size,bestand:f}))]);
  }

  // Steden voor dropdown
  const steden=[...new Set(houses.map(h=>h.stad))].sort();

  return (
    <div style={{maxWidth:700,margin:"0 auto"}}>
      <SH titel="Melding doorgeven" sub="Geef een aankomst, vertrek of reservering door." />
      <div className="card" style={{marginBottom:16,borderTop:`3px solid ${C.blauw}`}}>
        <label className="fl">Wat wil je melden?</label>
        <div style={{display:"flex",gap:10}}>
          {types.map(t=>(
            <div key={t.id} className={`rt ${type===t.id?"sel":""}`} onClick={()=>setType(t.id)}
              style={{borderColor:type===t.id?t.color:C.border,background:type===t.id?t.color+"12":"white"}}>
              <span style={{fontSize:26,display:"block",marginBottom:6}}>{t.icon}</span>
              <div style={{fontSize:10,fontWeight:700,color:type===t.id?t.color:C.muted,letterSpacing:".8px"}}>{t.label}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}} >
        <div style={{gridColumn:"1"}}><label className="fl">Naam medewerker</label><input className="fi" value={medewerker} onChange={e=>setMedewerker(e.target.value)} placeholder="Voor- en achternaam"/></div>
        <div style={{gridColumn:"2"}}><label className="fl">Datum</label><input className="fi" type="date" value={datum} onChange={e=>setDatum(e.target.value)}/></div>
        {type!=="verhuizing"&&<>
          <div>
            <label className="fl">Woning</label>
            <select className="fs" value={huisId} onChange={e=>{setHuisId(e.target.value);setKamer("");}}>
              {steden.map(stad=>(<optgroup key={stad} label={stad}>{houses.filter(h=>h.stad===stad).map(h=><option key={h.id} value={h.id}>{h.adres}</option>)}</optgroup>))}
            </select>
          </div>
          <div>
            <label className="fl">Kamernummer</label>
            <select className="fs" value={kamer} onChange={e=>setKamer(e.target.value)}>
              <option value="">Selecteer kamer</option>
              {selectedHouse?.kamers.map(k=><option key={k.k} value={k.k}>Kamer {k.k}{k.naam?` – ${k.naam}`:""} [{k.status}]</option>)}
            </select>
          </div>
        </>}
      </div>

      {/* VERHUIZING velden */}
      {type==="verhuizing"&&(
        <div className="card" style={{marginBottom:16,borderTop:`3px solid #7c3aed`}}>
          <div style={{fontWeight:700,fontSize:14,color:"#7c3aed",marginBottom:14}}>📦 Verhuizingsgegevens</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:12}}>
            <div>
              <label className="fl">Van woning</label>
              <select className="fs" value={vanHuisId} onChange={e=>{setVanHuisId(e.target.value);setVanKamer("");}}>
                <option value="">Huidige woning</option>
                {steden.map(stad=>(<optgroup key={stad} label={stad}>{houses.filter(h=>h.stad===stad).map(h=><option key={h.id} value={h.id}>{h.adres}</option>)}</optgroup>))}
              </select>
            </div>
            <div>
              <label className="fl">Van kamer</label>
              <select className="fs" value={vanKamer} onChange={e=>setVanKamer(e.target.value)} disabled={!vanHuisId}>
                <option value="">Kamer</option>
                {vanHuis?.kamers.map(k=><option key={k.k} value={k.k}>K{k.k}{k.naam?` – ${k.naam}`:""}</option>)}
              </select>
            </div>
            <div>
              <label className="fl">Naar woning</label>
              <select className="fs" value={naarHuisId} onChange={e=>{setNaarHuisId(e.target.value);setNaarKamer("");}}>
                <option value="">Nieuwe woning</option>
                {steden.map(stad=>(<optgroup key={stad} label={stad}>{houses.filter(h=>h.stad===stad).map(h=><option key={h.id} value={h.id}>{h.adres}</option>)}</optgroup>))}
              </select>
            </div>
            <div>
              <label className="fl">Naar kamer</label>
              <select className="fs" value={naarKamer} onChange={e=>setNaarKamer(e.target.value)} disabled={!naarHuisId}>
                <option value="">Kamer</option>
                {naarHuis?.kamers.map(k=><option key={k.k} value={k.k}>K{k.k}{k.naam?` – ${k.naam}`:""} [{k.status}]</option>)}
              </select>
            </div>
          </div>
          {vanHuisId&&vanKamer&&naarHuisId&&naarKamer&&(
            <div style={{background:"#f5f3ff",border:"1px solid #c4b5fd",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#6d28d9",fontWeight:500}}>
              📦 {vanHuis?.adres} K{vanKamer} → {naarHuis?.adres} K{naarKamer}
            </div>
          )}
          {/* Controlelijst verhuizing */}
          <div style={{marginTop:14}}>
            <label className="fl">Controlelijst oude kamer</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:6}}>
              {[
                {key:"sleutelTerug", label:"🔑 Sleutel(s) ingeleverd"},
                {key:"kamerSchoon",  label:"🧹 Kamer schoon achtergelaten"},
              ].map(({key,label})=>(
                <div key={key} onClick={()=>{
                  if(key==="sleutelTerug") setSleutelTerug(sleutelTerug==="ja"?null:"ja");
                  if(key==="kamerSchoon") setKamerSchoon(kamerSchoon==="ja"?null:"ja");
                }} style={{border:`2px solid ${(key==="sleutelTerug"?sleutelTerug:kamerSchoon)==="ja"?C.groen:C.border}`,borderRadius:8,padding:"10px 12px",cursor:"pointer",background:(key==="sleutelTerug"?sleutelTerug:kamerSchoon)==="ja"?"#f0fdf4":"white",display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:18,height:18,borderRadius:4,border:`2px solid ${(key==="sleutelTerug"?sleutelTerug:kamerSchoon)==="ja"?C.groen:C.border}`,background:(key==="sleutelTerug"?sleutelTerug:kamerSchoon)==="ja"?C.groen:"white",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {(key==="sleutelTerug"?sleutelTerug:kamerSchoon)==="ja"&&<span style={{color:"white",fontSize:10,fontWeight:700}}>✓</span>}
                  </div>
                  <span style={{fontSize:13,fontWeight:500,color:(key==="sleutelTerug"?sleutelTerug:kamerSchoon)==="ja"?C.groen:C.text}}>{label}</span>
                </div>
              ))}
            </div>
            <label className="fl" style={{marginTop:12}}>Aantal sleutels nieuwe kamer</label>
            <select className="fs" value={sleutelAantal} onChange={e=>setSleutelAantal(Number(e.target.value))}>
              {[1,2].map(n=><option key={n} value={n}>{n} sleutel{n>1?"s":""}</option>)}
            </select>
          </div>
        </div>
      )}
      {(type==="aankomst"||type==="reservering")&&(
        <div className="card" style={{marginBottom:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
          <div><label className="fl">Wie regelt aankomst?</label><input className="fi" value={wieRegelt} onChange={e=>setWieRegelt(e.target.value)} placeholder="bijv. NW CB, Hans, zelf..."/></div>
          {/* Voor wie - alleen tonen bij overig/vertrek, niet bij reservering/aankomst (die zijn automatisch) */}
          {type!=="reservering" && type!=="aankomst" && type!=="verhuizing" && type!=="vertrek" && type!=="vertrek_aankondiging" && (
            <div>
              <label className="fl">Voor wie is deze melding?</label>
              <div style={{display:"flex",gap:8}}>
                {[["backoffice","📊 Backoffice"],["huismeester","🏠 Huismeester"],["iedereen","👥 Iedereen"]].map(([v,l])=>(
                  <div key={v} onClick={()=>setVoorRol(v)}
                    style={{flex:1,border:`2px solid ${voorRol===v?C.blauw:C.border}`,borderRadius:8,padding:"8px 4px",textAlign:"center",cursor:"pointer",background:voorRol===v?C.blauw+"10":"white",fontSize:11,fontWeight:600,color:voorRol===v?C.blauw:C.muted}}>
                    {l}
                  </div>
                ))}
              </div>
            </div>
          )}
          {type==="aankomst"&&<div><label className="fl">Aantal sleutels ontvangen</label><select className="fs" value={sleutelAantal} onChange={e=>setSleutelAantal(Number(e.target.value))}>{[0,1,2,3].map(n=><option key={n} value={n}>{n}</option>)}</select></div>}
        </div>
      )}
      {(type==="vertrek")&&(
        <div className="card" style={{marginBottom:16}}>
          <label className="fl">Controlelijst bij vertrek</label>
          <div className="cr">
            <span style={{flex:1,fontSize:14,fontWeight:500}}>🔑 Sleutel(s) teruggegeven?</span>
            <div style={{display:"flex",gap:8}}>
              <button className={`cb ja ${sleutelTerug==="ja"?"s":""}`} onClick={()=>setSleutelTerug("ja")}>ja</button>
              <button onClick={()=>setSleutelTerug("controle")}
                style={{padding:"5px 14px",borderRadius:6,fontSize:12,fontWeight:600,border:"1.5px solid",cursor:"pointer",transition:"all .15s",borderColor:"#f59e0b",color:sleutelTerug==="controle"?"white":"#f59e0b",background:sleutelTerug==="controle"?"#f59e0b":"white"}}>
                controle
              </button>
              <button className={`cb nee ${sleutelTerug==="nee"?"s":""}`} onClick={()=>setSleutelTerug("nee")}>nee</button>
            </div>
          </div>
          <div className="cr">
            <span style={{flex:1,fontSize:14,fontWeight:500}}>🧹 Kamer schoon achtergelaten?</span>
            <div style={{display:"flex",gap:8}}>
              <button className={`cb ja ${kamerSchoon==="ja"?"s":""}`} onClick={()=>setKamerSchoon("ja")}>ja</button>
              <button onClick={()=>setKamerSchoon("controle")}
                style={{padding:"5px 14px",borderRadius:6,fontSize:12,fontWeight:600,border:"1.5px solid",cursor:"pointer",transition:"all .15s",borderColor:"#f59e0b",color:kamerSchoon==="controle"?"white":"#f59e0b",background:kamerSchoon==="controle"?"#f59e0b":"white"}}>
                controle
              </button>
              <button className={`cb nee ${kamerSchoon==="nee"?"s":""}`} onClick={()=>setKamerSchoon("nee")}>nee</button>
            </div>
          </div>
          {sleutelTerug==="nee"&&<div style={{marginTop:10,padding:"10px 14px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,fontSize:13,color:"#b91c1c",fontWeight:500}}>⚠️ Sleutel niet terug → backoffice wordt geïnformeerd om €100 in te houden van borg</div>}
          {sleutelTerug==="controle"&&<div style={{marginTop:10,padding:"10px 14px",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,fontSize:13,color:"#b45309",fontWeight:500}}>🔍 Sleutel in controle → backoffice en huismeester worden geïnformeerd</div>}
          {kamerSchoon==="controle"&&<div style={{marginTop:8,padding:"10px 14px",background:"#fef3c7",border:"1px solid #fcd34d",borderRadius:8,fontSize:13,color:"#b45309",fontWeight:500}}>🔍 Schoonmaak in controle → huismeester wordt gevraagd te inspecteren</div>}
        </div>
      )}
      <div className="card" style={{marginBottom:16}}><label className="fl">Opmerkingen</label><textarea className="fi" value={opmerkingen} onChange={e=>setOpmerkingen(e.target.value)} placeholder="Eventuele bijzonderheden..." rows={3} style={{resize:"vertical"}}/></div>

      {/* BIJLAGES */}
      <div className="card" style={{marginBottom:20}}>
        <label className="fl">📎 Bijlages toevoegen (optioneel)</label>
        <label style={{display:"block",cursor:"pointer"}}>
          <div className="upload-zone">
            <div style={{fontSize:28,marginBottom:6}}>📎</div>
            <div style={{fontSize:14,fontWeight:600,color:C.blauw,marginBottom:4}}>Klik om bestanden te kiezen</div>
            <div style={{fontSize:12,color:C.muted}}>Foto's, PDF's of documenten — bijv. schadefotos</div>
            <input type="file" multiple accept="image/*,.pdf,.doc,.docx" onChange={handleBijlage} style={{display:"none"}}/>
          </div>
        </label>
        {bijlages.length>0&&(
          <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:6}}>
            {bijlages.map((b,i)=>(
              <div key={i} className="bijlage-chip">
                <span>{b.naam.length>20?b.naam.slice(0,20)+"...":b.naam}</span>
                <span style={{color:C.muted,fontSize:11}}>({Math.round(b.grootte/1024)}KB)</span>
                <button onClick={()=>setBijlages(prev=>prev.filter((_,j)=>j!==i))}
                  style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontFamily:"inherit",fontSize:14,lineHeight:1,padding:"0 2px"}}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="btn-b" style={{width:"100%",padding:14,fontSize:15}} onClick={handleSubmit} disabled={saving}>{saving?"⏳ Opslaan...":`✓ ${type==="verhuizing"?"Verhuizing":type.charAt(0).toUpperCase()+type.slice(1)} doorgeven`}</button>
    </div>
  );
}

function MijnMeldingen({meldingen,houses}) {
  if(meldingen.length===0) return <div className="card" style={{textAlign:"center",padding:"60px 20px"}}><div style={{fontSize:40,marginBottom:12}}>📭</div><div style={{color:C.muted}}>Je hebt nog geen meldingen ingediend</div></div>;
  return <div><SH titel="Mijn meldingen"/>{meldingen.map(m=><MeldingItem key={m.id} m={m} houses={houses}/>)}</div>;
}

function MeldingItem({m,houses}) {
  const ti={aankomst:"🚗",vertrek:"🧳",reservering:"📅",verhuizing:"📦",overig:"💬"};
  const tc={aankomst:C.groen,vertrek:"#ef4444",reservering:C.blauw,verhuizing:"#7c3aed",overig:C.muted};
  const huis=houses.find(h=>h.id===m.woning_id);
  return(
    <div className="mc" style={{borderLeft:`3px solid ${m.sleutel_terug==="nee"||m.kamer_schoon==="nee"?"#ef4444":tc[m.type]||C.muted}`}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
        <div style={{fontSize:24}}>{ti[m.type]||"💬"}</div>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:4}}>
            <span style={{fontWeight:700,fontSize:15,color:C.text}}>{m.medewerker}</span>
            <span className="badge" style={{background:(tc[m.type]||C.muted)+"18",color:tc[m.type]||C.muted}}>{(m.type||"").toUpperCase()}</span>
            <span className="badge" style={{background:m.status==="open"?C.blauw+"18":"#f0fdf4",color:m.status==="open"?C.blauw:C.groen,marginLeft:"auto"}}>{(m.status||"").toUpperCase()}</span>
          </div>
          <div style={{fontSize:13,color:C.muted}}>📍 {huis?.adres}, {huis?.stad} · Kamer {m.kamer} · {m.created_at?fmtFull(m.created_at):""}</div>
          {m.wie_regelt&&<div style={{fontSize:12,color:C.muted,marginTop:4}}>👤 Wie regelt: {m.wie_regelt}</div>}
          {m.type==="vertrek"&&<div style={{display:"flex",gap:8,marginTop:6}}><span className="badge" style={{background:m.sleutel_terug==="ja"?C.groen+"18":"#fef2f2",color:m.sleutel_terug==="ja"?C.groen:"#ef4444"}}>🔑 {m.sleutel_terug}</span><span className="badge" style={{background:m.kamer_schoon==="ja"?C.groen+"18":"#fef2f2",color:m.kamer_schoon==="ja"?C.groen:"#ef4444"}}>🧹 {m.kamer_schoon}</span></div>}
          {m.opmerkingen&&<div style={{fontSize:13,color:C.muted,marginTop:6,fontStyle:"italic"}}>"{m.opmerkingen}"</div>}
        </div>
      </div>
    </div>
  );
}

function HuismeesterTaken({meldingen,houses,onUpdate,naam}) {
  const [notitieMap,setNotitieMap]=useState({});
  const open=meldingen.filter(m=>m.status==="open");
  const afgehandeld=meldingen.filter(m=>m.status!=="open"&&m.afgehandeld_door===naam);

  function taken(m){
    const t=[];
    if(m.type==="aankomst") t.push({icon:"🛏",tekst:`Kamer ${m.kamer} gereedmaken voor ${m.medewerker}`});
    if(m.type==="vertrek"&&m.kamer_schoon==="nee") t.push({icon:"🧹",tekst:`Kamer ${m.kamer} schoonmaken`,urgent:true});
    if(m.type==="vertrek") t.push({icon:"🔍",tekst:`Kamer ${m.kamer} controleren na vertrek ${m.medewerker}`});
    if(m.type==="reservering") t.push({icon:"📅",tekst:`Kamer ${m.kamer} klaarzetten voor ${m.medewerker} (aankomst ${m.datum})`});
    if(m.wie_regelt) t.push({icon:"👤",tekst:`Wie regelt: ${m.wie_regelt}`});
    if(m.opmerkingen) t.push({icon:"📝",tekst:m.opmerkingen});
    return t;
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
        <div><h2 style={{fontSize:20,fontWeight:800,color:C.blauw}}>Openstaande meldingen</h2><p style={{fontSize:13,color:C.muted,marginTop:2}}>Meldingen die jouw actie vereisen</p></div>
        <div style={{display:"flex",gap:12}}>
          <div style={{textAlign:"center",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 20px"}}><div style={{fontSize:22,fontWeight:700,color:"#ef4444"}}>{open.length}</div><div style={{fontSize:11,color:C.muted}}>Open</div></div>
          <div style={{textAlign:"center",background:"#f0fdf4",border:`1px solid ${C.groen}40`,borderRadius:10,padding:"10px 20px"}}><div style={{fontSize:22,fontWeight:700,color:C.groen}}>{afgehandeld.length}</div><div style={{fontSize:11,color:C.muted}}>Afgehandeld</div></div>
        </div>
      </div>
      {open.length===0?<div className="card" style={{textAlign:"center",padding:"60px 20px"}}><div style={{fontSize:48,marginBottom:12}}>✅</div><div style={{fontWeight:700,color:C.groen}}>Alles afgehandeld!</div></div>
      :open.map(m=>{
        const huis=houses.find(h=>h.id===m.woning_id);
        const tl=taken(m);
        return(
          <div key={m.id} className="mc" style={{marginBottom:14,borderLeft:`4px solid ${C.groen}`}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <span style={{fontSize:22}}>{m.type==="aankomst"?"🚗":m.type==="vertrek"?"🧳":"📅"}</span>
              <div>
                <div style={{fontWeight:700,fontSize:15,color:C.text}}>{m.medewerker} — <span style={{color:C.blauw,textTransform:"uppercase",fontSize:12}}>{m.type}</span></div>
                <div style={{fontSize:12,color:C.muted}}>📍 {huis?.adres}, {huis?.stad} · K{m.kamer} · Door: {m.ingediend_door} · {m.created_at?fmtFull(m.created_at):""}</div>
              </div>
            </div>
            <div style={{background:C.bg,borderRadius:8,padding:14,marginBottom:12,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:10,letterSpacing:".8px"}}>TE DOEN:</div>
              {tl.map((t,i)=>(
                <div key={i} style={{display:"flex",gap:10,padding:"6px 0",borderBottom:i<tl.length-1?`1px solid ${C.border}`:"none",alignItems:"center"}}>
                  <span style={{fontSize:16}}>{t.icon}</span><span style={{fontSize:14,flex:1,color:C.text}}>{t.tekst}</span>
                  {t.urgent&&<span style={{fontSize:10,fontWeight:700,color:"#ef4444",background:"#fef2f2",padding:"2px 8px",borderRadius:4}}>URGENT</span>}
                </div>
              ))}
            </div>
            <input className="fi" value={notitieMap[m.id]||""} onChange={e=>setNotitieMap(p=>({...p,[m.id]:e.target.value}))} placeholder="Optionele notitie..." style={{fontSize:13,marginBottom:10}}/>
            <div style={{display:"flex",gap:10}}>
              <button className="btn-g" style={{flex:1,padding:"10px"}} onClick={()=>onUpdate(m.id,"afgehandeld",notitieMap[m.id]||"")}>✓ Afgehandeld</button>
              <button className="btn-out" onClick={()=>onUpdate(m.id,"in_behandeling",notitieMap[m.id]||"")}>In behandeling</button>
            </div>
          </div>
        );
      })}
      {afgehandeld.length>0&&<div style={{marginTop:32}}><h3 style={{fontSize:13,fontWeight:700,color:C.muted,marginBottom:12,textTransform:"uppercase",letterSpacing:".5px"}}>Eerder afgehandeld</h3>{afgehandeld.slice(0,5).map(m=><MeldingItem key={m.id} m={m} houses={houses}/>)}</div>}
    </div>
  );
}

function BackofficeInbox({meldingen,houses,onUpdate,naam,showToast}) {
  const [notitieMap,setNotitieMap]=useState({});
  const [filter,setFilter]=useState("open");
  const actie=meldingen.filter(m=>m.sleutel_terug==="nee"||m.kamer_schoon==="nee");
  const filtered=meldingen.filter(m=>filter==="open"?m.status==="open":filter==="actie"?(m.sleutel_terug==="nee"||m.kamer_schoon==="nee"):true);

  return(
    <div>
      <div style={{display:"flex",alignItems:"flex-start",gap:16,marginBottom:20}}>
        <div><h2 style={{fontSize:20,fontWeight:800,color:C.blauw}}>Backoffice Inbox</h2><p style={{fontSize:13,color:C.muted,marginTop:2}}>Meldingen met administratieve of salaris consequenties</p></div>
        {actie.length>0&&<div style={{marginLeft:"auto",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 18px",textAlign:"center"}}><div style={{fontSize:20,fontWeight:700,color:"#ef4444"}}>{actie.length}</div><div style={{fontSize:10,color:C.muted}}>Salarisactie</div></div>}
      </div>
      {actie.length>0&&(
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:12,padding:"14px 18px",marginBottom:20}}>
          <div style={{fontWeight:700,color:"#b91c1c",marginBottom:8,fontSize:14}}>⚠️ Salarisverwerking vereist</div>
          {actie.map(m=>{const h=houses.find(h=>h.id===m.woning_id);return <div key={m.id} style={{fontSize:13,color:"#b91c1c",marginBottom:4,display:"flex",gap:10,flexWrap:"wrap"}}><span>• {m.medewerker} ({h?.adres}, K{m.kamer}):</span>{m.sleutel_terug==="nee"&&<span style={{background:"#fecaca",padding:"2px 8px",borderRadius:4,fontSize:11}}>🔑 €100 inhouden</span>}{m.kamer_schoon==="nee"&&<span style={{background:"#fef3c7",padding:"2px 8px",borderRadius:4,fontSize:11,color:"#b45309"}}>🧹 schoonmaakkosten</span>}</div>;})}
        </div>
      )}
      <div style={{display:"flex",gap:6,marginBottom:20}}>{[["open","Open"],["actie","Actie vereist"],["alle","Alle"]].map(([v,l])=><button key={v} onClick={()=>setFilter(v)} style={{background:filter===v?C.blauw:"white",color:filter===v?"white":C.muted,border:`1.5px solid ${filter===v?C.blauw:C.border}`,borderRadius:20,padding:"6px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>)}</div>
      {filtered.map(m=>{
        const huis=houses.find(h=>h.id===m.woning_id);
        const na=m.sleutel_terug==="nee"||m.kamer_schoon==="nee";
        return(
          <div key={m.id} className="mc" style={{marginBottom:12,borderLeft:`4px solid ${na?"#ef4444":C.blauw}`}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:10}}>
              <span style={{fontSize:22}}>{m.type==="aankomst"?"🚗":m.type==="vertrek"?"🧳":"📅"}</span>
              <div style={{flex:1}}>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <span style={{fontWeight:700,color:C.text}}>{m.medewerker}</span>
                  <span className="badge" style={{background:C.bg,color:C.muted,fontSize:10}}>{(m.type||"").toUpperCase()}</span>
                  {na&&<span className="badge" style={{background:"#fef2f2",color:"#ef4444",fontSize:10}}>⚠️ ACTIE SALARIS</span>}
                  <span className="badge" style={{background:m.status==="open"?C.blauw+"18":"#f0fdf4",color:m.status==="open"?C.blauw:C.groen,marginLeft:"auto",fontSize:10}}>{(m.status||"").toUpperCase()}</span>
                </div>
                <div style={{fontSize:12,color:C.muted,marginTop:4}}>📍 {huis?.adres}, {huis?.stad} · K{m.kamer} · {m.datum} · Door: {m.ingediend_door}</div>
                {m.wie_regelt&&<div style={{fontSize:12,color:C.muted,marginTop:2}}>👤 Wie regelt: {m.wie_regelt}</div>}
                {m.opmerkingen&&<div style={{fontSize:13,color:C.text,marginTop:6,fontStyle:"italic",background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:8,padding:"8px 12px"}}>💬 "{m.opmerkingen}"</div>}
              </div>
            </div>
            <div style={{background:C.bg,borderRadius:8,padding:12,marginBottom:10,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:8,letterSpacing:".8px"}}>ADMINISTRATIEVE ACTIES:</div>
              {m.type==="aankomst"&&<div style={{fontSize:13,color:C.text}}>✅ Kamer {m.kamer} → <strong style={{color:C.groen}}>Lopend</strong> — huuraftrek actief per {m.datum}</div>}
              {m.type==="reservering"&&<div style={{fontSize:13,color:C.text}}>📅 Kamer {m.kamer} gereserveerd voor {m.medewerker} — aankomst {m.datum}</div>}
              {m.type==="vertrek"&&(<><div style={{fontSize:13,color:C.text,marginBottom:6}}>
                {m.sleutel_terug==="nee"?"🔑❌ ":m.sleutel_terug==="controle"?"🔑🔍 ":"🔑✅ "}
                {m.sleutel_terug==="nee"?<strong style={{color:"#ef4444"}}>NIET terug → €100 inhouden van borg</strong>:m.sleutel_terug==="controle"?<strong style={{color:"#f59e0b"}}>In controle → nog natrekken</strong>:<span style={{color:C.groen}}>Sleutel teruggegeven</span>}
              </div><div style={{fontSize:13,color:C.text}}>
                {m.kamer_schoon==="nee"?"🧹❌ ":m.kamer_schoon==="controle"?"🧹🔍 ":"🧹✅ "}
                {m.kamer_schoon==="nee"?<strong style={{color:"#f59e0b"}}>NIET schoon → schoonmaakkosten verwerken</strong>:m.kamer_schoon==="controle"?<strong style={{color:"#f59e0b"}}>In controle → huismeester inspecteert</strong>:<span style={{color:C.groen}}>Kamer schoon achtergelaten</span>}
              </div></>)}
            </div>
            {m.status==="open"&&m.type!=="vertrek_aankondiging"&&(<><input className="fi" value={notitieMap[m.id]||""} onChange={e=>setNotitieMap(p=>({...p,[m.id]:e.target.value}))} placeholder="Notitie bij verwerking..." style={{fontSize:13,marginBottom:10}}/><button className="btn-b" style={{width:"100%"}} onClick={()=>onUpdate(m.id,"verwerkt",notitieMap[m.id]||"")}>✓ Verwerkt in administratie</button></>)}
            {m.status!=="open"&&m.afgehandeld_door&&<div style={{fontSize:12,color:C.muted,marginTop:8}}>Verwerkt door {m.afgehandeld_door}{m.notitie?` — "${m.notitie}"`:""}</div>}
          </div>
        );
      })}
    </div>
  );
}

function WoningenDetail({houses, onUpdateWoning}) {
  const [filterStad,setFilterStad]=useState("Alle");
  const [filterStatus,setFilterStatus]=useState("Alle");
  const [zoek,setZoek]=useState("");
  const [bewerkKamer,setBewerkKamer]=useState(null); // {huisId, kamerNr}
  const [bewerkWaarden,setBewerkWaarden]=useState({naam:"",bedrijf:"",status:""});
  const [saving,setSaving]=useState(false);

  const steden=["Alle",...Array.from(new Set(houses.map(h=>h.stad))).sort()];
  const total=houses.reduce((s,h)=>s+h.kamers.length,0);
  const bezet=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.naam&&k.status==="Lopend").length,0);
  const beschikbaar=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Beschikbaar").length,0);
  const gereserveerd=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Gereserveerd").length,0);
  const controle=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Controle").length,0);
  const filtered=houses.filter(h=>{
    if(filterStad!=="Alle"&&h.stad!==filterStad) return false;
    if(filterStatus!=="Alle"&&!h.kamers.some(k=>k.status===filterStatus)) return false;
    if(zoek.trim()){const q=zoek.toLowerCase();return h.adres.toLowerCase().includes(q)||h.stad.toLowerCase().includes(q)||h.kamers.some(k=>k.naam.toLowerCase().includes(q)||(k.bedrijf||"").toLowerCase().includes(q));}
    return true;
  });

  function startBewerk(huis, k) {
    setBewerkKamer({huisId:huis.id, kamerNr:k.k});
    setBewerkWaarden({naam:k.naam||"", bedrijf:k.bedrijf||"", status:k.status||"Beschikbaar"});
  }

  async function slaBewerk(huis) {
    setSaving(true);
    const nieuweKamers = huis.kamers.map(k =>
      k.k===bewerkKamer.kamerNr ? {...k,...bewerkWaarden} : k
    );
    await onUpdateWoning(huis.id, {kamers:nieuweKamers});
    setSaving(false);
    setBewerkKamer(null);
  }

  return(
    <div>
      <SH titel="Woningoverzicht" sub={`Alle ${houses.length} woningen met bewoners en kamerstatus`}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:24}}>
        <SK label="Bezet" val={bezet} color={C.groen}/>
        <SK label="Beschikbaar" val={beschikbaar} color={C.blauw}/>
        <SK label="Gereserveerd" val={gereserveerd} color="#f59e0b"/>
        <SK label="Controle" val={controle} color="#ef4444"/>
        <SK label="Totaal kamers" val={total} color={C.muted}/>
      </div>
      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
        <input value={zoek} onChange={e=>setZoek(e.target.value)} placeholder="🔍 Zoek op naam, adres, bedrijf..."
          style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 14px",fontSize:13,outline:"none",width:240}}/>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{steden.map(s=><button key={s} onClick={()=>setFilterStad(s)} style={{background:filterStad===s?C.blauw:"white",color:filterStad===s?"white":C.muted,border:`1.5px solid ${filterStad===s?C.blauw:C.border}`,borderRadius:20,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{s}</button>)}</div>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:12,outline:"none"}}>
          {["Alle",...STATUSSEN].map(s=><option key={s}>{s}</option>)}
        </select>
        <span style={{fontSize:12,color:C.muted}}>{filtered.length} woningen</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:16}}>
        {filtered.map(h=>{
          const bezette=h.kamers.filter(k=>k.naam&&k.status==="Lopend").length;
          const hasIssue=h.kamers.some(k=>k.status==="Controle"||k.status==="Moet aan het werk");
          const hasVrij=h.kamers.some(k=>k.status==="Beschikbaar");
          return(
            <div key={h.id} className="card" style={{borderTop:`3px solid ${hasIssue?"#ef4444":hasVrij?C.blauw:C.groen}`,padding:"18px 18px 14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div><div style={{fontWeight:800,fontSize:15,color:C.text}}>{h.adres}</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>{h.stad} · {h.postcode}</div></div>
                <div style={{textAlign:"right",flexShrink:0,marginLeft:10}}><div style={{fontSize:22,fontWeight:800,color:C.blauw,lineHeight:1}}>{bezette}<span style={{fontSize:13,color:C.muted}}>/{h.kamers.length}</span></div><div style={{fontSize:10,color:C.muted,marginTop:2}}>bezet</div></div>
              </div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:12}}>
                {h.kamers.map(k=>{const c=STATUS_MAP[k.status]||{dot:C.muted};return <div key={k.k} title={`K${k.k}: ${k.naam||"leeg"} — ${k.status}`} style={{width:12,height:12,borderRadius:3,background:c.dot+"50",border:`1.5px solid ${c.dot}`}}/>;  })}
              </div>
              <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10}}>
                {h.kamers.map(k=>{
                  const c=STATUS_MAP[k.status]||{bg:C.bg,text:C.muted,dot:C.muted};
                  const rijBg=k.status==="Controle"?"#fef2f2":k.status==="Moet aan het werk"?"#fff7ed":k.status==="Beschikbaar"?C.blauw+"08":"transparent";
                  const isBezig=bewerkKamer?.huisId===h.id&&bewerkKamer?.kamerNr===k.k;

                  return(
                    <div key={k.k}>
                      {isBezig ? (
                        // ── Inline bewerk formulier ──
                        <div style={{background:C.blauw+"08",border:`1.5px solid ${C.blauw}`,borderRadius:8,padding:10,marginBottom:4}}>
                          <div style={{fontSize:11,fontWeight:700,color:C.blauw,marginBottom:8}}>✏️ Kamer {k.k} bewerken</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                            <div>
                              <label style={{fontSize:10,fontWeight:600,color:C.muted,display:"block",marginBottom:3,textTransform:"uppercase",letterSpacing:".5px"}}>Naam bewoner</label>
                              <input className="fi" value={bewerkWaarden.naam} onChange={e=>setBewerkWaarden(p=>({...p,naam:e.target.value}))} placeholder="Naam..." style={{fontSize:12,padding:"6px 10px"}}/>
                            </div>
                            <div>
                              <label style={{fontSize:10,fontWeight:600,color:C.muted,display:"block",marginBottom:3,textTransform:"uppercase",letterSpacing:".5px"}}>Bedrijf</label>
                              <input className="fi" value={bewerkWaarden.bedrijf} onChange={e=>setBewerkWaarden(p=>({...p,bedrijf:e.target.value}))} placeholder="Bedrijf..." style={{fontSize:12,padding:"6px 10px"}}/>
                            </div>
                          </div>
                          <div style={{marginBottom:8}}>
                            <label style={{fontSize:10,fontWeight:600,color:C.muted,display:"block",marginBottom:3,textTransform:"uppercase",letterSpacing:".5px"}}>Status</label>
                            <select className="fs" value={bewerkWaarden.status} onChange={e=>setBewerkWaarden(p=>({...p,status:e.target.value}))} style={{fontSize:12,padding:"6px 10px"}}>
                              {STATUSSEN.map(s=><option key={s}>{s}</option>)}
                            </select>
                          </div>
                          <div style={{display:"flex",gap:6}}>
                            <button className="btn-b" style={{flex:1,padding:"7px",fontSize:12}} onClick={()=>slaBewerk(h)} disabled={saving}>
                              {saving?"⏳":"✓ Opslaan"}
                            </button>
                            <button className="btn-out" style={{padding:"7px 12px",fontSize:12}} onClick={()=>setBewerkKamer(null)}>Annuleren</button>
                          </div>
                        </div>
                      ) : (
                        // ── Normale weergave met bewerk-knop ──
                        <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:7,marginBottom:2,background:rijBg,cursor:"pointer"}}
                          onMouseEnter={e=>e.currentTarget.style.background=C.blauw+"08"}
                          onMouseLeave={e=>e.currentTarget.style.background=rijBg}>
                          <div style={{width:6,height:6,borderRadius:2,background:c.dot,flexShrink:0}}/>
                          <span style={{fontSize:11,fontWeight:700,color:C.muted,minWidth:28,fontFamily:"monospace"}}>K{k.k}</span>
                          <span style={{flex:1,fontSize:13,color:k.naam?C.text:"#aab4c4",fontStyle:k.naam?"normal":"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k.naam||"leeg"}</span>
                          {k.bedrijf&&<span style={{fontSize:11,color:C.muted,whiteSpace:"nowrap",flexShrink:0}}>{k.bedrijf}</span>}
                          <span style={{padding:"2px 8px",borderRadius:4,background:c.bg,color:c.text,fontSize:10,fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>{k.status}</span>
                          {onUpdateWoning&&(
                            <button onClick={()=>startBewerk(h,k)}
                              style={{background:"none",border:`1px solid ${C.border}`,borderRadius:5,padding:"2px 7px",fontSize:11,cursor:"pointer",color:C.muted,flexShrink:0,transition:"all .15s"}}
                              title="Bewerken">✏️</button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`,display:"flex",gap:6,flexWrap:"wrap"}}>
                {hasVrij&&<span style={{fontSize:10,fontWeight:600,color:C.blauw,background:C.blauw+"18",padding:"3px 8px",borderRadius:4}}>{h.kamers.filter(k=>k.status==="Beschikbaar").length} vrij</span>}
                {h.kamers.filter(k=>k.status==="Gereserveerd").length>0&&<span style={{fontSize:10,fontWeight:600,color:"#b45309",background:"#fef3c7",padding:"3px 8px",borderRadius:4}}>{h.kamers.filter(k=>k.status==="Gereserveerd").length} gereserveerd</span>}
                {h.kamers.filter(k=>k.status==="Controle").length>0&&<span style={{fontSize:10,fontWeight:600,color:"#ef4444",background:"#fef2f2",padding:"3px 8px",borderRadius:4}}>⚠ {h.kamers.filter(k=>k.status==="Controle").length} controle</span>}
                {h.kamers.filter(k=>k.status==="Moet aan het werk").length>0&&<span style={{fontSize:10,fontWeight:600,color:"#c2410c",background:"#fff7ed",padding:"3px 8px",borderRadius:4}}>⚠ {h.kamers.filter(k=>k.status==="Moet aan het werk").length} moet aan het werk</span>}
                {h.kamers.filter(k=>k.status==="Vertrokken").length>0&&<span style={{fontSize:10,fontWeight:600,color:"#52525b",background:"#f4f4f5",padding:"3px 8px",borderRadius:4}}>{h.kamers.filter(k=>k.status==="Vertrokken").length} vertrokken</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlanningView({houses}) {
  const [filterStad,setFilterStad]=useState("Alle");
  const steden=["Alle",...Array.from(new Set(houses.map(h=>h.stad))).sort()];
  const filtered=filterStad==="Alle"?houses:houses.filter(h=>h.stad===filterStad);
  const total=houses.reduce((s,h)=>s+h.kamers.length,0);
  const bezet=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.naam&&k.status==="Lopend").length,0);
  const beschikbaar=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Beschikbaar").length,0);
  const controle=houses.reduce((s,h)=>s+h.kamers.filter(k=>k.status==="Controle").length,0);
  return(
    <div>
      <SH titel="Statusoverzicht"/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        <SK label="Bezet" val={bezet} color={C.groen}/>
        <SK label="Beschikbaar" val={beschikbaar} color={C.blauw}/>
        <SK label="Te controleren" val={controle} color="#ef4444"/>
        <SK label="Totaal kamers" val={total} color={C.muted}/>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>{steden.map(s=><button key={s} onClick={()=>setFilterStad(s)} style={{background:filterStad===s?C.blauw:"white",color:filterStad===s?"white":C.muted,border:`1.5px solid ${filterStad===s?C.blauw:C.border}`,borderRadius:20,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{s}</button>)}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14}}>
        {filtered.map(h=>{
          const bezette=h.kamers.filter(k=>k.naam&&k.status==="Lopend").length;
          return(
            <div key={h.id} className="card" style={{borderTop:`3px solid ${C.blauw}`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
                <div><div style={{fontWeight:800,fontSize:15,color:C.text}}>{h.adres}</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>{h.stad} · {h.postcode}</div></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:22,fontWeight:800,color:C.blauw}}>{bezette}/{h.kamers.length}</div><div style={{fontSize:10,color:C.muted}}>bezet</div></div>
              </div>
              <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:12}}>{h.kamers.map(k=>{const c=STATUS_MAP[k.status]||{dot:C.muted};return <div key={k.k} title={`K${k.k}: ${k.naam||"leeg"}`} style={{width:10,height:10,borderRadius:3,background:c.dot+"60",border:`1.5px solid ${c.dot}`}}/>;})}</div>
              <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12}}>
                {h.kamers.map(k=>{const c=STATUS_MAP[k.status]||{bg:C.bg,text:C.muted};return(
                  <div key={k.k} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:6,marginBottom:2}}>
                    <span style={{fontSize:10,fontWeight:700,color:C.muted,minWidth:26,fontFamily:"monospace"}}>K{k.k}</span>
                    <span style={{flex:1,fontSize:13,color:k.naam?C.text:"#aab4c4",fontStyle:k.naam?"normal":"italic"}}>{k.naam||"leeg"}</span>
                    {k.bedrijf&&<span style={{fontSize:11,color:C.muted}}>{k.bedrijf}</span>}
                    <span style={{padding:"2px 8px",borderRadius:4,background:c.bg,color:c.text,fontSize:10,fontWeight:600,whiteSpace:"nowrap"}}>{k.status}</span>
                  </div>
                );})}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BeheerView({houses,onAdd,onUpdate,onDelete,showToast,gebruikers,onAddGebruiker,onUpdateGebruiker,onDeleteGebruiker,checklistItems,dagplanningDB}) {
  const [subTab,setSubTab]=useState("woningen");
  return(
    <div>
      <SH titel="⚙️ Beheer" sub="Alleen beschikbaar voor Liset"/>
      <div style={{display:"flex",gap:6,marginBottom:24,borderBottom:`2px solid ${C.border}`,paddingBottom:0}}>
        {[["woningen","🏠 Woningen & kamers"],["gebruikers","👥 Gebruikers & pincodes"],["checklists","✅ Checklists"],["dagplanning","📅 Dagplanning huismeester"]].map(([v,l])=>(
          <button key={v} onClick={()=>setSubTab(v)}
            style={{background:"none",border:"none",padding:"10px 20px",fontSize:14,fontWeight:700,color:subTab===v?C.blauw:C.muted,borderBottom:subTab===v?`3px solid ${C.blauw}`:"3px solid transparent",marginBottom:-2,cursor:"pointer",fontFamily:"inherit"}}>
            {l}
          </button>
        ))}
      </div>
      {subTab==="woningen"&&<WoningBeheer houses={houses} onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete} showToast={showToast}/>}
      {subTab==="gebruikers"&&<GebruikersBeheer gebruikers={gebruikers} onAdd={onAddGebruiker} onUpdate={onUpdateGebruiker} onDelete={onDeleteGebruiker} showToast={showToast}/>}
      {subTab==="checklists"&&<ChecklistItemsBeheer checklistItems={checklistItems} showToast={showToast}/>}
      {subTab==="dagplanning"&&<DagplanningBeheer dagplanningDB={dagplanningDB} showToast={showToast} houses={houses}/>}
    </div>
  );
}

// ─── DAGPLANNING BEHEER ───────────────────────────────────────────────────────
function DagplanningBeheer({ dagplanningDB, showToast, houses=[] }) {
  const [bewerkId, setBewerkId] = useState(null);
  const [saving, setSaving] = useState(false);

  async function slaOp(dag) {
    setSaving(true);
    const { error } = await supabase.from("dagplanning").update({
      focus: dag.focus,
      taken: dag.taken,
      woning_ids: dag.woning_ids || [],
      updated_at: new Date().toISOString(),
    }).eq("id", dag.id);
    setSaving(false);
    if (error) { showToast("Fout bij opslaan","err"); return; }
    showToast("✓ Dagplanning opgeslagen");
    setBewerkId(null);
  }

  return (
    <div>
      <div style={{marginBottom:20}}>
        <h3 style={{fontSize:16,fontWeight:800,color:C.blauw}}>📅 Dagplanning huismeester</h3>
        <p style={{fontSize:13,color:C.muted,marginTop:4}}>Pas per dag de focus en taken aan. De huismeester ziet dit direct in zijn "Mijn dag" overzicht.</p>
      </div>
      <div style={{display:"grid",gap:16}}>
        {dagplanningDB.map(dag => (
          <DagKaart key={dag.id} dag={dag} isBewerken={bewerkId===dag.id}
            onBewerken={()=>setBewerkId(dag.id)}
            onAnnuleren={()=>setBewerkId(null)}
            onOpslaan={slaOp}
            saving={saving}
            houses={houses}/>
        ))}
      </div>
    </div>
  );
}

function DagKaart({ dag, isBewerken, onBewerken, onAnnuleren, onOpslaan, saving, houses=[] }) {
  const [focus, setFocus] = useState(dag.focus);
  const [taken, setTaken] = useState([...dag.taken]);
  const [woningIds, setWoningIds] = useState(dag.woning_ids||[]);

  useEffect(() => { setFocus(dag.focus); setTaken([...dag.taken]); setWoningIds(dag.woning_ids||[]); }, [dag]);

  function updateTaak(i, val) { setTaken(prev => prev.map((t,j) => j===i ? val : t)); }
  function verwijderTaak(i) { setTaken(prev => prev.filter((_,j) => j!==i)); }
  function voegToe() { setTaken(prev => [...prev, ""]); }
  function toggleWoning(id) { setWoningIds(prev => prev.includes(id) ? prev.filter(w=>w!==id) : [...prev, id]); }

  return (
    <div style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`4px solid ${dag.kleur}`,borderRadius:12,padding:20}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:isBewerken?16:0}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:24}}>{dag.icon}</span>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:dag.kleur}}>{dag.label}</div>
            {!isBewerken && <div style={{fontSize:13,color:C.muted,marginTop:2}}>{dag.focus}</div>}
          </div>
        </div>
        {!isBewerken && (
          <button onClick={onBewerken}
            style={{background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,padding:"7px 16px",fontSize:13,cursor:"pointer",fontFamily:"inherit",color:C.muted}}>
            ✏️ Aanpassen
          </button>
        )}
      </div>

      {!isBewerken && (
        <div style={{marginTop:12}}>
          {(dag.woning_ids||[]).length > 0 && (
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
              {(dag.woning_ids||[]).map(id=>{
                const h = houses.find(h=>h.id===id);
                return h ? (
                  <span key={id} style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,background:dag.kleur+"18",color:dag.kleur}}>
                    📍 {h.adres}, {h.stad}
                  </span>
                ) : null;
              })}
            </div>
          )}
          {dag.taken.map((t,i) => (
            <div key={i} style={{display:"flex",gap:10,padding:"6px 0",borderBottom:i<dag.taken.length-1?`1px solid ${C.border}`:"none",fontSize:13,color:C.text}}>
              <span style={{color:dag.kleur,fontWeight:700}}>{i+1}.</span> {t}
            </div>
          ))}
        </div>
      )}

      {isBewerken && (
        <div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>Focus van de dag</label>
            <input value={focus} onChange={e=>setFocus(e.target.value)}
              style={{width:"100%",background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"10px 14px",fontSize:14,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
          </div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:8,display:"block"}}>Taken</label>
            {taken.map((t,i) => (
              <div key={i} style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
                <span style={{color:dag.kleur,fontWeight:700,fontSize:13,minWidth:20}}>{i+1}.</span>
                <input value={t} onChange={e=>updateTaak(i,e.target.value)}
                  style={{flex:1,background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
                <button onClick={()=>verwijderTaak(i)}
                  style={{background:"#fef2f2",border:"1px solid #fecaca",color:"#ef4444",borderRadius:6,padding:"6px 10px",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>🗑</button>
              </div>
            ))}
            <button onClick={voegToe}
              style={{background:C.bg,border:`1.5px dashed ${C.border}`,borderRadius:8,padding:"8px 16px",fontSize:13,cursor:"pointer",fontFamily:"inherit",color:C.muted,width:"100%",marginTop:4}}>
              + Taak toevoegen
            </button>
          </div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:8,display:"block"}}>Woningen op deze dag</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {houses.map(h=>{
                const geselecteerd = woningIds.includes(h.id);
                return (
                  <div key={h.id} onClick={()=>toggleWoning(h.id)}
                    style={{padding:"6px 12px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",border:`1.5px solid ${geselecteerd?dag.kleur:C.border}`,background:geselecteerd?dag.kleur+"18":"white",color:geselecteerd?dag.kleur:C.muted}}>
                    {geselecteerd?"✓ ":""}{h.adres}, {h.stad}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>onOpslaan({...dag, focus, taken, woning_ids: woningIds})} disabled={saving}
              style={{background:C.blauw,color:"white",border:"none",borderRadius:8,padding:"10px 24px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              {saving?"⏳ Opslaan...":"✓ Opslaan"}
            </button>
            <button onClick={onAnnuleren}
              style={{background:"white",border:`1.5px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"10px 16px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
              Annuleren
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WoningBeheer({houses,onAdd,onUpdate,onDelete,showToast}) {
  const [geselecteerd,setGeselecteerd]=useState(null);
  const [nieuweWoning,setNieuweWoning]=useState({stad:"",adres:"",postcode:""});
  const [toonNieuwe,setToonNieuwe]=useState(false);
  const [nieuweKamer,setNieuweKamer]=useState({k:"",naam:"",bedrijf:"",status:"Beschikbaar"});
  const [bewerkKamer,setBewerkKamer]=useState(null);
  const [saving,setSaving]=useState(false);
  const huis=houses.find(h=>h.id===geselecteerd);

  // Groepeer per stad
  const steden=[...new Set(houses.map(h=>h.stad))].sort();

  async function woningToevoegen() {
    if(!nieuweWoning.stad||!nieuweWoning.adres){showToast("Vul stad en adres in","err");return;}
    setSaving(true);const ok=await onAdd({...nieuweWoning,kamers:[]});setSaving(false);
    if(ok){setNieuweWoning({stad:"",adres:"",postcode:""});setToonNieuwe(false);}
  }
  async function kamerToevoegen() {
    if(!nieuweKamer.k){showToast("Vul kamernummer in","err");return;}
    if(!huis) return;
    if(huis.kamers.some(k=>k.k===nieuweKamer.k)){showToast("Kamernummer bestaat al","err");return;}
    setSaving(true);await onUpdate(huis.id,{kamers:[...huis.kamers,{...nieuweKamer}]});setSaving(false);
    setNieuweKamer({k:"",naam:"",bedrijf:"",status:"Beschikbaar"});
  }
  async function kamerOpslaan(nr,u) { if(!huis) return; setSaving(true); await onUpdate(huis.id,{kamers:huis.kamers.map(k=>k.k===nr?{...k,...u}:k)}); setSaving(false); setBewerkKamer(null); }
  async function kamerVerwijderen(nr) { if(!huis||!window.confirm(`Kamer ${nr} verwijderen?`)) return; setSaving(true); await onUpdate(huis.id,{kamers:huis.kamers.filter(k=>k.k!==nr)}); setSaving(false); }
  async function woningVerwijderen(id) { if(!window.confirm("Woning verwijderen?")) return; const ok=await onDelete(id); if(ok) setGeselecteerd(null); }

  return(
    <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:20}}>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <span style={{fontWeight:700,fontSize:14,color:C.blauw}}>Woningen ({houses.length})</span>
          <button className="btn-b" style={{padding:"7px 14px",fontSize:12}} onClick={()=>setToonNieuwe(true)}>+ Woning</button>
        </div>
        {toonNieuwe&&(
          <div className="card" style={{marginBottom:14,borderTop:`3px solid ${C.groen}`}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:12,color:C.blauw}}>Nieuwe woning</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <input className="fi" value={nieuweWoning.stad} onChange={e=>setNieuweWoning(p=>({...p,stad:e.target.value}))} placeholder="Stad" style={{fontSize:13}}/>
              <input className="fi" value={nieuweWoning.adres} onChange={e=>setNieuweWoning(p=>({...p,adres:e.target.value}))} placeholder="Adres" style={{fontSize:13}}/>
              <input className="fi" value={nieuweWoning.postcode} onChange={e=>setNieuweWoning(p=>({...p,postcode:e.target.value}))} placeholder="Postcode" style={{fontSize:13}}/>
              <div style={{display:"flex",gap:8}}>
                <button className="btn-b" style={{flex:1,padding:"8px",fontSize:13}} onClick={woningToevoegen} disabled={saving}>{saving?"⏳":"✓ Toevoegen"}</button>
                <button className="btn-out" style={{padding:"8px 12px",fontSize:13}} onClick={()=>setToonNieuwe(false)}>✗</button>
              </div>
            </div>
          </div>
        )}
        {/* Gegroepeerd per stad */}
        {steden.map(stad=>(
          <div key={stad} style={{marginBottom:12}}>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:"1px",textTransform:"uppercase",marginBottom:6,paddingLeft:4}}>{stad}</div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {houses.filter(h=>h.stad===stad).map(h=>(
                <button key={h.id} onClick={()=>setGeselecteerd(h.id)}
                  style={{background:geselecteerd===h.id?C.blauw+"12":"white",border:`1.5px solid ${geselecteerd===h.id?C.blauw:C.border}`,borderRadius:10,padding:"10px 14px",color:C.text,textAlign:"left",transition:"all .15s",cursor:"pointer"}}>
                  <div style={{fontWeight:700,fontSize:13}}>{h.adres}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>{h.kamers.length} kamers</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div>
        {!huis?<div className="card" style={{textAlign:"center",padding:"60px 20px"}}><div style={{fontSize:40,marginBottom:10}}>👈</div><div style={{color:C.muted}}>Selecteer een woning</div></div>:(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
              <div><h3 style={{fontSize:18,fontWeight:800,color:C.blauw}}>{huis.adres}</h3><div style={{fontSize:13,color:C.muted,marginTop:2}}>{huis.stad} · {huis.postcode} · {huis.kamers.length} kamers</div></div>
              <button className="btn-r" onClick={()=>woningVerwijderen(huis.id)}>🗑 Verwijderen</button>
            </div>
            <div className="card" style={{marginBottom:16}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:C.blauw}}>Kamers</div>
              {huis.kamers.length===0&&<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>Nog geen kamers</div>}
              {huis.kamers.map(k=>(
                <div key={k.k}>{bewerkKamer===k.k?
                  <KamerBewerken kamer={k} onSave={u=>kamerOpslaan(k.k,u)} onCancel={()=>setBewerkKamer(null)} saving={saving}/>:
                  <div className="br">
                    <div style={{width:6,height:6,borderRadius:2,background:STATUS_MAP[k.status]?.dot||C.muted,flexShrink:0}}/>
                    <span style={{fontSize:11,fontWeight:700,color:C.muted,minWidth:30,fontFamily:"monospace"}}>K{k.k}</span>
                    <span style={{flex:1,fontSize:13,color:k.naam?C.text:"#aab4c4",fontStyle:k.naam?"normal":"italic"}}>{k.naam||"leeg"}</span>
                    {k.bedrijf&&<span style={{fontSize:11,color:C.muted}}>{k.bedrijf}</span>}
                    <span style={{padding:"2px 8px",borderRadius:4,background:STATUS_MAP[k.status]?.bg||C.bg,color:STATUS_MAP[k.status]?.text||C.muted,fontSize:10,fontWeight:600}}>{k.status}</span>
                    <button className="btn-out" style={{padding:"4px 10px",fontSize:11}} onClick={()=>setBewerkKamer(k.k)}>✏️</button>
                    <button className="btn-r" style={{padding:"4px 10px",fontSize:11}} onClick={()=>kamerVerwijderen(k.k)}>🗑</button>
                  </div>
                }</div>
              ))}
            </div>
            <div className="card" style={{borderTop:`3px solid ${C.groen}`}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:C.groen}}>+ Nieuwe kamer toevoegen</div>
              <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr",gap:10,marginBottom:10}}>
                <div><label className="fl">Kamer nr</label><input className="fi" value={nieuweKamer.k} onChange={e=>setNieuweKamer(p=>({...p,k:e.target.value}))} placeholder="1" style={{fontSize:13}}/></div>
                <div><label className="fl">Naam bewoner</label><input className="fi" value={nieuweKamer.naam} onChange={e=>setNieuweKamer(p=>({...p,naam:e.target.value}))} placeholder="Optioneel" style={{fontSize:13}}/></div>
                <div><label className="fl">Bedrijf</label><input className="fi" value={nieuweKamer.bedrijf} onChange={e=>setNieuweKamer(p=>({...p,bedrijf:e.target.value}))} placeholder="Optioneel" style={{fontSize:13}}/></div>
              </div>
              <div style={{marginBottom:12}}><label className="fl">Status</label><select className="fs" value={nieuweKamer.status} onChange={e=>setNieuweKamer(p=>({...p,status:e.target.value}))} style={{fontSize:13}}>{STATUSSEN.map(s=><option key={s}>{s}</option>)}</select></div>
              <button className="btn-g" style={{width:"100%",padding:10,fontSize:13}} onClick={kamerToevoegen} disabled={saving}>{saving?"⏳ Opslaan...":"✓ Kamer toevoegen"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KamerBewerken({kamer,onSave,onCancel,saving}) {
  const [naam,setNaam]=useState(kamer.naam||"");
  const [bedrijf,setBedrijf]=useState(kamer.bedrijf||"");
  const [status,setStatus]=useState(kamer.status||"Beschikbaar");
  return(
    <div style={{background:C.blauw+"08",borderRadius:8,padding:12,marginBottom:6,border:`1.5px solid ${C.blauw}`}}>
      <div style={{fontSize:12,fontWeight:700,color:C.blauw,marginBottom:10}}>Kamer {kamer.k} bewerken</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <input className="fi" value={naam} onChange={e=>setNaam(e.target.value)} placeholder="Naam bewoner" style={{fontSize:12}}/>
        <input className="fi" value={bedrijf} onChange={e=>setBedrijf(e.target.value)} placeholder="Bedrijf" style={{fontSize:12}}/>
      </div>
      <select className="fs" value={status} onChange={e=>setStatus(e.target.value)} style={{fontSize:12,marginBottom:8}}>{STATUSSEN.map(s=><option key={s}>{s}</option>)}</select>
      <div style={{display:"flex",gap:8}}>
        <button className="btn-b" style={{flex:1,padding:"7px",fontSize:12}} onClick={()=>onSave({naam,bedrijf,status})} disabled={saving}>{saving?"⏳":"✓ Opslaan"}</button>
        <button className="btn-out" style={{padding:"7px 12px",fontSize:12}} onClick={onCancel}>Annuleren</button>
      </div>
    </div>
  );
}

function GebruikersBeheer({gebruikers,onAdd,onUpdate,onDelete,showToast}) {
  const [nieuw,setNieuw]=useState({naam:"",pin:"",rol:"collega"});
  const [bewerk,setBewerk]=useState(null);
  const [saving,setSaving]=useState(false);

  async function voegToe() {
    if(!nieuw.naam.trim()){showToast("Vul een naam in","err");return;}
    if(nieuw.pin.length<4){showToast("Pincode moet minimaal 4 cijfers zijn","err");return;}
    if(gebruikers.some(g=>g.naam.toLowerCase()===nieuw.naam.toLowerCase())){showToast("Naam bestaat al","err");return;}
    setSaving(true);
    await onAdd({naam:nieuw.naam.trim(),pin:nieuw.pin,rol:nieuw.rol,actief:true});
    setSaving(false);
    setNieuw({naam:"",pin:"",rol:"collega"});
  }

  async function verwijder(g) {
    if(g.naam==="Liset"){showToast("Liset kan niet verwijderd worden","err");return;}
    if(!window.confirm(`${g.naam} verwijderen?`)) return;
    await onDelete(g.id);
  }

  async function slaBewerk(g, updates) {
    setSaving(true);
    await onUpdate(g.id, updates);
    setSaving(false);
    setBewerk(null);
  }

  const rk={backoffice:C.blauw,huismeester:C.groen,collega:C.muted,financieel:"#f59e0b"};
  const ri={backoffice:"📊",huismeester:"🏠",collega:"👤",financieel:"💶"};

  return(
    <div style={{maxWidth:700}}>
      <div className="card" style={{marginBottom:20,borderTop:`3px solid ${C.groen}`}}>
        <div style={{fontWeight:700,fontSize:14,color:C.groen,marginBottom:16}}>+ Nieuwe gebruiker toevoegen</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 120px 160px",gap:12,marginBottom:12}}>
          <div><label className="fl">Naam</label><input className="fi" value={nieuw.naam} onChange={e=>setNieuw(p=>({...p,naam:e.target.value}))} placeholder="Voornaam"/></div>
          <div><label className="fl">Pincode</label><input className="fi" value={nieuw.pin} onChange={e=>setNieuw(p=>({...p,pin:e.target.value.replace(/\D/g,"")}))} placeholder="1234" maxLength={8} type="password"/></div>
          <div><label className="fl">Rol</label><select className="fs" value={nieuw.rol} onChange={e=>setNieuw(p=>({...p,rol:e.target.value}))}><option value="collega">👤 Collega</option><option value="huismeester">🏠 Huismeester</option><option value="financieel">💶 Financieel</option><option value="backoffice">📊 Backoffice</option></select></div>
        </div>
        <button className="btn-g" style={{padding:"10px 24px"}} onClick={voegToe} disabled={saving}>{saving?"⏳ Opslaan...":"✓ Toevoegen"}</button>
      </div>
      <div className="card">
        <div style={{fontWeight:700,fontSize:14,color:C.blauw,marginBottom:16}}>Alle gebruikers ({gebruikers.length})</div>
        {gebruikers.map(g=>(
          <div key={g.id}>
            {bewerk===g.id ? <GebruikerBewerken g={g} onSave={u=>slaBewerk(g,u)} onCancel={()=>setBewerk(null)} saving={saving}/>:(
              <div className="br" style={{marginBottom:8}}>
                <div style={{width:32,height:32,borderRadius:8,background:rk[g.rol]+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{ri[g.rol]}</div>
                <div style={{flex:1}}><div style={{fontWeight:700,fontSize:14,color:C.text}}>{g.naam}</div><div style={{fontSize:11,color:rk[g.rol],fontWeight:600,textTransform:"capitalize"}}>{g.rol}</div></div>
                <div style={{fontSize:13,color:C.muted,fontFamily:"monospace",background:C.bg,padding:"4px 10px",borderRadius:6}}>••••</div>
                <button className="btn-out" style={{padding:"5px 12px",fontSize:12}} onClick={()=>setBewerk(g.id)}>✏️ Bewerken</button>
                {g.naam!=="Liset"&&<button className="btn-r" style={{padding:"5px 12px",fontSize:12}} onClick={()=>verwijder(g)}>🗑</button>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GebruikerBewerken({g,onSave,onCancel}) {
  const [naam,setNaam]=useState(g.naam);const [pin,setPin]=useState(g.pin);const [rol,setRol]=useState(g.rol);
  return(
    <div style={{background:C.blauw+"08",border:`1.5px solid ${C.blauw}`,borderRadius:10,padding:14,marginBottom:8}}>
      <div style={{fontSize:12,fontWeight:700,color:C.blauw,marginBottom:12}}>{g.naam} bewerken</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 120px 160px",gap:10,marginBottom:10}}>
        <div><label className="fl">Naam</label><input className="fi" value={naam} onChange={e=>setNaam(e.target.value)} style={{fontSize:13}}/></div>
        <div><label className="fl">Pincode</label><input className="fi" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,""))} type="text" maxLength={8} style={{fontSize:13}}/></div>
        <div><label className="fl">Rol</label><select className="fs" value={rol} onChange={e=>setRol(e.target.value)} style={{fontSize:13}}><option value="collega">👤 Collega</option><option value="huismeester">🏠 Huismeester</option><option value="financieel">💶 Financieel</option><option value="backoffice">📊 Backoffice</option></select></div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn-b" style={{padding:"8px 20px",fontSize:13}} onClick={()=>onSave({naam,pin,rol})}>✓ Opslaan</button>
        <button className="btn-out" style={{padding:"8px 16px",fontSize:13}} onClick={onCancel}>Annuleren</button>
      </div>
    </div>
  );
}

// ─── CHECKLIST ITEMS BEHEER ───────────────────────────────────────────────────
function ChecklistItemsBeheer({ checklistItems, showToast }) {
  const [actief, setActief] = useState("wekelijks");
  const [nieuwTekst, setNieuwTekst] = useState("");
  const [bewerkId, setBewerkId] = useState(null);
  const [bewerkTekst, setBewerkTekst] = useState("");
  const [saving, setSaving] = useState(false);

  const types = [
    { id:"wekelijks",   label:"📋 Wekelijks",   kleur:C.blauw },
    { id:"4wekelijks",  label:"📅 4-wekelijks",  kleur:C.groen },
    { id:"kwartaal",    label:"🏆 Kwartaal",     kleur:"#7c3aed" },
  ];

  const huidigeLijst = checklistItems.filter(i => i.type === actief);
  const actiefInfo = types.find(t => t.id === actief);

  async function voegToe() {
    if (!nieuwTekst.trim()) { showToast("Vul een omschrijving in", "err"); return; }
    setSaving(true);
    const maxVolgorde = huidigeLijst.length > 0 ? Math.max(...huidigeLijst.map(i => i.volgorde)) : 0;
    const { error } = await supabase.from("checklist_items").insert([{
      type: actief, tekst: nieuwTekst.trim(), volgorde: maxVolgorde + 1, actief: true
    }]);
    setSaving(false);
    if (error) { showToast("Fout bij toevoegen", "err"); return; }
    setNieuwTekst("");
    showToast("✓ Item toegevoegd");
  }

  async function slaBewerk(id) {
    if (!bewerkTekst.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("checklist_items").update({ tekst: bewerkTekst.trim() }).eq("id", id);
    setSaving(false);
    if (error) { showToast("Fout bij opslaan", "err"); return; }
    setBewerkId(null);
    showToast("✓ Opgeslagen");
  }

  async function verwijder(id, tekst) {
    if (!window.confirm(`"${tekst.substring(0,50)}..." verwijderen?`)) return;
    const { error } = await supabase.from("checklist_items").update({ actief: false }).eq("id", id);
    if (error) { showToast("Fout bij verwijderen", "err"); return; }
    showToast("✓ Item verwijderd");
  }

  async function verschuif(item, richting) {
    const lijst = [...huidigeLijst].sort((a,b) => a.volgorde - b.volgorde);
    const idx = lijst.findIndex(i => i.id === item.id);
    const swap = richting === "up" ? lijst[idx-1] : lijst[idx+1];
    if (!swap) return;
    await supabase.from("checklist_items").update({ volgorde: swap.volgorde }).eq("id", item.id);
    await supabase.from("checklist_items").update({ volgorde: item.volgorde }).eq("id", swap.id);
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display:"flex", gap:8, marginBottom:20 }}>
        {types.map(t => (
          <button key={t.id} onClick={() => setActief(t.id)}
            style={{ flex:1, background:actief===t.id?t.kleur:"white", color:actief===t.id?"white":C.text, border:`2px solid ${actief===t.id?t.kleur:C.border}`, borderRadius:10, padding:"10px 16px", cursor:"pointer", fontFamily:"inherit", fontWeight:700, fontSize:13, transition:"all .2s" }}>
            {t.label}
            <div style={{ fontSize:11, opacity:.8, marginTop:2, fontWeight:400 }}>{checklistItems.filter(i=>i.type===t.id).length} items</div>
          </button>
        ))}
      </div>

      {/* Nieuw item toevoegen */}
      <div className="card" style={{ marginBottom:16, borderTop:`3px solid ${actiefInfo.kleur}` }}>
        <div style={{ fontWeight:700, fontSize:13, color:actiefInfo.kleur, marginBottom:12 }}>+ Item toevoegen aan {actiefInfo.label}</div>
        <div style={{ display:"flex", gap:10 }}>
          <input className="fi" value={nieuwTekst} onChange={e=>setNieuwTekst(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&voegToe()}
            placeholder="Omschrijving van de controletaak..."
            style={{ flex:1 }} />
          <button className="btn-b" style={{ padding:"10px 20px", flexShrink:0 }} onClick={voegToe} disabled={saving}>
            {saving?"⏳":"+ Toevoegen"}
          </button>
        </div>
      </div>

      {/* Huidige items */}
      <div className="card">
        <div style={{ fontWeight:700, fontSize:13, color:C.blauw, marginBottom:16 }}>
          {actiefInfo.label} — {huidigeLijst.length} items
        </div>
        {huidigeLijst.length === 0 && (
          <div style={{ textAlign:"center", padding:"30px", color:C.muted, fontSize:13 }}>
            Nog geen items. Voeg er hierboven een toe!
          </div>
        )}
        {[...huidigeLijst].sort((a,b)=>a.volgorde-b.volgorde).map((item, idx, arr) => (
          <div key={item.id} style={{ marginBottom:6 }}>
            {bewerkId === item.id ? (
              <div style={{ display:"flex", gap:8, padding:"8px", background:C.blauw+"08", borderRadius:8, border:`1.5px solid ${C.blauw}` }}>
                <input className="fi" value={bewerkTekst} onChange={e=>setBewerkTekst(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&slaBewerk(item.id)}
                  style={{ flex:1, fontSize:13 }} autoFocus />
                <button className="btn-b" style={{ padding:"8px 14px", fontSize:12, flexShrink:0 }} onClick={()=>slaBewerk(item.id)} disabled={saving}>✓</button>
                <button className="btn-out" style={{ padding:"8px 12px", fontSize:12, flexShrink:0 }} onClick={()=>setBewerkId(null)}>✗</button>
              </div>
            ) : (
              <div className="br" style={{ gap:6 }}>
                <span style={{ fontSize:11, fontWeight:700, color:C.muted, minWidth:24, fontFamily:"monospace" }}>{idx+1}</span>
                <span style={{ flex:1, fontSize:13, color:C.text }}>{item.tekst}</span>
                <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                  <button onClick={()=>verschuif(item,"up")} disabled={idx===0}
                    style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:6, padding:"4px 8px", cursor:idx===0?"not-allowed":"pointer", color:idx===0?C.border:C.muted, fontSize:12 }}>↑</button>
                  <button onClick={()=>verschuif(item,"down")} disabled={idx===arr.length-1}
                    style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:6, padding:"4px 8px", cursor:idx===arr.length-1?"not-allowed":"pointer", color:idx===arr.length-1?C.border:C.muted, fontSize:12 }}>↓</button>
                  <button className="btn-out" style={{ padding:"4px 10px", fontSize:11 }}
                    onClick={()=>{ setBewerkId(item.id); setBewerkTekst(item.tekst); }}>✏️</button>
                  <button className="btn-r" style={{ padding:"4px 10px", fontSize:11 }}
                    onClick={()=>verwijder(item.id, item.tekst)}>🗑</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LOG VIEW ─────────────────────────────────────────────────────────────────
function LogView({meldingen,houses,activiteiten}) {
  const [zoek, setZoek] = useState("");
  const [typeFilter, setTypeFilter] = useState("alle");
  const [autoMeldingen, setAutoMeldingen] = useState([]);
  const [fietsLog, setFietsLog] = useState([]);
  const [borgPlannen, setBorgPlannen] = useState([]);
  const [huurschulden, setHuurschulden] = useState([]);
  const [huurbetalingen, setHuurbetalingen] = useState([]);
  const [extraLoading, setExtraLoading] = useState(true);

  useEffect(() => {
    async function loadExtra() {
      const [auto, fiets, borg, schulden, betalingen] = await Promise.all([
        supabase.from("auto_meldingen").select("*").order("created_at",{ascending:false}).limit(500),
        supabase.from("fiets_log").select("*").order("created_at",{ascending:false}).limit(500),
        supabase.from("borg_plannen").select("*").order("created_at",{ascending:false}).limit(500),
        supabase.from("huurschulden").select("*").order("created_at",{ascending:false}).limit(500),
        supabase.from("huurbetalingen").select("*").order("created_at",{ascending:false}).limit(500),
      ]);
      setAutoMeldingen(auto.data||[]);
      setFietsLog(fiets.data||[]);
      setBorgPlannen(borg.data||[]);
      setHuurschulden(schulden.data||[]);
      setHuurbetalingen(betalingen.data||[]);
      setExtraLoading(false);
    }
    loadExtra();
  }, []);

  const typeKleur = {
    aankomst:C.groen, vertrek:"#ef4444", reservering:C.blauw, verhuizing:"#7c3aed", overig:C.muted,
    melding_status:C.groen, taak_gedaan:C.blauw, checklist:"#7c3aed", kamer_wijziging:"#f59e0b", gebruiker:C.muted,
    uitgifte:"#0891b2", inname:"#0e7490", storing:"#dc2626", schade:"#b91c1c",
    fiets_uitgifte:"#059669", fiets_inname:"#047857",
    borg_plan:"#7c3aed", huurschuld:"#d97706", huurbetaling:"#16a34a",
  };

  const soortIcoon = { melding:"📋", activiteit:"⚡", auto:"🚗", fiets:"🚲", borg:"🔐", huur:"💰" };

  const alles = [
    ...meldingen.map(m=>({
      id:`m-${m.id}`, soort:"melding", datum:m.created_at,
      type:m.type, naam:m.medewerker, door:m.ingediend_door,
      adres:houses.find(h=>h.id===m.woning_id)?.adres||"",
      kamer:m.kamer, status:m.status, notitie:m.notitie||"", extra:m.opmerkingen||"",
    })),
    ...activiteiten.map(a=>({
      id:`a-${a.id}`, soort:"activiteit", datum:a.created_at,
      type:a.type, naam:a.omschrijving, door:a.gedaan_door,
      adres:"", kamer:"", status:"", notitie:"", extra:"",
    })),
    ...autoMeldingen.map(a=>({
      id:`au-${a.id}`, soort:"auto", datum:a.created_at,
      type:a.actie||"auto", naam:a.naam_medewerker||"-", door:a.ingediend_door||"",
      adres:"", kamer:"", status:a.status||"",
      notitie:a.kenteken||"",
      extra:[a.opmerkingen, a.locatie, a.kilometerstand?`${a.kilometerstand} km`:""].filter(Boolean).join(" · "),
    })),
    ...fietsLog.map(f=>({
      id:`fi-${f.id}`, soort:"fiets", datum:f.created_at,
      type:`fiets_${f.actie||"log"}`, naam:f.naam_medewerker||"-", door:f.ingediend_door||"",
      adres:"", kamer:"", status:"",
      notitie:`Fiets ${f.fietsnummer||""}`, extra:f.opmerkingen||"",
    })),
    ...borgPlannen.map(b=>({
      id:`bp-${b.id}`, soort:"borg", datum:b.created_at,
      type:"borg_plan", naam:b.naam_medewerker||"-", door:b.aangemaakt_door||b.ingediend_door||"",
      adres:houses.find(h=>h.id===b.woning_id)?.adres||"",
      kamer:b.kamer||"", status:b.status||"",
      notitie:`Borg €${b.totaal_borg||0}`, extra:b.opmerkingen||"",
    })),
    ...huurschulden.map(s=>({
      id:`hs-${s.id}`, soort:"huur", datum:s.created_at,
      type:"huurschuld", naam:s.naam_medewerker||"-", door:s.aangemaakt_door||"",
      adres:"", kamer:"", status:s.actief?"actief":"afgesloten",
      notitie:`Schuld €${s.beginsaldo||0}`, extra:s.opmerkingen||"",
    })),
    ...huurbetalingen.map(b=>{
      const schuld=huurschulden.find(s=>s.id===b.schuld_id);
      return {
        id:`hb-${b.id}`, soort:"huur", datum:b.created_at,
        type:"huurbetaling", naam:schuld?.naam_medewerker||"-", door:b.geregistreerd_door||"",
        adres:"", kamer:"", status:"",
        notitie:`Betaling €${b.bedrag||0}`, extra:b.opmerking||"",
      };
    }),
  ].sort((a,b)=>new Date(b.datum||0)-new Date(a.datum||0));

  function exportCSV() {
    let csv="sep=;\nDatum;Tijd;Categorie;Type;Naam/Medewerker;Extra info;Adres;Kamer;Ingediend door;Status\n";
    alles.forEach(item=>{
      const dt=item.datum?new Date(item.datum):new Date();
      csv+=`"${fmtDate(dt)}";"${fmtTime(dt)}";"${item.soort}";"${item.type}";"${item.naam}";"${(item.extra||item.notitie||"").replace(/"/g,"'")}";"${item.adres}";"${item.kamer}";"${item.door}";"${item.status}"\n`;
    });
    const blob=new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`KTP_volledig_log_${todayISO()}.csv`;a.click();URL.revokeObjectURL(url);
  }

  const q=zoek.toLowerCase().trim();
  const totalen={
    meldingen:alles.filter(i=>i.soort==="melding").length,
    activiteiten:alles.filter(i=>i.soort==="activiteit").length,
    autos:alles.filter(i=>i.soort==="auto").length,
    fietsen:alles.filter(i=>i.soort==="fiets").length,
    borg_huur:alles.filter(i=>i.soort==="borg"||i.soort==="huur").length,
  };
  const gefilterd=alles.filter(item=>{
    if (typeFilter==="meldingen"&&item.soort!=="melding") return false;
    if (typeFilter==="activiteiten"&&item.soort!=="activiteit") return false;
    if (typeFilter==="autos"&&item.soort!=="auto") return false;
    if (typeFilter==="fietsen"&&item.soort!=="fiets") return false;
    if (typeFilter==="borg_huur"&&item.soort!=="borg"&&item.soort!=="huur") return false;
    if (!q) return true;
    return [item.naam,item.type,item.adres,item.door,item.notitie,item.extra,item.kamer,item.status]
      .some(v=>(v||"").toLowerCase().includes(q));
  });

  return (
    <div>
      <SH titel="📝 Log" sub={`${alles.length} totaal · ${extraLoading?"laden...":"alles geladen"}`}
        actie={<button className="btn-out" onClick={exportCSV}>⬇ Exporteer CSV</button>}/>
      <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <input value={zoek} onChange={e=>setZoek(e.target.value)}
          placeholder="🔍 Zoek op naam, kenteken, adres, ingediend door..."
          style={{flex:1,minWidth:220,background:"white",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,padding:"9px 14px",fontSize:13,outline:"none",fontFamily:"inherit"}}/>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {[["alle","Alles",alles.length],["meldingen","📋 Woningen",totalen.meldingen],["activiteiten","⚡ Activiteiten",totalen.activiteiten],["autos","🚗 Auto's",totalen.autos],["fietsen","🚲 Fietsen",totalen.fietsen],["borg_huur","💰 Borg/Huur",totalen.borg_huur]].map(([v,l,n])=>(
            <button key={v} onClick={()=>setTypeFilter(v)}
              style={{background:typeFilter===v?C.blauw:"white",color:typeFilter===v?"white":C.muted,border:`1.5px solid ${typeFilter===v?C.blauw:C.border}`,borderRadius:20,padding:"7px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
              {l} <span style={{opacity:.7,fontSize:10}}>({n})</span>
            </button>
          ))}
        </div>
      </div>
      {q&&<div style={{fontSize:13,color:C.muted,marginBottom:10}}>{gefilterd.length} resultaten voor "<strong>{zoek}</strong>"</div>}
      {gefilterd.length===0?(
        <div className="card" style={{textAlign:"center",padding:"50px"}}>
          <div style={{fontSize:40,marginBottom:10}}>🔍</div>
          <div style={{color:C.muted}}>Geen resultaten{q?` voor "${zoek}"`:""}</div>
        </div>
      ):(
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"85px 50px 110px 30px 1fr 1fr 90px",padding:"10px 16px",fontSize:10,fontWeight:700,color:C.muted,letterSpacing:".6px",textTransform:"uppercase",borderBottom:`1px solid ${C.border}`,background:C.bg}}>
            <span>Datum</span><span>Tijd</span><span>Type</span><span></span><span>Naam / Omschrijving</span><span>Extra info</span><span>Door</span>
          </div>
          {gefilterd.map((item,i)=>{
            const dt=item.datum?new Date(item.datum):new Date();
            const kleur=typeKleur[item.type]||C.muted;
            return(
              <div key={item.id} style={{display:"grid",gridTemplateColumns:"85px 50px 110px 30px 1fr 1fr 90px",padding:"10px 16px",fontSize:12,borderBottom:i<gefilterd.length-1?`1px solid ${C.border}`:"none",alignItems:"center",background:i%2===0?"white":C.bg+"60"}}>
                <span style={{color:C.muted}}>{fmtDate(dt)}</span>
                <span style={{color:C.muted}}>{fmtTime(dt)}</span>
                <span style={{padding:"2px 6px",borderRadius:4,background:kleur+"18",color:kleur,fontSize:9,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.type}</span>
                <span style={{fontSize:14,textAlign:"center"}}>{soortIcoon[item.soort]||"•"}</span>
                <div>
                  <div style={{fontWeight:600,color:C.text,marginBottom:1}}>{item.naam}</div>
                  {item.notitie&&<div style={{fontSize:11,color:C.muted}}>{item.notitie}</div>}
                  {item.status&&<span style={{fontSize:10,fontWeight:700,color:item.status==="open"||item.status==="actief"?C.blauw:C.groen}}>{item.status.toUpperCase()}</span>}
                </div>
                <div>
                  <div style={{color:C.muted,fontSize:11}}>{item.adres}{item.kamer?` · K${item.kamer}`:""}</div>
                  {item.extra&&<div style={{fontSize:11,color:C.text,fontStyle:"italic"}}>{item.extra.slice(0,70)}{item.extra.length>70?"...":""}</div>}
                </div>
                <span style={{fontWeight:600,color:C.blauw,fontSize:11}}>{item.door}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AppWithBoundary() {
  return <ErrorBoundary><App /></ErrorBoundary>;
}
export default AppWithBoundary;
