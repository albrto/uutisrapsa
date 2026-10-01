#!/usr/bin/env python3
"""Siirtää agenttien tulokset (agenttiarvio/tulokset/*.json) tarkistusnäkymään.

Jokainen jakso → yksi merkintä tarkistusehdotukset.json:iin (erot = AVOIMIA ehdotuksia)
ja jokainen ero → Clauden SUOSITUS tarkistusarviot.json:iin. Päätöksiä ei kirjoiteta:
käyttäjä hyväksyy tai hylkää jokaisen itse. Ei API-kutsuja.

  ../venv/bin/python3 yhdista.py            # kuivaharjoitus: näyttää ongelmat
  ../venv/bin/python3 yhdista.py --kirjoita
"""
import glob, json, os, sys
from datetime import datetime

KANSIO = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.dirname(KANSIO)
EHDOTUKSET = os.path.join(PIPELINE, "tarkistusehdotukset.json")
ARVIOT = os.path.join(PIPELINE, "tarkistusarviot.json")
KATEGORIAT = {"kirja", "elokuva", "tv-sarja", "podcast", "artikkeli", "musiikki", "ruoka", "kulttuuri", "urheilu", "muu"}
PAKOLLISET = {"suosittelija": ["suosittelija"], "teos": ["teos"],
              "puuttuu": ["teos", "suosittelija", "kuvaus", "paakategoria"], "ylimaarainen": []}
SUOSITUS = {"suosittelija": "hyvaksy", "teos": "hyvaksy", "puuttuu": "hyvaksy", "ylimaarainen": "poista"}


def ero_avain(jakso_id, ero):
    """Sama kuin tarkistus/palvelin.py:n ero_avain."""
    kohde = ero.get("r_idx") if ero.get("r_idx") is not None else (ero.get("teos") or "").strip().lower()
    return f"{jakso_id}::{ero['tyyppi']}::{kohde}"


def kirjoita(polku, data):
    json.dump(data, open(polku + ".tmp", "w"), ensure_ascii=False, indent=2)
    os.replace(polku + ".tmp", polku)


def main():
    syotteet = {}
    for f in glob.glob(os.path.join(KANSIO, "erat", "*.json")):
        for j in json.load(open(f)):
            syotteet[j["jakso_id"]] = j
    ehdotukset = json.load(open(EHDOTUKSET))
    arviot = json.load(open(ARVIOT)) if os.path.exists(ARVIOT) else {}
    olemassa = {e["jakso_id"] for e in ehdotukset}

    uudet, ongelmat, laskuri = [], [], {}
    for f in sorted(glob.glob(os.path.join(KANSIO, "tulokset", "*.json"))):
        for t in json.load(open(f)):
            jid = t.get("jakso_id")
            if jid not in syotteet:
                ongelmat.append(f"{os.path.basename(f)}: tuntematon jakso {jid}")
                continue
            if jid in olemassa:
                continue
            s = syotteet[jid]
            erot, nahdyt = [], set()
            for x in t.get("erot", []):
                tyyppi = x.get("tyyppi")
                if tyyppi not in SUOSITUS:
                    ongelmat.append(f"{s['paivamaara']}: outo tyyppi {tyyppi}"); continue
                d = x.get("uusi_data") or {}
                puuttuvat = [k for k in PAKOLLISET[tyyppi] if not d.get(k)]
                if puuttuvat:
                    ongelmat.append(f"{s['paivamaara']} {tyyppi} '{x.get('teos')}': uusi_data puuttuu {puuttuvat}"); continue
                if tyyppi != "puuttuu" and not (isinstance(x.get("r_idx"), int) and 0 <= x["r_idx"] < len(s["sivulla_nyt"])):
                    ongelmat.append(f"{s['paivamaara']} {tyyppi}: virheellinen r_idx {x.get('r_idx')}"); continue
                if d.get("paakategoria") and d["paakategoria"] not in KATEGORIAT:
                    d["paakategoria"] = "muu"
                d.setdefault("kategoriat", []) if tyyppi == "puuttuu" else None
                if tyyppi == "puuttuu":
                    d.setdefault("google_linkki", ""); d.setdefault("lisatieto_linkki", "")
                if d.get("suosittelija") and s["osallistujat"] and d["suosittelija"] not in s["osallistujat"] \
                        and d["suosittelija"] != "tuntematon":
                    ongelmat.append(f"HUOM {s['paivamaara']}: '{d['suosittelija']}' ei osallistujalistalla (vieras?)")
                ero = {"tyyppi": tyyppi, "r_idx": x.get("r_idx") if tyyppi != "puuttuu" else None,
                       "teos": x.get("teos") or d.get("teos") or (s["sivulla_nyt"][x["r_idx"]]["teos"] if tyyppi != "puuttuu" else ""),
                       "vanha": x.get("vanha"), "uusi": x.get("uusi") or d.get("suosittelija") or d.get("teos"),
                       "peruste": x.get("peruste", ""), "uusi_data": d}
                avain = ero_avain(jid, ero)
                if avain in nahdyt:
                    continue  # sama ero kahdesti → yksi kortti
                nahdyt.add(avain)
                erot.append(ero)
                laskuri[tyyppi] = laskuri.get(tyyppi, 0) + 1
                arviot[avain] = {"suositus": SUOSITUS[tyyppi], "data": d if tyyppi != "ylimaarainen" else None,
                                 "varmuus": x.get("varmuus", "epävarma"), "perustelu": x.get("perustelu", ""),
                                 "aika": datetime.now().isoformat(timespec="seconds"), "lahde": "agentti"}
            uudet.append({"jakso_id": jid, "jakso_otsikko": s["otsikko"], "paivamaara": s["paivamaara"],
                          "osallistujat_rss": s["osallistujat"], "osallistujat_tiukka": s["osallistujat"],
                          "vanhoja": len(s["sivulla_nyt"]), "uusia": t.get("suosituksia_jaksossa", 0),
                          "erot": erot, "varoitukset": t.get("huomiot", []), "kaytto": [],
                          "deepgram_min": 0, "kustannus_claude": 0, "kustannus_deepgram": 0,
                          "otos": "agentti", "pisteet": "-", "syyt": [], "puhujat": t.get("puhujat", "")})

    print(f"Uusia jaksoja {len(uudet)}, eroja {sum(laskuri.values())}: {laskuri}")
    for o in ongelmat:
        print("  ⚠️", o)
    huomiot = [(u["paivamaara"], h) for u in uudet for h in u["varoitukset"]]
    print(f"Lisähuomioita {len(huomiot)} (näkyvät jaksokohtaisina varoituksina)")
    if "--kirjoita" in sys.argv:
        kirjoita(EHDOTUKSET, ehdotukset + uudet)
        kirjoita(ARVIOT, arviot)
        print(f"✅ Kirjoitettu {len(uudet)} jaksoa → {EHDOTUKSET} ja suositukset → {ARVIOT}")


if __name__ == "__main__":
    main()
