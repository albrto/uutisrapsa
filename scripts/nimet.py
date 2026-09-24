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


def poimi_osallistujat_rss(kuvaus):
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
