"""Tarkistusnäkymän paikallinen palvelin (http://127.0.0.1:5002).

Lukee tarkista_jaksot.py:n tulokset (tarkistusehdotukset.json) ja tallentaa
ihmisen päätökset erilliseen tiedostoon tarkistuspaatokset.json — erillään siksi,
että käynnissä oleva tarkistusajo kirjoittaa ehdotustiedoston kokonaan uudelleen
joka jakson jälkeen ja pyyhkisi samaan tiedostoon tallennetut päätökset.

"Vie"-toiminto lisää hyväksytyt päätökset admin/korjaukset.json:iin samassa
muodossa kuin admin-näkymä (täysi tietue / tyyppi "lisays"). Sivusto muuttuu
vasta, kun tiedosto pushataan mainiin (käynnistää tuotantoajon).
"""
import http.server
import json
import os
import socketserver
import urllib.parse
from datetime import datetime

PORT = 5002
KANSIO = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.dirname(KANSIO)
JUURI = os.path.dirname(PIPELINE)
EHDOTUKSET = os.path.join(PIPELINE, "tarkistusehdotukset.json")
PAATOKSET = os.path.join(PIPELINE, "tarkistuspaatokset.json")
# Clauden (agenttien) arviot: vain SUOSITUKSIA ihmiselle, eivät päätöksiä — ihminen
# hyväksyy tai hylkää jokaisen itse (käyttäjän toive 1.10.2026)
ARVIOT = os.path.join(PIPELINE, "tarkistusarviot.json")
SUOSITUKSET = os.path.join(JUURI, "suositukset.json")
KORJAUKSET = os.path.join(JUURI, "admin", "korjaukset.json")
TRANSKRIPTIT = os.path.join(JUURI, "transkriptit")

REC_KENTAT = ("teos", "paakategoria", "google_linkki", "lisatieto_linkki", "kuvaus", "suosittelija", "kategoriat")
# Valinnaiset kentät: viedään vain, jos päätöksen datassa on arvo (podcastin alkuperä ohjaa kuuntelulinkkejä)
VALINNAISET_KENTAT = ("alkupera", "lisalinkit")


def lue(polku, oletus):
    try:
        with open(polku, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return oletus


def kirjoita(polku, data):
    valiaikainen = polku + ".tmp"
    with open(valiaikainen, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(valiaikainen, polku)  # atominen: keskeytys ei jätä puolikasta tiedostoa


def ero_avain(jakso_id, ero):
    """Vakaa avain päätökselle: sama ero saa saman avaimen, vaikka jakso ajettaisiin uudelleen."""
    kohde = ero.get("r_idx") if ero.get("r_idx") is not None else (ero.get("teos") or "").strip().lower()
    return f"{jakso_id}::{ero['tyyppi']}::{kohde}"


def kokoa_data():
    ehdotukset = lue(EHDOTUKSET, [])
    live = {j["id"]: j for j in lue(SUOSITUKSET, [])}
    korjaukset = lue(KORJAUKSET, [])
    kasikorjatut = {(k["jakso_id"], k["r_idx"]) for k in korjaukset if k.get("tyyppi") != "lisays"}
    jaksot = []
    for e in ehdotukset:
        vanhat = live.get(e["jakso_id"], {}).get("suositukset", [])
        erot = []
        for ero in e["erot"]:
            ero = dict(ero, avain=ero_avain(e["jakso_id"], ero))
            if ero.get("r_idx") is not None:
                ero["kasikorjattu"] = (e["jakso_id"], ero["r_idx"]) in kasikorjatut
            erot.append(ero)
        jaksot.append({
            **{k: e.get(k) for k in ("jakso_id", "jakso_otsikko", "paivamaara", "osallistujat_rss",
                                     "osallistujat_tiukka", "pisteet", "syyt", "otos", "uusia")},
            "vanhat": vanhat,
            "erot": erot,
            "transkriptio": os.path.exists(transkriptin_polku(e["jakso_id"])),
        })
    return {"jaksot": jaksot, "paatokset": lue(PAATOKSET, {}), "arviot": lue(ARVIOT, {})}


def transkriptin_polku(jakso_id):
    import re
    return os.path.join(TRANSKRIPTIT, re.sub(r'[^A-Za-z0-9_-]', '_', jakso_id) + ".txt")


def vie_korjauksiin():
    """Muuntaa hyväksytyt, viemättömät päätökset korjaukset.json-merkinnöiksi."""
    paatokset = lue(PAATOKSET, {})
    ehdotukset = {e["jakso_id"]: e for e in lue(EHDOTUKSET, [])}
    live = {j["id"]: j for j in lue(SUOSITUKSET, [])}
    korjaukset = lue(KORJAUKSET, [])

    muokkaukset = {}   # (jakso_id, r_idx) → uusi_data  (saman suosituksen useampi ero yhdistetään)
    lisaykset = []
    vietavat_avaimet = []
    for avain, p in paatokset.items():
        if p.get("paatos") != "hyvaksytty" or p.get("viety"):
            continue
        jakso_id, tyyppi, _ = avain.split("::", 2)
        jakso = live.get(jakso_id)
        if not jakso or jakso_id not in ehdotukset:
            continue
        data = p.get("data") or {}
        if tyyppi in ("suosittelija", "teos"):
            r_idx = p["r_idx"]
            if r_idx >= len(jakso["suositukset"]):
                continue
            pohja = muokkaukset.setdefault((jakso_id, r_idx),
                                           {k: jakso["suositukset"][r_idx].get(k, "") for k in REC_KENTAT})
            pohja.update({k: v for k, v in data.items() if k in REC_KENTAT or (k in VALINNAISET_KENTAT and v)})
        elif tyyppi == "puuttuu":
            uusi = {k: data.get(k, "" if k != "kategoriat" else []) for k in REC_KENTAT}
            uusi.update({k: data[k] for k in VALINNAISET_KENTAT if data.get(k)})
            lisaykset.append((jakso_id, uusi))
        else:
            continue  # "ylimaarainen": poistotyyppiä ei vielä ole — päätös jää odottamaan
        vietavat_avaimet.append(avain)

    uudet = []
    for (jakso_id, r_idx), uusi_data in muokkaukset.items():
        jakso = live[jakso_id]
        uudet.append({"jakso_id": jakso_id, "jakso_otsikko": jakso["jakso_otsikko"],
                      "paivamaara": jakso["paivamaara"], "r_idx": r_idx,
                      "teos": jakso["suositukset"][r_idx].get("teos", ""), "uusi_data": uusi_data})
    # Lisäyksen paikka = jakson loppu, tai vielä soveltamattomien lisäysten perään
    # (sama sääntö kuin netlify/functions/tallenna.js)
    seuraava = {}
    for jakso_id, uusi_data in lisaykset:
        if jakso_id not in seuraava:
            paikka = len(live[jakso_id]["suositukset"])
            for k in korjaukset:
                if k.get("tyyppi") == "lisays" and k["jakso_id"] == jakso_id:
                    paikka = max(paikka, k["r_idx"] + 1)
            seuraava[jakso_id] = paikka
        jakso = live[jakso_id]
        uudet.append({"tyyppi": "lisays", "jakso_id": jakso_id, "jakso_otsikko": jakso["jakso_otsikko"],
                      "paivamaara": jakso["paivamaara"], "r_idx": seuraava[jakso_id],
                      "teos": uusi_data["teos"], "uusi_data": uusi_data})
        seuraava[jakso_id] += 1

    if uudet:
        kirjoita(KORJAUKSET, korjaukset + uudet)
        aika = datetime.now().isoformat(timespec="seconds")
        for avain in vietavat_avaimet:
            paatokset[avain]["viety"] = aika
        kirjoita(PAATOKSET, paatokset)
    return {"muokkauksia": len(muokkaukset), "lisayksia": len(lisaykset)}


class Kasittelija(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=KANSIO, **kwargs)

    def end_headers(self):
        # Ei välimuistia millekään (myös index.html): Safari näytti muuten
        # vanhaa sivuversiota palvelimen päivityksen jälkeen (1.10.2026)
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def vastaa(self, data, koodi=200, tyyppi="application/json; charset=utf-8"):
        runko = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode()
        self.send_response(koodi)
        self.send_header("Content-Type", tyyppi)
        self.end_headers()
        self.wfile.write(runko)

    def do_GET(self):
        osoite = urllib.parse.urlparse(self.path)
        if osoite.path == "/data":
            return self.vastaa(kokoa_data())
        if osoite.path == "/transkripti":
            jakso_id = urllib.parse.parse_qs(osoite.query).get("id", [""])[0]
            polku = transkriptin_polku(jakso_id)
            if not os.path.exists(polku):
                return self.vastaa({"virhe": "ei transkriptiota"}, 404)
            with open(polku, encoding="utf-8") as f:
                return self.vastaa(f.read().encode(), tyyppi="text/plain; charset=utf-8")
        return super().do_GET()

    def do_POST(self):
        pituus = int(self.headers.get("Content-Length", 0))
        try:
            runko = json.loads(self.rfile.read(pituus) or b"{}")
        except json.JSONDecodeError:
            return self.vastaa({"virhe": "virheellinen JSON"}, 400)
        if self.path == "/paatos":
            paatokset = lue(PAATOKSET, {})
            avain = runko["avain"]
            if paatokset.get(avain, {}).get("viety"):
                return self.vastaa({"virhe": "jo viety korjauksiin — muuta admin-näkymässä"}, 409)
            if runko.get("paatos") is None:
                paatokset.pop(avain, None)
            else:
                paatokset[avain] = {"paatos": runko["paatos"], "r_idx": runko.get("r_idx"),
                                    "data": runko.get("data"),
                                    "aika": datetime.now().isoformat(timespec="seconds")}
            kirjoita(PAATOKSET, paatokset)
            return self.vastaa({"ok": True})
        if self.path == "/vie":
            return self.vastaa(vie_korjauksiin())
        return self.vastaa({"virhe": "tuntematon osoite"}, 404)

    def log_message(self, fmt, *args):
        if "/paatos" in self.path or "/vie" in self.path:
            super().log_message(fmt, *args)


class Palvelin(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Palvelin(("127.0.0.1", PORT), Kasittelija) as httpd:
        print(f"🔎 Tarkistusnäkymä: http://127.0.0.1:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n👋 Suljetaan.")
