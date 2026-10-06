import JSZip from "jszip";
import { supabase } from "./supabaseClient";

// ─── HUUROVEREENKOMST ALS WORD ───────────────────────────────────────────────
// Vult het Word-sjabloon (RDM-model, per taal) met de gegevens uit de app.
// Het sjabloon werkt met Word-invulvelden (inhoudsbesturingselementen) met een
// vaste tag, bv. "Naam huurder", "Bedrag huur", "Startdatum huur". Die vullen we
// op tag. Velden zonder tag in de tweede taal ("[NAME]", "[PLACE]") nemen de
// waarden over van de regel erboven. Wat leeg blijft wordt een stippellijn,
// zodat het na printen met de hand ingevuld kan worden.
//
// Sjablonen staan in storage-bucket "bijlages" onder sjablonen/ en worden
// via de pagina Huurcontracten geüpload (geen code-wijziging nodig bij een nieuw model).

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const BUCKET = "bijlages";
const LEEG = "..............................";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const SJABLOON_TALEN = ["NL", "EN", "PL", "RO"];
export const sjabloonPad = taal => `sjablonen/huurovereenkomst_${taal}.docx`;
// Juridische naam werkgever zoals die in het contract komt
export const WERKGEVER_JURIDISCH = { KTP: "KTP Backoffice B.V.", FP: "Flexpedia B.V." };
// Tags die het sjabloon minimaal moet bevatten om bruikbaar te zijn
const VERPLICHTE_TAGS = ["Naam huurder", "Bedrag huur", "Startdatum huur", "Einddatum huur"];

function datumNL(iso) { if (!iso) return ""; const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}-${m}-${y}`; }
function euro(n) { return n == null || n === "" ? "" : "€ " + Number(n).toFixed(2).replace(".", ","); }
const dt = iso => (iso ? { tekst: datumNL(iso), iso: iso.slice(0, 10) } : "");

// Waarden per tag. `extra` = gegevens die alleen voor dit document gebruikt worden
// en bewust niet in de app worden opgeslagen (geboortedatum, telefoon, ID-nummer).
export function contractWaarden(c, huis, einde, extra = {}) {
  return {
    "Naam huurder": c.naam_medewerker,
    "Geboorteplaats": extra.geboorteplaats || "",
    "Geboortedatum": dt(extra.geboortedatum),
    "Telefoonnummer": extra.telefoon || "",
    "Documentnummer": extra.documentnummer || "",
    "Adres woning": huis?.adres || "",
    "Plaats woning": [huis?.postcode, huis?.stad].filter(Boolean).join(" "),
    "Specificering": c.kamer ? `Kamer ${c.kamer}` : "",
    "Bedrag huur": euro(c.huurprijs),
    "Wijze van facturering/verrekening": "via salaris",
    "Bedrag borg": euro(c.borg),
    "Startdatum huur": dt(c.begindatum),
    "Einddatum huur": dt(einde),
    "BEREKENING VAN PUNTEN ONDER PKS": "n.v.t.",
    "Bedrag": "n.v.t.",
    "Naam": WERKGEVER_JURIDISCH[c.werkgever] || "",
    "Bijzonderheden": extra.bijzonderheden || "geen bijzonderheden",
    // Plaats/datum ondertekening huurder: bij het tekenen invullen
  };
}

const kind = (el, naam) => Array.from(el.childNodes).find(n => n.namespaceURI === W && n.localName === naam);
const tagVan = sdt => { const pr = kind(sdt, "sdtPr"); const t = pr && kind(pr, "tag"); return t ? t.getAttributeNS(W, "val") : null; };
const tekstVan = el => Array.from(el.getElementsByTagNameNS(W, "t")).map(t => t.textContent).join("");
function alinea(el) { let p = el.parentNode; while (p && !(p.namespaceURI === W && p.localName === "p")) p = p.parentNode; return p; }
function isPlaceholder(sdt) {
  const pr = kind(sdt, "sdtPr");
  if (pr && kind(pr, "showingPlcHdr")) return true;
  return /^\s*\[[^\]]+\]\s*$/.test(tekstVan(kind(sdt, "sdtContent") || sdt));
}

function zetWaarde(doc, sdt, waarde) {
  const tekst = typeof waarde === "object" ? waarde.tekst : waarde;
  const iso = typeof waarde === "object" ? waarde.iso : null;
  const pr = kind(sdt, "sdtPr");
  const inhoud = kind(sdt, "sdtContent");
  if (!inhoud) return;
  const wasPlaceholder = pr && kind(pr, "showingPlcHdr");
  if (wasPlaceholder) pr.removeChild(wasPlaceholder);
  const datum = pr && kind(pr, "date");
  if (datum && iso) datum.setAttributeNS(W, "w:fullDate", iso + "T00:00:00Z");

  // Opmaak van de eerste tekst-run overnemen (zonder de grijze "tijdelijke aanduiding"-stijl)
  const eersteRun = inhoud.getElementsByTagNameNS(W, "r")[0];
  const rPr = eersteRun && kind(eersteRun, "rPr") ? kind(eersteRun, "rPr").cloneNode(true) : null;
  if (rPr && wasPlaceholder) { const st = kind(rPr, "rStyle"); if (st) rPr.removeChild(st); }

  const run = doc.createElementNS(W, "w:r");
  if (rPr) run.appendChild(rPr);
  const t = doc.createElementNS(W, "w:t");
  t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  t.textContent = tekst;
  run.appendChild(t);

  // Blok-niveau veld (bevat alinea's): run in de eerste alinea, rest weg
  const p = kind(inhoud, "p");
  const doel = p || inhoud;
  if (p) Array.from(inhoud.childNodes).forEach(n => { if (n !== p) inhoud.removeChild(n); });
  Array.from(doel.childNodes).forEach(n => { if (!(n.namespaceURI === W && n.localName === "pPr")) doel.removeChild(n); });
  doel.appendChild(run);
}

// Vult één XML-deel; geeft de gevonden tags terug
function vulDeel(xml, waarden) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const sdts = Array.from(doc.getElementsByTagNameNS(W, "sdt"));
  const gevonden = new Set();

  // Groepeer per alinea, in documentvolgorde
  const groepen = [];
  for (const sdt of sdts) {
    const p = alinea(sdt);
    const laatste = groepen[groepen.length - 1];
    if (laatste && laatste.p === p) laatste.velden.push(sdt); else groepen.push({ p, velden: [sdt] });
  }

  // In het RDM-sjabloon mist het label vóór het einddatum-veld (er staat alleen ": "); aanvullen
  for (const sdt of sdts) {
    if (tagVan(sdt) !== "Einddatum huur") continue;
    let vorige = sdt.previousSibling;
    while (vorige && vorige.nodeType !== 1) vorige = vorige.previousSibling;
    const t = vorige && vorige.localName === "r" ? Array.from(vorige.getElementsByTagNameNS(W, "t")).pop() : null;
    if (!t || !/^\s*:\s*$/.test(t.textContent) || /Einddatum/.test(tekstVan(alinea(sdt)).split(":")[0])) continue;
    // Label vóór de tab, net als "Begindatum<tab>: ..." erboven
    const label = doc.createElementNS(W, "w:t");
    label.textContent = "Einddatum";
    const tab = Array.from(vorige.childNodes).find(n => n.localName === "tab");
    vorige.insertBefore(label, tab || t);
  }

  let vorigeGetagd = null; // waarden van de laatste alinea met getagde velden
  for (const g of groepen) {
    const tags = g.velden.map(tagVan);
    if (tags.some(Boolean)) {
      const vals = tags.map(tag => (tag && tag in waarden ? waarden[tag] : undefined));
      tags.forEach(tag => tag && gevonden.add(tag));
      g.velden.forEach((sdt, i) => {
        const v = vals[i];
        if (v !== undefined && v !== "" && v != null) zetWaarde(doc, sdt, v);
        else if (isPlaceholder(sdt)) zetWaarde(doc, sdt, LEEG);
      });
      vorigeGetagd = vals;
    } else {
      // Tweede taal zonder tags: zelfde aantal velden als de regel erboven -> waarden overnemen
      const spiegel = vorigeGetagd && vorigeGetagd.length === g.velden.length;
      g.velden.forEach((sdt, i) => {
        if (!isPlaceholder(sdt)) return;
        const v = spiegel ? vorigeGetagd[i] : undefined;
        zetWaarde(doc, sdt, v !== undefined && v !== "" && v != null ? v : LEEG);
      });
      vorigeGetagd = null;
    }
  }
  return { xml: new XMLSerializer().serializeToString(doc), gevonden };
}

const DELEN = /^word\/(document|header\d*|footer\d*)\.xml$/;

export async function vulSjabloon(sjabloon, waarden) {
  const zip = await JSZip.loadAsync(sjabloon);
  const gevonden = new Set();
  for (const naam of Object.keys(zip.files).filter(n => DELEN.test(n))) {
    const res = vulDeel(await zip.file(naam).async("string"), waarden);
    res.gevonden.forEach(t => gevonden.add(t));
    zip.file(naam, res.xml);
  }
  const blob = await zip.generateAsync({ type: "blob", mimeType: DOCX_MIME, compression: "DEFLATE" });
  return { blob, gevonden };
}

// Controle bij uploaden: is dit een bruikbaar sjabloon?
export async function controleerSjabloon(bestand) {
  let zip;
  try { zip = await JSZip.loadAsync(bestand); } catch { return { ok: false, reden: "Geen geldig .docx-bestand" }; }
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return { ok: false, reden: "Geen geldig Word-document" };
  const ontbreekt = VERPLICHTE_TAGS.filter(t => !xml.includes(`w:val="${t}"`));
  return ontbreekt.length ? { ok: false, reden: "Invulvelden ontbreken: " + ontbreekt.join(", ") } : { ok: true };
}

export async function haalSjabloon(taal) {
  const { data, error } = await supabase.storage.from(BUCKET).download(sjabloonPad(taal));
  if (error || !data) return null;
  return data;
}

export async function uploadSjabloon(taal, bestand) {
  const { error } = await supabase.storage.from(BUCKET).upload(sjabloonPad(taal), bestand, { upsert: true, contentType: DOCX_MIME, cacheControl: "0" });
  return error;
}

export async function aanwezigeSjablonen() {
  const { data } = await supabase.storage.from(BUCKET).list("sjablonen");
  const uit = {};
  for (const f of data || []) {
    const m = f.name.match(/^huurovereenkomst_(\w+)\.docx$/);
    if (m) uit[m[1]] = f.updated_at || f.created_at || true;
  }
  return uit;
}

export function bewaarBestand(blob, naam) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = naam;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
