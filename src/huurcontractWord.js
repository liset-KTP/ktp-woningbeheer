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
    // Plaats en datum ondertekening: bij het tekenen invullen
  };
}

const DELEN = /^word\/(document|header\d*|footer\d*)\.xml$/;

export async function vulSjabloon(sjabloon, waarden) {
  const zip = await JSZip.loadAsync(sjabloon);
  for (const naam of Object.keys(zip.files).filter(n => DELEN.test(n))) {
    const xml = await zip.file(naam).async("string");
    zip.file(naam, xml.replace(/\{\{([^{}]+)\}\}/g, (_, tag) => {
      const v = waarden[tag];
      return xmlVeilig(v == null || v === "" ? LEEG : v);
    }));
  }
  return zip.generateAsync({ type: "blob", mimeType: DOCX_MIME, compression: "DEFLATE" });
}

export async function haalSjabloon(taal) {
  const res = await fetch(`${process.env.PUBLIC_URL || ""}/sjablonen/huurovereenkomst_${taal}.docx`);
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
