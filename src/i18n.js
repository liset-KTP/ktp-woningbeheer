// i18n.js — centrale vertaling voor de woningen-app.
// Nederlands is de BRONTEKST: tx("Opslaan") geeft in NL "Opslaan" terug, in andere talen de vertaling
// uit teksten.json. Ontbreekt een vertaling, dan valt hij terug op Nederlands (nooit leeg, nooit crash).
//
// Nieuwe tekst toevoegen in de app?  Schrijf hem als tx("Nederlandse tekst") en voeg in
// src/i18n/teksten.json een regel toe: "Nederlandse tekst": { "en": "...", "ro": "...", "pl": "..." }
// Controleer ontbrekende vertalingen met:  node scripts/check-vertalingen.js
import TEKSTEN from "./i18n/teksten.json";

export const TAAL_CODES = ["nl", "en", "ro", "pl"];
let huidigeTaal = "nl";

export function zetTaal(taal) { huidigeTaal = TAAL_CODES.includes(taal) ? taal : "nl"; }
export function huidigeTaalCode() { return huidigeTaal; }

// tx: vertaal een Nederlandse tekst naar de actieve taal.
// Niet-strings (getallen, null, React-elementen) gaan ongewijzigd terug.
export function tx(nl, taal = huidigeTaal) {
  if (typeof nl !== "string" || taal === "nl" || !nl) return nl;
  const rij = TEKSTEN[nl];
  if (rij && rij[taal]) return rij[taal];
  // Probeer zonder voor/na-spaties (fragmenten rond {variabelen})
  const kern = nl.trim();
  if (kern !== nl) {
    const r2 = TEKSTEN[kern];
    if (r2 && r2[taal]) return nl.replace(kern, r2[taal]);
  }
  return nl;
}

// dbTekst: tekst uit de database in de actieve taal, bv. checklist_items.tekst_ro.
// Valt terug op de Nederlandse kolom als de vertaling leeg is.
export function dbTekst(rij, veld = "tekst", taal = huidigeTaal) {
  if (!rij) return "";
  if (taal !== "nl" && rij[veld + "_" + taal]) return rij[veld + "_" + taal];
  return rij[veld];
}
