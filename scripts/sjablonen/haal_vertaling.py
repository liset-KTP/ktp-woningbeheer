"""Haalt de vertaling uit een tweetalig RDM-sjabloon (NL + andere taal) en schrijft
vertalingen/<TAAL>.json: per alinea-nummer van het Nederlandse origineel de vertaalde tekst
als lijst [tekst, vet]. Gebruik: python haal_vertaling.py EN bron.docx

Het tweetalige sjabloon zet de vertaling per artikel in één blok (regels gescheiden door
een regeleinde); die blokken worden hier per alinea opgeknipt. De koppeling hieronder
(KOPPELING) is gecontroleerd voor het RDM-model "Huurovereenkomst uitzendbureau -
uitzendkracht (arbeidsmigrant)" zoals in gebruik per 10-2026.
"""
import json, re, sys, zipfile
from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
q = lambda t: "{%s}%s" % (W, t)

# NL-alinea('s) in het origineel  <-  alinea in het tweetalige sjabloon
# int = één alinea; lijst = blok dat per regeleinde over die NL-alinea's verdeeld wordt
KOPPELING = [
    (0, 1), (1, 3), (3, 6), (4, 8), (5, 10), (7, 13), (8, 15), (10, 18),
    (13, 22), ([14, 15, 16, 17, 18], 28),
    (21, 32), (22, 34), ([23, 24, 25], 38),
    (27, 41), ([28, 29], 44),
    (31, 47), ([32, 33, 34, 35, 36, 37, 38, 39], 57),
    (41, 59), (list(range(42, 55)), 74),
    (57, 77),
    (59, 80), (list(range(60, 74)), 96),
    (75, 98), ([76, 77, 78, 79, 80], 105),
    (82, 107), ([83, 84, 85, 86, 87], 113),
    (89, 116),
    (107, 134), (109, 137),
    (111, 140), (112, 142), (113, 144), (114, 146), (115, 148),
    (117, 151), (118, 153), (119, 155), (120, 157),
    (122, 160), (123, 162), (124, 164), (125, 166), (126, 168),
    (128, 171), (129, 173), (130, 175), (131, 177), (132, 179),
    (134, 182), (135, 184), (136, 186),
    (138, 189), (139, 191), (140, 193), (142, 196),
]

# Aanvullingen/correcties op het RDM-sjabloon (per taal; ontbrekend in het bronbestand)
AANVULLING = {
    "EN": {
        56: "Article 5. Taxes and other levies",                     # kop ontbreekt in RDM-sjabloon
        106: "Annex: Rental Confirmation",                           # verwijzing onder de handtekeningen
        132: "End date: no more than 26 weeks after the start date", # RDM: "enddate which end date ..."
    },
}

def runs_met_breaks(p):
    """Lijst segmenten (per <w:br/>), elk een lijst [tekst, vet]; ook runs binnen invulvelden."""
    segs, cur = [], []
    for r in p.iter(q("r")):
        rpr = r.find(q("rPr"))
        vet = rpr is not None and rpr.find(q("b")) is not None and rpr.find(q("b")).get(q("val")) not in ("0", "false")
        for el in r:
            if el.tag == q("br"):
                segs.append(cur); cur = []
            elif el.tag == q("t") and el.text:
                if cur and cur[-1][1] == vet: cur[-1][0] += el.text
                else: cur.append([el.text, vet])
            elif el.tag == q("tab"):
                if cur: cur[-1][0] += " "
    segs.append(cur)
    return [s for s in segs if "".join(t for t, _ in s).strip()]

def main(taal, bron):
    doc = etree.fromstring(zipfile.ZipFile(bron).read("word/document.xml"))
    paras = [p for p in doc.find(q("body")).iter(q("p")) if not any(a.tag == q("p") for a in p.iterancestors())]  # geen alinea's in tekstvakken
    uit = {}
    for nl, bi in KOPPELING:
        segs = runs_met_breaks(paras[bi])
        doelen = nl if isinstance(nl, list) else [nl]
        if len(doelen) == 1 and len(segs) > 1:
            segs = [[x for s in segs for x in s]]
        assert len(segs) == len(doelen), f"alinea {bi}: {len(segs)} stukken voor {len(doelen)} NL-alinea's"
        for d, s in zip(doelen, segs):
            uit[str(d)] = s
    for i, tekst in AANVULLING.get(taal, {}).items():
        uit[str(i)] = [[tekst, False]]
    uit = dict(sorted(uit.items(), key=lambda kv: int(kv[0])))
    json.dump(uit, open(f"vertalingen/{taal}.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(f"{taal}: {len(uit)} alinea's")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
