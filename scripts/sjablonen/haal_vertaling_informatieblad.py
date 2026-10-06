"""Haalt de vertaling uit een tweetalig informatieblad (Pivoton-versie: Nederlands met de
vertaling in grijs erachter) en schrijft vertalingen/informatieblad_<TAAL>.json, per
alinea-nummer van het Nederlandse origineel (zelfde opbouw als bij de huurovereenkomst).

    python haal_vertaling_informatieblad.py EN <Info blad Pivoton - Engels.docx> <origineel NL informatieblad .docx>

Nederlandse tekst en vertaling worden gescheiden op opmaak (vertaling = grijs, 808080).
Elke Nederlandse tekst wordt opgezocht in het origineel; tekst die daar niet in staat
(Pivoton-toevoegingen) wordt overgeslagen. Controleer vertalingen/controle_informatieblad_<TAAL>.txt.
"""
import json, re, sys
import haal_vertaling as hv
from haal_vertaling import q, alineas

hv.PLACEHOLDER = re.compile(r"\[[^\]]*\]|</?[A-Z_]+>|Klik of tik om (een datum|tekst) in te voeren\.?")
GRIJS = "808080"

# Correcties/aanvullingen per taal: NL-alinea -> vertaling (overschrijft de bron)
AANVULLING = {
    "EN": {
        # Pivoton EN laat de contactgegevens weg ("by email, by telephone, and by regular mail")
        53: "If you have complaints about the dwelling, have identified defects, or have other matters relating to "
            "the rented property, you can initially contact the landlord by email at info@ktp.nl, by telephone on "
            "053-7113495 and by regular mail at Kanaalstraat 217, 7547 AS Enschede. The landlord may also appoint a "
            "manager. In that case, you should initially contact the manager using the contact details provided for that purpose.",
        59: "In some cases, you can also take your complaint to the Rent Tribunal or the subdistrict court. More information "
            "can be found here: When can I go to the Rent Tribunal and when to the subdistrict court? | Government of the "
            "Netherlands. You should be aware that legislation, reporting points and website links may change from time to "
            "time. If you have any questions about this, you can contact the landlord.",
        40: "In the event of an emergency, such as a gas leak. In that case, the landlord may enter the dwelling without permission;",  # Pivoton: "the event of ..."
    },
    "PL": {
        # Pivoton: tweede deel van alinea 59 staat los; hier samengevoegd zoals in het origineel
        59: "W niektórych przypadkach ze swoją skargą mogą Państwo zwrócić się również do komisji ds. najmu lub do sądu "
            "rejonowego. Więcej informacji znajdą Państwo tutaj: Wanneer kan ik terecht bij de Huurcommissie en wanneer "
            "kan ik naar de kantonrechter? | Rijksoverheid.nl. Najemca powinien mieć świadomość, że przepisy, punkty "
            "zgłoszeń i linki do stron internetowych mogą się z czasem zmieniać. Jeśli mają Państwo pytania na ten temat, "
            "mogą Państwo skontaktować się z wynajmującym.",
        # Pivoton PL laat de linktekst weg ("tutaj:"); Nederlandse linktekst toegevoegd (link gaat naar Nederlandse site)
        35: "Więcej informacji o podwyżce czynszu znajdą Państwo tutaj: Welke regels gelden er voor een huurverhoging? | Rijksoverheid.nl",
        48: "Przegląd tego, z czym mogą Państwo zwrócić się do wynajmującego, a za co odpowiadają Państwo sami, można znaleźć "
            "tutaj: Welke kosten zijn voor de huurder en welke voor de verhuurder? | Rijksoverheid.nl",
        57: "Przegląd gminnych punktów zgłoszeń można znaleźć tutaj: Inventarisatie van gemeentelijke meldpunten en verhuurverordeningen (pdf)",
    },
    "RO": {
        59: "În unele cazuri, vă puteți adresa cu plângerea dumneavoastră și comisiei de chirii sau judecătorului cantonal. "
            "Mai multe informații găsiți aici: Când mă pot adresa Comisiei de chirii și când judecătorului cantonal? | Rijksoverheid.nl. "
            "Chiriașul trebuie să fie conștient că legislația, punctele de sesizare și linkurile către site-uri se pot schimba "
            "din când în când. Dacă aveți întrebări în această privință, vă puteți adresa proprietarului.",
    },
}

# Invulpunten in de vertaling (zelfde als in de Nederlandse tekst) en datums eruit
VERVANG = {
    "*": [
        (r"\[?<WERKNEMER>.*?</WERKNEMER>\]?", "{{Adres woning}}, {{Plaats woning}}"),
        (r"\[?<?INVUL_AANTAL_BEWONERS>\]?", "{{Max bewoners}}"),
        (r",?\s*(version|wersja|versiunea|versie)\s+\d{1,2}\s+\w+\s+\d{4}", ""),  # versiedatum pdf-link
        (r"\(pdf, 806 kB\)", "(pdf)"),
    ],
    "EN": [
        (r"bathroom, kitchen, toilet, entrance and storage space", "{{Voorzieningen EN}}"),
        (r"via website/contact details reporting point\.", "via: {{Meldpunt}}"),
    ],
    "PL": [
        (r"\{\{Plaats woning\}\}, Dzielą", "{{Plaats woning}}. Dzielą"),
        (r"łazienka, kuchnia, toaleta, wejście i schowek", "{{Voorzieningen PL}}"),
        (r"jest dostępny pod adresem\.", "jest dostępny pod adresem: {{Meldpunt}}"),
    ],
    "RO": [
        (r"baie, bucătărie, toaletă, intrare și spațiu de depozitare", "{{Voorzieningen RO}}"),
        (r"poate fi contactat la\.", "poate fi contactat la: {{Meldpunt}}"),
        (r"Kanaalstraat 217, 7547 AS, Enschede", "Kanaalstraat 217, 7547 AS Enschede"),
    ],
}

def eenheden(p):
    """Per regeleinde: (Nederlandse tekst, vertaal-runs [tekst, vet])."""
    uit, nl, tr = [], "", []
    for r in p.iter(q("r")):  # na het eerste grijze stuk hoort alles bij de vertaling (ook blauwe links)
        rpr = r.find(q("rPr"))
        kleur = rpr.find(q("color")) if rpr is not None else None
        grijs = kleur is not None and kleur.get(q("val"), "").upper() == GRIJS
        b = rpr.find(q("b")) if rpr is not None else None
        vet = b is not None and b.get(q("val")) not in ("0", "false")
        for el in r:
            if el.tag == q("br"):
                uit.append((nl, tr)); nl, tr = "", []
            elif el.tag in (q("t"), q("tab")):
                t = el.text or "" if el.tag == q("t") else " "
                if grijs or tr:
                    if tr and tr[-1][1] == vet: tr[-1][0] += t
                    else: tr.append([t, vet])
                else:
                    nl += t
    uit.append((nl, tr))
    return [(n, t) for n, t in uit if n.strip() or "".join(x for x, _ in t).strip()]

def schoon(runs):
    runs = [[re.sub(r"\s+", " ", t), v] for t, v in runs]
    if runs: runs[0][0] = runs[0][0].lstrip(); runs[-1][0] = runs[-1][0].rstrip()
    return [r for r in runs if r[0]]

def main(taal, bron, origineel):
    nl_p = alineas(origineel)
    nl_tekst = ["".join(t.text or "" for t in p.iter(q("t"))) for p in nl_p]
    uit, wacht, pos, niet = {}, None, 0, []
    for p in alineas(bron):
        for nl, tr in eenheden(p):
            if nl.strip():
                beste, idx = 0, None
                for j in range(pos, min(pos + 15, len(nl_tekst))):
                    g = hv.gelijkenis(nl, nl_tekst[j])
                    if g > beste: beste, idx = g, j
                if beste < 0.75:
                    niet.append(nl.strip()[:60]); wacht = None; continue
                pos = idx + 1; wacht = idx
            if wacht is not None and tr:
                uit.setdefault(wacht, []).extend(tr)
                wacht = None
    uit = {str(i): schoon(r) for i, r in uit.items()}
    for i, t in AANVULLING.get(taal, {}).items():
        uit[str(i)] = [[t, False]]
    for k, runs in uit.items():
        for r in runs:
            for patroon, nieuw in VERVANG["*"] + VERVANG.get(taal, []):
                r[0] = re.sub(patroon, nieuw, r[0])
    uit = dict(sorted(((k, v) for k, v in uit.items() if v), key=lambda kv: int(kv[0])))
    json.dump(uit, open(f"vertalingen/informatieblad_{taal}.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
    with open(f"vertalingen/controle_informatieblad_{taal}.txt", "w", encoding="utf8") as f:
        for i, t in enumerate(nl_tekst):
            if not t.strip(): continue
            f.write(f"{i:>4} NL: {t}\n")
            f.write(f"     {taal}: {''.join(x for x, _ in uit[str(i)]) if str(i) in uit else '!!! GEEN VERTALING'}\n")
    print(f"{taal}: {len(uit)} alinea's; niet in origineel (overgeslagen): {len(niet)}")
    for n in niet: print("   ?", n)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
