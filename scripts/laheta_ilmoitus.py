import json
import os
import requests
import urllib.parse

# Sama skripti ajaa Actionsin (data + admin/epailyttavat.json repon juuressa)
# ja paikallisen putken (datakopiot pipeline/-kansiossa, epäilyttävät
# pipeline/validointidata/epailyttavat.json:ssa) — ks. UUTISRAPSA_DATAKANSIO
# ja UUTISRAPSA_EPAILYTTAVAT; oletukset säilyttävät entisen Actions-käytöksen.
JUURI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATAKANSIO = os.environ.get("UUTISRAPSA_DATAKANSIO", JUURI)
STATUS_FILE = os.path.join(DATAKANSIO, "ajon_tulos.json")
EPAILYTTAVAT_FILE = os.environ.get(
    "UUTISRAPSA_EPAILYTTAVAT", os.path.join(JUURI, "admin", "epailyttavat.json"))
NETLIFY_URL = "https://uutisrapsa.fi/"

def hae_epailyttavien_luettelo(jakso_id):
    if not os.path.exists(EPAILYTTAVAT_FILE):
        return 0

    try:
        with open(EPAILYTTAVAT_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        for jakso in data:
            if jakso.get("jakso_id") == jakso_id:
                # Kaksi skeemaa: paikallinen validoi_suosittelijat.py tuottaa
                # epailyttavat_suositukset-listan, tuotannon
                # generoi_validointidata.py kaikki suositukset is_suspicious-lipuin
                if "epailyttavat_suositukset" in jakso:
                    return len(jakso["epailyttavat_suositukset"])
                return sum(1 for r in jakso.get("suositukset", []) if r.get("is_suspicious"))
    except Exception as e:
        print(f"Laheta_ilmoitus: Virhe luettaessa epailyttavat.json: {e}")

    return 0

def laheta_sahkoposti(otsikko, viesti):
    print(f"Lähetetään sähköposti Netlify Formsin kautta:\nOtsikko: {otsikko}\n{viesti}")
    
    payload = {
        "form-name": "automaatio-ilmoitus",
        "subject": otsikko,
        "viesti": viesti
    }
    
    try:
        res = requests.post(NETLIFY_URL, data=payload, headers={"Content-Type": "application/x-www-form-urlencoded"})
        if res.status_code == 200:
            print("✅ Sähköposti-ilmoitus lähetetty onnistuneesti!")
        else:
            print(f"❌ Sähköposti-ilmoituksen lähetys epäonnistui: {res.status_code}")
    except Exception as e:
        print(f"❌ Yhteysvirhe sähköpostin lähetyksessä: {e}")

def main():
    if not os.path.exists(STATUS_FILE):
        print("laheta_ilmoitus.py: Ei raportoitavaa, uusia jaksoja ei käsitelty.")
        return

    try:
        with open(STATUS_FILE, "r", encoding="utf-8") as f:
            tulos = json.load(f)
    except Exception as e:
        print(f"Virhe luettaessa ajon statusta: {e}")
        return

    # Yksi ajo voi käsitellä useita jaksoja: uusi muoto on lista.
    # Vanha yksittäinen dict hyväksytään yhä yhteensopivuuden vuoksi.
    tulokset = tulos if isinstance(tulos, list) else [tulos]
    if not tulokset:
        os.remove(STATUS_FILE)
        print("laheta_ilmoitus.py: Ei raportoitavaa, uusia jaksoja ei käsitelty.")
        return

    epailyttavia_yht = 0
    varoituksia_yht = 0
    osiot = []
    for t in tulokset:
        jakso_otsikko = t.get("jakso_otsikko", "Nimetön jakso")
        suos_kpl = t.get("suosituksia_kpl", 0)
        varoitukset = t.get("varoitukset", [])
        epailyttavia_kpl = hae_epailyttavien_luettelo(t.get("jakson_id", ""))
        epailyttavia_yht += epailyttavia_kpl
        varoituksia_yht += len(varoitukset)

        osio = f"Käsitelty jakso: {jakso_otsikko}\nAnalysoitavaksi löytyi yhteensä {suos_kpl} suositusta.\n"
        if epailyttavia_kpl > 0:
            osio += f"⚠️ HUOMIO: Skripti poimi tästä jaksosta {epailyttavia_kpl} epäilyttävää suosittelijanimeä, jotka eivät täsmää RSS-feediin.\n"
        else:
            osio += "Kaikki suosittelijanimet vaikuttivat luotettavilta.\n"
        if varoitukset:
            osio += "Automaattiset laatuvaroitukset:\n"
            for v in varoitukset:
                osio += f"- {v}\n"
        osiot.append(osio)

    if len(tulokset) == 1:
        otsikko_osa = f"'{tulokset[0].get('jakso_otsikko', 'Nimetön jakso')}'"
    else:
        otsikko_osa = f"{len(tulokset)} jaksoa"

    if epailyttavia_yht > 0:
        sähköpostin_otsikko = f"⚠️ Uutisraportti: {otsikko_osa} käsitelty — {epailyttavia_yht} epäilyttävää suosittelijaa"
    elif varoituksia_yht > 0:
        sähköpostin_otsikko = f"⚠️ Uutisraportti: {otsikko_osa} käsitelty — {varoituksia_yht} tarkistettavaa"
    else:
        sähköpostin_otsikko = f"Uutisraportti: {otsikko_osa} käsitelty!"

    viesti = "Skripti ajettiin onnistuneesti.\n\n" + "\n".join(osiot)
    if epailyttavia_yht > 0:
        viesti += "\nKäy tarkistamassa ja vahvistamassa epäilyttävät osoitteessa: https://uutisrapsa.fi/admin\n"

    laheta_sahkoposti(sähköpostin_otsikko, viesti)

    # Siivous
    os.remove(STATUS_FILE)

if __name__ == "__main__":
    main()
