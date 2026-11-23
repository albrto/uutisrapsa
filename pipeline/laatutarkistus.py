"""Datan laatutarkistus: ilmainen raportti tyypillisistä virheistä repon juuren suositukset.json:ssa.

Kokoaa 23.11.2026 käsin tehdyt tarkistukset yhteen, jotta samat virheet huomataan, jos niitä
syntyy uudelleen (uudet jaksot, admin-korjaukset, tarkistuspäätökset). Ei muokkaa mitään,
ei tee verkko- eikä API-kutsuja. Teosryhmät lasketaan app.js:n omilla funktioilla (node),
jotta tulos vastaa sivun "N× suositeltu" -ryhmiä.

    ./venv/bin/python3 laatutarkistus.py          # kaikki tarkistukset
    ./venv/bin/python3 laatutarkistus.py --lyhyt  # vain määrät

Tarkistukset:
  kategoria     pääkategoria ei ole sallittujen listalla; podcastilta puuttuu alkupera
  linkit        vanhentuneet hakumuodot (areena …/search?q=, /haku?q=, supla.fi/search?q=),
                linkki ilman http(s):ää
  tuplajaksot   sama jakson otsikko tai täsmälleen sama suosituslista kahdesti
  tunnisteet    sama aihetunniste eri kirjainkoolla (yhdysvallat / Yhdysvallat)
  nimet         podcastin tekijän nimi kirjoitettu kuvauksessa lähes oikein ("Alma Unali")
  teosnimet     kaksi eri teosryhmää, joiden avaimet eroavat vain 1–2 merkillä
  kuuntelu      näkyvä suositus ilman kuuntelukohtaa kuuntelu.json:ssa
"""
import argparse
import difflib
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict

PIPELINE_KANSIO = os.path.dirname(os.path.abspath(__file__))
JUURI = os.path.dirname(PIPELINE_KANSIO)
sys.path.insert(0, os.path.join(JUURI, "scripts"))
from nimet import TUNNETUT_NIMET  # noqa: E402

SUOSITUKSET = os.path.join(JUURI, "suositukset.json")
KUUNTELU = os.path.join(JUURI, "kuuntelu.json")
KATEGORIAT = {"kirja", "elokuva", "tv-sarja", "podcast", "artikkeli", "musiikki", "ruoka",
              "kulttuuri", "urheilu", "muu"}
# Teosavainparit, jotka ovat tarkistetusti eri teoksia (ei raportoida)
ERI_TEOKSET = {frozenset(("believable", "unbelievable"))}
KUOLLEET_HAUT = re.compile(r"areena\.yle\.fi/(search|haku)\?q=|supla\.fi/search\?q=|hs\.fi/haku\?q=")
# Teosryhmien avaimet sivun omalla logiikalla (app.js: hakuNormalisoi, siistiTeos, teosAvain)
NODE_RYHMAT = r"""
const fs=require('fs');const src=fs.readFileSync(process.argv[1]+'/app.js','utf8');
const fn=n=>{const i=src.indexOf('function '+n+'(');if(i<0)throw new Error(n);
  const j=src.indexOf('\n}\n',i);return src.slice(i,j+2)};
eval(fn('hakuNormalisoi')+fn('siistiTeos')+fn('teosAvain')+';globalThis.teosAvain=teosAvain');
const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const out=[];
for(const j of d) j.suositukset.forEach((r,i)=>{ if(!r.piilotettu&&!r.antisuositus)
  out.push([j.id,i,teosAvain(r.teos)]); });
process.stdout.write(JSON.stringify(out));
"""


def nakyvat(data):
    for j in data:
        for i, r in enumerate(j["suositukset"]):
            if not r.get("piilotettu"):
                yield j, i, r


def tunniste(j, i, r):
    return f"{j['paivamaara']} r{i} {r['teos'][:55]}"


def tarkista(data, kuuntelu, tiedosto=SUOSITUKSET):
    L = defaultdict(list)

    for j, i, r in nakyvat(data):
        t = tunniste(j, i, r)
        if r.get("paakategoria") not in KATEGORIAT:
            L["kategoria"].append(f"{t}: pääkategoria {r.get('paakategoria')!r}")
        if r.get("paakategoria") == "podcast" and not r.get("alkupera"):
            L["kategoria"].append(f"{t}: podcastilta puuttuu alkupera")
        for kentta in ("lisatieto_linkki", "google_linkki"):
            l = r.get(kentta) or ""
            if l and KUOLLEET_HAUT.search(l):
                L["linkit"].append(f"{t}: vanhentunut hakumuoto {l}")
            elif l and not re.match(r"https?://\S+$", l):
                L["linkit"].append(f"{t}: outo {kentta} {l!r}")
        if str(i) not in kuuntelu.get(j["id"], {}).get("t", {}):
            L["kuuntelu"].append(t)

    # Tuplajaksot
    otsikot, listat = defaultdict(list), defaultdict(list)
    for j in data:
        teokset = tuple(sorted(re.sub(r"\W", "", r["teos"].lower())
                               for r in j["suositukset"] if not r.get("piilotettu")))
        if teokset:
            listat[teokset].append(j)
        otsikot[re.sub(r"^\d+\.\d+\.\d+:\s*", "", j["jakso_otsikko"]).strip().lower()].append(j)
    for ryhma in list(otsikot.values()) + list(listat.values()):
        nakyvia = [j for j in ryhma if any(not r.get("piilotettu") for r in j["suositukset"])]
        if len(nakyvia) > 1:
            L["tuplajaksot"].append(" / ".join(f"{j['paivamaara']} {j['id']}" for j in nakyvia))
    L["tuplajaksot"] = sorted(set(L["tuplajaksot"]))

    # Aihetunnisteet: kirjainkokoerot
    tagit = Counter(t for _, _, r in nakyvat(data) for t in r.get("kategoriat") or [])
    pienilla = defaultdict(set)
    for t in tagit:
        pienilla[t.strip().lower()].add(t)
    for muodot in pienilla.values():
        if len(muodot) > 1:
            L["tunnisteet"].append(" / ".join(f"{m} ({tagit[m]})" for m in sorted(muodot)))

    # Tekijöiden nimet kuvauksissa lähes oikein
    for j, i, r in nakyvat(data):
        for m in re.finditer(r"\b([A-ZÅÄÖ][a-zåäöé]+(?:-[A-ZÅÄÖ][a-zåäö]+)?) ([A-ZÅÄÖ][a-zåäöé]+)", r.get("kuvaus") or ""):
            sana = m.group(0)
            etu, suku = m.group(1), m.group(2)
            # Oikein, mahdollisesti taivutettuna: sama etunimi ja sukunimen alku
            # (Teittinen → Teittisen, Niskakangas → Niskakankaan)
            if any(n.split()[0] == etu and suku[:max(3, len(n.split()[-1]) - 3)] ==
                   n.split()[-1][:max(3, len(n.split()[-1]) - 3)] for n in TUNNETUT_NIMET):
                continue
            lahin = difflib.get_close_matches(sana, TUNNETUT_NIMET, 1, 0.82)
            if lahin and lahin[0].split()[0] == sana.split()[0] and \
                    difflib.SequenceMatcher(None, lahin[0].split()[1], m.group(2)).ratio() > 0.7:
                L["nimet"].append(f"{tunniste(j, i, r)}: {sana!r} → {lahin[0]}?")

    # Teosnimien lähes samat ryhmät (sivun omalla ryhmittelyllä)
    try:
        tulos = subprocess.run(["node", "-e", NODE_RYHMAT, JUURI, tiedosto], capture_output=True, text=True, check=True)
        ryhmat = defaultdict(set)
        for jid, i, avain in json.loads(tulos.stdout):
            ryhmat[avain].add((jid, i))
        avaimet = sorted(a for a in ryhmat if len(a) >= 5)
        nimi = {(j["id"], i): r["teos"] for j, i, r in nakyvat(data)}
        for x, a in enumerate(avaimet):
            for b in avaimet[x + 1:]:
                if abs(len(a) - len(b)) > 2 or frozenset((a, b)) in ERI_TEOKSET:
                    continue
                if difflib.SequenceMatcher(None, a, b).ratio() >= (0.9 if min(len(a), len(b)) >= 10 else 0.86):
                    ta = nimi[next(iter(ryhmat[a]))]
                    tb = nimi[next(iter(ryhmat[b]))]
                    L["teosnimet"].append(f"{ta!r} ↔ {tb!r}")
    except (OSError, subprocess.CalledProcessError) as e:
        L["teosnimet"].append(f"(ohitettu: node ei toiminut – {e})")

    return L


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--lyhyt", action="store_true")
    p.add_argument("--tiedosto", default=SUOSITUKSET, help="tarkistettava suositukset.json (oletus: repon juuri)")
    args = p.parse_args()
    data = json.load(open(args.tiedosto, encoding="utf-8"))
    kuuntelu = json.load(open(KUUNTELU, encoding="utf-8")) if os.path.exists(KUUNTELU) else {}
    L = tarkista(data, kuuntelu, args.tiedosto)
    for nimi in ("kategoria", "linkit", "tuplajaksot", "tunnisteet", "nimet", "teosnimet", "kuuntelu"):
        rivit = L.get(nimi, [])
        print(f"## {nimi}: {len(rivit)}")
        if not args.lyhyt:
            for r in rivit[:60]:
                print("   ", r)
            if len(rivit) > 60:
                print(f"    … ja {len(rivit) - 60} muuta")


if __name__ == "__main__":
    main()
