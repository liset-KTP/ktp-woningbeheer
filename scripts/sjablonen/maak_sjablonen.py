"""Maakt de Word-sjablonen voor de app (public/sjablonen/) uit de Nederlandse RDM-originelen.

    python maak_sjablonen.py <origineel NL huurovereenkomst .docx> <origineel NL informatieblad .docx>

- Placeholders als [NAAM] worden invulpunten {{Naam huurder}} die de app vult
  (src/huurcontractWord.js). Vaste KTP-gegevens worden direct ingevuld.
- Per taal in vertalingen/<TAAL>.json komt onder elke Nederlandse alinea de vertaling
  (grijs, cursief, klein — zoals in de tweetalige RDM-sjablonen). NL = alleen Nederlands.
- Kentro-ankers (#CPNhandtekening / #WNRhandtekening, wit) bij de handtekeningen.
- Handtekening verhuurder: staat handtekening_verhuurder.png naast dit script, dan komt die
  in de huurovereenkomst boven de streep bij "Verhuurder".

Nieuwe taal? Zet een tweetalig RDM-sjabloon om met haal_vertaling.py en draai dit script opnieuw.
"""
import copy, json, os, re, sys, zipfile
from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
q = lambda t: "{%s}%s" % (W, t)
HIER = os.path.dirname(os.path.abspath(__file__))
UIT = os.path.join(HIER, "..", "..", "public", "sjablonen")
TAAL_CODE = {"EN": "en-US", "PL": "pl-PL", "RO": "ro-RO"}

# Vaste gegevens verhuurder
VERHUURDER = {"naam": "KTP Backoffice B.V.", "plaats": "Enschede", "adres": "Kanaalstraat 217",
              "kvk": "861467164", "ondertekenaar": "H. Jager"}

# Per NL-alinea: (begin van de tekst ter controle, vervanging per [..] op volgorde)
INVULLEN = {
    4:   ("de besloten vennootschap", [VERHUURDER["naam"], VERHUURDER["plaats"], VERHUURDER["adres"], VERHUURDER["kvk"]]),
    7:   ("de heer/mevrouw", ["{{Naam huurder}}", "{{Geboorteplaats}}", "{{Geboortedatum}}"]),
    99:  ("Namens deze", [VERHUURDER["ondertekenaar"]]),
    100: ("Namens deze", ["{{Naam huurder}}"]),
    101: ("Plaats", [VERHUURDER["plaats"]]),
    102: ("Plaats", ["{{Plaats ondertekening}}"]),
    103: ("Datum", ["{{Datum ondertekening}}"]),
    104: ("Datum", ["{{Datum ondertekening}}"]),
    112: ("Huurder:", ["{{Naam huurder}}"]),
    113: ("Geboortedatum", ["{{Geboortedatum}}"]),
    114: ("Telefoonnummer", ["{{Telefoonnummer}}"]),
    115: ("Nummer identificatiedocument", ["{{Documentnummer}}"]),
    118: ("Adres", ["{{Adres woning}}"]),
    119: ("Plaats", ["{{Plaats woning}}"]),
    120: ("Kamernummer", ["{{Kamer}}"]),
    123: ("Huurprijs", ["{{Huurprijs}}"]),
    125: ("Afspraken facturatie", ["{{Facturatie}}"]),
    126: ("Waarborgsom", ["{{Waarborgsom}}"]),
    129: ("Begindatum", ["{{Begindatum}}"]),
    132: (":", ["{{Einddatum}}"]),
    135: ("Punten Gehuurde", ["{{PKS punten}}"]),
    136: ("Huurprijs op basis", ["{{PKS huurprijs}}"]),
    139: ("Werkgever", ["{{Werkgever}}"]),
    140: ("Bijzonderheden", ["{{Bijzonderheden}}"]),
}
KENTRO = {93: "#CPNhandtekening", 94: "#WNRhandtekening"}
EINDDATUM_LABEL = 132  # sjabloon mist het woord "Einddatum" vóór ": [DATUM]"
HANDTEKENING_ALINEA = 95   # lege alinea in de verhuurder-cel, boven "____"
HANDTEKENING = os.path.join(HIER, "handtekening_verhuurder.png")

KTP_CONTACT = {"email": "info@ktp.nl", "telefoon": "053-7113495", "adres": "Kanaalstraat 217, 7547 AS Enschede"}
INVULLEN_INFORMATIEBLAD = {
    10: ("U huurt de woning", ["{{Adres woning}}", "{{Plaats woning}}", "{{Voorzieningen}}", "{{Max bewoners}}"]),
    53: ("Indien u klachten", [KTP_CONTACT["email"], KTP_CONTACT["telefoon"], KTP_CONTACT["adres"]]),
    55: ("Indien u samen", ["{{Meldpunt}}"]),
}

def tekst(p): return "".join(t.text or "" for t in p.iter(q("t")))

def vervang_placeholders(p, waarden):
    """Vervangt elke [..] (ook als die over meerdere runs verspreid staat) door de volgende waarde."""
    for waarde in waarden:
        ts = [t for t in p.iter(q("t"))]
        alles = "".join(t.text or "" for t in ts)
        start = alles.find("["); eind = alles.find("]", start)
        assert start >= 0 and eind > start, f"geen placeholder meer in: {alles[:60]}"
        pos = 0
        for t in ts:
            s, e = pos, pos + len(t.text or ""); pos = e
            if e <= start or s > eind: continue
            oud = t.text or ""
            voor = oud[: max(0, start - s)] if s <= start else ""
            na = oud[eind - s + 1:] if e > eind else ""
            t.text = (voor + waarde + na) if s <= start else na
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
            if s <= start:  # run met de waarde: geen gele markering
                rpr = t.getparent().find(q("rPr"))
                if rpr is not None:
                    for h in rpr.findall(q("highlight")): rpr.remove(h)
        for r in list(p.iter(q("r"))):  # lege runs opruimen
            t = r.find(q("t"))
            if t is not None and not t.text and r.find(q("tab")) is None and r.find(q("br")) is None:
                r.getparent().remove(r)
    for r in p.iter(q("r")):  # resterende markering weg
        rpr = r.find(q("rPr"))
        if rpr is not None:
            for h in rpr.findall(q("highlight")): rpr.remove(h)

def lees_inspringing(numbering, p):
    """Linker inspringing van de tekst van een genummerde alinea (twips)."""
    numpr = p.find(q("pPr") + "/" + q("numPr"))
    if numpr is None: return None
    ppr_ind = p.find(q("pPr") + "/" + q("ind"))
    if ppr_ind is not None and ppr_ind.get(q("left")): return ppr_ind.get(q("left"))
    num_id = numpr.find(q("numId")).get(q("val")); ilvl = numpr.find(q("ilvl"))
    ilvl = ilvl.get(q("val")) if ilvl is not None else "0"
    num = numbering.find(f"{q('num')}[@{q('numId')}='{num_id}']")
    if num is None: return "567"
    abs_id = num.find(q("abstractNumId")).get(q("val"))
    lvl = numbering.find(f"{q('abstractNum')}[@{q('abstractNumId')}='{abs_id}']/{q('lvl')}[@{q('ilvl')}='{ilvl}']")
    ind = lvl.find(q("pPr") + "/" + q("ind")) if lvl is not None else None
    return ind.get(q("left")) if ind is not None and ind.get(q("left")) else "567"

def vertaal_alinea(nl_p, stukken, lang, inspring, kop):
    p = etree.Element(q("p"))
    ppr = copy.deepcopy(nl_p.find(q("pPr"))) if nl_p.find(q("pPr")) is not None else etree.SubElement(p, q("pPr"))
    for tag in ("numPr", "rPr", "keepNext", "outlineLvl"):
        for el in ppr.findall(q(tag)): ppr.remove(el)
    if kop:  # kopstijl niet overnemen (hoofdletters/vet/inhoudsopgave)
        for el in ppr.findall(q("pStyle")): ppr.remove(el)
    if inspring is not None:
        for el in ppr.findall(q("ind")): ppr.remove(el)
        etree.SubElement(ppr, q("ind")).attrib.update({q("left"): inspring, q("hanging"): "0"})
    for el in ppr.findall(q("spacing")): ppr.remove(el)
    etree.SubElement(ppr, q("spacing")).attrib.update({q("before"): "0", q("after"): "120", q("line"): "220", q("lineRule"): "auto"})
    # volgorde in pPr maakt Word strenger dan nodig; zet spacing/ind na pStyle, vóór jc
    jc = ppr.find(q("jc"))
    if jc is not None: ppr.remove(jc); ppr.append(jc)
    p.append(ppr)
    for tekst_, vet in stukken:
        r = etree.SubElement(p, q("r"))
        rpr = etree.SubElement(r, q("rPr"))
        etree.SubElement(rpr, q("rFonts")).attrib.update({q("ascii"): "Arial", q("hAnsi"): "Arial", q("cs"): "Arial"})
        if vet: etree.SubElement(rpr, q("b")); etree.SubElement(rpr, q("bCs"))
        etree.SubElement(rpr, q("i")); etree.SubElement(rpr, q("iCs"))
        etree.SubElement(rpr, q("color")).set(q("val"), "808080")
        etree.SubElement(rpr, q("sz")).set(q("val"), "16"); etree.SubElement(rpr, q("szCs")).set(q("val"), "16")
        etree.SubElement(rpr, q("lang")).set(q("val"), lang)
        t = etree.SubElement(r, q("t")); t.text = tekst_
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return p

def zet_keep_next(p):
    ppr = p.find(q("pPr"))
    if ppr is None: ppr = etree.Element(q("pPr")); p.insert(0, ppr)
    if ppr.find(q("keepNext")) is None:
        kn = etree.Element(q("keepNext")); st = ppr.find(q("pStyle"))
        st.addnext(kn) if st is not None else ppr.insert(0, kn)

def voeg_handtekening_toe(zin, doc, p, bestanden):
    """Zet handtekening_verhuurder.png als afbeelding (max. 4,5 cm breed, 2,2 cm hoog) in alinea p."""
    import struct
    png = open(HANDTEKENING, "rb").read()
    assert png[:8] == b"\x89PNG\r\n\x1a\n", "handtekening moet een PNG zijn"
    bw, bh = struct.unpack(">II", png[16:24])
    emu_b = 4.5 * 360000; emu_h = emu_b * bh / bw
    if emu_h > 2.2 * 360000: emu_h = 2.2 * 360000; emu_b = emu_h * bw / bh
    cx, cy = int(emu_b), int(emu_h)
    R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    rels = etree.fromstring(zin.read("word/_rels/document.xml.rels"))
    rid = "rIdHandtekening"
    etree.SubElement(rels, "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship",
                     Id=rid, Type=R + "/image", Target="media/handtekening_verhuurder.png")
    bestanden["word/_rels/document.xml.rels"] = etree.tostring(rels, xml_declaration=True, encoding="UTF-8", standalone=True)
    ct = etree.fromstring(zin.read("[Content_Types].xml"))
    CT = "http://schemas.openxmlformats.org/package/2006/content-types"
    if not any(d.get("Extension", "").lower() == "png" for d in ct.findall("{%s}Default" % CT)):
        etree.SubElement(ct, "{%s}Default" % CT, Extension="png", ContentType="image/png")
    bestanden["[Content_Types].xml"] = etree.tostring(ct, xml_declaration=True, encoding="UTF-8", standalone=True)
    bestanden["word/media/handtekening_verhuurder.png"] = png
    tekening = f"""<w:r xmlns:w="{W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
      xmlns:r="{R}"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/>
      <wp:docPr id="9001" name="Handtekening verhuurder"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
      <pic:nvPicPr><pic:cNvPr id="9001" name="handtekening_verhuurder.png"/><pic:cNvPicPr/></pic:nvPicPr>
      <pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
      <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
      </pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"""
    p.append(etree.fromstring(tekening))

def maak(origineel, taal, soort="huurovereenkomst"):
    if soort == "informatieblad":
        return maak_informatieblad(origineel, taal)
    zin = zipfile.ZipFile(origineel)
    doc = etree.fromstring(zin.read("word/document.xml"))
    numbering = etree.fromstring(zin.read("word/numbering.xml"))
    body = doc.find(q("body"))
    paras = [p for p in body.iter(q("p")) if not any(a.tag == q("p") for a in p.iterancestors())]  # geen alinea's in tekstvakken
    assert len(paras) >= 142, "onverwacht sjabloon (aantal alinea's)"
    vertaling = json.load(open(os.path.join(HIER, "vertalingen", f"huurovereenkomst_{taal}.json"), encoding="utf8")) if taal != "NL" else {}
    bestanden = {}  # extra/gewijzigde bestanden in het docx-pakket

    # Gele markering (RDM: "maak een keuze / vul in") overal weg
    for h in list(doc.iter(q("highlight"))): h.getparent().remove(h)

    # Vertalingen eerst bepalen (op de originele alinea's), dan pas invullen/aanpassen
    for i, (begin, waarden) in INVULLEN.items():
        assert tekst(paras[i]).lstrip().startswith(begin), f"alinea {i} begint niet met {begin!r}: {tekst(paras[i])[:50]!r}"
    for i, (begin, waarden) in INVULLEN.items():
        vervang_placeholders(paras[i], waarden)
    # "Einddatum" vóór de tab in de regel ": [DATUM], welke einddatum ..."
    p = paras[EINDDATUM_LABEL]; r0 = p.find(q("r"))
    r_label = copy.deepcopy(r0)
    for el in list(r_label):
        if el.tag != q("rPr"): r_label.remove(el)
    etree.SubElement(r_label, q("t")).text = "Einddatum"
    r0.addprevious(r_label)
    for i, anker in KENTRO.items():
        r = etree.SubElement(paras[i], q("r")); rpr = etree.SubElement(r, q("rPr"))
        etree.SubElement(rpr, q("rFonts")).set(q("cs"), "Arial")
        etree.SubElement(rpr, q("color")).attrib.update({q("val"): "FFFFFF", q("themeColor"): "background1"})
        etree.SubElement(r, q("t")).text = anker

    for i_str, stukken in vertaling.items():
        i = int(i_str); nl_p = paras[i]
        genummerd = nl_p.find(q("pPr") + "/" + q("numPr")) is not None
        stukken = [list(s) for s in stukken]
        if genummerd and stukken:  # nummer staat al bij de Nederlandse tekst
            stukken[0][0] = re.sub(r"^\s*(\d+(\.\d+)*\.?|[A-Za-z]\.|•)\s+", "", stukken[0][0])
        if i in INVULLEN:  # [NAME] e.d. -> zelfde invulpunten als de Nederlandse regel
            waarden = [w for w in INVULLEN[i][1] if w.startswith("{{")]
            for s in stukken:
                while waarden and re.search(r"\[[^\]]+\]", s[0]):
                    s[0] = re.sub(r"\[[^\]]+\]", waarden.pop(0), s[0], count=1)
        stijl = nl_p.find(q("pPr") + "/" + q("pStyle"))
        kop = stijl is not None and stijl.get(q("val")) in ("Kop1", "Kop2")
        inspring = lees_inspringing(numbering, nl_p) if genummerd else None
        nieuw = vertaal_alinea(nl_p, stukken, TAAL_CODE[taal], inspring, kop)
        # NL-alinea en vertaling bij elkaar houden; ruimte pas ná de vertaling
        ppr = nl_p.find(q("pPr"))
        if ppr is None: ppr = etree.SubElement(nl_p, q("pPr")); nl_p.insert(0, ppr)
        sp = ppr.find(q("spacing"))
        if sp is None:
            sp = etree.Element(q("spacing")); st = ppr.find(q("pStyle")); (st.addnext(sp) if st is not None else ppr.insert(0, sp))
        sp.set(q("after"), "20")
        if ppr.find(q("keepNext")) is None:
            kn = etree.Element(q("keepNext")); st = ppr.find(q("pStyle")); (st.addnext(kn) if st is not None else ppr.insert(0, kn))
        nl_p.addnext(nieuw)

    # Handtekeningblok niet over twee pagina's: tabel-rijen niet splitsen, alles bij elkaar houden
    for tbl in body.iter(q("tbl")):
        for tr in tbl.iter(q("tr")):
            trpr = tr.find(q("trPr"))
            if trpr is None: trpr = etree.Element(q("trPr")); tr.insert(1 if tr.find(q("tblPrEx")) is not None else 0, trpr)
            if trpr.find(q("cantSplit")) is None: trpr.insert(0, etree.Element(q("cantSplit")))
        for p in list(tbl.iter(q("p")))[:-1]:
            zet_keep_next(p)
    for p in paras[89:91]:  # "Aldus overeengekomen ..." + witregel vóór de tabel
        zet_keep_next(p)
        if p.getnext() is not None and p.getnext().tag == q("p"): zet_keep_next(p.getnext())

    if os.path.exists(HANDTEKENING):
        voeg_handtekening_toe(zin, doc, paras[HANDTEKENING_ALINEA], bestanden)
    schrijf(zin, doc, bestanden, f"huurovereenkomst_{taal}.docx", len(vertaling))

def schrijf(zin, doc, bestanden, naam, n_vertaald):
    os.makedirs(UIT, exist_ok=True)
    pad = os.path.join(UIT, naam)
    bestanden = dict(bestanden)
    bestanden["word/document.xml"] = etree.tostring(doc, xml_declaration=True, encoding="UTF-8", standalone=True)
    with zipfile.ZipFile(pad, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, bestanden.pop(item.filename, None) or zin.read(item.filename))
        for naam_extra, data in bestanden.items():
            zout.writestr(naam_extra, data)
    print("gemaakt:", os.path.relpath(pad), f"({n_vertaald} vertaalde alinea's)")

def plaats_vertalingen(paras, numbering, vertaling, taal, invullen):
    for i_str, stukken in vertaling.items():
        i = int(i_str); nl_p = paras[i]
        genummerd = nl_p.find(q("pPr") + "/" + q("numPr")) is not None
        stukken = [list(s) for s in stukken]
        if genummerd and stukken:
            stukken[0][0] = re.sub(r"^\s*(\d+(\.\d+)*\.?|[A-Za-z]\.|•)\s+", "", stukken[0][0])
        stijl = nl_p.find(q("pPr") + "/" + q("pStyle"))
        kop = stijl is not None and stijl.get(q("val")) in ("Kop1", "Kop2", "Heading1", "Heading2", "Title", "Titel")
        inspring = lees_inspringing(numbering, nl_p) if genummerd else None
        nieuw = vertaal_alinea(nl_p, stukken, TAAL_CODE[taal], inspring, kop)
        ppr = nl_p.find(q("pPr"))
        if ppr is None: ppr = etree.Element(q("pPr")); nl_p.insert(0, ppr)
        sp = ppr.find(q("spacing"))
        if sp is None:
            sp = etree.Element(q("spacing")); st = ppr.find(q("pStyle")); (st.addnext(sp) if st is not None else ppr.insert(0, sp))
        sp.set(q("after"), "20")
        zet_keep_next(nl_p)
        nl_p.addnext(nieuw)

def verwijder_tekst(p, patroon):
    """Verwijdert alle stukken tekst die op patroon passen, ook als ze over meerdere runs verdeeld staan."""
    while True:
        ts = list(p.iter(q("t")))
        alles = "".join(t.text or "" for t in ts)
        m = re.search(patroon, alles)
        if not m: return
        start, eind, pos = m.start(), m.end(), 0
        for t in ts:
            s, e = pos, pos + len(t.text or ""); pos = e
            if e <= start or s >= eind: continue
            oud = t.text or ""
            t.text = oud[: max(0, start - s)] + oud[max(0, eind - s):]
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")

def maak_informatieblad(origineel, taal):
    zin = zipfile.ZipFile(origineel)
    doc = etree.fromstring(zin.read("word/document.xml"))
    numbering = etree.fromstring(zin.read("word/numbering.xml"))
    body = doc.find(q("body"))
    paras = [p for p in body.iter(q("p")) if not any(a.tag == q("p") for a in p.iterancestors())]
    assert len(paras) == 60, f"onverwacht informatieblad ({len(paras)} alinea's)"
    vertaling = json.load(open(os.path.join(HIER, "vertalingen", f"informatieblad_{taal}.json"), encoding="utf8")) if taal != "NL" else {}
    for h in list(doc.iter(q("highlight"))): h.getparent().remove(h)
    for i, (begin, waarden) in INVULLEN_INFORMATIEBLAD.items():
        assert tekst(paras[i]).lstrip().startswith(begin), f"alinea {i} begint niet met {begin!r}"
        vervang_placeholders(paras[i], waarden)
    # versiedatum en bestandsgrootte bij de pdf-link eruit (alinea 57)
    verwijder_tekst(paras[57], r",\s*806 kB|,?\s*versie\s+\d{1,2}\s+\w+\s+\d{4}")
    plaats_vertalingen(paras, numbering, vertaling, taal, INVULLEN_INFORMATIEBLAD)
    schrijf(zin, doc, {}, f"informatieblad_{taal}.docx", len(vertaling))

def talen(soort):
    return ["NL"] + sorted(f[len(soort) + 1:-5] for f in os.listdir(os.path.join(HIER, "vertalingen"))
                           if f.startswith(soort + "_") and f.endswith(".json"))

if __name__ == "__main__":
    for taal in talen("huurovereenkomst"):
        maak(sys.argv[1], taal)
    if len(sys.argv) > 2:
        for taal in talen("informatieblad"):
            maak(sys.argv[2], taal, "informatieblad")
