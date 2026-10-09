"""Maakt de Word-sjablonen voor brief 5 (verhuizing, art. 1.3) voor de app: public/sjablonen/brief_verhuizing_<TAAL>.docx

    python maak_brief_verhuizing.py <origineel NL brief 5a .docx>

Draai eerst maak_sjablonen.py: de Bijlage I (huurbevestiging) wordt overgenomen uit
public/sjablonen/huurovereenkomst_<TAAL>.docx, zodat die precies gelijk is aan die in het contract.

- [..] in de brief -> invulpunten {{..}} die de app vult (src/huurcontractWord.js, briefVerhuizingWaarden).
- Onder elke Nederlandse alinea de vertaling (zelfde opmaak als de huurovereenkomst). Nederlands is leidend.
  EN komt uit RDM-brief 5b; PL en RO zijn eigen vertalingen (Liset: geen extra controle door moedertaalspreker).
  Termen gelijk aan de huurovereenkomst (Wynajmujący / Potwierdzenie Najmu, Locatorul / Confirmare de închiriere).
- Onder de huurbevestiging een blok "voor akkoord" voor de huurder, met Kentro-anker #WNRhandtekening (wit).
"""
import copy, os, sys, zipfile
from lxml import etree
from maak_sjablonen import (q, W, HIER, UIT, TAAL_CODE, VERHUURDER, HANDTEKENING, tekst,
                            vervang_placeholders, vertaal_alinea, voeg_handtekening_toe, schrijf, zet_keep_next)

# NL-alinea -> (begin ter controle, vervangingen per [..] op volgorde)
INVULLEN = {
    0:  ("[NAAM WERKNEMER]", ["{{Naam huurder}}"]),
    1:  ("[ADRES]", ["{{Adres huidig}}"]),
    7:  ("[PLAATS]", [VERHUURDER["plaats"], "{{Datum brief}}"]),
    13: ("Beste", ["{{Naam huurder}}"]),
    15: ("Op [DATUM]", ["{{Datum huurovereenkomst}}", VERHUURDER["naam"]]),
    17: ("Zoals overeengekomen", ["{{Verhuisdatum}}", "{{Nieuw adres}}", "{{Verhuisdatum}}"]),
    25: ("[NAAM VERHUURDER]", [VERHUURDER["naam"]]),
    26: ("[NAAM VERTEGENWOORDIGER", [VERHUURDER["ondertekenaar"]]),
}
EMAIL_ALINEA = 4          # "Tevens verzonden per e-mail: [..]" -> hele regel wordt {{E-mail regel}} (leeg = weg)
HANDTEKENING_ALINEA = 23  # lege alinea boven [NAAM VERHUURDER]
LEGE_ALINEAS = [9, 12, 22, 24]  # dubbele witregels in het RDM-origineel

V = "{{Datum huurovereenkomst}}"; D = "{{Verhuisdatum}}"; A = "{{Nieuw adres}}"; N = "{{Naam huurder}}"
VERTALING = {
    "EN": {
        10: [("Re: Change of accommodation and confirmation of new lease agreement", True)],
        13: [(f"Dear {N},", False)],
        15: [(f"On {V}, you have entered into a lease agreement with {VERHUURDER['naam']}.", False)],
        17: [("As agreed in Article 1.3 of the lease agreement, the Landlord has the right to unilaterally offer an alternative "
              "accommodation comparable to the leased accommodation, which offer you in fairness cannot refuse. We hereby inform you "
              "that the Landlord will exercise this option. The Landlord hereby unilaterally offers you, as from "
              f"{D}, a comparable alternative accommodation located at {A}. This means that as from {D} your current lease "
              "agreement ends and a new lease agreement is established under the same terms and conditions as the current lease "
              "agreement. The provisions concerning the accommodation that deviate from the current lease agreement are included in a "
              "new Rental Confirmation, which is attached to this letter as Annex I. Could you please sign a copy of the attached "
              "Rental Confirmation and return it to us?", False)],
        19: [("If you nonetheless have insurmountable objections to moving to the alternative accommodation, please inform us "
              "at your earliest convenience.", False)],
        21: [("Kind regards,", False)],
        28: [("Annex I: Rental Confirmation", False)],
    },
    "PL": {
        10: [("Dotyczy: zmiana lokalu mieszkalnego i potwierdzenie nowej umowy najmu", True)],
        13: [(f"Szanowna Pani / Szanowny Panie {N},", False)],
        15: [(f"W dniu {V} zawarł(a) Pan/Pani umowę najmu z {VERHUURDER['naam']}.", False)],
        17: [("Zgodnie z art. 1.3 umowy najmu Wynajmujący ma prawo jednostronnie zaoferować alternatywny lokal mieszkalny, "
              "porównywalny z wynajmowanym lokalem, której to oferty nie może Pan/Pani w uzasadniony sposób odrzucić. Niniejszym "
              "informujemy, że Wynajmujący skorzysta z tej możliwości. Wynajmujący niniejszym jednostronnie oferuje Panu/Pani od dnia "
              f"{D} porównywalny alternatywny lokal mieszkalny, położony pod adresem {A}. Oznacza to, że z dniem {D} Pana/Pani "
              "obecna umowa najmu wygasa i zostaje zawarta nowa umowa najmu na tych samych warunkach co obecna umowa najmu. "
              "Postanowienia dotyczące lokalu, które odbiegają od obecnej umowy najmu, zostały ujęte w nowym Potwierdzeniu Najmu, "
              "stanowiącym Załącznik I do niniejszego pisma. Prosimy o podpisanie jednego egzemplarza załączonego Potwierdzenia "
              "Najmu i odesłanie go do nas.", False)],
        19: [("Jeżeli ma Pan/Pani poważne zastrzeżenia wobec przeprowadzki do alternatywnego lokalu, prosimy o jak najszybsze "
              "poinformowanie nas o tym.", False)],
        21: [("Z poważaniem,", False)],
        28: [("Załącznik I: Potwierdzenie Najmu", False)],
    },
    "RO": {
        10: [("Privind: schimbarea locuinței și confirmarea noului contract de închiriere", True)],
        13: [(f"Stimată doamnă / Stimate domn {N},", False)],
        15: [(f"La data de {V} ați încheiat un contract de închiriere cu {VERHUURDER['naam']}.", False)],
        17: [("Conform articolului 1.3 din contractul de închiriere, Locatorul are dreptul de a vă oferi în mod unilateral o "
              "locuință alternativă, comparabilă cu locuința închiriată, ofertă pe care nu o puteți refuza în mod rezonabil. Prin "
              "prezenta vă informăm că Locatorul va face uz de această opțiune. Locatorul vă oferă prin prezenta, în mod unilateral, "
              f"începând cu data de {D}, o locuință alternativă comparabilă, situată la adresa {A}. Aceasta înseamnă că, începând "
              f"cu data de {D}, contractul dumneavoastră de închiriere actual încetează și se încheie un nou contract de închiriere "
              "în aceleași condiții ca și contractul actual. Prevederile privind locuința care diferă de contractul de închiriere "
              "actual sunt incluse într-o nouă Confirmare de închiriere, atașată la prezenta scrisoare ca Anexa I. Vă rugăm să "
              "semnați un exemplar al Confirmării de închiriere atașate și să ni-l returnați.", False)],
        19: [("Dacă aveți totuși obiecții serioase împotriva mutării în locuința alternativă, vă rugăm să ne anunțați cât mai "
              "curând posibil.", False)],
        21: [("Cu stimă,", False)],
        28: [("Anexa I: Confirmare de închiriere", False)],
    },
}
AKKOORD = {  # blok onder de huurbevestiging: (NL, vertaling)
    "titel": ("Voor akkoord huurder", {"EN": "Agreed by the tenant", "PL": "Zgoda najemcy", "RO": "De acord, chiriașul"}),
    "naam": ("Naam", {"EN": "Name", "PL": "Imię i nazwisko", "RO": "Nume"}),
    "datum": ("Datum", {"EN": "Date", "PL": "Data", "RO": "Data"}),
    "hand": ("Handtekening", {"EN": "Signature", "PL": "Podpis", "RO": "Semnătură"}),
}

def run(tekst_, vet=False, wit=False, grijs=False):
    r = etree.Element(q("r")); rpr = etree.SubElement(r, q("rPr"))
    etree.SubElement(rpr, q("rFonts")).attrib.update({q("ascii"): "Arial", q("hAnsi"): "Arial", q("cs"): "Arial"})
    if vet: etree.SubElement(rpr, q("b"))
    if grijs: etree.SubElement(rpr, q("i")); etree.SubElement(rpr, q("color")).set(q("val"), "808080"); etree.SubElement(rpr, q("sz")).set(q("val"), "16")
    if wit: etree.SubElement(rpr, q("color")).attrib.update({q("val"): "FFFFFF", q("themeColor"): "background1"})
    t = etree.SubElement(r, q("t")); t.text = tekst_; t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return r

def alinea(*runs, voor=0, na=0, pagina=False):
    p = etree.Element(q("p")); ppr = etree.SubElement(p, q("pPr"))
    etree.SubElement(ppr, q("spacing")).attrib.update({q("before"): str(voor), q("after"): str(na)})
    if pagina:
        r = etree.SubElement(p, q("r")); etree.SubElement(r, q("br")).set(q("type"), "page")
    for r in runs: p.append(r)
    return p

def label(sleutel, taal):
    nl, tr = AKKOORD[sleutel]
    return nl + (f" / {tr[taal]}" if taal != "NL" else "")

def huurbevestiging_blok(taal):
    """De body-elementen van 'Bijlage: Huurbevestiging' t/m het einde uit het contract-sjabloon van dezelfde taal."""
    pad = os.path.join(UIT, f"huurovereenkomst_{taal}.docx")
    doc = etree.fromstring(zipfile.ZipFile(pad).read("word/document.xml"))
    kids = [el for el in doc.find(q("body")) if el.tag != q("sectPr")]
    start = next(i for i, el in enumerate(kids)
                 if el.tag == q("p") and el.find(q("pPr") + "/" + q("pStyle")) is not None
                 and el.find(q("pPr") + "/" + q("pStyle")).get(q("val")) == "Kop1" and "Huurbevestiging" in tekst(el))
    blok = [copy.deepcopy(el) for el in kids[start:]]
    for el in blok:  # geen sectie-einden of 'last rendered'-markers meenemen
        for x in list(el.iter(q("sectPr"), q("lastRenderedPageBreak"))): x.getparent().remove(x)
    return blok

def maak(origineel, taal):
    zin = zipfile.ZipFile(origineel)
    doc = etree.fromstring(zin.read("word/document.xml"))
    body = doc.find(q("body"))
    paras = list(body.iter(q("p")))
    assert len(paras) == 29, f"onverwachte brief ({len(paras)} alinea's)"
    for h in list(doc.iter(q("highlight"))): h.getparent().remove(h)
    for i, (begin, waarden) in INVULLEN.items():
        assert tekst(paras[i]).lstrip().startswith(begin), f"alinea {i} begint niet met {begin!r}: {tekst(paras[i])[:50]!r}"
    for i, (begin, waarden) in INVULLEN.items():
        vervang_placeholders(paras[i], waarden)
    # e-mailregel: hele tekst vervangen door één invulpunt
    p = paras[EMAIL_ALINEA]; ts = list(p.iter(q("t")))
    assert tekst(p).startswith("Tevens verzonden per e-mail")
    ts[0].text = "{{E-mail regel}}"
    for t in ts[1:]: t.text = ""

    # "met [NAAM VERHUURDER]." -> geen dubbele punt na "B.V."
    for t in paras[15].iter(q("t")):
        if t.text and "B.V.." in t.text: t.text = t.text.replace("B.V..", "B.V.")
    if "B.V.." in tekst(paras[15]):  # punt in een losse run
        ts = [t for t in paras[15].iter(q("t")) if t.text]
        if ts[-1].text.strip() == "." : ts[-1].text = ""
    for i, stukken in VERTALING.get(taal, {}).items():
        nl_p = paras[i]
        nieuw = vertaal_alinea(nl_p, [list(s) for s in stukken], TAAL_CODE[taal], None, False)
        zet_keep_next(nl_p)
        nl_p.addnext(nieuw)

    # "Met vriendelijke groet" + handtekening + naam bij elkaar houden
    groet = paras[21]
    for el in [groet, groet.getnext(), paras[23], paras[25]]:
        if el is not None and el.tag == q("p"): zet_keep_next(el)
    # Overbodige witregels weg, zodat de brief (NL) op één pagina past
    for i in LEGE_ALINEAS:
        assert not tekst(paras[i]).strip(), f"alinea {i} is niet leeg"
        paras[i].getparent().remove(paras[i])

    bestanden = {}
    if os.path.exists(HANDTEKENING):
        voeg_handtekening_toe(zin, doc, paras[HANDTEKENING_ALINEA], bestanden)

    # Bijlage I op een nieuwe pagina, daaronder 'voor akkoord' huurder
    sect = body.find(q("sectPr"))
    blok = huurbevestiging_blok(taal)
    akkoord = [
        alinea(run(label("titel", taal), vet=True), voor=240, na=80),
        alinea(run(f"{label('naam', taal)}: {{{{Naam huurder}}}}"), na=80),
        alinea(run(f"{label('datum', taal)}: .............................."), na=80),
        alinea(run(f"{label('hand', taal)}: .................................................."), voor=360, na=0),
        alinea(run("#WNRhandtekening", wit=True)),
    ]
    # Slot van de huurbevestiging + akkoordblok bij elkaar op één pagina
    laatste = [el for el in blok if el.tag == q("p") and tekst(el).strip()][-2:]
    for el in laatste + akkoord[:-1]:
        zet_keep_next(el)
    for el in [alinea(pagina=True)] + blok + akkoord:
        sect.addprevious(el)
    schrijf(zin, doc, bestanden, f"brief_verhuizing_{taal}.docx", len(VERTALING.get(taal, {})))

if __name__ == "__main__":
    for taal in ["NL", "EN", "PL", "RO"]:
        maak(sys.argv[1], taal)
