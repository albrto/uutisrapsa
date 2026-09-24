#!/usr/bin/env python3
"""
Interaktiivinen korjausskripti: Käy läpi epäilyttävät suosittelijamerkinnät
ja antaa käyttäjän korjata ne yksi kerrallaan.

Käyttö: python3 korjaa_suosittelijat_interaktiivisesti.py
"""
import feedparser
import json
import re
import os
import sys

# Polut ankkuroidaan tiedoston omaan sijaintiin, jotta kansion voi nimetä/siirtää vapaasti
PIPELINE_KANSIO = os.path.dirname(os.path.abspath(__file__))
SUOSITUKSET_TIEDOSTO = os.path.join(PIPELINE_KANSIO, "suositukset.json")
RSS_URL = "https://feeds.captivate.fm/uutisraportti-podcast/"

TUNNETUT_NIMET = [
    "Tuomas Peltomäki", "Salla Vuorikoski", "Marko Junkkari",
    "Jussi Niemeläinen", "Anna-Sofia Berner", "Alma Onali",
    "Rasmus Helaniemi", "Helmi Sundström", "Hanna Havusto",
    "John Helin", "Sohvi Sirkesalo", "Maria Manner", "Maria Pettersson",
    "Onni Niemi", "Joakim Westrén-Doll", "Alli Hallonblad",
    "Pekka Mykkänen", "Teemu Muhonen", "Paavo Teittinen",
    "Lari Malmberg", "Anni Keski-Heikkilä", "Anni Lassila",
    "Aino Frilander", "Timo R. Stewart", "Elina Kervinen",
    "Elli Harju", "Emil Elo", "Hanna Mahlamäki",
    "Hilla Körkkä", "Jarno Hartikainen", "Tommi Nieminen",
    "Ville Similä", "Venla Kuokkanen", "Toni Lehtinen",
    "Sara Vainio", "Susanna Salmi", "Niklas Storås",
    "Matti Apunen", "Pia Elonen", "Tuija Siltamäki",
    "Tuomas Niskakangas", "Julian Puumalainen",
    "Karoliina Knuuti", "Anni Huttunen",
    "Milka Valtanen", "Matilda Jokinen", "Ida-Sofia Hirvonen",
    "Inkeri Harju", "Milla Palkoaho", "Oskari Eronen",
    "Jukka Huusko", "Joona Aaltonen", "Heini Pitkänen",
    "Irina Hala", "Ilmo Ilkka", "Jantso Jokelin",
    "Aleksi Af Heurlin", "Jaakko Lyytinen", "Harri Sulavuori",
    "Petja Pelli", "Suvi Turtiainen",
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
    "sohvi": "Sohvi Sirkesalo",
    "maria": "Maria Manner",
    "onni": "Onni Niemi",
    "joakim": "Joakim Westrén-Doll",
    "alli": "Alli Hallonblad",
    "pekka": "Pekka Mykkänen",
    "teemu": "Teemu Muhonen",
    "paavo": "Paavo Teittinen",
    "lari": "Lari Malmberg",
    "julian": "Julian Puumalainen",
    "anni": "Anni Lassila",
}


def poimi_osallistujat_rss(kuvaus):
    """Poimii jaksokuvauksesta vain tunnetut nimet."""
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
    ]
    for pattern in studio_patterns:
        match = re.search(pattern, kuvaus)
        if match:
            lause = match.group(1)
            sanat = re.findall(r'\b([A-ZÄÖÅ][a-zäöåé-]+)\b', lause)
            for sana in sanat:
                etunimi = sana.lower()
                if etunimi in ETUNIMI_KARTTA:
                    osallistujat.add(ETUNIMI_KARTTA[etunimi])
    return sorted(osallistujat)


def loytyy_suosittelijana(suosittelija, rss_osallistujat):
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


def lataa_rss():
    print("Ladataan RSS-syöte...")
    feed = feedparser.parse(RSS_URL)
    rss_kartta = {}
    for entry in feed.entries:
        otsikko = entry.get("title", "")
        kuvaus = entry.get("summary", "") or entry.get("description", "")
        entry_id = entry.get("id", "")
        osallistujat = poimi_osallistujat_rss(kuvaus)
        if osallistujat:
            rss_kartta[entry_id] = {
                "otsikko": otsikko,
                "osallistujat": osallistujat,
                "kuvaus_pala": kuvaus[:300],
            }
    print(f"RSS: {len(feed.entries)} jaksoa, {len(rss_kartta)} jaksosta löytyi osallistujatietoa.\n")
    return rss_kartta


def etsi_rss_jakso(jakso_id, jakso_otsikko, rss_kartta):
    rss_info = rss_kartta.get(jakso_id)
    if not rss_info:
        for rid, rinfo in rss_kartta.items():
            if rinfo["otsikko"] == jakso_otsikko:
                return rinfo
    return rss_info


def main():
    rss_kartta = lataa_rss()

    with open(SUOSITUKSET_TIEDOSTO, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Kerää epäilyttävät
    epailyttavat = []
    for j_idx, jakso in enumerate(data):
        jakso_id = jakso["id"]
        jakso_otsikko = jakso["jakso_otsikko"]
        rss_info = etsi_rss_jakso(jakso_id, jakso_otsikko, rss_kartta)
        if not rss_info or not rss_info["osallistujat"]:
            continue
        rss_osallistujat = rss_info["osallistujat"]
        for r_idx, rec in enumerate(jakso.get("suositukset", [])):
            suosittelija = rec.get("suosittelija", "")
            if not suosittelija:
                continue
            if not loytyy_suosittelijana(suosittelija, rss_osallistujat):
                epailyttavat.append({
                    "j_idx": j_idx,
                    "r_idx": r_idx,
                    "jakso_otsikko": jakso_otsikko,
                    "paivamaara": jakso.get("paivamaara", "?"),
                    "rss_osallistujat": rss_osallistujat,
                    "suosittelija": suosittelija,
                    "teos": rec.get("teos", "?"),
                    "kuvaus": rec.get("kuvaus", "")[:150],
                    "rss_kuvaus": rss_info.get("kuvaus_pala", ""),
                })

    print(f"Löydettiin {len(epailyttavat)} epäilyttävää tapausta.\n")
    print("Käyn ne läpi. Komennot:")
    print("  [Enter]      = Jätä ennalleen (ei korjausta)")
    print("  [numero]     = Vaihda suosittelijaksi ehdotettu osallistuja (1, 2, ...)")
    print("  [nimi]       = Kirjoita uusi suosittelijan nimi vapaasti")
    print("  s            = Ohita (skip)")
    print("  q            = Lopeta ja tallenna\n")
    print("=" * 70)

    muutokset = 0
    for i, ep in enumerate(epailyttavat, 1):
        print(f"\n--- {i}/{len(epailyttavat)} ---")
        print(f"JAKSO:       {ep['paivamaara']} – {ep['jakso_otsikko']}")
        print(f"RSS-kuvaus:  {ep['rss_kuvaus'][:200]}...")
        print(f"RSS-osallistujat: {', '.join(ep['rss_osallistujat'])}")
        print(f"⚠️  Suosittelija: \"{ep['suosittelija']}\"")
        print(f"   Teos:     {ep['teos']}")
        print(f"   Kuvaus:   {ep['kuvaus']}...")
        print()
        for k, os_nimi in enumerate(ep['rss_osallistujat'], 1):
            print(f"  [{k}] {os_nimi}")
        print()

        try:
            vastaus = input("Valinta: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nKeskeytys – tallennetaan muutokset.")
            break

        if vastaus.lower() == 'q':
            print("Lopetetaan.")
            break
        elif vastaus.lower() == 's' or vastaus == '':
            print("  → Jätetään ennalleen.")
            continue
        elif vastaus.isdigit():
            nro = int(vastaus)
            if 1 <= nro <= len(ep['rss_osallistujat']):
                uusi_nimi = ep['rss_osallistujat'][nro - 1]
                data[ep['j_idx']]["suositukset"][ep['r_idx']]["suosittelija"] = uusi_nimi
                print(f"  ✅ Vaihdettu: \"{ep['suosittelija']}\" → \"{uusi_nimi}\"")
                muutokset += 1
            else:
                print("  ⚠️ Virheellinen numero, jätetään ennalleen.")
        else:
            # Vapaa tekstisyöte
            uusi_nimi = vastaus
            data[ep['j_idx']]["suositukset"][ep['r_idx']]["suosittelija"] = uusi_nimi
            print(f"  ✅ Vaihdettu: \"{ep['suosittelija']}\" → \"{uusi_nimi}\"")
            muutokset += 1

    # Tallenna
    if muutokset > 0:
        # Varmuuskopio ennen tallennusta
        import shutil
        varmuus_polku = SUOSITUKSET_TIEDOSTO.replace(".json", f"_backup.json")
        shutil.copy2(SUOSITUKSET_TIEDOSTO, varmuus_polku)
        print(f"\n💾 Varmuuskopio tallennettu: {varmuus_polku}")

        with open(SUOSITUKSET_TIEDOSTO, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"✅ Tallennettu {muutokset} korjausta tiedostoon: {SUOSITUKSET_TIEDOSTO}")
    else:
        print("\nEi muutoksia tehty.")


if __name__ == "__main__":
    main()
