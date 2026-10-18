"""Kuuntelukohdat, vaihe 2: paikannuserät agenteille.

Jokaisesta jaksosta, jolla on aikaleimallinen transkriptio (vaihe 1, litteroi.py), poimitaan
suositusosio rivinumeroineen ja suositukset vihjeineen (scripts/kuuntelukohdat.py, sama teksti
kuin tuotannon paikannuksessa). Agentti (ohje.md) päättää lopullisen aloitusrivin.

Käyttö (pipeline/-kansiosta):
  ./venv/bin/python3 kuuntelukohdat/valmistele.py --koko 100   # erän koko kilotavuina
  → kuuntelukohdat/erat/era_N.txt
Jo paikannetut jaksot (tulokset/*.json ja kuuntelu.json) ohitetaan, joten ajon voi toistaa.
"""
import argparse
import glob
import json
import os
import sys

TAMA_KANSIO = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TAMA_KANSIO)
from litteroi import paa, tj  # noqa: E402
import kuuntelukohdat as kk  # noqa: E402  (scripts/, polku litteroi→tarkista_jaksot)

ERAT = os.path.join(TAMA_KANSIO, "erat")
TULOKSET = os.path.join(TAMA_KANSIO, "tulokset")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--koko", type=int, default=100, help="erän tavoitekoko kilotavuina")
    p.add_argument("--alku", type=int, default=1, help="ensimmäisen erän numero")
    args = p.parse_args()

    valmiit = set(kk.lue_kuuntelu())
    for f in glob.glob(os.path.join(TULOKSET, "*.json")):
        valmiit.update(json.load(open(f, encoding="utf-8")).keys())

    tekstit = []
    for j in tj.lue_json(tj.SUOSITUKSET, []):
        if j["id"] in valmiit or not any(not r.get("piilotettu") for r in j["suositukset"]):
            continue
        tpolku = paa.transkriptin_polku(j["id"])
        apolku = tj.ajat_polku(j["id"])
        if not (os.path.exists(tpolku) and os.path.exists(apolku)):
            continue
        rivit = open(tpolku, encoding="utf-8").read().split("\n")
        ajat = json.load(open(apolku, encoding="utf-8"))
        if len(ajat["rivit"]) != len(rivit):
            print(f"⚠️ rivimäärät eroavat, ohitetaan: {j['paivamaara']} {j['jakso_otsikko'][:50]}")
            continue
        tekstit.append(kk.jakson_teksti(j, rivit, ajat)[0])

    os.makedirs(ERAT, exist_ok=True)
    for f in glob.glob(os.path.join(ERAT, "era_*.txt")):
        os.remove(f)
    erat, nyt = [], []
    for t in tekstit:
        nyt.append(t)
        if sum(len(x.encode()) for x in nyt) >= args.koko * 1000:
            erat.append(nyt)
            nyt = []
    if nyt:
        erat.append(nyt)
    for n, era in enumerate(erat, args.alku):
        with open(os.path.join(ERAT, f"era_{n}.txt"), "w", encoding="utf-8") as f:
            f.write("\n\n".join(era) + "\n")
    print(f"{len(tekstit)} jaksoa, {len(erat)} erää (era_{args.alku}–era_{args.alku + len(erat) - 1}).")


if __name__ == "__main__":
    main()
