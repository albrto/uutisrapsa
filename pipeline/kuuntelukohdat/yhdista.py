"""Kuuntelukohdat, vaihe 3: agenttien rivinumerot (tulokset/*.json) → repon juuren kuuntelu.json.

Rivin aika muunnetaan jakson sekunneiksi (scripts/kuuntelukohdat.py). Olemassa olevat jaksot
säilyvät; tuloksissa olevat korvataan.

Käyttö (pipeline/-kansiosta):
  ./venv/bin/python3 kuuntelukohdat/yhdista.py            # tarkistus + yhteenveto
  ./venv/bin/python3 kuuntelukohdat/yhdista.py --kirjoita
"""
import argparse
import glob
import json
import os
import sys

TAMA_KANSIO = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TAMA_KANSIO)
from litteroi import audio_osoitteet, tj  # noqa: E402
import kuuntelukohdat as kk  # noqa: E402


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--kirjoita", action="store_true")
    args = p.parse_args()

    data = {j["id"]: j for j in tj.lue_json(tj.SUOSITUKSET, [])}
    tulokset = {}
    for f in sorted(glob.glob(os.path.join(TAMA_KANSIO, "tulokset", "*.json"))):
        tulokset.update(json.load(open(f, encoding="utf-8")))
    osoitteet = audio_osoitteet()

    kuuntelu = kk.lue_kuuntelu()
    kohtia = nulleja = 0
    for jid, kohdat in tulokset.items():
        if jid not in data or jid not in osoitteet:
            print(f"  ⚠️ tuntematon jakso tai ei audiota: {jid}")
            continue
        ajat = json.load(open(tj.ajat_polku(jid), encoding="utf-8"))
        t = kk.kohdat_sekunteina(kohdat, data[jid], ajat)
        nulleja += sum(1 for v in kohdat.values() if v is None)
        hylatyt = len(kohdat) - len(t) - sum(1 for v in kohdat.values() if v is None)
        if hylatyt:
            print(f"  ⚠️ {data[jid]['paivamaara']}: {hylatyt} virheellistä kohtaa")
        kohtia += len(t)
        if t:
            kuuntelu[jid] = {"a": osoitteet[jid], "k": round(ajat["leike"]["kesto_s"], 1), "t": t}

    recs = sum(1 for j in data.values() for r in j["suositukset"] if not r.get("piilotettu"))
    kaikki = sum(len(v["t"]) for v in kuuntelu.values())
    print(f"Tuloksia {len(tulokset)} jaksosta: {kohtia} kohtaa, {nulleja} null.")
    print(f"kuuntelu.json kattaa {kaikki}/{recs} suositusta ({len(kuuntelu)} jaksoa).")
    if args.kirjoita:
        kk.tallenna_kuuntelu(kuuntelu)
        print(f"Kirjoitettu {kk.KUUNTELU_TIEDOSTO} ({os.path.getsize(kk.KUUNTELU_TIEDOSTO) // 1000} kt).")


if __name__ == "__main__":
    main()
