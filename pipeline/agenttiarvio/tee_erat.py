#!/usr/bin/env python3
"""Jakaa litteroidut, vielä arvioimattomat jaksot agenttien eriksi.

Ei API-kutsuja. Lukee jonotiedoston (pipeline/tarkistusjono_*.txt), ottaa mukaan vain
jaksot, joilla on pitkä (nykyleikkauksen) transkriptio ja joita ei ole vielä
tarkistusehdotukset.json:ssa eikä aiemmissa erissä. Erät: agenttiarvio/erat/aaltoN_eraM.json.

  ../venv/bin/python3 tee_erat.py ../tarkistusjono_parseri.txt --aalto 1 --erat 6 --max 36
"""
import argparse, glob, json, os, re, sys

import feedparser

KANSIO = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.dirname(KANSIO)
JUURI = os.path.dirname(PIPELINE)
sys.path.insert(0, os.path.join(JUURI, "scripts"))
from nimet import poimi_osallistujat_rss  # noqa: E402

LYHYT = 18000  # sama raja kuin tarkista_jaksot.LYHYT_TRANSKRIPTI


def transkriptio(jakso_id):
    return os.path.join(JUURI, "transkriptit", re.sub(r'[^A-Za-z0-9_-]', '_', jakso_id) + ".txt")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("jono")
    ap.add_argument("--aalto", type=int, required=True)
    ap.add_argument("--erat", type=int, default=6)
    ap.add_argument("--max", type=int, default=36)
    a = ap.parse_args()

    ids = [r.split()[-1] for r in open(a.jono, encoding="utf-8") if r.strip() and not r.lstrip().startswith("#")]
    tehty = {e["jakso_id"] for e in json.load(open(os.path.join(PIPELINE, "tarkistusehdotukset.json")))}
    for f in glob.glob(os.path.join(KANSIO, "erat", "*.json")):
        tehty |= {j["jakso_id"] for j in json.load(open(f))}
    live = {j["id"]: j for j in json.load(open(os.path.join(JUURI, "suositukset.json")))}
    rss = {e.id: (e.get("summary", "") or e.get("description", ""))
           for e in feedparser.parse("https://feeds.captivate.fm/uutisraportti-podcast/").entries}

    jaksot = []
    for i in ids:
        t = transkriptio(i)
        if i in tehty or i not in live or not os.path.exists(t) or os.path.getsize(t) < LYHYT:
            continue
        j = live[i]
        jaksot.append({"jakso_id": i, "paivamaara": j["paivamaara"], "otsikko": j["jakso_otsikko"],
                       "osallistujat": poimi_osallistujat_rss(rss.get(i, "")),
                       "rss_kuvaus": re.sub(r'<[^>]+>', ' ', rss.get(i, ""))[:1500],
                       "sivulla_nyt": [{"r_idx": n, "teos": r["teos"], "suosittelija": r["suosittelija"],
                                        "paakategoria": r.get("paakategoria", ""), "kuvaus": r.get("kuvaus", "")}
                                       for n, r in enumerate(j["suositukset"])],
                       "transkriptio": t, "merkkeja": os.path.getsize(t)})
        if len(jaksot) >= a.max:
            break

    os.makedirs(os.path.join(KANSIO, "erat"), exist_ok=True)
    erat = [[] for _ in range(min(a.erat, len(jaksot)) or 1)]
    for j in sorted(jaksot, key=lambda x: -x["merkkeja"]):
        min(erat, key=lambda e: sum(x["merkkeja"] for x in e)).append(j)
    for n, e in enumerate(erat, 1):
        if not e:
            continue
        polku = os.path.join(KANSIO, "erat", f"aalto{a.aalto}_era{n}.json")
        json.dump(e, open(polku, "w"), ensure_ascii=False, indent=1)
        print(f"{polku}: {len(e)} jaksoa, {sum(x['merkkeja'] for x in e) // 1000} k merkkiä")
    print(f"Yhteensä {len(jaksot)} jaksoa.")


if __name__ == "__main__":
    main()
