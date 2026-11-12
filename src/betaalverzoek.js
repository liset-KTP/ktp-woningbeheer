// ─── BETAALVERZOEK HUISVESTING ────────────────────────────────────────────────
// Maakt een betaalverzoek in KTP-stijl voor een openstaande huurschuld, in NL/EN/PL/RO.
// Alle bedragen komen uit de app (berekenSpecificatie) — collega's typen niets zelf,
// dus naam, periode en bedrag kloppen altijd met wat er in Huurbetalingen staat.
// Opent in een nieuw venster; daar "Afdrukken / opslaan als PDF".

// Afzender en rekening — dezelfde gegevens als op de KTP-facturen (ktp-facturen).
// Besluit Liset 12-11-2026: voorlopig KTP Interflex + rekening NL10 (ook al is KTP Backoffice
// juridisch verhuurder in de huurovereenkomst). Wisselen = alleen AFZENDER_STANDAARD aanpassen.
// Wijzigt dit? Alleen hier aanpassen.
export const AFZENDERS = {
  BACKOFFICE: {
    naam: "KTP Backoffice B.V.", logo: "/logo-ktp-backoffice.jpg",
    adres: "Kanaalstraat 217", postcode: "7547 AS Enschede",
    telefoon: "053-7113495", email: "info@ktp.nl",
    iban: "NL13 RABO 0356 7910 41", bic: "RABONL2U", kvk: "78604745",
  },
  INTERFLEX: {
    naam: "KTP Interflex B.V.", logo: "/logo-ktp-interflex.jpg",
    adres: "Kanaalstraat 217", postcode: "7547 AS Enschede",
    telefoon: "053-7113495", email: "info@ktp.nl",
    iban: "NL10 RABO 0326 0410 28", bic: "RABONL2U", kvk: "70445796",
  },
};
export const AFZENDER_STANDAARD = "INTERFLEX";

export const BETAALVERZOEK_TALEN = ["NL", "EN", "PL", "RO"];

const T = {
  NL: { titel: "Betaalverzoek", herinnering: "Herinnering", aan: "Aan", kenmerk: "Kenmerk", datum: "Datum", termijn: "Betaaltermijn", dagen: "dagen", verval: "Vervaldatum",
        betreft: "Betreft", betreftTekst: "Huisvesting via KTP",
        kDatum: "Periode", kOms: "Omschrijving", kAantal: "Aantal", kEenheid: "Eenheid", kTarief: "Tarief", kBedrag: "Bedrag",
        week: "Huisvesting – volledige week", weken: "Huisvesting – volledige weken", dag: "Huisvesting – losse dag", dagenOms: "Huisvesting – losse dagen",
        eWeek: "week", eDag: "dag", eStuk: "stuk", achterstand: "Eerdere achterstand", extra: "Extra kosten",
        totaal: "Totaal verschuldigd", betaald: "Reeds betaald", tebetalen: "Te betalen",
        verzoek: (b, d, iban, tnv, k) => `Wij verzoeken je het bedrag van <b>${b}</b> vóór <b>${d}</b> over te maken op <b>${iban}</b> t.n.v. ${tnv}, onder vermelding van <b>${k}</b>.`,
        tarief: (w, d) => `Huur: ${w} per week, vooraf te betalen. Onvolledige week: ${d} per dag (max. ${w} per week).`,
        contact: "Contact", bank: "Bank", registratie: "Registratie", print: "Opslaan als PDF / afdrukken", locale: "nl-NL" },
  EN: { titel: "Payment request", herinnering: "Reminder", aan: "To", kenmerk: "Reference", datum: "Date", termijn: "Payment term", dagen: "days", verval: "Due date",
        betreft: "Subject", betreftTekst: "Accommodation via KTP",
        kDatum: "Period", kOms: "Description", kAantal: "Qty", kEenheid: "Unit", kTarief: "Rate", kBedrag: "Amount",
        week: "Accommodation – full week", weken: "Accommodation – full weeks", dag: "Accommodation – single day", dagenOms: "Accommodation – single days",
        eWeek: "week", eDag: "day", eStuk: "item", achterstand: "Previous arrears", extra: "Additional costs",
        totaal: "Total due", betaald: "Already paid", tebetalen: "Amount to pay",
        verzoek: (b, d, iban, tnv, k) => `Please transfer <b>${b}</b> before <b>${d}</b> to <b>${iban}</b> in the name of ${tnv}, stating <b>${k}</b>.`,
        tarief: (w, d) => `Rent: ${w} per week, paid in advance. Incomplete week: ${d} per day (max. ${w} per week).`,
        contact: "Contact", bank: "Bank", registratie: "Registration", print: "Save as PDF / print", locale: "en-GB" },
  PL: { titel: "Prośba o zapłatę", herinnering: "Przypomnienie", aan: "Dla", kenmerk: "Numer", datum: "Data wystawienia", termijn: "Termin płatności", dagen: "dni", verval: "Płatne do",
        betreft: "Dotyczy", betreftTekst: "Zakwaterowanie przez KTP",
        kDatum: "Okres", kOms: "Opis", kAantal: "Ilość", kEenheid: "Jedn.", kTarief: "Stawka", kBedrag: "Kwota",
        week: "Zakwaterowanie – pełny tydzień", weken: "Zakwaterowanie – pełne tygodnie", dag: "Zakwaterowanie – dzień", dagenOms: "Zakwaterowanie – dni",
        eWeek: "tydzień", eDag: "dzień", eStuk: "szt.", achterstand: "Wcześniejsze zaległości", extra: "Koszty dodatkowe",
        totaal: "Razem należność", betaald: "Już zapłacono", tebetalen: "Do zapłaty",
        verzoek: (b, d, iban, tnv, k) => `Prosimy o przelanie kwoty <b>${b}</b> do <b>${d}</b> na konto <b>${iban}</b> (odbiorca: ${tnv}), w tytule przelewu podając <b>${k}</b>.`,
        tarief: (w, d) => `Czynsz: ${w} za tydzień, płatny z góry. Niepełny tydzień: ${d} za dzień (maks. ${w} za tydzień).`,
        contact: "Kontakt", bank: "Bank", registratie: "Rejestracja", print: "Zapisz jako PDF / drukuj", locale: "pl-PL" },
  RO: { titel: "Solicitare de plată", herinnering: "Reamintire", aan: "Către", kenmerk: "Referință", datum: "Data", termijn: "Termen de plată", dagen: "zile", verval: "Scadență",
        betreft: "Privind", betreftTekst: "Cazare prin KTP",
        kDatum: "Perioadă", kOms: "Descriere", kAantal: "Cant.", kEenheid: "Unitate", kTarief: "Tarif", kBedrag: "Sumă",
        week: "Cazare – săptămână completă", weken: "Cazare – săptămâni complete", dag: "Cazare – o zi", dagenOms: "Cazare – zile",
        eWeek: "săpt.", eDag: "zi", eStuk: "buc.", achterstand: "Restanțe anterioare", extra: "Costuri suplimentare",
        totaal: "Total datorat", betaald: "Deja plătit", tebetalen: "De plată",
        verzoek: (b, d, iban, tnv, k) => `Vă rugăm să transferați suma de <b>${b}</b> până la <b>${d}</b> în contul <b>${iban}</b> pe numele ${tnv}, menționând <b>${k}</b>.`,
        tarief: (w, d) => `Chirie: ${w} pe săptămână, plătită în avans. Săptămână incompletă: ${d} pe zi (max. ${w} pe săptămână).`,
        contact: "Contact", bank: "Bancă", registratie: "Înregistrare", print: "Salvare ca PDF / tipărire", locale: "ro-RO" },
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Bedragnotatie zoals op de facturen: € 2.775,00
function eur(n) {
  const [heel, dec] = Math.abs(Number(n)).toFixed(2).split(".");
  return (Number(n) < 0 ? "– " : "") + "€ " + heel.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + dec;
}
function getal(n) { return Number(n).toFixed(2).replace(".", ","); }

// Eerstvolgende vrijdag, minimaal 2 dagen vanaf vandaag (huur wordt op vrijdag betaald)
export function betaalDatum(vandaag = new Date()) {
  const d = new Date(vandaag); d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 2);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  return d;
}

export function kenmerkVoor(schuld) { return `HUUR-${schuld.id}`; }

// Bouwt de volledige HTML van het betaalverzoek, in de opmaak van de KTP-facturen.
// spec = berekenSpecificatie(schuld), betaald = berekenTotaalBetaald(schuld)
// basis = waar de logo's staan (standaard de app zelf)
export function betaalverzoekHTML({ schuld, spec, betaald, taal = "NL", vandaag = new Date(), afzender = AFZENDER_STANDAARD, basis, herinnering = 0 }) {
  const t = T[taal] || T.NL;
  const a = AFZENDERS[afzender] || AFZENDERS[AFZENDER_STANDAARD];
  const root = basis ?? (typeof window !== "undefined" ? window.location.origin : "");
  const dt = d => (d ? new Date(d).toLocaleDateString(t.locale, { day: "numeric", month: "numeric", year: "numeric" }).replace(/\//g, "-").replace(/\.$/, "") : "");
  const periode = r => (r.van ? (r.tot && dt(r.tot) !== dt(r.van) ? `${dt(r.van)} – ${dt(r.tot)}` : dt(r.van)) : "");
  const teBetalen = Math.max(0, spec.totaal - betaald);
  const kenmerk = kenmerkVoor(schuld);
  const verval = betaalDatum(vandaag);
  const termijn = Math.round((verval - new Date(new Date(vandaag).setHours(0,0,0,0))) / 86400000);

  const rijen = spec.regels.map(r => {
    let oms, aantal = "", eenheid = "", tarief = "";
    if (r.soort === "weken") { oms = r.aantal === 1 ? t.week : t.weken; aantal = r.aantal; eenheid = t.eWeek; tarief = getal(r.prijs); }
    else if (r.soort === "dagen") { oms = r.aantal === 1 ? t.dag : t.dagenOms; aantal = r.aantal; eenheid = t.eDag; tarief = r.prijs != null ? getal(r.prijs) : `max. ${getal(spec.weekbedrag)}`; }
    else if (r.soort === "achterstand") { oms = t.achterstand; aantal = 1; eenheid = t.eStuk; tarief = getal(r.bedrag); }
    else { oms = t.extra + (r.omschrijving ? ` – ${esc(r.omschrijving)}` : ""); aantal = 1; eenheid = t.eStuk; tarief = getal(r.bedrag); }
    return `<tr><td class="per">${periode(r)}</td><td>${oms}</td><td class="r">${aantal}</td><td class="eh">${eenheid}</td><td class="r">${tarief}</td><td class="r">${eur(r.bedrag)}</td></tr>`;
  }).join("");

  return `<!DOCTYPE html><html lang="${taal.toLowerCase()}"><head><meta charset="utf-8">
<title>${esc(t.titel)} ${esc(kenmerk)} ${esc(schuld.naam_medewerker)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: "Open Sans", "Segoe UI", Helvetica, Arial, sans-serif; color: #1C2233; margin: 0; background: #E9ECF2; font-size: 12px; }
  .balk { position: sticky; top: 0; background: #1C2233; padding: 12px; text-align: center; z-index: 2; }
  .balk button { background: #5A9A3C; color: #fff; border: 0; border-radius: 6px; padding: 9px 20px; font: 600 13px "Open Sans", sans-serif; cursor: pointer; }
  .blad { width: 210mm; min-height: 297mm; margin: 24px auto; background: #fff; padding: 18mm 17mm 14mm; box-shadow: 0 2px 14px rgba(28,34,51,.12); display: flex; flex-direction: column; }
  .kop { display: flex; justify-content: space-between; align-items: flex-start; }
  .kop img { height: 46px; }
  .titel { text-align: right; }
  .titel h1 { margin: 0; color: #2D3B94; font-size: 26px; font-weight: 800; letter-spacing: -.3px; }
  .herinn { display: inline-block; background: #B3261E; color: #fff; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; padding: 3px 8px; border-radius: 3px; margin-bottom: 6px; }
  .titel .streep { width: 34px; height: 3px; background: #5A9A3C; margin: 6px 0 0 auto; }
  .adres { display: flex; justify-content: space-between; margin-top: 38px; padding-bottom: 18px; border-bottom: 1px solid #E3E7EF; }
  .lbl { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: #6B7388; }
  .aan .n { font-size: 13px; font-weight: 600; margin-top: 6px; }
  .meta { width: 215px; }
  .meta div { display: flex; justify-content: space-between; line-height: 1.8; }
  .meta span:first-child { color: #6B7388; }
  .meta span:last-child { font-weight: 600; }
  .betreft { display: flex; gap: 40px; padding: 14px 0; }
  .betreft span:first-child { color: #6B7388; width: 48px; }
  .betreft span:last-child { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { text-align: left; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #2D3B94; padding: 0 6px 7px; border-bottom: 2px solid #2D3B94; }
  td { padding: 9px 6px; border-bottom: 1px solid #E3E7EF; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; } th.r { text-align: right; }
  .per { white-space: nowrap; width: 1%; padding-right: 16px; }
  .eh { color: #6B7388; padding-left: 2px; }
  .tot { width: 220px; margin: 18px 0 0 auto; }
  .tot div { display: flex; justify-content: space-between; padding: 4px 11px; }
  .tot div span:first-child { color: #6B7388; }
  .tot .eind { background: #2D3B94; color: #fff; margin-top: 8px; padding: 11px; }
  .tot .eind span:first-child { color: #fff; font-weight: 600; }
  .tot .eind span:last-child { font-size: 16px; font-weight: 800; }
  .verzoek { margin-top: 34px; line-height: 1.6; max-width: 400px; }
  .tarief { margin-top: 8px; color: #6B7388; font-size: 10px; }
  .vrij { flex: 1; }
  .voet { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; border-top: 1px solid #E3E7EF; padding-top: 12px; font-size: 9.5px; color: #3A4256; line-height: 1.55; }
  .voet b { color: #2D3B94; display: block; }
  @media print { body { background: #fff; } .balk { display: none; } .blad { margin: 0; box-shadow: none; }
    th, .tot .eind { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="balk"><button onclick="window.print()">${t.print}</button></div>
<div class="blad">
  <div class="kop">
    <img src="${root}${a.logo}" alt="${esc(a.naam)}">
    <div class="titel">${herinnering > 0 ? `<div class="herinn">${t.herinnering}${herinnering > 1 ? " " + herinnering : ""}</div>` : ""}<h1>${t.titel}</h1><div class="streep"></div></div>
  </div>
  <div class="adres">
    <div class="aan"><div class="lbl">${t.aan}</div><div class="n">${esc(schuld.naam_medewerker)}</div></div>
    <div class="meta">
      <div><span>${t.kenmerk}</span><span>${esc(kenmerk)}</span></div>
      <div><span>${t.datum}</span><span>${dt(vandaag)}</span></div>
      <div><span>${t.termijn}</span><span>${termijn} ${t.dagen}</span></div>
      <div><span>${t.verval}</span><span>${dt(verval)}</span></div>
    </div>
  </div>
  <div class="betreft"><span>${t.betreft}</span><span>${t.betreftTekst}</span></div>
  <table>
    <thead><tr><th>${t.kDatum}</th><th>${t.kOms}</th><th class="r">${t.kAantal}</th><th>${t.kEenheid}</th><th class="r">${t.kTarief}</th><th class="r">${t.kBedrag}</th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
  <div class="tot">
    ${betaald > 0 ? `<div><span>${t.totaal}</span><span>${eur(spec.totaal)}</span></div><div><span>${t.betaald}</span><span>– ${eur(betaald)}</span></div>` : ""}
    <div class="eind"><span>${t.tebetalen}</span><span>${eur(teBetalen)}</span></div>
  </div>
  <div class="verzoek">${t.verzoek(eur(teBetalen), dt(verval), esc(a.iban), esc(a.naam), esc(kenmerk))}
    <div class="tarief">${t.tarief(eur(spec.weekbedrag), eur(spec.dagbedrag))}</div></div>
  <div class="vrij"></div>
  <div class="voet">
    <div><b>${esc(a.naam)}</b>${esc(a.adres)}<br>${esc(a.postcode)}</div>
    <div><b>${t.contact}</b>${esc(a.telefoon)}<br>${esc(a.email)}</div>
    <div><b>${t.bank}</b>${esc(a.iban)}<br>BIC ${esc(a.bic)}</div>
    <div><b>${t.registratie}</b>KvK ${esc(a.kvk)}</div>
  </div>
</div></body></html>`;
}

// Venster openen MOET direct in de klik gebeuren (anders blokkeert de browser de pop-up);
// de inhoud schrijven mag daarna, als het verzoek is vastgelegd.
export function openLeegVenster() {
  const w = window.open("", "_blank");
  if (w) w.document.write("<p style='font-family:sans-serif;padding:24px;color:#6B7388'>Betaalverzoek wordt gemaakt…</p>");
  return w;
}
export function schrijfInVenster(w, html) {
  if (!w || w.closed) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

// Snapshot van wat er op het verzoek staat — wordt opgeslagen bij het verzoek, zodat het
// document later exact zo terug te halen is (ook als de huurschuld intussen verandert).
export function maakSnapshot({ spec, betaald }) {
  return {
    regels: spec.regels.map(r => ({ ...r, van: r.van ? new Date(r.van).toISOString() : null, tot: r.tot ? new Date(r.tot).toISOString() : null })),
    totaal: spec.totaal, weekbedrag: spec.weekbedrag, dagbedrag: spec.dagbedrag, betaald,
  };
}

// HTML van een vastgelegd verzoek (uit de tabel betaalverzoeken)
export function htmlUitVerzoek(v) {
  const sn = v.snapshot || {};
  return betaalverzoekHTML({
    schuld: { id: v.schuld_id, naam_medewerker: v.naam_medewerker },
    spec: { regels: sn.regels || [], totaal: Number(sn.totaal) || 0, weekbedrag: sn.weekbedrag, dagbedrag: sn.dagbedrag },
    betaald: Number(sn.betaald) || 0,
    taal: v.taal, afzender: v.afzender, herinnering: v.herinneringen || 0,
    vandaag: new Date(v.datum + "T00:00:00"),
  });
}
