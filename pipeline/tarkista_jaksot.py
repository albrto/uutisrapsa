#!/usr/bin/env python3
"""
Vanhojen jaksojen uudelleentarkistus (tarkistusajo).

Jokaiselle jaksolle tehdään TUORE poiminta samalla kaksivaiheisella promptilla
kuin tuotannossa (analysoi_claudella), ja pieni lisäkutsu parittaa vanhat ja
uudet suositukset keskenään. Erot kirjataan ehdotuksiksi:

  puuttuu       uusi poiminta löysi suosituksen, jota sivulla ei ole (→ lisäys)
  suosittelija  sama teos, eri suosittelija (uuden poiminnan puhujanäyttö mukana)
  teos          sama suositus, mutta teoksen nimi eroaa olennaisesti
  ylimaarainen  sivulla oleva suositus, jota uusi poiminta ei löytänyt
                (heikko signaali — tuore poimintakin voi missata, tarkista aina)

suositukset.json EI muutu. Ehdotukset tallentuvat tiedostoon
tarkistusehdotukset.json jakso kerrallaan (keskeytyksen voi jatkaa: valmiit
jaksot ohitetaan). Jono tulee pisteyta_jaksot.py:n tuloksesta.

Käyttö:
  ./venv/bin/python3 tarkista_jaksot.py --kokeilu            # 20 kärkijaksoa + 10 satunnaista
  ./venv/bin/python3 tarkista_jaksot.py --maara 50           # 50 seuraavaa jonosta
  ./venv/bin/python3 tarkista_jaksot.py --jaksot "ID1 ID2"   # tietyt jaksot (välilyönti/rivinvaihto)
  ./venv/bin/python3 tarkista_jaksot.py --jaksot-tiedosto lista.txt   # id:t tiedostosta, yksi per rivi
  ./venv/bin/python3 tarkista_jaksot.py --yhteenveto         # tulosta tulokset uudelleen
"""
import argparse
import json
import os
import random
import sys

import feedparser
import requests
from pydub import AudioSegment

PIPELINE_KANSIO = os.path.dirname(os.path.abspath(__file__))
JUURI = os.path.dirname(PIPELINE_KANSIO)
# Pääskripti lataa .env:n datakansiosta — paikallisesti se on pipeline/
os.environ.setdefault("UUTISRAPSA_DATAKANSIO", PIPELINE_KANSIO)
sys.path.insert(0, os.path.join(JUURI, "scripts"))
import uutisraportti_automaatio_deepgram_claude as paa  # noqa: E402
from pisteyta_jaksot import poimi_osallistujat_tiukasti  # noqa: E402
from nimet import loytyy  # noqa: E402

SUOSITUKSET = os.path.join(JUURI, "suositukset.json")  # auktoriteetti, ei paikallinen kopio
PISTEYTYS = os.path.join(PIPELINE_KANSIO, "validointidata", "pisteytys.json")
EHDOTUKSET = os.path.join(PIPELINE_KANSIO, "tarkistusehdotukset.json")

# Hinnat $/miljoona tokenia (input, output) — Anthropicin listahinnat 9/2026
HINNAT = {
    "claude-sonnet-5": (2.0, 10.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5-20251001": (1.0, 5.0),
    "claude-opus-4-6": (5.0, 25.0),
}
# Deepgram nova-2 + diarisointi, $/min — ARVIO, tarkista Deepgram-konsolista
DEEPGRAM_MINUUTTIHINTA = 0.0058
LYHYT_TRANSKRIPTI = 18000  # merkkiä; tätä lyhyempi välimuistitranskripti litteroidaan uudelleen

PARITUS_PROMPT = """Olet tarkka suomalainen toimitussihteeri. Saat saman podcast-jakson suositukset kahdesta eri poiminnasta: VANHAT (sivustolla nyt) ja UUDET (tuore poiminta samasta äänitteestä).

Tehtäväsi on parittaa suositukset: sama suositus = sama teos, tuote, paikka tai asia, vaikka nimi olisi kirjoitettu eri tavalla, käännetty, lyhennetty tai tarkennettu. Suosittelijaa ÄLÄ käytä paritusperusteena — juuri sen eroja etsitään.

Palauta TISMALLEEN JA AINOASTAAN JSON-lista, jossa jokainen vanha ja jokainen uusi suositus esiintyy täsmälleen kerran:
[
  {"r_idx": 0, "u_idx": 2, "nimi_eroaa": false},
  {"r_idx": 1, "u_idx": null, "nimi_eroaa": false},
  {"r_idx": null, "u_idx": 0, "nimi_eroaa": false}
]
- Pari: molemmat indeksit. Vain vanhoissa: u_idx null. Vain uusissa: r_idx null.
- "nimi_eroaa": true VAIN parille, jonka teoksen nimet viittaavat selvästi eri asiaan tai toinen on ilmeinen litterointivirhe (esim. "Weathering Heights" vs. "Humiseva harju" = false, koska sama teos; "Kotka" vs. "Kotkat" -sarja = false; "Vaino" vs. "Väinö Linna -elämäkerta" = true). Pelkkä kirjoitusasu, tarkennus tai käännös = false.
Älä käytä markdown-koodiblokkeja."""


def lue_json(polku, oletus):
    try:
        with open(polku, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return oletus


def tallenna_ehdotukset(ehdotukset):
    with open(EHDOTUKSET, "w", encoding="utf-8") as f:
        json.dump(ehdotukset, f, ensure_ascii=False, indent=2)


def kustannus(kaytto):
    return sum(HINNAT.get(m, (5.0, 25.0))[0] * i / 1e6 + HINNAT.get(m, (5.0, 25.0))[1] * o / 1e6
               for m, i, o in kaytto)


def ajat_polku(jakso_id):
    """Transkription rivien aikaleimat (tarkistusnäkymän soitin): transkriptit/<id>.ajat.json"""
    return paa.transkriptin_polku(jakso_id)[:-4] + ".ajat.json"


def transkriboi_ajoilla(audio_path):
    """Kuten paa.transkriboi_deepgram, mutta palauttaa myös jokaisen rivin alkuajan
    leikkeessä (s). Rivit muodostetaan täsmälleen samoin, joten teksti on identtinen."""
    url = "https://api.deepgram.com/v1/listen?model=nova-2&language=fi&smart_format=true&diarize=true&utterances=true"
    with open(audio_path, "rb") as audio:
        r = requests.post(url, headers={"Authorization": f"Token {paa.DEEPGRAM_API_KEY}", "Content-Type": "audio/mp3"},
                          data=audio, timeout=600)
    if r.status_code != 200:
        print(f"Deepgram virhe: {r.status_code} - {r.text[:200]}")
        return "", []
    data = r.json()
    rivit, alut = [], []
    for u in data.get("results", {}).get("utterances", []) or []:
        t = u.get("transcript", "").strip()
        if t:
            rivit.append(f"Puhuja {u.get('speaker', '?')}: {t}")
            alut.append(round(u.get("start", 0), 2))
    if rivit:
        return "\n".join(rivit), alut
    try:
        return data["results"]["channels"][0]["alternatives"][0]["transcript"], []
    except (KeyError, IndexError):
        return "", []


def hae_transkripti(jakso_id, audio_url):
    """Palauttaa (teksti, litteroidut_minuutit). Välimuistiosuma = 0 minuuttia."""
    teksti = paa.lue_transkripti(jakso_id)
    # 16.9.2026 siirretyt 66 transkriptiota tehtiin aikoinaan kapeammalla
    # leikkauksella (~2 + 10 min, ~12 000 merkkiä) — niistä puuttuu usein koko
    # suositusosio. Nykyinen 5 + 20 min leike tuottaa ~20 000+ merkkiä.
    if teksti and len(teksti) >= LYHYT_TRANSKRIPTI:
        print("  📄 Transkripti välimuistista.")
        return teksti, 0.0
    if teksti:
        print(f"  ✂️ Välimuistin transkripti on vanhalla lyhyellä leikkauksella ({len(teksti)} merkkiä) — litteroidaan uudelleen.")
    if not audio_url:
        print("  ⚠️ Ei audio-osoitetta — ohitetaan.")
        return None, 0.0

    mp3_temp = os.path.join(PIPELINE_KANSIO, "temp_tarkistus_full.mp3")
    clip_temp = os.path.join(PIPELINE_KANSIO, "temp_tarkistus_clip.mp3")
    try:
        print("  Ladataan audiota...")
        r = requests.get(audio_url, timeout=300)
        if r.status_code != 200:
            print(f"  ⚠️ Audion lataus epäonnistui: {r.status_code}")
            return None, 0.0
        with open(mp3_temp, "wb") as f:
            f.write(r.content)
        # Täsmälleen sama leikkaus kuin pääputkessa
        audio = AudioSegment.from_file(mp3_temp)
        kesto_ms = len(audio)
        alku_osa = audio[:paa.ALKU_SEKUNTIA * 1000]
        loppu_osa = audio[max(paa.ALKU_SEKUNTIA * 1000, kesto_ms - paa.LEIKKAUS_SEKUNTIA * 1000):]
        leike = alku_osa + loppu_osa
        leike.export(clip_temp, format="mp3")
        teksti, alut = transkriboi_ajoilla(clip_temp)
        if teksti:
            paa.tallenna_transkripti(jakso_id, teksti)
            if alut:
                # Leikkeen aika → jakson aika: alku_s asti sama, sen jälkeen + (loppu_alku_s − alku_s)
                with open(ajat_polku(jakso_id), "w", encoding="utf-8") as f:
                    json.dump({"leike": {"alku_s": paa.ALKU_SEKUNTIA,
                                         "loppu_alku_s": max(paa.ALKU_SEKUNTIA * 1000, kesto_ms - paa.LEIKKAUS_SEKUNTIA * 1000) / 1000,
                                         "kesto_s": kesto_ms / 1000},
                               "rivit": alut}, f)
        return (teksti or None), len(leike) / 60000
    finally:
        for tmp in (mp3_temp, clip_temp):
            if os.path.exists(tmp):
                os.remove(tmp)


def parita(client, vanhat, uudet):
    """Parittaa vanhat ja uudet suositukset. Palauttaa listan (r_idx, u_idx, nimi_eroaa)."""
    if not vanhat and not uudet:
        return []
    if not vanhat:
        return [(None, u, False) for u in range(len(uudet))]
    if not uudet:
        return [(r, None, False) for r in range(len(vanhat))]
    viesti = (
        "VANHAT:\n" + json.dumps([{"r_idx": i, "teos": s.get("teos", ""), "kuvaus": s.get("kuvaus", "")}
                                 for i, s in enumerate(vanhat)], ensure_ascii=False, indent=1)
        + "\n\nUUDET:\n" + json.dumps([{"u_idx": i, "teos": s.get("teos", ""), "kuvaus": s.get("kuvaus", "")}
                                      for i, s in enumerate(uudet)], ensure_ascii=False, indent=1)
    )
    tulos = paa.kysy_claudelta(client, PARITUS_PROMPT, viesti)
    if tulos is None:
        return None
    parit, nahdyt_r, nahdyt_u = [], set(), set()
    for p in tulos:
        r, u = p.get("r_idx"), p.get("u_idx")
        # Suojaus: mallin keksimät tai tuplatut indeksit hylätään
        if r is not None and (not isinstance(r, int) or r in nahdyt_r or not 0 <= r < len(vanhat)):
            r = None
        if u is not None and (not isinstance(u, int) or u in nahdyt_u or not 0 <= u < len(uudet)):
            u = None
        if r is None and u is None:
            continue
        nahdyt_r.add(r)
        nahdyt_u.add(u)
        parit.append((r, u, bool(p.get("nimi_eroaa")) and r is not None and u is not None))
    # Mallilta unohtuneet → parittomiksi, jotta mitään ei katoa hiljaa
    parit += [(r, None, False) for r in range(len(vanhat)) if r not in nahdyt_r]
    parit += [(None, u, False) for u in range(len(uudet)) if u not in nahdyt_u]
    return parit


def tarkista_jakso(client, jakso, rss_entry):
    jakso_id = jakso["id"]
    kuvaus = (rss_entry or {}).get("summary", "") or (rss_entry or {}).get("description", "")
    audio_url = next((l.href for l in (rss_entry or {}).get("links", []) if "audio" in l.get("type", "")), None)

    teksti, minuutit = hae_transkripti(jakso_id, audio_url)
    if not teksti:
        return None

    # Sama osallistujaparseri kuin tuotannossa, jotta tulos vastaa sitä mitä
    # putki nyt tuottaisi; tiukka parseri kirjataan vertailuksi
    osallistujat = paa.poimi_osallistujat_rss(kuvaus)
    kaytto_alku = len(paa.KAYTTO)
    uudet, varoitukset, tunnistukset = paa.analysoi_claudella(teksti, osallistujat, kuvaus)
    vanhat = jakso.get("suositukset", [])
    parit = parita(client, vanhat, uudet)
    kaytto = paa.KAYTTO[kaytto_alku:]
    if parit is None:
        print("  ⚠️ Paritus epäonnistui — ohitetaan jakso.")
        return None

    erot = []
    for r, u, nimi_eroaa in parit:
        vanha = vanhat[r] if r is not None else None
        uusi = uudet[u] if u is not None else None
        peruste = tunnistukset[u]["peruste"] if u is not None and u < len(tunnistukset) else ""
        if vanha and uusi:
            v_nimi, u_nimi = vanha.get("suosittelija", ""), uusi.get("suosittelija", "")
            # Ilman RSS-osallistujia uusi poiminta voi jättää pelkän etunimen
            # ("Tuomas") — se on sama henkilö, ei ero
            sama = v_nimi == u_nimi or (len(u_nimi.split()) == 1 and loytyy(u_nimi, [v_nimi]))
            if not sama and u_nimi != "tuntematon":
                erot.append({"tyyppi": "suosittelija", "r_idx": r, "teos": vanha.get("teos"),
                             "vanha": vanha.get("suosittelija"), "uusi": uusi.get("suosittelija"),
                             "peruste": peruste, "uusi_data": uusi})
            if nimi_eroaa:
                erot.append({"tyyppi": "teos", "r_idx": r, "vanha": vanha.get("teos"),
                             "uusi": uusi.get("teos"), "uusi_data": uusi})
        elif uusi:
            # Yhteissuositus (sama teos usealta puhujalta) → yksi ehdotus
            aiempi = next((x for x in erot if x["tyyppi"] == "puuttuu"
                           and x["teos"].strip().lower() == uusi.get("teos", "").strip().lower()), None)
            if aiempi:
                aiempi["uusi"] += f", {uusi.get('suosittelija')}"
                continue
            erot.append({"tyyppi": "puuttuu", "teos": uusi.get("teos"),
                         "uusi": uusi.get("suosittelija"), "peruste": peruste, "uusi_data": uusi})
        elif vanha:
            erot.append({"tyyppi": "ylimaarainen", "r_idx": r, "teos": vanha.get("teos"),
                         "vanha": vanha.get("suosittelija")})

    return {
        "jakso_id": jakso_id,
        "jakso_otsikko": jakso.get("jakso_otsikko", ""),
        "paivamaara": jakso.get("paivamaara", ""),
        "osallistujat_rss": osallistujat,
        "osallistujat_tiukka": poimi_osallistujat_tiukasti(kuvaus)[0],
        "vanhoja": len(vanhat),
        "uusia": len(uudet),
        "erot": erot,
        "varoitukset": varoitukset,
        "kaytto": kaytto,
        "deepgram_min": round(minuutit, 1),
        "kustannus_claude": round(kustannus(kaytto), 4),
        "kustannus_deepgram": round(minuutit * DEEPGRAM_MINUUTTIHINTA, 4),
    }


def valitse_jono(args, pisteytys, rss_kartta, valmiit):
    kelvolliset = [p for p in pisteytys if p["jakso_id"] in rss_kartta and p["jakso_id"] not in valmiit]
    if args.jaksot:
        halutut = args.jaksot
        return [p for p in pisteytys if p["jakso_id"] in halutut and p["jakso_id"] not in valmiit]
    if args.kokeilu:
        karki = kelvolliset[:20]
        # Satunnaisotos muista (ei erikois-/maistiaisjaksoja) vertailupohjaksi:
        # kertoo, onko virheitä myös matalan pistemäärän jaksoissa
        loput = [p for p in kelvolliset[20:] if not any("normaalia" in s for s in p["syyt"])]
        satunnaiset = random.Random(20260927).sample(loput, min(10, len(loput)))
        for p in karki:
            p["otos"] = "kärki"
        for p in satunnaiset:
            p["otos"] = "satunnainen"
        return karki + satunnaiset
    return kelvolliset[:args.maara] if args.maara else kelvolliset


def tulosta_yhteenveto(ehdotukset):
    if not ehdotukset:
        print("Ei tuloksia.")
        return
    print(f"\n{'=' * 60}\nTARKISTETTU {len(ehdotukset)} JAKSOA\n{'=' * 60}")
    for e in ehdotukset:
        tyypit = [x["tyyppi"] for x in e["erot"]]
        print(f"\n{e['paivamaara']} [{e.get('otos', '-')}, {e.get('pisteet', '?')} p] {e['jakso_otsikko'][:55]}")
        print(f"  suosituksia: sivulla {e['vanhoja']}, uusi poiminta {e['uusia']}  "
              f"| {e['kustannus_claude'] + e['kustannus_deepgram']:.3f} $")
        for x in e["erot"]:
            if x["tyyppi"] == "puuttuu":
                print(f"  ➕ PUUTTUU: \"{x['teos']}\" ({x['uusi']})")
            elif x["tyyppi"] == "suosittelija":
                print(f"  🔁 SUOSITTELIJA #{x['r_idx']} \"{x['teos']}\": {x['vanha']} → {x['uusi']}")
                if x.get("peruste"):
                    print(f"       näyttö: {x['peruste'][:140]}")
            elif x["tyyppi"] == "teos":
                print(f"  ✏️ TEOS #{x['r_idx']}: \"{x['vanha']}\" → \"{x['uusi']}\"")
            elif x["tyyppi"] == "ylimaarainen":
                print(f"  ❔ EI LÖYTYNYT UUDESTA #{x['r_idx']}: \"{x['teos']}\" ({x['vanha']})")
        if not tyypit:
            print("  ✅ ei eroja")

    print(f"\n{'=' * 60}")
    for otos in ("kärki", "satunnainen", "-"):
        ryhma = [e for e in ehdotukset if e.get("otos", "-") == otos]
        if not ryhma:
            continue
        erollisia = sum(1 for e in ryhma if any(x["tyyppi"] != "ylimaarainen" for x in e["erot"]))
        laskuri = {t: sum(1 for e in ryhma for x in e["erot"] if x["tyyppi"] == t)
                   for t in ("puuttuu", "suosittelija", "teos", "ylimaarainen")}
        print(f"{otos:12} {len(ryhma)} jaksoa, joista {erollisia}:ssä vahva ero | " +
              ", ".join(f"{k} {v}" for k, v in laskuri.items()))
    claude = sum(e["kustannus_claude"] for e in ehdotukset)
    dg = sum(e["kustannus_deepgram"] for e in ehdotukset)
    dg_n = sum(1 for e in ehdotukset if e["deepgram_min"] > 0)
    print(f"\nKustannus: Claude {claude:.2f} $ ({claude / len(ehdotukset):.3f} $/jakso), "
          f"Deepgram ~{dg:.2f} $ ({dg_n} litterointia, {dg / max(dg_n, 1):.3f} $/jakso, arvio)")


def main():
    parser = argparse.ArgumentParser(description="Vanhojen jaksojen uudelleentarkistus")
    parser.add_argument("--kokeilu", action="store_true", help="20 kärkijaksoa + 10 satunnaista")
    parser.add_argument("--maara", type=int, help="N seuraavaa jaksoa pisteytysjonosta")
    # Ei pilkkua erottimena: vanhojen jaksojen id:issä on pilkku ("tag:soundcloud,2010:tracks/…")
    parser.add_argument("--jaksot", help="välilyönnillä tai rivinvaihdolla erotetut jakso-id:t")
    parser.add_argument("--jaksot-tiedosto", help="tiedosto, jossa jakso-id:t (yksi per rivi; muut sarakkeet ohitetaan)")
    parser.add_argument("--yhteenveto", action="store_true", help="tulosta vain aiemmat tulokset")
    parser.add_argument("--vain-litterointi", action="store_true",
                        help="hae/litteroi jonon transkriptiot Deepgramilla ilman Claude-kutsuja "
                             "(arviointi tehdään sitten esim. Claude Coden agenteilla)")
    parser.add_argument("--uudelleen", action="store_true",
                        help="aja --jaksot-jaksot uudelleen (korvaa aiemman tuloksen, esim. promptimuutoksen jälkeen)")
    args = parser.parse_args()
    # --jaksot/--jaksot-tiedosto → lista; tiedostossa id on rivin viimeinen sarake
    # (sallii esim. "23.7.2026  20d33d41-…"-muotoisen listan sellaisenaan)
    if args.jaksot_tiedosto:
        with open(args.jaksot_tiedosto, encoding="utf-8") as f:
            args.jaksot = [r.split()[-1] for r in f if r.strip() and not r.lstrip().startswith("#")]
    elif args.jaksot:
        args.jaksot = args.jaksot.split()

    ehdotukset = lue_json(EHDOTUKSET, [])
    aiemmat_otokset = {e["jakso_id"]: e.get("otos", "-") for e in ehdotukset}
    aiemmat_paikat = {}
    if args.uudelleen and args.jaksot:
        # Päätökset (tarkistuspaatokset.json) säilyvät: niiden avain ei riipu ajokerrasta
        # Uudelleen ajettu jakso palaa entiselle paikalleen (näkymän järjestys säilyy)
        aiemmat_paikat = {e["jakso_id"]: i for i, e in enumerate(ehdotukset)}
        ehdotukset = [e for e in ehdotukset if e["jakso_id"] not in args.jaksot]
    if args.yhteenveto:
        tulosta_yhteenveto(ehdotukset)
        return
    if not paa.DEEPGRAM_API_KEY or not paa.ANTHROPIC_API_KEY:
        print("VIRHE: DEEPGRAM_API_KEY tai ANTHROPIC_API_KEY puuttuu pipeline/.env:stä")
        return
    pisteytys = lue_json(PISTEYTYS, [])
    if not pisteytys:
        print("Aja ensin: ./venv/bin/python3 pisteyta_jaksot.py")
        return

    print("Ladataan RSS-syöte...")
    feed = feedparser.parse(paa.RSS_URL)
    rss_kartta = {e.get("id", ""): e for e in feed.entries}
    data = {j["id"]: j for j in lue_json(SUOSITUKSET, [])}
    valmiit = {e["jakso_id"] for e in ehdotukset}
    jono = valitse_jono(args, pisteytys, rss_kartta, valmiit)
    print(f"Jonossa {len(jono)} jaksoa.\n")

    if args.vain_litterointi:
        # Ei Claude-kutsuja: vain transkriptiot välimuistiin (transkriptit/), 0 $ Claudelle
        minuutit = 0.0
        # 2016–2018 jaksoja ei ole RSS:ssä: niiden suorat MP3-osoitteet kerättiin Suplasta
        # (keraa_supla_audio_urlit.py → supla_audio_urlit.json); osoitteet toimivat ilman
        # kirjautumista (testattu 1.10.2026)
        supla = {e["id"]: e["audio_url"] for e in lue_json(os.path.join(PIPELINE_KANSIO, "supla_audio_urlit.json"), [])
                 if e.get("audio_url")}
        for i, p in enumerate(jono, 1):
            jakso = data.get(p["jakso_id"])
            entry = rss_kartta.get(p["jakso_id"])
            if not jakso or not (entry or p["jakso_id"] in supla):
                continue
            print(f"[{i}/{len(jono)}] {jakso['paivamaara']} — {jakso['jakso_otsikko'][:70]}")
            audio_url = (next((l.href for l in entry.get("links", []) if "audio" in l.get("type", "")), None)
                         if entry else supla[p["jakso_id"]])
            try:
                teksti, min_ = hae_transkripti(p["jakso_id"], audio_url)
            except Exception as e:
                print(f"  ❌ Virhe: {e}")
                continue
            minuutit += min_
            print(f"  → {len(teksti or '')} merkkiä")
        print(f"\nLitteroitu {minuutit:.0f} min ≈ {minuutit * DEEPGRAM_MINUUTTIHINTA:.2f} $ (arvio)")
        return

    client = paa.anthropic.Anthropic(api_key=paa.ANTHROPIC_API_KEY)
    for i, p in enumerate(jono, 1):
        jakso = data.get(p["jakso_id"])
        if not jakso:
            continue
        print(f"[{i}/{len(jono)}] {jakso['paivamaara']} — {jakso['jakso_otsikko'][:70]} ({p['pisteet']} p)")
        try:
            tulos = tarkista_jakso(client, jakso, rss_kartta.get(p["jakso_id"]))
        except Exception as e:  # yksi rikkinäinen jakso ei saa kaataa koko ajoa
            print(f"  ❌ Virhe: {e}")
            continue
        if not tulos:
            continue
        tulos["otos"] = p.get("otos") or aiemmat_otokset.get(p["jakso_id"], "-")
        tulos["pisteet"] = p["pisteet"]
        tulos["syyt"] = p["syyt"]
        paikka = aiemmat_paikat.get(p["jakso_id"])
        if paikka is not None:
            ehdotukset.insert(min(paikka, len(ehdotukset)), tulos)
        else:
            ehdotukset.append(tulos)
        tallenna_ehdotukset(ehdotukset)  # joka jakson jälkeen: keskeytyksen voi jatkaa
        print(f"  → {len(tulos['erot'])} eroa, {tulos['kustannus_claude'] + tulos['kustannus_deepgram']:.3f} $\n")

    tulosta_yhteenveto(ehdotukset)


if __name__ == "__main__":
    main()
