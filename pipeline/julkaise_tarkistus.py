"""Koostaa tarkistusajon ehdotukset admin-näkymän Tarkistus-välilehdelle.

Lukee paikalliset (gitignoratut) tarkistusehdotukset.json + tarkistusarviot.json
ja kirjoittaa repoon admin/tarkistus.json, jonka admin-näkymä lataa. Päätökset
eivät ole tässä tiedostossa: ne tallentuvat admin-näkymän Tallenna-napilla
admin/tarkistuspaatokset.json:iin (netlify/functions/tallenna.js).

Aja aina, kun tarkista_jaksot.py, agenttiarvio/yhdista.py tai
kuuntelukohdat/vie_tarkistukseen.py on tuottanut uusia ehdotuksia, ja commitoi
tulos mainiin:

    ./venv/bin/python3 julkaise_tarkistus.py
"""
import json
import os
import re
import urllib.request
from datetime import datetime

PIPELINE = os.path.dirname(os.path.abspath(__file__))
JUURI = os.path.dirname(PIPELINE)
EHDOTUKSET = os.path.join(PIPELINE, "tarkistusehdotukset.json")
ARVIOT = os.path.join(PIPELINE, "tarkistusarviot.json")
KOHDE = os.path.join(JUURI, "admin", "tarkistus.json")
RSS = "https://feeds.captivate.fm/uutisraportti-podcast/"

JAKSON_KENTAT = ("jakso_id", "jakso_otsikko", "paivamaara", "pisteet", "otos", "uusia", "puhujat")
EYRON_KENTAT = ("tyyppi", "r_idx", "teos", "vanha", "uusi", "peruste", "uusi_data")
ARVION_KENTAT = ("suositus", "data", "varmuus", "perustelu", "toinen")


def lue(polku, oletus):
    if not os.path.exists(polku):
        return oletus
    with open(polku, encoding="utf-8") as f:
        return json.load(f)


def ero_avain(jakso_id, ero):
    """Sama avain kuin pipeline/tarkistus/palvelin.py:ssä — vanhat päätökset säilyvät."""
    kohde = ero.get("r_idx") if ero.get("r_idx") is not None else (ero.get("teos") or "").strip().lower()
    return f"{jakso_id}::{ero['tyyppi']}::{kohde}"


def aanet():
    """jakso_id → täyden jakson MP3: kuuntelu.json, Supla-osoitteet ja RSS-syöte."""
    osoitteet = {i: v["a"] for i, v in lue(os.path.join(JUURI, "kuuntelu.json"), {}).items() if v.get("a")}
    for e in lue(os.path.join(PIPELINE, "supla_audio_urlit.json"), []):
        if e.get("audio_url"):
            osoitteet.setdefault(e["id"], e["audio_url"])
    try:
        xml = urllib.request.urlopen(RSS, timeout=30).read().decode("utf-8")
        for item in re.findall(r"<item>(.*?)</item>", xml, re.S):
            guid = re.search(r"<guid[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</guid>", item, re.S)
            enc = re.search(r'<enclosure[^>]*url="([^"]+)"', item)
            if guid and enc:
                osoitteet.setdefault(guid.group(1).strip(), enc.group(1).replace("&amp;", "&"))
    except Exception as e:
        print(f"⚠️ RSS-syötteen haku epäonnistui: {e}")
    return osoitteet


def main():
    ehdotukset = lue(EHDOTUKSET, [])
    arviot = lue(ARVIOT, {})
    osoitteet = aanet()
    jaksot, avaimet = [], set()
    for e in ehdotukset:
        if not e.get("erot"):
            continue
        erot = []
        for ero in e["erot"]:
            avain = ero_avain(e["jakso_id"], ero)
            avaimet.add(avain)
            erot.append({"avain": avain, **{k: ero[k] for k in EYRON_KENTAT if ero.get(k) is not None}})
        jaksot.append({
            **{k: e.get(k) for k in JAKSON_KENTAT},
            "osallistujat": e.get("osallistujat_tiukka") or e.get("osallistujat_rss") or [],
            # Agenttiarvioinnin lisähuomiot (esim. kuvauksen kirjoitusvirhe sivulla)
            "huomiot": e.get("varoitukset", []) if e.get("otos") == "agentti" else [],
            "audio": osoitteet.get(e["jakso_id"]),
            "erot": erot,
        })
    tulos = {
        "luotu": datetime.now().isoformat(timespec="seconds"),
        "jaksot": jaksot,
        "arviot": {a: {k: v[k] for k in ARVION_KENTAT if k in v} for a, v in arviot.items() if a in avaimet},
    }
    with open(KOHDE, "w", encoding="utf-8") as f:
        json.dump(tulos, f, ensure_ascii=False, separators=(",", ":"))
    erot = sum(len(j["erot"]) for j in jaksot)
    print(f"✅ {KOHDE}: {len(jaksot)} jaksoa, {erot} ehdotusta, {len(tulos['arviot'])} Clauden arviota, "
          f"{sum(1 for j in jaksot if j['audio'])} jaksolla ääni, {os.path.getsize(KOHDE) // 1024} kt")


if __name__ == "__main__":
    main()
