"""Haalt de vertaling uit een tweetalig RDM-sjabloon (NL + andere taal) en schrijft
vertalingen/huurovereenkomst_<TAAL>.json: per alinea-nummer van het Nederlandse origineel de vertaalde tekst
als lijst [tekst, vet].

    python haal_vertaling.py EN <tweetalig EN .docx>                      (vaste koppeling, zie KOPPELING)
    python haal_vertaling.py PL <tweetalig PL .docx> <origineel NL .docx> (koppeling op tekst)

De RDM-sjablonen zijn per taal verschillend opgebouwd:
- EN: vertaling per artikel in één blok -> vaste KOPPELING hieronder.
- PL: per alinea "Nederlands <regeleinde> vertaling".
- RO: Nederlandse alinea, vertaling als losse alinea eronder.
Voor PL/RO wordt elke Nederlandse tekst opgezocht in het origineel (tekstvergelijking,
in volgorde), dus de opbouw maakt niet uit. Controleer altijd controle_huurovereenkomst_<TAAL>.txt.

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

PLACEHOLDER = re.compile(r"\[[^\]]*\]|Klik of tik om (een datum|tekst) in te voeren\.?")

def norm(t):
    return re.sub(r"[^a-z]", "", PLACEHOLDER.sub("", t).lower())

def gelijkenis(bron, nl):
    """bron = Nederlandse tekst uit het tweetalige sjabloon, nl = alinea uit het origineel."""
    import difflib
    if ":" in nl and len(nl) < 90 and PLACEHOLDER.search(nl):  # invulregel: alleen het label vergelijken
        a, b = norm(bron.split(":")[0]), norm(nl.split(":")[0])
        return 1.0 if a and a == b else 0
    a, b = norm(bron)[:300], norm(nl)[:300]
    if not a or not b: return 0
    if len(b) < 40: return 1.0 if a == b else 0
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()

def segmenten(p):
    """Per <w:br/> een lijst runs [tekst, vet, in_invulveld]."""
    segs, cur = [], []
    for r in p.iter(q("r")):
        rpr = r.find(q("rPr"))
        b = rpr.find(q("b")) if rpr is not None else None
        vet = b is not None and b.get(q("val")) not in ("0", "false")
        sdt = any(a.tag == q("sdt") for a in r.iterancestors())
        for el in r:
            if el.tag == q("br"):
                segs.append(cur); cur = []
            elif el.tag == q("t") and el.text:
                cur.append([el.text, vet, sdt])
            elif el.tag == q("tab"):
                cur.append([" ", vet, sdt])
    segs.append(cur)
    return segs

def platte_tekst(runs): return "".join(t for t, _, _ in runs)

def opschonen(runs, met_invulpunten):
    """Runs samenvoegen; tekst in invulvelden wordt [X] als het om persoonsgegevens gaat."""
    uit = []
    for tekst, vet, sdt in runs:
        if sdt and met_invulpunten:
            if uit and uit[-1][0].endswith("[X]"): continue
            tekst = "[X]"
        if uit and uit[-1][1] == vet: uit[-1][0] += tekst
        else: uit.append([tekst, vet])
    for u in uit: u[0] = re.sub(r"\s+", " ", u[0])
    if uit: uit[0][0] = uit[0][0].lstrip(); uit[-1][0] = uit[-1][0].rstrip()
    return [u for u in uit if u[0]]

MET_INVULPUNTEN = {7}  # alinea's waarvan de vertaling invulvelden met persoonsgegevens bevat

def koppel_op_tekst(bron, origineel):
    nl = alineas(origineel)
    nl_tekst = ["".join(t.text or "" for t in p.iter(q("t"))) for p in nl]
    uit, wacht, pos, niet = {}, None, 0, []
    for p in alineas(bron):
        segs = [s for s in segmenten(p) if platte_tekst(s).strip()]
        if not segs: continue
        kop = platte_tekst(segs[0])
        beste, idx = 0, None
        for j in range(pos, min(pos + 25, len(nl))):
            g = gelijkenis(kop, nl_tekst[j])
            if g > beste: beste, idx = g, j
        if beste >= 0.75:
            pos = idx + 1
            if len(segs) > 1:
                uit[idx] = [r for s in segs[1:] for r in s]; wacht = None
            else:
                wacht = idx
        elif wacht is not None:
            uit[wacht] = [r for s in segs for r in s]; wacht = None
        else:
            niet.append(kop[:60])
    return uit, niet, nl_tekst

def alineas(pad):
    doc = etree.fromstring(zipfile.ZipFile(pad).read("word/document.xml"))
    return [p for p in doc.find(q("body")).iter(q("p")) if not any(a.tag == q("p") for a in p.iterancestors())]

# Alinea's die de tekstkoppeling niet kan vinden: NL-alinea <- alinea in het bronbestand
HANDMATIG_BRON = {
    "RO": {7: 10, 28: 48},  # RO: persoonsregel apart; vertalingen 2.1/2.2 staan omgewisseld
}
# Bron-alinea met meerdere vertalingen (per regeleinde) -> NL-alinea's
SPLITSEN = {
    "RO": {88: [48, 49, 50, 51, 52]},  # RO: opsomming 4.6 in één alinea
}

# Aanvullingen/correcties op het RDM-sjabloon (per taal; ontbrekend of fout in het bronbestand)
AANVULLING = {
    "EN": {
        56: "Article 5. Taxes and other levies",                     # kop ontbreekt in RDM-sjabloon
        106: "Annex: Rental Confirmation",                           # verwijzing onder de handtekeningen
        132: "End date: no more than 26 weeks after the start date", # RDM: "enddate which end date ..."
        # handtekeningblok (niet vertaald in RDM-sjabloon EN; wel in PL/RO)
        91: "Landlord", 92: "Tenant", 99: "On behalf of:", 100: "On behalf of:",
        101: "Place:", 102: "Place:", 103: "Date:", 104: "Date:",
    },
    "PL": {
        # Ontbreekt in het RDM-sjabloon PL (en in de tot nu toe getekende PL-contracten).
        # EIGEN VERTALING (o.b.v. NL en EN) — laten controleren door een moedertaalspreker.
        23: "Wynajmujący oddaje Najemcy w najem, a Najemca bierze w najem od Wynajmującego lokal mieszkalny, "
            "zwany dalej również „Przedmiotem Najmu”, znany lokalnie zgodnie z opisem w załączniku Potwierdzenie Najmu, "
            "zwanym dalej również „Potwierdzeniem Najmu”. Powyższy najem na rzecz Najemcy obejmuje również niewyłączne "
            "korzystanie z pomieszczeń wspólnych w budynku lub zespole budynków, w którym znajduje się Przedmiot Najmu, "
            "tj. z kuchni, łazienki, korytarzy i wspólnego salonu.",
        107: "Załącznik: Potwierdzenie Najmu",
        132: "Data zakończenia: nie później niż 26 tygodni po dacie rozpoczęcia",
        103: "Data:",  # RDM: "Data:]"
    },
    "RO": {
        # Huurbevestiging: RDM-vertaling RO bevat fouten ("Chiria" = de huur, "Scuze" = excuses) en is versnipperd
        117: "Imobilul închiriat",
        130: "Data de încheiere: în momentul în care contractul de muncă cu angajatorul se încheie, la care se adaugă o lună.",
        131: "SAU",
        132: "Data de încheiere: cel mult 26 de săptămâni după data de început",
        134: "Puncte PKS",
        112: "Chiriaș:", 118: "Adresă:", 119: "Localitate:", 120: "Numărul camerei/specificație:",
        123: "Chirie: pe săptămână", 124: "Se adaugă 1 lună", 125: "Modalitate de facturare:",
        126: "Garanție:", 129: "Data de început:", 135: "Punctele Imobilului închiriat pe baza PKS:",
        136: "Chiria pe baza punctelor PKS: pe săptămână", 139: "Angajator:", 140: "Particularități:",
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

def main_tekst(taal, bron, origineel):
    ruw, niet, nl_tekst = koppel_op_tekst(bron, origineel)
    bron_p = alineas(bron)
    for nl_i, b_i in HANDMATIG_BRON.get(taal, {}).items():
        ruw[nl_i] = [r for s in segmenten(bron_p[b_i]) for r in s]
    for b_i, doelen in SPLITSEN.get(taal, {}).items():
        segs = [s for s in segmenten(bron_p[b_i]) if platte_tekst(s).strip()]
        assert len(segs) == len(doelen), f"bron {b_i}: {len(segs)} stukken voor {len(doelen)}"
        for d, sg in zip(doelen, segs): ruw[d] = sg
    uit = {str(i): opschonen(r, i in MET_INVULPUNTEN) for i, r in ruw.items()}
    uit = {k: v for k, v in uit.items() if v}
    for i, tekst in AANVULLING.get(taal, {}).items():
        uit[str(i)] = [[tekst, False]]
    uit = dict(sorted(uit.items(), key=lambda kv: int(kv[0])))
    json.dump(uit, open(f"vertalingen/huurovereenkomst_{taal}.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
    with open(f"vertalingen/controle_huurovereenkomst_{taal}.txt", "w", encoding="utf8") as f:
        for i, t in enumerate(nl_tekst):
            if not t.strip(): continue
            f.write(f"{i:>4} NL: {t}\n")
            f.write(f"     {taal}: {''.join(x for x, _ in uit[str(i)]) if str(i) in uit else '!!! GEEN VERTALING'}\n")
    print(f"{taal}: {len(uit)} alinea's; niet gekoppeld in bron: {len(niet)}")
    for n in niet: print("   ?", n)

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
    json.dump(uit, open(f"vertalingen/huurovereenkomst_{taal}.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(f"{taal}: {len(uit)} alinea's")

if __name__ == "__main__":
    if len(sys.argv) > 3: main_tekst(sys.argv[1], sys.argv[2], sys.argv[3])
    else: main(sys.argv[1], sys.argv[2])
