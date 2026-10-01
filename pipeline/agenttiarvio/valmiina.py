#!/usr/bin/env python3
"""Montako jonon jaksoa on litteroitu valmiiksi mutta ei vielä jaettu agenttien eriin.

  python3 valmiina.py ../tarkistusjono_loput.txt   → tulostaa luvun
Ei verkkoyhteyksiä (aaltojen odotussilmukka kutsuu tätä tiheään).
"""
import glob, json, os, re, sys

KANSIO = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.dirname(KANSIO)
JUURI = os.path.dirname(PIPELINE)

ids = [r.split()[-1] for r in open(sys.argv[1], encoding="utf-8") if r.strip() and not r.lstrip().startswith("#")]
tehty = {e["jakso_id"] for e in json.load(open(os.path.join(PIPELINE, "tarkistusehdotukset.json")))}
for f in glob.glob(os.path.join(KANSIO, "erat", "*.json")):
    tehty |= {j["jakso_id"] for j in json.load(open(f))}
n = 0
for i in ids:
    t = os.path.join(JUURI, "transkriptit", re.sub(r'[^A-Za-z0-9_-]', '_', i) + ".txt")
    if i not in tehty and os.path.exists(t) and os.path.getsize(t) >= 18000:
        n += 1
print(n)
