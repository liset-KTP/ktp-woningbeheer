import JSZip from "jszip";

// ─── HUUROVEREENKOMST ALS WORD ───────────────────────────────────────────────
// Vult het Word-sjabloon (public/sjablonen/huurovereenkomst_<TAAL>.docx) met de
// gegevens uit de app. De sjablonen zijn gemaakt uit het Nederlandse RDM-origineel
// met scripts/sjablonen/maak_sjablonen.py: Nederlandse tekst met de vertaling eronder,
// en invulpunten als {{Naam huurder}}. Elk invulpunt staat in zijn geheel in één
// tekst-element, dus een simpele tekstvervanging is genoeg.
// Wat leeg blijft wordt een stippellijn, om na printen met de hand in te vullen.

const LEEG = "..............................";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Talen waarvoor een sjabloon in public/sjablonen staat
export const SJABLOON_TALEN = ["NL", "EN", "PL", "RO"];
// Juridische naam werkgever zoals die in het contract komt
export const WERKGEVER_JURIDISCH = { KTP: "KTP Backoffice B.V.", FP: "Flexpedia B.V." };

// Gedeelde voorzieningen (informatieblad), per taal. Standaard aangevinkt: de eerste vijf (RDM-tekst).
export const VOORZIENINGEN = [
  { k: "badkamer",   NL: "badkamer",   EN: "bathroom",      PL: "łazienka", RO: "baie",                 standaard: true },
  { k: "keuken",     NL: "keuken",     EN: "kitchen",       PL: "kuchnia",  RO: "bucătărie",            standaard: true },
  { k: "toilet",     NL: "toilet",     EN: "toilet",        PL: "toaleta",  RO: "toaletă",              standaard: true },
  { k: "entree",     NL: "entree",     EN: "entrance",      PL: "wejście",  RO: "intrare",              standaard: true },
  { k: "bergruimte", NL: "bergruimte", EN: "storage space", PL: "schowek",  RO: "spațiu de depozitare", standaard: true },
  { k: "woonkamer",  NL: "woonkamer",  EN: "living room",   PL: "salon",    RO: "sufragerie" },
  { k: "wasruimte",  NL: "wasruimte",  EN: "laundry room",  PL: "pralnia",  RO: "spălătorie" },
  { k: "tuin",       NL: "tuin",       EN: "garden",        PL: "ogród",    RO: "grădină" },
];
const EN_WOORD = { NL: "en", EN: "and", PL: "i", RO: "și" };
function opsomming(woorden, taal) {
  if (woorden.length <= 1) return woorden.join("");
  return woorden.slice(0, -1).join(", ") + ` ${EN_WOORD[taal]} ` + woorden[woorden.length - 1];
}

// Meldpunt Wet goed verhuurderschap per plaats van de woning (woningen.stad).
// Bron: websites gemeenten (opgezocht 10-2026) — controleer bij twijfel de link.
// Nieuwe plaats? Hier toevoegen; anders blijft het meldpunt in het informatieblad leeg.
export const MELDPUNTEN = {
  "Almelo":       "gemeente Almelo, www.almelo.nl/melden-aan-de-gemeente/ongewenst-verhuurgedrag-melden, tel. (0546) 54 11 11",
  "Borne":        "gemeente Borne, www.borne.nl/wet-goed-verhuurderschap, tel. 14 074",
  "De Krim":      "gemeente Hardenberg, www.hardenberg.nl/melden/slechte-verhuurders, tel. 14 0523",
  "Enschede":     "gemeente Enschede, www.enschede.nl/meldpunt-slecht-verhuurderschap, handhavingsloket@enschede.nl",
  "Goor":         "gemeente Hof van Twente, www.hofvantwente.nl/direct-regelen/wonen-en-leven/wonen/meldpunt-ongewenst-verhuurgedrag, info@hofvantwente.nl",
  "Klazienaveen": "gemeente Emmen, gemeente.emmen.nl/meldpunt-ongewenst-verhuurgedrag, tel. 14 0591",
  "Rijssen":      "gemeente Rijssen-Holten, www.rijssen-holten.nl/direct-regelen/wonen-verhuizen-verbouwen/wonen/wet-goed-verhuurderschap",
  "Winterswijk":  "gemeente Winterswijk, www.winterswijk.nl/meldpunt-ongewenst-verhuurgedrag, handhaving@winterswijk.nl",
};
export const meldpuntVoor = stad => MELDPUNTEN[(stad || "").trim()] || null;

export function informatiebladWaarden(huis, info = {}) {
  const gekozen = VOORZIENINGEN.filter(v => (info.voorzieningen || []).includes(v.k));
  const lijst = taal => opsomming(gekozen.map(v => v[taal]), taal);
  return {
    "Adres woning": huis?.adres,
    "Plaats woning": huis?.stad,  // "U huurt de woning aan <adres>, te <plaats>"
    "Voorzieningen": lijst("NL"), "Voorzieningen EN": lijst("EN"), "Voorzieningen PL": lijst("PL"), "Voorzieningen RO": lijst("RO"),
    "Max bewoners": info.maxBewoners ? String(info.maxBewoners) : "",
    "Meldpunt": meldpuntVoor(huis?.stad),
  };
}

function datumNL(iso) { if (!iso) return ""; const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}-${m}-${y}`; }
function euro(n) { return n == null || n === "" ? "" : "€ " + Number(n).toFixed(2).replace(".", ","); }
const xmlVeilig = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Waarden per invulpunt. `extra` = gegevens die alleen voor dit document gebruikt worden
// en bewust niet in de app worden opgeslagen (geboortedatum, telefoon, ID-nummer).
export function contractWaarden(c, huis, einde, extra = {}) {
  return {
    "Naam huurder": c.naam_medewerker,
    "Geboorteplaats": extra.geboorteplaats,
    "Geboortedatum": datumNL(extra.geboortedatum),
    "Telefoonnummer": extra.telefoon,
    "Documentnummer": extra.documentnummer,
    "Adres woning": huis?.adres,
    "Plaats woning": [huis?.postcode, huis?.stad].filter(Boolean).join(" "),
    "Kamer": c.kamer ? `Kamer ${c.kamer}` : "",
    "Huurprijs": euro(c.huurprijs),
    "Facturatie": "via salaris",
    "Waarborgsom": euro(c.borg),
    "Begindatum": datumNL(c.begindatum),
    "Einddatum": datumNL(einde),
    "PKS punten": "n.v.t.",
    "PKS huurprijs": "n.v.t.",
    "Werkgever": WERKGEVER_JURIDISCH[c.werkgever],
    "Bijzonderheden": extra.bijzonderheden || "geen bijzonderheden",
    "Datum ondertekening": datumNL(extra.datumOndertekening),  // bij beide handtekeningen
    // Plaats ondertekening huurder: bij het tekenen invullen
  };
}

// Brief 5 (verhuizing, art. 1.3) + Bijlage I huurbevestiging. `brief` = invoer op de pagina (niet opgeslagen).
const EMAIL_TEKST = { NL: "Tevens verzonden per e-mail", EN: "Also sent by e-mail", PL: "Wysłano również e-mailem", RO: "Trimis și prin e-mail" };
export function briefVerhuizingWaarden(c, huis, einde, extra = {}, brief = {}, taal = "NL") {
  const email = (brief.email || "").trim();
  const emailLabel = EMAIL_TEKST.NL + (taal !== "NL" && EMAIL_TEKST[taal] ? ` / ${EMAIL_TEKST[taal]}` : "");
  return {
    ...contractWaarden(c, huis, einde, extra),
    "Adres huidig": brief.huidigAdres,
    "E-mail regel": email ? `${emailLabel}: ${email}` : false,
    "Datum brief": datumNL(brief.datumBrief),
    "Datum huurovereenkomst": datumNL(brief.datumHuurovereenkomst),
    "Verhuisdatum": datumNL(c.begindatum),
    "Nieuw adres": [huis?.adres, [huis?.postcode, huis?.stad].filter(Boolean).join(" "), c.kamer ? `kamer ${c.kamer}` : ""].filter(Boolean).join(", "),
  };
}

const DELEN = /^word\/(document|header\d*|footer\d*)\.xml$/;

export async function vulSjabloon(sjabloon, waarden) {
  const zip = await JSZip.loadAsync(sjabloon);
  for (const naam of Object.keys(zip.files).filter(n => DELEN.test(n))) {
    const xml = await zip.file(naam).async("string");
    zip.file(naam, xml.replace(/\{\{([^{}]+)\}\}/g, (_, tag) => {
      const v = waarden[tag];
      if (v === false) return "";  // false = regel bewust leeg (geen stippellijn)
      return xmlVeilig(v == null || v === "" ? LEEG : v);
    }));
  }
  return zip.generateAsync({ type: "blob", mimeType: DOCX_MIME, compression: "DEFLATE" });
}

export async function haalSjabloon(taal, soort = "huurovereenkomst") {
  const res = await fetch(`${process.env.PUBLIC_URL || ""}/sjablonen/${soort}_${taal}.docx`);
  if (!res.ok) return null;
  return res.arrayBuffer();
}

export function bewaarBestand(blob, naam) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = naam;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
