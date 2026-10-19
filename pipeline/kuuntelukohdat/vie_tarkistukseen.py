"""Sivuhuomiot (sivuhuomiot_tulokset/osa_*.json) → tarkistusnäkymän avoimiksi ehdotuksiksi.

Agentit muuttivat kuuntelukohtien paikannuksessa tehdyt havainnot (sivuhuomiot.md) samaan
muotoon kuin agenttiarvion erot. Tämä skripti lisää ne pääkansion
pipeline/tarkistusehdotukset.json:iin (ero) ja tarkistusarviot.json:iin (Clauden suositus).
Päätöksiä ei kirjoiteta – käyttäjä hyväksyy tai hylkää jokaisen itse. Jo olemassa olevat erot
(sama avain kuin tarkistus/palvelin.py:n ero_avain) ohitetaan, ja ristiriidat.json:n huomiot
lisätään jakson varoituksiin ("Clauden muut huomiot"). Ennen kirjoitusta otetaan
aikaleimatut varmuuskopiot (tiedostot ovat gitignoroituja eikä niillä ole muuta varmuuskopiota).

  ../venv/bin/python3 kuuntelukohdat/vie_tarkistukseen.py            # kuivaharjoitus
  ../venv/bin/python3 kuuntelukohdat/vie_tarkistukseen.py --kirjoita
"""
import argparse
import glob
import json
import os
import shutil
from datetime import datetime

TAMA = os.path.dirname(os.path.abspath(__file__))
# Tarkistusnäkymän data on pääkansion pipeline/-kansiossa (myös worktreestä ajettaessa)
PAAKANSIO = "/Users/antero/Koodi/uutisrapsa/pipeline"
EHDOTUKSET = os.path.join(PAAKANSIO, "tarkistusehdotukset.json")
ARVIOT = os.path.join(PAAKANSIO, "tarkistusarviot.json")
SUOSITUKSET = os.path.join(os.path.dirname(os.path.dirname(TAMA)), "suositukset.json")
KATEGORIAT = {"kirja", "elokuva", "tv-sarja", "podcast", "artikkeli", "musiikki", "ruoka", "kulttuuri", "urheilu", "muu"}
PAKOLLISET = {"suosittelija": ["suosittelija"], "teos": ["teos"],
              "puuttuu": ["teos", "suosittelija", "kuvaus", "paakategoria"], "ylimaarainen": []}


def ero_avain(jakso_id, ero):
    """Sama kuin tarkistus/palvelin.py:n ero_avain."""
    kohde = ero.get("r_idx") if ero.get("r_idx") is not None else (ero.get("teos") or "").strip().lower()
    return f"{jakso_id}::{ero['tyyppi']}::{kohde}"


def kirjoita(polku, data):
    json.dump(data, open(polku + ".tmp", "w"), ensure_ascii=False, indent=2)
    os.replace(polku + ".tmp", polku)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--kirjoita", action="store_true")
    args = p.parse_args()

    jaksot = {j["id"]: j for j in json.load(open(SUOSITUKSET, encoding="utf-8"))}
    pvm_jaksot = {}
    for j in jaksot.values():
        pvm_jaksot.setdefault(j["paivamaara"], []).append(j["id"])
    ehdotukset = json.load(open(EHDOTUKSET, encoding="utf-8"))
    arviot = json.load(open(ARVIOT, encoding="utf-8"))
    merkinnat = {e["jakso_id"]: e for e in ehdotukset}
    olemassa = {ero_avain(e["jakso_id"], x) for e in ehdotukset for x in e["erot"]}

    lisatyt, ohitetut, jo, ongelmat = 0, 0, 0, []
    for f in sorted(glob.glob(os.path.join(TAMA, "sivuhuomiot_tulokset", "osa_*.json"))):
        for x in json.load(open(f, encoding="utf-8")):
            if x.get("jo_olemassa"):
                jo += 1
                continue
            jid, tyyppi = x.get("jakso_id"), x.get("tyyppi")
            if jid not in jaksot:
                ongelmat.append(f"{os.path.basename(f)}: tuntematon jakso {jid}")
                continue
            if tyyppi not in PAKOLLISET:
                ongelmat.append(f"{jid}: outo tyyppi {tyyppi}")
                continue
            d = x.get("uusi_data") or {}
            puuttuvat = [k for k in PAKOLLISET[tyyppi] if not d.get(k)]
            if puuttuvat or (tyyppi == "puuttuu" and d.get("paakategoria") not in KATEGORIAT):
                ongelmat.append(f"{jaksot[jid]['paivamaara']} {tyyppi} {x.get('teos')}: puuttuu {puuttuvat or 'paakategoria'}")
                continue
            r = x.get("r_idx")
            if tyyppi != "puuttuu" and not (isinstance(r, int) and 0 <= r < len(jaksot[jid]["suositukset"])):
                ongelmat.append(f"{jaksot[jid]['paivamaara']}: r_idx {r} ei kelpaa")
                continue
            ero = {"tyyppi": tyyppi, "r_idx": r if tyyppi != "puuttuu" else None,
                   "teos": x.get("teos") or (jaksot[jid]["suositukset"][r]["teos"] if r is not None else ""),
                   "vanha": x.get("vanha"), "uusi": x.get("uusi"),
                   "peruste": x.get("peruste", ""), "uusi_data": d, "lahde": "kuuntelukohdat"}
            avain = ero_avain(jid, ero)
            if avain in olemassa:
                ohitetut += 1
                continue
            olemassa.add(avain)
            if jid not in merkinnat:
                j = jaksot[jid]
                merkinnat[jid] = {"jakso_id": jid, "jakso_otsikko": j["jakso_otsikko"], "paivamaara": j["paivamaara"],
                                  "osallistujat_rss": [], "osallistujat_tiukka": [], "vanhoja": len(j["suositukset"]),
                                  "uusia": None, "erot": [], "varoitukset": [], "deepgram_min": 0,
                                  "kustannus_claude": 0, "kustannus_deepgram": 0, "otos": "kuuntelukohdat",
                                  "pisteet": "-", "syyt": []}
                ehdotukset.append(merkinnat[jid])
            merkinnat[jid]["erot"].append(ero)
            arviot[avain] = {"suositus": x.get("suositus", "hyvaksy"), "data": d,
                             "varmuus": x.get("varmuus", "epävarma"), "perustelu": x.get("perustelu", ""),
                             "aika": datetime.now().isoformat(timespec="seconds")}
            lisatyt += 1

    huomiot = 0
    rpolku = os.path.join(TAMA, "sivuhuomiot_tulokset", "ristiriidat.json")
    for r in (json.load(open(rpolku, encoding="utf-8")) if os.path.exists(rpolku) else []):
        for jid in pvm_jaksot.get(r["paivamaara"], []):
            if jid in merkinnat and r["huomio"] not in merkinnat[jid]["varoitukset"]:
                merkinnat[jid]["varoitukset"].append(r["huomio"])
                huomiot += 1

    print(f"Uusia ehdotuksia {lisatyt}, jo tarkistuksessa {jo + ohitetut}, ristiriitahuomioita {huomiot}.")
    for o in ongelmat:
        print("  ⚠️", o)
    if args.kirjoita:
        leima = datetime.now().strftime("%Y%m%d_%H%M%S")
        for polku in (EHDOTUKSET, ARVIOT):
            shutil.copy2(polku, f"{polku}.varmuus_{leima}")
        kirjoita(EHDOTUKSET, ehdotukset)
        kirjoita(ARVIOT, arviot)
        print(f"Kirjoitettu (varmuuskopiot .varmuus_{leima}).")


if __name__ == "__main__":
    main()
