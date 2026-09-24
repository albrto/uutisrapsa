#!/usr/bin/env python3
"""
Soveltaa verkkosivun tuottaman korjaukset.json -tiedoston
suoraan suositukset.json -tiedostoon.

Käyttö:
  python3 sovella_korjaukset.py korjaukset.json
"""
import json
import os
import sys
import shutil
from datetime import datetime

# Sama skripti ajaa Actionsin (suositukset.json repon juuressa) ja paikallisen
# putken (kopio pipeline/-kansiossa, UUTISRAPSA_DATAKANSIO asetettuna);
# oletus säilyttää entisen Actions-käytöksen. Korjaustiedosto tulee argumenttina.
JUURI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATAKANSIO = os.environ.get("UUTISRAPSA_DATAKANSIO", JUURI)
SUOSITUKSET = os.path.join(DATAKANSIO, "suositukset.json")

def main():
    if len(sys.argv) < 2:
        print("Käyttö: python3 sovella_korjaukset.py korjaukset.json")
        sys.exit(1)

    korjaukset_polku = sys.argv[1]

    with open(korjaukset_polku, encoding="utf-8") as f:
        korjaukset = json.load(f)

    with open(SUOSITUKSET, encoding="utf-8") as f:
        data = json.load(f)

    # Varmuuskopio
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    varmuus = SUOSITUKSET.replace(".json", f"_backup_{ts}.json")
    shutil.copy2(SUOSITUKSET, varmuus)
    print(f"💾 Varmuuskopio: {varmuus}")

    # Indeksoi jakso_id → jakso
    jakso_map = {j["id"]: j for j in data}

    ok = 0
    virhe = 0
    for korj in korjaukset:
        jakso_id = korj["jakso_id"]
        r_idx = korj["r_idx"]
        
        jakso = jakso_map.get(jakso_id)
        if not jakso:
            print(f"  ⚠️ Jaksoa ei löydy: {jakso_id} ({korj.get('jakso_otsikko', '?')})")
            virhe += 1
            continue

        suositukset = jakso.get("suositukset", [])
        if r_idx >= len(suositukset):
            print(f"  ⚠️ Suositusindeksi {r_idx} ei löydy jaksosta {jakso_id}")
            virhe += 1
            continue

        rec = suositukset[r_idx]
        
        if "uusi_data" in korj:
            uusi_data = korj["uusi_data"]
            # Päivitä kaikki kentät uuden datan mukaisiksi
            for k, v in uusi_data.items():
                rec[k] = v
            print(f"  ✅ {korj.get('paivamaara', '?')}: Päivitetty koko tietue: \"{rec.get('teos', '?')}\"")
        else:
            # Legacy / suosittelija-only mode
            vanha = korj.get("vanha_suosittelija", "")
            uusi = korj.get("uusi_suosittelija", "")
            nykyinen = rec.get("suosittelija", "")
            
            if vanha and nykyinen != vanha:
                print(f"  ⚠️ Odotettiin \"{vanha}\", löytyi \"{nykyinen}\" – OHITETAAN!")
                virhe += 1
                continue

            rec["suosittelija"] = uusi
            print(f"  ✅ {korj.get('paivamaara', '?')}: \"{vanha}\" → \"{uusi}\" ({rec.get('teos', '?')})")
        
        ok += 1

    # Tallenna
    with open(SUOSITUKSET, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*50}")
    print(f"✅ {ok} korjausta tehty, {virhe} virhettä.")
    print(f"Tallennettu: {SUOSITUKSET}")


if __name__ == "__main__":
    main()
