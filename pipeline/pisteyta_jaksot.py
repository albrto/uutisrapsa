"""Epäilyttävyyspisteytys: järjestää kaikki jaksot sen mukaan, kuinka todennäköisesti
niiden suosituksissa on virheitä. Ei API-kutsuja (vain RSS-syöte), joten ajo on ilmainen.

Pohjana käytetään repon juuren suositukset.json:ia (Actionsin ylläpitämä auktoriteetti),
ei pipeline/-kansion paikallista kopiota. Tulos: validointidata/pisteytys.json,
jota uudelleentarkistusajo voi käyttää jonona (korkein pistemäärä ensin).

    ./venv/bin/python3 pisteyta_jaksot.py            # tulostaa 40 kärkijaksoa
    ./venv/bin/python3 pisteyta_jaksot.py --kaikki   # tulostaa kaikki
"""
import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime

import feedparser

PIPELINE_KANSIO = os.path.dirname(os.path.abspath(__file__))
JUURI = os.path.dirname(PIPELINE_KANSIO)
sys.path.insert(0, os.path.join(JUURI, "scripts"))
from nimet import TUNNETUT_NIMET, ETUNIMI_KARTTA, poimi_osallistujat_rss, loytyy  # noqa: E402

RSS_URL = "https://feeds.captivate.fm/uutisraportti-podcast/"
SUOSITUKSET = os.path.join(JUURI, "suositukset.json")
KORJAUKSET = os.path.join(JUURI, "admin", "korjaukset.json")
OHITUKSET = os.path.join(JUURI, "admin", "ohitukset.json")
TRANSKRIPTIT = os.path.join(JUURI, "transkriptit")
TULOS = os.path.join(PIPELINE_KANSIO, "validointidata", "pisteytys.json")

# Kaksivaiheinen haku + puhujanäyttö otettiin käyttöön 25.8.2026; sitä vanhemmat
# jaksot on käsitelty vanhemmalla, heikommalla promptilla.
UUSI_PROMPTI_ALKAEN = datetime(2026, 8, 25)

ERIKOISJAKSO = re.compile(
    r'vaaliraportti|eurovaalit:|miniraportti|extra|spesiaali|reakti|q&a|kuulijakysym|'
    r'kooste|vuosikatsaus|special|ekstra|erikoisjakso|infoa|pikkujoulu|vaalikoju|avunpyyntö', re.IGNORECASE)


def lue_json(polku, oletus):
    try:
        with open(polku, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return oletus


def parsi_pvm(pvm):
    try:
        return datetime.strptime(pvm, "%d.%m.%Y")
    except (ValueError, TypeError):
        return None


def poimi_osallistujat_tiukasti(kuvaus):
    """Tiukempi kuin nimet.poimi_osallistujat_rss: katsoo vain lauseen alkua ennen
    verbiä ("Tuomas, Marko ja Salla keskustelevat …"). Jaettu parseri lukee myös
    verbin jälkeisen aihetekstin, jolloin esim. "ilman Tuomas Peltomäkeä" tai
    "Teemu Luukan kirja" tulkitaan osallistujiksi → vääriä 'ei suositusta' -hälytyksiä.
    Palauttaa (osallistujat, varma); varma=False kun rakennetta ei löytynyt ja
    käytettiin jaettua parseria."""
    teksti = re.sub(r'<[^>]+>', ' ', kuvaus or "")
    # Lause rajataan vain [.!?]+välilyönti -kohdista: "HS:n" tai "P. Orpon" eivät katkaise
    osuma = re.search(
        r'((?:[^.!?]|[.!?](?!\s))*?)\s+(keskustelevat|keskustelee|juttelevat|juttelee|pohtivat|puhuvat)\b'
        r'((?:[^.!?]|[.!?](?!\s))*)', teksti)
    if not osuma:
        return poimi_osallistujat_rss(kuvaus), False
    osat = [(osuma.group(1), False)]
    # "Salla keskustelee Hanna Mahlamäen ja Toni Lehtisen kanssa" → kanssa-osan nimet
    # ovat osallistujia genetiivissäkin
    kanssa = re.match(r'(.*?)\bkanssa\b', osuma.group(3))
    if kanssa:
        osat.append((kanssa.group(1), True))

    osallistujat = set()
    for osa, genetiivi_ok in osat:
        for nimi in TUNNETUT_NIMET:
            # Sananraja estää "Marko Junkkarin hiihtolomaillessa" → Marko Junkkari
            if re.search(r'\b' + re.escape(nimi) + r'\b', osa, re.IGNORECASE):
                osallistujat.add(nimi)
        sanat = list(re.finditer(r'\b([A-ZÄÖÅ][a-zäöåé]+(?:-[A-ZÄÖÅ][a-zäöåé]+)?)\b', osa))
        for i, m in enumerate(sanat):
            etunimi = m.group(1).lower()
            if etunimi not in ETUNIMI_KARTTA:
                continue
            tunnettu = ETUNIMI_KARTTA[etunimi]
            seuraava = sanat[i + 1] if i + 1 < len(sanat) else None
            if seuraava and osa[m.end():seuraava.start()].strip() == "":
                # Etunimeä seuraa sukunimi → joko tunnettu koko nimi (käsitelty yllä),
                # tunnetun nimen taivutusmuoto tai kokonaan eri henkilö (vieras)
                sukunimi = seuraava.group(1)
                tunnettu_suku = tunnettu.split()[-1]
                if sukunimi == tunnettu_suku:
                    continue
                if sukunimi.startswith(tunnettu_suku[:-1]):
                    if genetiivi_ok:
                        osallistujat.add(tunnettu)
                    continue
                vieras = f"{m.group(1)} {sukunimi}"
                osallistujat.add(next((n for n in TUNNETUT_NIMET if n.startswith(vieras[:-2])), vieras))
            else:
                osallistujat.add(tunnettu)
    return sorted(osallistujat), bool(osallistujat)


def transkriptin_nimi(jakso_id):
    return re.sub(r'[^A-Za-z0-9_-]', '_', jakso_id) + ".txt"


def pisteyta(jakso, rss, korjausmaara, ohitetut):
    """Palauttaa (pisteet, syyt). Painot on valittu niin, että 'suositus puuttuu'
    -tyyppiset signaalit painavat eniten — ne ovat yleisin ja näkymättömin virhe."""
    pisteet = 0
    syyt = []
    recs = jakso.get("suositukset", [])
    n = len(recs)
    otsikko = jakso.get("jakso_otsikko", "")
    kuvaus = (rss or {}).get("kuvaus", "")
    osallistujat, varma = poimi_osallistujat_tiukasti(kuvaus) if kuvaus else ([], False)
    paino = 3 if varma else 1  # epävarma osallistujalista → pienempi paino

    if "MAISTIAISJAKSO" in otsikko.upper() or "MAISTIAISJAKSO" in kuvaus.upper():
        return 0, ["maistiaisjakso (0 suositusta on normaalia)"]
    # Minisarjoissa ja erikoisjaksoissa (vaaliraportit, reaktiocastit, Q&A, koosteet)
    # ei ole suosituskierrosta → tyhjä jakso on odotettu, ei virhe
    if n == 0 and ERIKOISJAKSO.search(otsikko):
        return 0, ["erikoisjakso (0 suositusta on normaalia)"]

    if n == 0:
        pisteet += 5
        syyt.append("0 suositusta")

    # Osallistujat, joilta ei löydy yhtään suositusta
    if osallistujat:
        suosittelijat = [r.get("suosittelija", "") for r in recs]
        ilman = [o for o in osallistujat if not any(loytyy(s, [o]) for s in suosittelijat)]
        if ilman and n > 0:
            pisteet += paino * len(ilman)
            syyt.append(f"ei suositusta: {', '.join(ilman)}" + ("" if varma else " (osallistujat epävarmoja)"))
        # Sama henkilö useasti samalla kun joku jää ilman → mahdollinen puhujasekaannus
        toistot = [s for s, c in Counter(suosittelijat).items() if c > 1 and s != "tuntematon"]
        if toistot and ilman and varma:
            pisteet += 2
            syyt.append(f"useampi suositus: {', '.join(toistot)} (sekaannus?)")
    elif n == 1:
        pisteet += 2
        syyt.append("vain 1 suositus (osallistujia ei RSS:ssä)")

    # Nimi, joka ei ole osallistuja / ei tunnettu kirjoitusasu
    for r_idx, rec in enumerate(recs):
        s = rec.get("suosittelija", "")
        if (jakso["id"], r_idx) in ohitetut:
            continue
        if s == "tuntematon":
            pisteet += 2
            syyt.append(f"#{r_idx} tuntematon suosittelija")
        elif (s not in osallistujat) if varma else (s not in TUNNETUT_NIMET):
            pisteet += 2
            syyt.append(f"#{r_idx} epäilyttävä nimi: {s}")

    if n >= 7:
        pisteet += 1
        syyt.append(f"poikkeuksellisen monta suositusta ({n})")

    # Käsin tehdyt korjaukset: virheet kasautuvat samoihin jaksoihin
    if korjausmaara:
        pisteet += min(korjausmaara, 3)
        syyt.append(f"{korjausmaara} aiempaa korjausta")

    pvm = parsi_pvm(jakso.get("paivamaara"))
    if pvm and pvm < UUSI_PROMPTI_ALKAEN:
        pisteet += 1
        syyt.append("vanha prompti")
    if not rss:
        syyt.append("ei RSS:ssä (Supla-jakso)")

    return pisteet, syyt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--kaikki", action="store_true", help="tulosta kaikki jaksot")
    args = parser.parse_args()

    print("Ladataan RSS-syöte...")
    feed = feedparser.parse(RSS_URL)
    rss_kartta = {e.get("id", ""): {"otsikko": e.get("title", ""),
                                    "kuvaus": e.get("summary", "") or e.get("description", "")}
                  for e in feed.entries}
    rss_otsikot = {v["otsikko"]: v for v in rss_kartta.values()}

    data = lue_json(SUOSITUKSET, [])
    korjausmaarat = Counter(k.get("jakso_id") for k in lue_json(KORJAUKSET, []))
    ohitetut = {(o.get("jakso_id"), o.get("r_idx")) for o in lue_json(OHITUKSET, [])}
    transkriptit = set(os.listdir(TRANSKRIPTIT)) if os.path.isdir(TRANSKRIPTIT) else set()

    tulos = []
    for jakso in data:
        rss = rss_kartta.get(jakso["id"]) or rss_otsikot.get(jakso.get("jakso_otsikko"))
        pisteet, syyt = pisteyta(jakso, rss, korjausmaarat.get(jakso["id"], 0), ohitetut)
        tulos.append({
            "jakso_id": jakso["id"],
            "paivamaara": jakso.get("paivamaara", ""),
            "jakso_otsikko": jakso.get("jakso_otsikko", ""),
            "suosituksia": len(jakso.get("suositukset", [])),
            "osallistujat_rss": poimi_osallistujat_tiukasti(rss["kuvaus"])[0] if rss else [],
            "pisteet": pisteet,
            "syyt": syyt,
            "transkriptio_valmiina": transkriptin_nimi(jakso["id"]) in transkriptit,
        })

    # Pisteet laskevasti; tasapisteissä uudempi ensin (kiinnostavampi lukijoille)
    tulos.sort(key=lambda t: (-t["pisteet"], -(parsi_pvm(t["paivamaara"]) or datetime.min).timestamp()))

    os.makedirs(os.path.dirname(TULOS), exist_ok=True)
    with open(TULOS, "w", encoding="utf-8") as f:
        json.dump(tulos, f, ensure_ascii=False, indent=2)

    jakauma = Counter(min(t["pisteet"], 10) for t in tulos)
    print(f"\n✅ Pisteytetty {len(tulos)} jaksoa → {TULOS}")
    print("Pistejakauma (10 = 10+): " + ", ".join(f"{p}: {jakauma[p]}" for p in sorted(jakauma)))
    for raja in (8, 5, 3):
        valitut = [t for t in tulos if t["pisteet"] >= raja]
        ilman_tr = sum(not t["transkriptio_valmiina"] for t in valitut)
        print(f"  ≥{raja} pistettä: {len(valitut)} jaksoa ({ilman_tr} vaatii uuden litteroinnin)")

    print()
    for t in tulos if args.kaikki else tulos[:40]:
        tr = "📄" if t["transkriptio_valmiina"] else "  "
        print(f"{t['pisteet']:>3} {tr} {t['paivamaara']:>10}  {t['jakso_otsikko'][:60]}")
        print(f"            {'; '.join(t['syyt'])}")


if __name__ == "__main__":
    main()
