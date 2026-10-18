"""Kuuntelukohdat, vaihe 1: rivikohtaiset aikaleimat kaikille jaksoille.

Suosituksen soitin tarvitsee jokaisesta jaksosta transkriptin, jonka riveillä on alkuaika
(transkriptit/<id>.ajat.json). Ajat syntyvät vain Deepgramilla, joten jaksot, joilta
aikaleimat puuttuvat, litteroidaan uudelleen samalla leikkauksella kuin pääputki
(tarkista_jaksot.litteroi_ajoilla). Jo litteroidut ohitetaan, joten ajon voi keskeyttää.

Käyttö (pipeline/-kansiosta):
  ./venv/bin/python3 kuuntelukohdat/litteroi.py --kuiva     # mitä tehtäisiin
  ./venv/bin/python3 kuuntelukohdat/litteroi.py --maara 3   # kokeilu
  ./venv/bin/python3 kuuntelukohdat/litteroi.py             # kaikki puuttuvat
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import feedparser

TAMA_KANSIO = os.path.dirname(os.path.abspath(__file__))
PIPELINE_KANSIO = os.path.dirname(TAMA_KANSIO)
sys.path.insert(0, PIPELINE_KANSIO)
import tarkista_jaksot as tj  # noqa: E402
paa = tj.paa


def audio_osoitteet():
    """jakso_id → äänitiedoston osoite: RSS-syötteen enclosure, vanhoille Supla-jaksoille
    keraa_supla_audio_urlit.py:n kokoama lista."""
    osoitteet = {}
    for e in feedparser.parse(paa.RSS_URL).entries:
        for l in e.get("links", []):
            if l.get("rel") == "enclosure":
                osoitteet[e.id] = l.href
                break
    for e in tj.lue_json(os.path.join(PIPELINE_KANSIO, "supla_audio_urlit.json"), []):
        if e.get("audio_url"):
            osoitteet.setdefault(e["id"], e["audio_url"])
    return osoitteet


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--maara", type=int, default=0, help="enintään näin monta jaksoa")
    p.add_argument("--rinnakkain", type=int, default=3)
    p.add_argument("--kuiva", action="store_true")
    args = p.parse_args()

    data = tj.lue_json(tj.SUOSITUKSET, [])
    osoitteet = audio_osoitteet()
    jono, ei_audiota = [], []
    for j in data:
        if not any(not r.get("piilotettu") for r in j["suositukset"]):
            continue  # ei suosituksia → ei soitettavaa
        if os.path.exists(tj.ajat_polku(j["id"])):
            continue
        (jono if j["id"] in osoitteet else ei_audiota).append(j)
    if args.maara:
        jono = jono[:args.maara]
    print(f"Litteroitavia {len(jono)} jaksoa, ilman audio-osoitetta {len(ei_audiota)}.")
    for j in ei_audiota:
        print(f"  ei audiota: {j['paivamaara']} {j['jakso_otsikko'][:60]}")
    if args.kuiva or not jono:
        return

    minuutit, valmiit, virheet = 0.0, 0, []
    alku = time.time()

    def tee(j):
        return j, tj.litteroi_ajoilla(j["id"], osoitteet[j["id"]])

    with ThreadPoolExecutor(max_workers=args.rinnakkain) as pool:
        tulevat = [pool.submit(tee, j) for j in jono]
        for f in as_completed(tulevat):
            try:
                j, (teksti, min_) = f.result()
            except Exception as e:  # yksi epäonnistuminen ei kaada koko ajoa
                virheet.append(str(e)[:120])
                continue
            minuutit += min_ or 0
            if teksti and os.path.exists(tj.ajat_polku(j["id"])):
                valmiit += 1
            else:
                virheet.append(f"{j['paivamaara']} {j['jakso_otsikko'][:50]}")
            print(f"[{valmiit}/{len(jono)}] {j['paivamaara']} {j['jakso_otsikko'][:50]} "
                  f"({minuutit:.0f} min, ~{minuutit * tj.DEEPGRAM_MINUUTTIHINTA:.2f} $, {time.time() - alku:.0f} s)",
                  flush=True)
    print(f"\nValmis: {valmiit}/{len(jono)} jaksoa, {minuutit:.0f} min Deepgramia "
          f"(~{minuutit * tj.DEEPGRAM_MINUUTTIHINTA:.2f} $).")
    for v in virheet:
        print("  ⚠️", v)


if __name__ == "__main__":
    main()
