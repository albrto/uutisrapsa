#!/usr/bin/env python3
"""
Generoi validointi-JSON-tiedoston selainpohjaista validointisivua varten.
Sisältää kaikki epäilyttävät tapaukset audio URL:eineen ja kestoineen.

Tulos: admin/epailyttavat.json (ajetaan web-repon juuresta)
"""
import feedparser
import json
import re
import os

from nimet import TUNNETUT_NIMET, ETUNIMI_KARTTA, poimi_osallistujat_rss, loytyy

# Polut ankkuroidaan repon juureen, jotta skripti toimii ajokansiosta riippumatta
JUURI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUOSITUKSET = os.path.join(JUURI, "suositukset.json")
OHITUKSET = os.path.join(JUURI, "admin", "ohitukset.json")
RSS_URL = "https://feeds.captivate.fm/uutisraportti-podcast/"
TULOS = os.path.join(JUURI, "admin", "epailyttavat.json")

def kesto_sekunteina(kesto_str):
    """Muuntaa HH:MM:SS tai MM:SS → sekunnit"""
    if not kesto_str:
        return 0
    osat = kesto_str.strip().split(":")
    try:
        osat = [int(x) for x in osat]
        if len(osat) == 3:
            return osat[0] * 3600 + osat[1] * 60 + osat[2]
        elif len(osat) == 2:
            return osat[0] * 60 + osat[1]
        else:
            return int(osat[0])
    except:
        return 0


def main():
    print("Ladataan RSS-syöte...")
    feed = feedparser.parse(RSS_URL)

    # Rakenna RSS-kartta: id → {audio_url, kesto_sek, osallistujat, kuvaus}
    rss_kartta = {}
    for entry in feed.entries:
        entry_id = entry.get("id", "")
        otsikko = entry.get("title", "")
        kuvaus = entry.get("summary", "") or entry.get("description", "")
        kesto_str = entry.get("itunes_duration", "")
        kesto_sek = kesto_sekunteina(kesto_str)

        # Audio URL
        audio_url = ""
        for link in entry.get("links", []):
            if link.get("type", "").startswith("audio"):
                audio_url = link["href"]
                break

        osallistujat = poimi_osallistujat_rss(kuvaus)

        rss_kartta[entry_id] = {
            "otsikko": otsikko,
            "kuvaus": kuvaus[:400],
            "audio_url": audio_url,
            "kesto_sek": kesto_sek,
            "kesto_str": kesto_str,
            "osallistujat": osallistujat,
        }

    print(f"RSS: {len(feed.entries)} jaksoa ladattu.\n")

    # Lue suositukset
    with open(SUOSITUKSET, encoding="utf-8") as f:
        data = json.load(f)

    # Lataa ohitukset
    ohitukset_set = set()
    if os.path.exists(OHITUKSET):
        with open(OHITUKSET, encoding="utf-8") as f:
            for o in json.load(f):
                ohitukset_set.add((o.get("jakso_id", ""), o.get("r_idx", -1)))

    # Ryhmittele jaksot ja suositukset (sisältäen normaalit ja epäilyttävät)
    muokattavat_jaksot = {}
    
    total_jaksot = len(data)

    for i, jakso in enumerate(data):
        j_idx = total_jaksot - i
        jakso_id = jakso["id"]
        jakso_otsikko = jakso["jakso_otsikko"]

        rss_info = rss_kartta.get(jakso_id)
        if not rss_info:
            # Yritä otsikolla
            for rid, rinfo in rss_kartta.items():
                if rinfo["otsikko"] == jakso_otsikko:
                    rss_info = rinfo
                    break

        # Jos ei löydy RSS-infoa lainkaan, otetaan vain perusmalli suosituksista
        rss_osallistujat = rss_info["osallistujat"] if rss_info else []

        if jakso_id not in muokattavat_jaksot:
            muokattavat_jaksot[jakso_id] = {
                "j_idx": j_idx,
                "jakso_id": jakso_id,
                "jakso_otsikko": jakso_otsikko,
                "paivamaara": jakso.get("paivamaara", "?"),
                "audio_url": rss_info.get("audio_url", "") if rss_info else "",
                "kesto_sek": rss_info.get("kesto_sek", 0) if rss_info else 0,
                "kesto_str": rss_info.get("kesto_str", "") if rss_info else "",
                "rss_osallistujat": rss_osallistujat,
                "rss_kuvaus": rss_info.get("kuvaus", "") if rss_info else "",
                "suositukset": [],
            }

        for r_idx, rec in enumerate(jakso.get("suositukset", [])):
            suosittelija = rec.get("suosittelija", "")
            
            # Tarkistetaan onko tämä suositus epäilyttävä
            is_suspicious = False
            if suosittelija:
                if rss_osallistujat and not loytyy(suosittelija, rss_osallistujat):
                    is_suspicious = True
                # Tarkan kirjoitusasun invariantti: lähes oikea nimi (esim.
                # "Johnn Helin") ei saa mennä loytyy():n sukunimiosuman turvin
                # läpi — kaikki muut kuin täsmälleen tunnetut nimet liputetaan.
                if suosittelija != "tuntematon" and suosittelija not in TUNNETUT_NIMET:
                    is_suspicious = True
                if is_suspicious and (jakso_id, r_idx) in ohitukset_set:
                    is_suspicious = False
            
            # Lisää kaikki suositukset listaan (oli ne epäilyttäviä tai ei)
            # Rajoitetaan määrää hieman jos satoja, mutta tässä otetaan kaikki
            muokattavat_jaksot[jakso_id]["suositukset"].append({
                "r_idx": r_idx,
                "is_suspicious": is_suspicious,
                "suosittelija": suosittelija,
                "teos": rec.get("teos", "?"),
                "paakategoria": rec.get("paakategoria", ""),
                "kategoriat": rec.get("kategoriat", []),
                "kuvaus": rec.get("kuvaus", ""),
                "google_linkki": rec.get("google_linkki", ""),
                "lisatieto_linkki": rec.get("lisatieto_linkki", ""),
            })

    # Suodatetaan vain ne jaksot, joissa on suosituksia
    tuloslista = [j for j in muokattavat_jaksot.values() if j["suositukset"]]
    
    tuloslista.sort(key=lambda x: x["paivamaara"], reverse=True)

    os.makedirs(os.path.dirname(TULOS), exist_ok=True)
    with open(TULOS, "w", encoding="utf-8") as f:
        json.dump(tuloslista, f, ensure_ascii=False, indent=2)

    # Luo myös JS-versio, jota index.html lataa
    tulos_js = TULOS.replace(".json", ".js")
    with open(tulos_js, "w", encoding="utf-8") as f:
        f.write("window.VALIDATION_DATA = ")
        json.dump(tuloslista, f, ensure_ascii=False, indent=2)
        f.write(";\n")

    print(f"✅ Generoitu {len(tuloslista)} jaksoa.")
    n_epailyttavat = sum(sum(1 for r in j['suositukset'] if r['is_suspicious']) for j in tuloslista)
    print(f"   Yhteensä {n_epailyttavat} epäilyttävää suositusta.")
    print(f"   Tiedosto: {TULOS}")


if __name__ == "__main__":
    main()
