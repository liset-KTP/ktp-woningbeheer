// Controleert of elke tx("...")-tekst in src/ een vertaling heeft in src/i18n/teksten.json.
// Gebruik: node scripts/check-vertalingen.js        (toont ontbrekende teksten per taal)
const fs = require("fs"), path = require("path");
const SRC = path.join(__dirname, "..", "src");
const teksten = JSON.parse(fs.readFileSync(path.join(SRC, "i18n", "teksten.json"), "utf8"));
const TALEN = ["en", "ro", "pl"];
const re = /\btx\(("(?:[^"\\]|\\.)*")\)/g;
const ontbreekt = new Map();
for (const f of fs.readdirSync(SRC).filter(f => f.endsWith(".js") && f !== "i18n.js")) {
  const src = fs.readFileSync(path.join(SRC, f), "utf8");
  let m;
  while ((m = re.exec(src))) {
    const nl = JSON.parse(m[1]);
    const rij = teksten[nl] || teksten[nl.trim()] || {};
    const mis = TALEN.filter(t => !rij[t]);
    if (mis.length) ontbreekt.set(nl, { bestand: f, mis });
  }
}
if (!ontbreekt.size) { console.log("✓ Alle teksten zijn vertaald (en/ro/pl)."); process.exit(0); }
console.log(`⚠ ${ontbreekt.size} tekst(en) zonder (volledige) vertaling:`);
for (const [nl, { bestand, mis }] of ontbreekt) console.log(`  [${bestand}] ${JSON.stringify(nl)}  → mist: ${mis.join(", ")}`);
process.exit(1);
