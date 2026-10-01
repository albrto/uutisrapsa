#!/usr/bin/env python3
"""Toisen mielipiteen kierros: erät agenteille ja tulosten yhdistäminen.

  ../venv/bin/python3 varmistus.py erat --kierros 1 --erat 6 --jaksoja 8
      → varmistus/erat/kierros1_eraM.json (avoimet, varmistamattomat ehdotukset)
  ../venv/bin/python3 varmistus.py yhdista [--kirjoita]
      → tarkistusarviot.json: arviot[avain]["toinen"] = {kanta, perustelu, korjaus}

Agentit noudattavat ohjetta ohje_varmistus.md. Ei API-kutsuja; ei päätöksiä.
"""
import argparse, glob, json, os, re, sys

KANSIO = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.dirname(KANSIO)
JUURI = os.path.dirname(PIPELINE)
EHDOTUKSET = os.path.join(PIPELINE, "tarkistusehdotukset.json")
PAATOKSET = os.path.join(PIPELINE, "tarkistuspaatokset.json")
ARVIOT = os.path.join(PIPELINE, "tarkistusarviot.json")
ERAT = os.path.join(KANSIO, "varmistus", "erat")
TULOKSET = os.path.join(KANSIO, "varmistus", "tulokset")
sys.path.insert(0, KANSIO)
from yhdista import ero_avain, kirjoita  # noqa: E402


def lue(polku, oletus):
    try:
        return json.load(open(polku, encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return oletus


def tee_erat(a):
    paatokset, arviot = lue(PAATOKSET, {}), lue(ARVIOT, {})
    jaossa = set()
    for f in glob.glob(os.path.join(ERAT, "*.json")):
        for j in lue(f, []):
            jaossa |= {e["avain"] for e in j["ehdotukset"]}
    live = {j["id"]: j for j in lue(os.path.join(JUURI, "suositukset.json"), [])}
    jaksot = []
    for e in lue(EHDOTUKSET, []):
        avoimet = []
        for x in e["erot"]:
            k = ero_avain(e["jakso_id"], x)
            if k in paatokset or k in jaossa or "toinen" in arviot.get(k, {}):
                continue
            ens = arviot.get(k, {})
            avoimet.append({"avain": k, "tyyppi": x["tyyppi"], "r_idx": x.get("r_idx"), "teos": x.get("teos"),
                            "vanha": x.get("vanha"), "uusi": x.get("uusi"),
                            "uusi_data": (ens.get("data") if ens.get("suositus") == "hyvaksy" else None) or x.get("uusi_data"),
                            "ensimmaisen_perustelu": ens.get("perustelu", "")})
        t = os.path.join(JUURI, "transkriptit", re.sub(r'[^A-Za-z0-9_-]', '_', e["jakso_id"]) + ".txt")
        if not avoimet or e["jakso_id"] not in live or not os.path.exists(t):
            continue
        jaksot.append({"jakso_id": e["jakso_id"], "paivamaara": e["paivamaara"], "otsikko": e["jakso_otsikko"],
                       "osallistujat": e.get("osallistujat_tiukka") or e.get("osallistujat_rss") or [],
                       "sivulla_nyt": [{"r_idx": n, "teos": r["teos"], "suosittelija": r["suosittelija"],
                                        "kuvaus": r.get("kuvaus", "")} for n, r in enumerate(live[e["jakso_id"]]["suositukset"])],
                       "transkriptio": t, "ehdotukset": avoimet})
    jaksot = jaksot[: a.erat * a.jaksoja]
    os.makedirs(ERAT, exist_ok=True)
    for n in range(a.erat):
        osa = jaksot[n::a.erat]
        if not osa:
            continue
        polku = os.path.join(ERAT, f"kierros{a.kierros}_era{n + 1}.json")
        json.dump(osa, open(polku, "w"), ensure_ascii=False, indent=1)
        print(f"{polku}: {len(osa)} jaksoa, {sum(len(j['ehdotukset']) for j in osa)} ehdotusta")
    print(f"Yhteensä {len(jaksot)} jaksoa, {sum(len(j['ehdotukset']) for j in jaksot)} ehdotusta.")


def yhdista(a):
    arviot = lue(ARVIOT, {})
    laskuri, ongelmat = {}, []
    for f in sorted(glob.glob(os.path.join(TULOKSET, "*.json"))):
        for t in lue(f, []):
            k, kanta = t.get("avain"), t.get("kanta")
            if kanta not in ("vahvistaa", "kiistaa", "epavarma"):
                ongelmat.append(f"{os.path.basename(f)}: outo kanta {kanta} ({k})"); continue
            arviot.setdefault(k, {"suositus": None})["toinen"] = {
                "kanta": kanta, "perustelu": t.get("perustelu", ""), "korjaus": t.get("korjaus") or None}
            laskuri[kanta] = laskuri.get(kanta, 0) + 1
    print("Toisia mielipiteitä:", laskuri)
    for o in ongelmat:
        print("  ⚠️", o)
    if a.kirjoita:
        kirjoita(ARVIOT, arviot)
        print(f"✅ Kirjoitettu → {ARVIOT}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="komento", required=True)
    e = sub.add_parser("erat"); e.add_argument("--kierros", type=int, required=True)
    e.add_argument("--erat", type=int, default=6); e.add_argument("--jaksoja", type=int, default=8)
    y = sub.add_parser("yhdista"); y.add_argument("--kirjoita", action="store_true")
    a = ap.parse_args()
    tee_erat(a) if a.komento == "erat" else yhdista(a)
