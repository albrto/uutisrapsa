#!/usr/bin/env python3
"""
Tunnettujen toimittajien nimilistat ja RSS-kuvauksen osallistujaparseri.

Tämä on AINOA paikka, jossa nimilistoja ylläpidetään (yhdistetty 16.9.2026 —
aiemmin kopiot generoi_validointidata.py:ssä ja validoi_suosittelijat.py:ssä
piti pitää käsin synkassa, ja ne ehtivät jo eriytyä "milka"-mappauksen verran).
"""
import re

TUNNETUT_NIMET = [
    "Tuomas Peltomäki", "Salla Vuorikoski", "Marko Junkkari",
    "Jussi Niemeläinen", "Anna-Sofia Berner", "Alma Onali",
    "Rasmus Helaniemi", "Helmi Sundström", "Hanna Havusto",
    "John Helin", "Maria Manner", "Maria Pettersson",
    "Onni Niemi", "Joakim Westrén-Doll", "Alli Hallonblad",
    "Pekka Mykkänen", "Teemu Muhonen", "Paavo Teittinen",
    "Lari Malmberg", "Anni Keski-Heikkilä", "Anni Lassila",
    "Aino Frilander", "Timo R. Stewart", "Elina Kervinen",
    "Elli Harju", "Emil Elo", "Hanna Mahlamäki",
    "Hilla Körkkö", "Jarno Hartikainen", "Tommi Nieminen",
    "Ville Similä", "Venla Kuokkanen", "Toni Lehtinen",
    "Sara Vainio", "Susanne Salmi", "Niclas Storås",
    "Matti Apunen", "Pia Elonen", "Tuija Siltamäki",
    "Tuomas Niskakangas", "Julian Puumalainen",
    "Karoliina Knuuti", "Anni Huttunen",
    "Milka Valtanen", "Matilda Jokinen", "Iida Sofia Hirvonen",
    "Inkeri Harju", "Milla Palkoaho", "Oskari Eronen",
    "Jukka Huusko", "Joona Aaltonen", "Heini Pitkänen",
    "Irina Hasala", "Ilmo Ilkka", "Jantso Jokelin",
    "Alex af Heurlin", "Jaakko Lyytinen", "Harri Sulavuori",
    "Petja Pelli", "Suvi Turtiainen",
    "Pihla Saravirta", "Topi Kosunen", "Susanna Reinboth",
]

ETUNIMI_KARTTA = {
    "tuomas": "Tuomas Peltomäki",
    "salla": "Salla Vuorikoski",
    "marko": "Marko Junkkari",
    "jussi": "Jussi Niemeläinen",
    "anna-sofia": "Anna-Sofia Berner",
    "alma": "Alma Onali",
    "rasmus": "Rasmus Helaniemi",
    "helmi": "Helmi Sundström",
    "hanna": "Hanna Havusto",
    "john": "John Helin",
    # "Sohvi" on Anna-Sofia Bernerin lempinimi podcastissa (Sohvi Sirkesalo oli virheellinen haamunimi)
    "sohvi": "Anna-Sofia Berner",
    "maria": "Maria Manner",
    "onni": "Onni Niemi",
    "joakim": "Joakim Westrén-Doll",
    "alli": "Alli Hallonblad",
    "pekka": "Pekka Mykkänen",
    "teemu": "Teemu Muhonen",
    "paavo": "Paavo Teittinen",
    "lari": "Lari Malmberg",
    "milka": "Milka Valtanen",
    "julian": "Julian Puumalainen",
    # Anni Keski-Heikkilä oli podcastin vakiokasvo (ei enää HS:llä) —
    # pelkkä "Anni" vanhoissa jaksokuvauksissa viittaa häneen, ei Anni Lassilaan
    "anni": "Anni Keski-Heikkilä",
    "iida": "Iida Sofia Hirvonen",
    "pihla": "Pihla Saravirta",
    "topi": "Topi Kosunen",
    "susanna": "Susanna Reinboth",
}


def poimi_osallistujat_laajasti(kuvaus):
    """Vanha, löyhä parseri — käytetään vain varalla, kun kuvauksesta ei löydy
    "X, Y ja Z keskustelevat" -rakennetta. Etsii tunnetut koko nimet mistä tahansa
    kuvauksesta ja etunimet studio-/keskustelulauseista, joten se tuottaa helposti
    vääriä osallistujia aihetekstistä (ks. poimi_osallistujat_tiukasti)."""
    if not kuvaus:
        return []
    osallistujat = set()
    kuvaus_lower = kuvaus.lower()
    for nimi in TUNNETUT_NIMET:
        if nimi.lower() in kuvaus_lower:
            osallistujat.add(nimi)
    studio_patterns = [
        r'[Ss]tudiossa\s+([^.]+)',
        r'[Kk]eskustelevat\s+([^.]+)',
        # Nimet voivat olla myös ENNEN verbiä: "Sohvi, Marko ja Tommi keskustelevat..."
        r'([^.]+?)\s+keskustelevat',
    ]
    for pattern in studio_patterns:
        match = re.search(pattern, kuvaus)
        if match:
            lause = match.group(1)
            sanat = re.findall(r'\b([A-ZÄÖÅ][a-zäöåé]+(?:-[A-ZÄÖÅ][a-zäöåé]+)?)\b', lause)
            for sana in sanat:
                etunimi = sana.lower()
                if etunimi in ETUNIMI_KARTTA:
                    osallistujat.add(ETUNIMI_KARTTA[etunimi])
    return sorted(osallistujat)


# Verbit, joiden EDELLÄ jaksokuvauksessa luetellaan osallistujat
OSALLISTUJAVERBIT = (r'keskustelevat|keskustelee|juttelevat|juttelee|pohtivat|puhuvat|'
                     r'kertaavat|perkaavat|puivat|ruotivat')
# Lause rajataan vain [.!?]+välilyönti -kohdista: "HS:n" tai "P. Orpon" eivät katkaise
LAUSE = r'(?:[^.!?]|[.!?](?!\s))'
# Vierailijalause: "…ja vierailun tekee valtiontaloustietäjä Teemu Muhonen",
# "HS:n pääkirjoitustoimittaja Jussi Niemeläinen kertoo, …"
VIERAILU = re.compile(r'vierai|vieraa|saapuu|\bkertoo\b|\bkertovat\b', re.IGNORECASE)


def _sukunimen_vartalo(sukunimi):
    """Taivutusvartalo genetiivitäsmäykseen: Vainio→Vaini(on), Mahlamäki→Mahlamä(en),
    Lehtinen→Lehti(sen), Berner→Bern(erin)."""
    return sukunimi[:-3] if sukunimi.endswith("nen") else sukunimi[:-2]


def _nimet_osasta(osa, genetiivi_ok):
    """Poimii osallistujat yhdestä lauseen osasta. genetiivi_ok=True "… kanssa"
    -osalle, jossa nimet ovat taivutettuina ("Hanna Mahlamäen kanssa")."""
    loydetyt = set()
    for nimi in TUNNETUT_NIMET:
        # Sananraja estää "Marko Junkkarin hiihtolomaillessa" → Marko Junkkari
        if re.search(r'\b' + re.escape(nimi) + r'\b', osa, re.IGNORECASE):
            loydetyt.add(nimi)
        elif genetiivi_ok:
            etu, _, suku = nimi.rpartition(" ")
            if etu and re.search(r'\b' + re.escape(etu) + r'\s+' + re.escape(_sukunimen_vartalo(suku))
                                 + r'\w*', osa, re.IGNORECASE):
                loydetyt.add(nimi)
    sanat = list(re.finditer(r'\b([A-ZÄÖÅ][a-zäöåé]+(?:-[A-ZÄÖÅ][a-zäöåé]+)?)\b', osa))
    for i, m in enumerate(sanat):
        etunimi = m.group(1).lower()
        if etunimi not in ETUNIMI_KARTTA:
            continue
        tunnettu = ETUNIMI_KARTTA[etunimi]
        seuraava = sanat[i + 1] if i + 1 < len(sanat) else None
        if seuraava and osa[m.end():seuraava.start()].strip() == "":
            # Etunimeä seuraa sukunimi → tunnettu koko nimi (käsitelty yllä), sen
            # taivutusmuoto / kirjoitusvirhe tai kokonaan eri henkilö (vieras)
            sukunimi = seuraava.group(1)
            tunnettu_suku = tunnettu.split()[-1]
            if sukunimi == tunnettu_suku:
                continue
            if sukunimi.startswith(tunnettu_suku[:-1]):
                # Lyhyempi = kirjoitusvirhe ("Maria Manne") → osallistuja; pidempi =
                # taivutus ("Marko Junkkarin hiihtolomaillessa") → vain kanssa-osassa
                if genetiivi_ok or len(sukunimi) <= len(tunnettu_suku):
                    loydetyt.add(tunnettu)
                continue
            vieras = f"{m.group(1)} {sukunimi}"
            tunnettu_vieras = next((n for n in TUNNETUT_NIMET if n.startswith(vieras[:-2])), None)
            if tunnettu_vieras:
                loydetyt.add(tunnettu_vieras)
            elif not genetiivi_ok:
                # Tuntematon vieras hyväksytään vain verbiä edeltävästä subjektista
                # ("… ja Jussi Sippola keskustelevat"); kanssa-osasta löytyy muuten
                # esim. "Pekka Toverin (kok) sanoin … Venäjän kanssa"
                loydetyt.add(vieras)
        else:
            loydetyt.add(tunnettu)
    return loydetyt


def poimi_osallistujat_tiukasti(kuvaus):
    """Katsoo vain osallistujaverbiä edeltävää lauseen alkua ("Tuomas, Marko ja Salla
    keskustelevat …"), "… kanssa" -osaa sekä vierailijalauseiden tunnettuja koko nimiä.
    Vanha laaja parseri luki myös verbin jälkeisen aihetekstin, jolloin esim. "ilman
    Tuomas Peltomäkeä" tai "Teemu Luukan kirja" päätyivät sallituiksi suosittelijoiksi
    tuotannon promptiin (korjattu 27.9.2026; pohjana pipeline/pisteyta_jaksot.py).
    Palauttaa (osallistujat, varma); varma=False kun rakenteesta ei löytynyt nimiä ja
    käytettiin laajaa parseria."""
    teksti = re.sub(r'<[^>]+>', ' ', kuvaus or "")
    teksti = teksti.replace("&nbsp;", " ")
    osat = []
    for osuma in re.finditer(r'(' + LAUSE + r'*?)\s+(?:' + OSALLISTUJAVERBIT + r')\b(' + LAUSE + r'*)', teksti):
        # Kanssa voi olla verbin edellä ("yhdessä Anna-Sofia Bernerin kanssa keskustelevat")
        # tai jälkeen ("Salla keskustelee Hanna Mahlamäen ja Toni Lehtisen kanssa")
        ennen = re.match(r'(.*)\bkanssa\b(.*)', osuma.group(1))
        if ennen:
            osat += [(ennen.group(1), True), (ennen.group(2), False)]
        else:
            osat.append((osuma.group(1), False))
        kanssa = re.match(r'(.*?)\bkanssa\b', osuma.group(2))
        if kanssa:
            osat.append((kanssa.group(1), True))

    osallistujat = set()
    for osa, genetiivi_ok in osat:
        osallistujat |= _nimet_osasta(osa, genetiivi_ok)
    if not osallistujat:
        return poimi_osallistujat_laajasti(kuvaus), False
    for lause in re.split(r'[.!?]\s', teksti):
        if VIERAILU.search(lause):
            osallistujat |= {n for n in TUNNETUT_NIMET
                             if re.search(r'\b' + re.escape(n) + r'\b', lause, re.IGNORECASE)}
    return sorted(osallistujat), True


def poimi_osallistujat_rss(kuvaus):
    """Jakson osallistujat RSS-kuvauksesta (lista). Tuotanto syöttää tämän promptiin
    ainoina sallittuina suosittelijoina, joten väärä osallistuja on haitallisempi
    kuin puuttuva."""
    return poimi_osallistujat_tiukasti(kuvaus)[0]


def loytyy(suosittelija, rss_osallistujat):
    """Löyhä täsmäys: koko nimi, sukunimi tai etunimi (pituusrajoin)."""
    for osallistuja in rss_osallistujat:
        if suosittelija.lower() == osallistuja.lower():
            return True
        s = suosittelija.split()
        o = osallistuja.split()
        if s and o:
            if s[-1].lower() == o[-1].lower() and len(s[-1]) > 2:
                return True
            if s[0].lower() == o[0].lower() and len(s[0]) > 3:
                return True
    return False
