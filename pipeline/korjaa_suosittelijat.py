#!/usr/bin/env python3
"""
Uudelleenattribuoi epäilyttäviksi merkittyjen suositusten suosittelijat.

Lukee epäilyttävät tapaukset validointidatasta (epailyttavat.json), lataa ja
transkriboi jakson uudelleen puhujittain eroteltuna (tai käyttää
transkriptit-välimuistia), ja pyytää Claudea päättelemään VAIN suosittelijan
uudelleen. Suositusten järjestykseen tai sisältöön ei kosketa, joten
(jakso_id, r_idx) -viittaukset pysyvät ehjinä.

Tulokset kirjoitetaan korjausehdotukset.json-tiedostoon TARKISTETTAVAKSI —
suositukset.json ei muutu ennen kuin ehdotukset viedään korjaukset.json:iin
ja ajetaan paivita_korjaukset.sh.

Käyttö:
  ./venv/bin/python3 korjaa_suosittelijat.py             # kaikki epäilyttävät jaksot
  ./venv/bin/python3 korjaa_suosittelijat.py --maara 3   # vain N ensimmäistä (testiajo)
  ./venv/bin/python3 korjaa_suosittelijat.py --vie       # vie muutosehdotukset korjaukset.json:iin
"""
import argparse
import json
import os

import requests
from pydub import AudioSegment
from dotenv import load_dotenv
import anthropic

# Yhteiset skriptit (mm. uutisraportti_automaatio_deepgram_claude) asuvat
# 16.9.2026 alkaen vain scripts/-kansiossa — lisätään se importtipolkuun
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from uutisraportti_automaatio_deepgram_claude import (
    transkriboi_deepgram, tallenna_transkripti, lue_transkripti,
    LEIKKAUS_SEKUNTIA,
)

load_dotenv(override=True)

# Polut ankkuroidaan tiedoston omaan sijaintiin, jotta kansion voi nimetä/siirtää vapaasti
PIPELINE_KANSIO = os.path.dirname(os.path.abspath(__file__))
EPAILYTTAVAT = os.path.join(PIPELINE_KANSIO, "validointidata", "epailyttavat.json")
EHDOTUKSET = "korjausehdotukset.json"
KORJAUKSET = "korjaukset.json"
OHITUKSET = "ohitukset.json"

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")


def lataa_json(polku, oletus):
    if os.path.exists(polku):
        try:
            with open(polku, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Virhe luettaessa {polku}: {e}")
    return oletus


def normalisoi_epailyttavat(data):
    """Tukee kahta muotoa: paikallinen (epailyttavat_suositukset-lista) ja
    tuotannon admin/epailyttavat.json (kaikki suositukset + is_suspicious-liput)."""
    tulos = []
    for j in data:
        if "epailyttavat_suositukset" in j:
            if j["epailyttavat_suositukset"]:
                tulos.append(j)
            continue
        liputetut = [r for r in j.get("suositukset", []) if r.get("is_suspicious")]
        if liputetut:
            jakso = {k: v for k, v in j.items() if k != "suositukset"}
            jakso["epailyttavat_suositukset"] = liputetut
            tulos.append(jakso)
    return tulos


def hae_transkripti(jakso):
    """Palauttaa jakson transkriptin välimuistista tai lataa+transkriboi audion."""
    jakso_id = jakso["jakso_id"]
    teksti = lue_transkripti(jakso_id)
    if teksti:
        print("  Transkripti löytyi välimuistista.")
        return teksti

    audio_url = jakso.get("audio_url", "")
    if not audio_url:
        print("  ⚠️ Ei audio_url:ää — ohitetaan.")
        return None

    mp3_temp = "temp_korjaus_full.mp3"
    clip_temp = "temp_korjaus_clip.mp3"
    try:
        print("  Ladataan audiota...")
        r = requests.get(audio_url)
        if r.status_code != 200:
            print(f"  ⚠️ Audion lataus epäonnistui: {r.status_code}")
            return None
        with open(mp3_temp, "wb") as f:
            f.write(r.content)

        # Sama leikkaus kuin pääputkessa: alun esittelyt + lopun suositukset
        audio = AudioSegment.from_file(mp3_temp)
        kesto_ms = len(audio)
        alku_osa = audio[:120000]
        loppu_osa = audio[max(0, kesto_ms - LEIKKAUS_SEKUNTIA * 1000):]
        (alku_osa + loppu_osa).export(clip_temp, format="mp3")

        teksti = transkriboi_deepgram(clip_temp)
        if teksti:
            tallenna_transkripti(jakso_id, teksti)
        return teksti or None
    finally:
        for tmp in (mp3_temp, clip_temp):
            if os.path.exists(tmp):
                os.remove(tmp)


def attribuoi_claudella(transkripti, jakso):
    """Pyytää Claudea päättelemään epäilyttävien suositusten oikeat suosittelijat."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    osallistujat = jakso.get("rss_osallistujat", [])

    tapaukset = []
    for e in jakso["epailyttavat_suositukset"]:
        tapaukset.append({
            "r_idx": e["r_idx"],
            "teos": e.get("teos", "?"),
            "kuvaus": e.get("kuvaus", ""),
            "nykyinen_suosittelija": e.get("suosittelija", ""),
        })

    system_prompt = f"""Olet ammattimainen suomalainen toimitussihteeri. Saat Uutisraportti-podcastin jakson transkriptin, jossa rivit voivat olla puhujittain eroteltuja ("Puhuja 0:", "Puhuja 1:" jne.), sekä listan jakson suosituksista, joiden suosittelija on mahdollisesti merkitty väärin.

Tehtäväsi on päätellä JOKAISELLE annetulle suositukselle oikea suosittelija.

SÄÄNNÖT:
1. Jakson osallistujat RSS-kuvauksen mukaan: {', '.join(osallistujat) if osallistujat else '(ei tiedossa)'}. Suosittelijan on ensisijaisesti oltava joku näistä.
2. Selvitä ensin jakson alkuesittelyistä, kuka puhujanumero on kukin henkilö, ja käytä sitten puhujanumeroa suosituksen antajan tunnistamiseen.
3. Jos suosituksen antaa selvästi joku muu, joka esitellään jakson alussa nimeltä, käytä sitä nimeä (koko nimi, suomalaisittain kirjoitettuna).
4. Jos et pysty päättelemään suosittelijaa varmasti, käytä arvoa "tuntematon" — älä koskaan arvaa.
5. ÄLÄ muuta mitään muuta kuin suosittelijaa. Palauta jokaiselle tapaukselle sama r_idx kuin syötteessä.

Palauta TISMALLEEN JA AINOASTAAN validia JSON:ia, taulukko jossa on yksi olio per tapaus:
[
  {{"r_idx": 0, "suosittelija": "Etunimi Sukunimi", "perustelu": "1 lyhyt lause, esim. mikä puhuja antaa suosituksen ja miten hänet tunnistettiin"}}
]
Älä käytä markdown-koodiblokkeja."""

    viesti = (
        f"Jakson RSS-kuvaus:\n{jakso.get('rss_kuvaus', '')}\n\n"
        f"Tarkistettavat suositukset:\n{json.dumps(tapaukset, ensure_ascii=False, indent=2)}\n\n"
        f"Jakson transkripti:\n{transkripti}"
    )

    for model_name in ["claude-sonnet-4-6", "claude-haiku-4-5"]:
        try:
            # HUOM: ei temperature-parametria — Sonnet 5 hylkää sen (400) ja
            # uusin anthropic-SDK ei hyväksy koko parametria (TypeError)
            response = client.messages.create(
                model=model_name,
                max_tokens=1500,
                system=system_prompt,
                messages=[{"role": "user", "content": viesti}],
            )
            tulos = response.content[0].text.strip()
            # Poimitaan JSON-taulukko vastauksesta, vaikka malli lisäisi
            # ympärille selitystekstiä tai koodiblokin
            alku, loppu = tulos.find("["), tulos.rfind("]")
            if alku == -1 or loppu == -1:
                raise ValueError(f"Vastauksessa ei JSON-taulukkoa: {tulos[:200]}")
            return json.loads(tulos[alku:loppu + 1])
        except Exception as e:
            print(f"  ⚠️ Malli {model_name} epäonnistui: {e}")
            continue
    return None


def aja_attribuointi(maara=None, lahde=None):
    if not ANTHROPIC_API_KEY:
        print("VIRHE: ANTHROPIC_API_KEY puuttuu .env-tiedostosta!")
        return

    lahde = lahde or EPAILYTTAVAT
    epailyttavat = normalisoi_epailyttavat(lataa_json(lahde, []))
    if not epailyttavat:
        print(f"Ei epäilyttäviä tapauksia tiedostossa {lahde}")
        return

    ehdotukset = lataa_json(EHDOTUKSET, [])
    valmiit = {(e["jakso_id"], e["r_idx"]) for e in ehdotukset}

    # Vain jaksot, joissa on vielä käsittelemättömiä tapauksia
    jonossa = [j for j in epailyttavat
               if any((j["jakso_id"], e["r_idx"]) not in valmiit
                      for e in j["epailyttavat_suositukset"])]
    if maara:
        jonossa = jonossa[:maara]

    print(f"Käsitellään {len(jonossa)} jaksoa "
          f"({sum(len(j['epailyttavat_suositukset']) for j in jonossa)} epäilyttävää suositusta).\n")

    for i, jakso in enumerate(jonossa, 1):
        print(f"[{i}/{len(jonossa)}] {jakso['paivamaara']} — {jakso['jakso_otsikko']}")

        transkripti = hae_transkripti(jakso)
        if not transkripti:
            continue

        tulokset = attribuoi_claudella(transkripti, jakso)
        if tulokset is None:
            print("  ⚠️ Attribuointi epäonnistui — ohitetaan jakso.")
            continue

        tulos_kartta = {t.get("r_idx"): t for t in tulokset if isinstance(t, dict)}
        for e in jakso["epailyttavat_suositukset"]:
            if (jakso["jakso_id"], e["r_idx"]) in valmiit:
                continue
            t = tulos_kartta.get(e["r_idx"])
            if not t or not t.get("suosittelija"):
                continue
            uusi = t["suosittelija"].strip()
            vanha = e.get("suosittelija", "")
            merkki = "✅ sama" if uusi == vanha else ("❓ tuntematon" if uusi == "tuntematon" else "✏️ MUUTOS")
            print(f"  {merkki}: r{e['r_idx']} \"{e.get('teos', '?')}\" — \"{vanha}\" → \"{uusi}\"")
            ehdotukset.append({
                "jakso_id": jakso["jakso_id"],
                "jakso_otsikko": jakso["jakso_otsikko"],
                "paivamaara": jakso["paivamaara"],
                "r_idx": e["r_idx"],
                "teos": e.get("teos", "?"),
                "vanha_suosittelija": vanha,
                "uusi_suosittelija": uusi,
                "perustelu": t.get("perustelu", ""),
                "rss_osallistujat": jakso.get("rss_osallistujat", []),
            })
            valmiit.add((jakso["jakso_id"], e["r_idx"]))

        # Tallennetaan jokaisen jakson jälkeen, jotta keskeytys ei hukkaa työtä
        with open(EHDOTUKSET, "w", encoding="utf-8") as f:
            json.dump(ehdotukset, f, ensure_ascii=False, indent=2)

    muutokset = [e for e in ehdotukset if e["uusi_suosittelija"] not in (e["vanha_suosittelija"], "tuntematon")]
    samat = [e for e in ehdotukset if e["uusi_suosittelija"] == e["vanha_suosittelija"]]
    tuntemattomat = [e for e in ehdotukset if e["uusi_suosittelija"] == "tuntematon"]
    print(f"\n{'=' * 50}")
    print(f"Ehdotuksia yhteensä: {len(ehdotukset)} ({EHDOTUKSET})")
    print(f"  ✏️ muutosehdotuksia: {len(muutokset)}")
    print(f"  ✅ nykyinen nimi vahvistettu: {len(samat)}  (→ ehkä ohitukset.json)")
    print(f"  ❓ tuntemattomia: {len(tuntemattomat)}  (vaatii käsintarkistuksen)")
    print(f"\nTarkista ehdotukset ja vie ne sitten: ./venv/bin/python3 korjaa_suosittelijat.py --vie")


def vie_korjauksiin():
    """Vie muutosehdotukset korjaukset.json:iin ja vahvistetut ohitukset.json:iin."""
    ehdotukset = lataa_json(EHDOTUKSET, [])
    if not ehdotukset:
        print(f"Ei ehdotuksia tiedostossa {EHDOTUKSET}")
        return

    # Vahvistetut tapaukset (AI totesi nykyisen nimen oikeaksi) → ohitukset.json,
    # jotta validaattori lakkaa liputtamasta niitä
    ohitukset = lataa_json(OHITUKSET, [])
    ohitettu = {(o.get("jakso_id"), o.get("r_idx")) for o in ohitukset}
    vahvistetut = [e for e in ehdotukset
                   if e["uusi_suosittelija"] == e["vanha_suosittelija"]
                   and (e["jakso_id"], e["r_idx"]) not in ohitettu]
    for e in vahvistetut:
        ohitukset.append({"jakso_id": e["jakso_id"], "r_idx": e["r_idx"]})
    if vahvistetut:
        with open(OHITUKSET, "w", encoding="utf-8") as f:
            json.dump(ohitukset, f, ensure_ascii=False, indent=2)
        print(f"✅ Vietiin {len(vahvistetut)} vahvistettua tapausta tiedostoon {OHITUKSET}.")

    korjaukset = lataa_json(KORJAUKSET, [])
    olemassa = {(k["jakso_id"], k["r_idx"]) for k in korjaukset}

    vietavat = [e for e in ehdotukset
                if e["uusi_suosittelija"] not in (e["vanha_suosittelija"], "tuntematon")
                and (e["jakso_id"], e["r_idx"]) not in olemassa]

    for e in vietavat:
        korjaukset.append({
            "jakso_id": e["jakso_id"],
            "jakso_otsikko": e["jakso_otsikko"],
            "paivamaara": e["paivamaara"],
            "r_idx": e["r_idx"],
            "teos": e["teos"],
            "vanha_suosittelija": e["vanha_suosittelija"],
            "uusi_suosittelija": e["uusi_suosittelija"],
        })

    with open(KORJAUKSET, "w", encoding="utf-8") as f:
        json.dump(korjaukset, f, ensure_ascii=False, indent=2)

    print(f"✅ Vietiin {len(vietavat)} korjausta tiedostoon {KORJAUKSET} "
          f"(yhteensä {len(korjaukset)} korjausta).")
    print("Aja seuraavaksi: ./paivita_korjaukset.sh")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Uudelleenattribuoi epäilyttävät suositukset")
    parser.add_argument("--maara", type=int, default=None, help="käsittele vain N ensimmäistä jaksoa")
    parser.add_argument("--vie", action="store_true", help="vie muutosehdotukset korjaukset.json:iin")
    parser.add_argument("--lahde", default=None,
                        help="epäilyttävien lähdetiedosto (oletus: paikallinen validointidata; "
                             "tukee myös tuotannon admin/epailyttavat.json -muotoa)")
    args = parser.parse_args()

    if args.vie:
        vie_korjauksiin()
    else:
        aja_attribuointi(maara=args.maara, lahde=args.lahde)
