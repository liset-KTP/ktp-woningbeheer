// HandleidingModule.js — KTP Interflex Woningbeheer
import { useState } from "react";

const C = {
  blauw: "#1B3A6B", groen: "#4A9B3C", oranje: "#F5A623",
  rood: "#ef4444", paars: "#7c3aed", muted: "#6b7280",
  border: "#e5e7eb", bg: "#f8fafc", text: "#1e293b",
};

export function HandleidingModule({ gebruiker }) {
  const rol = gebruiker?.rol;
  const [actieveRol, setActieveRol] = useState(rol === "backoffice" ? "collega" : rol);

  const rollen = [
    { id: "collega",     label: "👤 Collega",      kleur: C.groen },
    { id: "huismeester", label: "🏠 Huismeester",  kleur: C.blauw },
    { id: "backoffice",  label: "📊 Backoffice",   kleur: C.paars },
  ];

  return (
    <div style={{maxWidth: 860, margin: "0 auto", fontFamily: "Inter, sans-serif"}}>
      {/* Header */}
      <div style={{background: `linear-gradient(135deg, ${C.blauw} 0%, #2d5a9e 100%)`, borderRadius: 16, padding: "28px 32px", marginBottom: 28, color: "white"}}>
        <div style={{fontSize: 32, marginBottom: 8}}>📖</div>
        <h1 style={{fontSize: 24, fontWeight: 800, margin: 0, marginBottom: 6}}>Handleiding KTP Woningbeheer</h1>
        <p style={{fontSize: 14, opacity: 0.85, margin: 0}}>Alles wat je moet weten om de app te gebruiken — simpel uitgelegd!</p>
      </div>

      {/* Rol tabs */}
      <div style={{display: "flex", gap: 10, marginBottom: 24}}>
        {rollen.map(r => (
          <button key={r.id} onClick={() => setActieveRol(r.id)}
            style={{flex: 1, padding: "12px 8px", borderRadius: 12, border: `2px solid ${actieveRol === r.id ? r.kleur : C.border}`, background: actieveRol === r.id ? r.kleur + "15" : "white", color: actieveRol === r.id ? r.kleur : C.muted, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", transition: "all .2s"}}>
            {r.label}
          </button>
        ))}
      </div>

      {/* Collega */}
      {actieveRol === "collega" && (
        <div>
          <Sectie titel="🎯 Wat doet een collega in de app?" kleur={C.groen}>
            <p>Als collega gebruik jij de app om aankomsten, verhuizingen en vertrekken door te geven. Jij weet als eerste wanneer iemand aankomt of weggaat — dat geef jij door zodat Cristian en het kantoor dit kunnen regelen.</p>
          </Sectie>

          <Sectie titel="📋 Een melding doorgeven — stap voor stap" kleur={C.groen}>
            <Stap nr={1} titel="Ga naar Taken & Meldingen">
              Klik bovenaan op <Knop>📋 Taken & Meldingen</Knop>. Dit is jouw belangrijkste pagina.
            </Stap>
            <Stap nr={2} titel="Klik op + Taak toevoegen">
              Klik op de knop <Knop>+ Taak toevoegen</Knop> bovenaan. Je ziet dan een formulier.
            </Stap>
            <Stap nr={3} titel="Kies het type melding">
              Kies wat er aan de hand is:
              <TypeLijst items={[
                {icon:"📅", naam:"Reservering", uitleg:"Iemand gaat binnenkort komen. Je weet de datum maar hij/zij is er nog niet."},
                {icon:"🚗", naam:"Aankomst", uitleg:"Iemand komt vandaag of binnenkort aan. Vul de aankomstdatum en het kamernummer in."},
                {icon:"📦", naam:"Verhuizing", uitleg:"Iemand verhuist van de ene naar de andere kamer of woning."},
                {icon:"📢", naam:"Vertrek aankondiging", uitleg:"Iemand gaat binnenkort weggaan. Je weet al wanneer maar is er nog."},
                {icon:"🧳", naam:"Daadwerkelijk vertrek", uitleg:"Iemand gaat vandaag weg of is net weggegaan."},
                {icon:"💬", naam:"Overig", uitleg:"Iets anders — een klacht, vraag of melding die nergens anders bij past."},
              ]}/>
            </Stap>
            <Stap nr={4} titel="Vul de gegevens in">
              Vul de naam van de medewerker in, de datum en de woning/kamer. Heb je extra info? Zet dat bij Opmerkingen.
            </Stap>
            <Stap nr={5} titel="Klik op Verzenden">
              Klaar! Het kantoor en Cristian krijgen automatisch een melding.
            </Stap>
            <TipBox>💡 <strong>Tip:</strong> Vul alles zo volledig mogelijk in. Hoe meer info, hoe sneller het geregeld is!</TipBox>
          </Sectie>

          <Sectie titel="📸 Foto toevoegen aan een melding" kleur={C.groen}>
            <p>Soms wil je een foto meesturen — bijvoorbeeld van schade of een document. Dit kan bij elke melding:</p>
            <Stap nr={1} titel="Open de melding">Zoek de melding op in de lijst en klik erop.</Stap>
            <Stap nr={2} titel="Klik op Foto/document toevoegen">Onderaan de melding staat een upload vak. Sleep je foto erheen of klik om te kiezen.</Stap>
            <Stap nr={3} titel="Klik op Uploaden">De foto wordt opgeslagen en is zichtbaar voor iedereen.</Stap>
          </Sectie>

          <Sectie titel="🚲 Een fiets reserveren" kleur={C.groen}>
            <Stap nr={1} titel="Ga naar Fietsen">Klik op <Knop>🚲 Fietsen</Knop> in de navigatie.</Stap>
            <Stap nr={2} titel="Klik op Reserveren">Klik op het tabje <Knop>📅 Reserveren</Knop>.</Stap>
            <Stap nr={3} titel="Kies een fiets">Klik op een beschikbare fiets (groen = beschikbaar).</Stap>
            <Stap nr={4} titel="Vul de datum in">Wanneer heb je de fiets nodig?</Stap>
            <Stap nr={5} titel="Klik op Reservering indienen">Het kantoor verwerkt dit zo snel mogelijk.</Stap>
            <TipBox>💡 <strong>Let op:</strong> Heb je de fiets gekregen? Dan regelt Cristian de uitgifte.</TipBox>
          </Sectie>

          <Sectie titel="💬 Een bericht sturen" kleur={C.groen}>
            <p>Wil je iets vragen of doorgeven zonder een melding? Stuur een bericht!</p>
            <Stap nr={1} titel="Ga naar Berichten">Klik op <Knop>💬 Berichten</Knop>.</Stap>
            <Stap nr={2} titel="Klik op Nieuw bericht">Rechtsbovenaan staat de knop.</Stap>
            <Stap nr={3} titel="Kies wie het moet ontvangen">Kies Cristian (huismeester) of het kantoor (backoffice).</Stap>
            <Stap nr={4} titel="Typ je bericht en verstuur">Klaar!</Stap>
          </Sectie>

          <Sectie titel="🌍 Taal wisselen" kleur={C.groen}>
            <p>De app is beschikbaar in Nederlands, Engels, Roemeens en Pools. Klik rechtsboven op de taalknoppen: <Knop>🇳🇱 NL</Knop> <Knop>🇬🇧 EN</Knop> <Knop>🇷🇴 RO</Knop> <Knop>🇵🇱 PL</Knop></p>
          </Sectie>
        </div>
      )}

      {/* Huismeester */}
      {actieveRol === "huismeester" && (
        <div>
          <Sectie titel="🎯 Wat doet de huismeester in de app?" kleur={C.blauw}>
            <p>Als huismeester ben jij de spil in het dagelijks beheer. Jij ziet wat er die dag te doen is, vinkt taken af, controleert kamers en regelt de uitgifte van sleutels en fietsen.</p>
          </Sectie>

          <Sectie titel="📅 Mijn dag — jouw startpagina" kleur={C.blauw}>
            <p>Als je inlogt land je direct op <strong>Mijn dag</strong>. Hier zie je alles wat er vandaag te doen is:</p>
            <InfoBlok items={[
              {icon:"🔔", titel:"Open meldingen", tekst:"Aankomsten en vertrekken die je nog moet regelen. Klik op ✓ als je het geregeld hebt."},
              {icon:"📌", titel:"Openstaande to-do's", tekst:"Taken die voor jou zijn ingepland. Klik op ✓ als je klaar bent."},
              {icon:"🏠", titel:"Woningen vandaag", tekst:"Klik op een woning om de wekelijkse checklist af te vinken. Je kunt per item een opmerking toevoegen."},
              {icon:"📅", titel:"Aankomsten", tekst:"Wie er vandaag aankomt. Zorg dat de kamer klaar is!"},
            ]}/>
            <TipBox>💡 <strong>Tip:</strong> Kun je iets niet afmaken? Klik op <Knop>🚫 Kan niet</Knop> en leg uit waarom. Het kantoor krijgt dan automatisch een melding.</TipBox>
          </Sectie>

          <Sectie titel="✅ Checklist afvinken — per woning" kleur={C.blauw}>
            <Stap nr={1} titel="Klik op een woning in Mijn dag">De woning klapt uit.</Stap>
            <Stap nr={2} titel="Vink items af">Klik op een item om het af te vinken. Het wordt groen.</Stap>
            <Stap nr={3} titel="Opmerking toevoegen?">Klik op het 💬 icoontje naast een item. Typ bijvoorbeeld: <em>"Rookmelder K3 kapot, nieuwe bestellen"</em> of <em>"Temperatuur ketel: 68°C"</em>.</Stap>
            <TipBox>💡 Als alle items afgevinkt zijn, wordt de woning groen met ✅ Klaar.</TipBox>
          </Sectie>

          <Sectie titel="🔑 Kamer controleren na vertrek of verhuizing" kleur={C.blauw}>
            <p>Na een vertrek of verhuizing maak jij de kamer vrij. Je krijgt hiervoor automatisch een taak:</p>
            <Stap nr={1} titel="Open de taak in Taken & Meldingen">Zoek de taak <em>"Kamer controleren na vertrek"</em>.</Stap>
            <Stap nr={2} titel="Controleer de kamer">Is de kamer schoon? Zijn de sleutels ingeleverd?</Stap>
            <Stap nr={3} titel="Vink af in de taak">
              Klik op de gele balk <strong>"✅ Controlepunten afvinken"</strong>:
              <ul style={{marginTop:8,paddingLeft:20,lineHeight:2}}>
                <li>🧹 Kamer schoon</li>
                <li>🔑 Sleutel 1 ingeleverd</li>
                <li>🔑 Sleutel 2 ingeleverd (als er 2 waren)</li>
              </ul>
            </Stap>
            <Stap nr={4} titel="Klaar!">Als alles afgevinkt is, krijgt het kantoor automatisch een bericht. De kamer wordt automatisch op Beschikbaar gezet.</Stap>
          </Sectie>

          <Sectie titel="🚲 Fiets uitgifte en inname" kleur={C.blauw}>
            <Stap nr={1} titel="Ga naar Fietsen → Uitgifte / Inname">Klik op <Knop>🚲 Fietsen</Knop> en dan op <Knop>📋 Uitgifte / Inname</Knop>.</Stap>
            <Stap nr={2} titel="Uitgifte: zoek de medewerker">Vul de naam in en selecteer welke fiets. Klik op Uitgifte registreren.</Stap>
            <Stap nr={3} titel="Inname: selecteer de fiets">Zoek de fiets op en klik op Inname registreren.</Stap>
            <TipBox>💡 Bij uitgifte wordt automatisch de borg verwerkt in het systeem.</TipBox>
          </Sectie>

          <Sectie titel="📋 Taken beheren" kleur={C.blauw}>
            <InfoBlok items={[
              {icon:"📅", titel:"Accepteren & Inplannen", tekst:"Klik op 📅 Inplannen om een datum te kiezen voor de taak."},
              {icon:"🔄", titel:"Mee bezig", tekst:"Klik op 🔄 Mee bezig als je er al mee bezig bent maar nog niet klaar bent."},
              {icon:"🚫", titel:"Kan niet", tekst:"Klik op 🚫 Kan niet als je de taak niet kunt uitvoeren. Vul in waarom — het kantoor krijgt een melding."},
              {icon:"↩", titel:"Terugzetten", tekst:"Heb je een taak per ongeluk afgevinkt? Klik op ↩ Terugzetten naar open."},
            ]}/>
          </Sectie>
        </div>
      )}

      {/* Backoffice */}
      {actieveRol === "backoffice" && (
        <div>
          <Sectie titel="🎯 Wat doet backoffice in de app?" kleur={C.paars}>
            <p>Als backoffice beheer jij alles achter de schermen: aankomsten verwerken, borg bijhouden, huurbetalingen registreren en het grote overzicht bewaken.</p>
          </Sectie>

          <Sectie titel="🚗 Aankomst verwerken" kleur={C.paars}>
            <p>Als een collega een aankomst indient, krijg jij een taak én een melding. Zo verwerk je het:</p>
            <Stap nr={1} titel="Ga naar Taken & Meldingen">Je ziet de melding bovenaan bij Meldingen.</Stap>
            <Stap nr={2} titel="Controleer de gegevens">Klopt de naam, kamer en datum? Klik op ✏️ Bewerken als er iets fout staat.</Stap>
            <Stap nr={3} titel="Klik op ✓ Verwerkt in administratie">De melding verdwijnt en Cristian krijgt automatisch een taak om de sleutels uit te reiken.</Stap>
            <Stap nr={4} titel="Borg wordt automatisch aangemaakt">Na het verwerken maakt het systeem automatisch een borgplan aan met de juiste termijnen.</Stap>
            <TipBox>💡 Je krijgt ook een bericht in 💬 Berichten als het borgplan aangemaakt is.</TipBox>
          </Sectie>

          <Sectie titel="🔐 Borg bijhouden" kleur={C.paars}>
            <p>Ga naar <Knop>🛡️ Inhoudingen</Knop> voor het borgbeheer.</p>
            <InfoBlok items={[
              {icon:"📅", titel:"Deze week", tekst:"Alle borgtermijnen die deze week ingehouden moeten worden. Klik op ✓ als je het hebt verwerkt."},
              {icon:"👤", titel:"Alle plannen", tekst:"Zoek op naam om een specifiek borgplan te vinden. Je ziet hoeveel er ingehouden is en hoeveel er nog te gaan is."},
              {icon:"💶", titel:"Terug te betalen", tekst:"Medewerkers die borg terug moeten krijgen. Dit verschijnt automatisch als Cristian de kamer heeft goedgekeurd."},
              {icon:"📋", titel:"Archief", tekst:"Alle afgesloten borgplannen. Hier kun je de geschiedenis terugvinden."},
            ]}/>
            <TipBox>💡 <strong>Week opschuiven:</strong> Is iemand later begonnen met betalen? Klik op 📅 Week opschuiven om alle termijnen 1 week later te zetten.</TipBox>
          </Sectie>

          <Sectie titel="💶 Huurbetalingen" kleur={C.paars}>
            <Stap nr={1} titel="Ga naar Huurbetalingen">Klik op <Knop>💶 Huurbetalingen</Knop>.</Stap>
            <Stap nr={2} titel="Betaling registreren">Klik op <Knop>+ Betaling</Knop> bij de juiste persoon en vul het bedrag in.</Stap>
            <Stap nr={3} titel="Iemand gaat weg?">Klik op <Knop>🛑 Stopzetten</Knop> en vul de einddatum in. De huur stopt op die datum maar de schuld blijft zichtbaar totdat alles betaald is.</Stap>
            <Stap nr={4} titel="Schuld volledig betaald?">Klik op <Knop>✓ Afsluiten</Knop>. De schuld gaat naar het archief.</Stap>
          </Sectie>

          <Sectie titel="📊 Checklist rapportage" kleur={C.paars}>
            <p>Wil je zien welke woningen goed gecontroleerd worden? Ga naar <Knop>✅ Checklists</Knop>.</p>
            <InfoBlok items={[
              {icon:"📊", titel:"Rapportage tab", tekst:"Selecteer een week en zie per woning hoeveel items afgevinkt zijn. Rode woningen zijn niet (goed) gecontroleerd."},
              {icon:"⚠️", titel:"Structureel niet gedaan", tekst:"Items die de laatste 4 weken meerdere keren gemist zijn worden rood gemarkeerd."},
              {icon:"⬇", titel:"Exporteer CSV", tekst:"Download een overzicht als Excel-bestand voor rapportages."},
            ]}/>
          </Sectie>

          <Sectie titel="✏️ Melding bewerken" kleur={C.paars}>
            <p>Staat er iets fout in een melding? Iedereen kan bewerken:</p>
            <Stap nr={1} titel="Open de melding">Zoek hem op in Taken & Meldingen.</Stap>
            <Stap nr={2} titel="Klik op ✏️ Bewerken">Onderaan de melding.</Stap>
            <Stap nr={3} titel="Pas aan wat nodig is">Naam, datum, kamer, type — alles kan aangepast worden.</Stap>
            <Stap nr={4} titel="Vul een reden in">Verplicht! Bijvoorbeeld: <em>"Verkeerde kamer ingevuld"</em>. Dit wordt opgeslagen in de wijzigingshistorie.</Stap>
          </Sectie>
        </div>
      )}

      {/* Algemeen onderaan */}
      <Sectie titel="❓ Veel gestelde vragen" kleur={C.oranje}>
        <VraagAntwoord items={[
          {vraag:"De app is wit — wat doe ik?", antwoord:"Druk op Ctrl+Shift+R (hard refresh). Als het dan nog wit is, stuur een bericht naar Liset."},
          {vraag:"Ik zie mijn melding niet meer — waar is die?", antwoord:'Klik op het tabje "Afgehandeld" of "Alle" in Taken & Meldingen. Verwerkte meldingen verdwijnen uit het "Open" overzicht.'},
          {vraag:"Hoe verander ik de taal?", antwoord:"Klik rechtsboven op de taalknoppen 🇳🇱 🇬🇧 🇷🇴 🇵🇱. De app onthoudt jouw keuze."},
          {vraag:"Ik heb iets per ongeluk aangeklikt — kan dat terug?", antwoord:"Bij taken: klik op ↩ Terugzetten. Bij borg: klik op ↩ naast de termijn. Bij meldingen: klik op ✏️ Bewerken."},
          {vraag:"Hoe weet ik of mijn melding is ontvangen?", antwoord:"Je ziet de melding in de lijst onder 'Open'. Het kantoor en Cristian krijgen automatisch een mail en een bericht in de app."},
        ]}/>
      </Sectie>
    </div>
  );
}

// ─── Helper componenten ───────────────────────────────────────────────────────

function Sectie({ titel, kleur, children }) {
  return (
    <div style={{background:"white",border:`1px solid ${C.border}`,borderLeft:`5px solid ${kleur}`,borderRadius:12,padding:"20px 24px",marginBottom:16}}>
      <h2 style={{fontSize:17,fontWeight:800,color:kleur,marginBottom:14,marginTop:0}}>{titel}</h2>
      <div style={{fontSize:14,color:C.text,lineHeight:1.7}}>{children}</div>
    </div>
  );
}

function Stap({ nr, titel, children }) {
  return (
    <div style={{display:"flex",gap:14,marginBottom:14,alignItems:"flex-start"}}>
      <div style={{width:28,height:28,borderRadius:"50%",background:C.blauw,color:"white",fontSize:13,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{nr}</div>
      <div>
        <div style={{fontWeight:700,color:C.text,marginBottom:3}}>{titel}</div>
        <div style={{fontSize:13,color:C.muted,lineHeight:1.6}}>{children}</div>
      </div>
    </div>
  );
}

function Knop({ children }) {
  return <span style={{background:"#f1f5f9",border:"1px solid #cbd5e1",borderRadius:6,padding:"2px 8px",fontSize:12,fontWeight:600,color:C.blauw,fontFamily:"inherit"}}>{children}</span>;
}

function TipBox({ children }) {
  return <div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#92400e",marginTop:12,lineHeight:1.6}}>{children}</div>;
}

function TypeLijst({ items }) {
  return (
    <div style={{display:"grid",gap:8,marginTop:10}}>
      {items.map((item,i) => (
        <div key={i} style={{display:"flex",gap:12,padding:"10px 14px",background:C.bg,borderRadius:8,border:`1px solid ${C.border}`,alignItems:"flex-start"}}>
          <span style={{fontSize:20,flexShrink:0}}>{item.icon}</span>
          <div>
            <div style={{fontWeight:700,color:C.text,fontSize:13}}>{item.naam}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>{item.uitleg}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function InfoBlok({ items }) {
  return (
    <div style={{display:"grid",gap:10,marginTop:10}}>
      {items.map((item,i) => (
        <div key={i} style={{display:"flex",gap:12,padding:"12px 14px",background:C.bg,borderRadius:8,border:`1px solid ${C.border}`}}>
          <span style={{fontSize:22,flexShrink:0}}>{item.icon}</span>
          <div>
            <div style={{fontWeight:700,color:C.text,fontSize:13,marginBottom:2}}>{item.titel}</div>
            <div style={{fontSize:12,color:C.muted,lineHeight:1.6}}>{item.tekst}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function VraagAntwoord({ items }) {
  const [open, setOpen] = useState(null);
  return (
    <div style={{display:"grid",gap:8}}>
      {items.map((item,i) => (
        <div key={i} style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
          <div onClick={() => setOpen(open===i?null:i)}
            style={{padding:"12px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",background:open===i?"#f0f4ff":"white",fontWeight:600,fontSize:13,color:C.text}}>
            {item.vraag}
            <span style={{color:C.muted,fontSize:16}}>{open===i?"▲":"▼"}</span>
          </div>
          {open===i && (
            <div style={{padding:"10px 16px 14px",fontSize:13,color:C.muted,lineHeight:1.7,borderTop:`1px solid ${C.border}`,background:"white"}}>
              {item.antwoord}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
