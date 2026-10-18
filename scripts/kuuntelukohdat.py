"""Suositusten kuuntelukohdat: missä kohtaa jakson äänitettä kukin suositus alkaa.

Yhteinen sekä tuotannolle (uutisraportti_automaatio_deepgram_claude.py: uuden jakson
suositukset paikannetaan Clauden API:lla heti poiminnan jälkeen) että vanhan datan
täydennykselle (pipeline/kuuntelukohdat/: agentit lukevat samat ikkunat erätiedostoista).

Tulos on repon juuren kuuntelu.json, jota sivuston soitin lukee:
  {"<jakso_id>": {"a": "<äänitteen osoite>", "k": <kesto s>, "t": {"<r_idx>": <alku s>}}}
"""
import json
import os
import re
import unicodedata

JUURI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KUUNTELU_TIEDOSTO = os.path.join(JUURI, "kuuntelu.json")

# Suositusosio alkaa yleensä loppuleikkeen puolivälin jälkeen: ikkuna alkaa VARALLA riviä
# ennen loppuleikkeen ensimmäistä "suosit…"-sanaa
VARALLA = 25
ETUAIKA = 1.0  # aloitetaan hetki ennen rivin alkua, ettei ensimmäinen tavu leikkaudu
TAYTESANAT = {"podcast", "kirja", "sarja", "elokuva", "the", "and", "kausi", "osa", "dokumentti",
              "yle", "areena", "netflix", "hbo", "kirjoittanut", "suomeksi"}

PAIKANNUS_PROMPT = """Olet tarkka podcast-toimittaja. Saat Uutisraportti-podcastin jakson suositusosion litteroinnin rivinumeroineen (Deepgramin konetekstiä: nimet usein väärin kirjoitettuja, puhujanvaihdot voivat lipsahtaa sanan tai kaksi) sekä jakson suositukset muodossa rX: teos — suosittelija [vihje: rivi N]. Vihje on rivi, jolla teoksen nimen sanoja esiintyy; se voi olla väärä.

Etsi jokaiselle suositukselle rivi, josta kuuntelijan kannattaa aloittaa, jotta hän kuulee suosituksen alusta:
1. Kohta, jossa suosittelija alkaa esitellä tätä suositusta – usein ennen teoksen nimeä ("Mä haluan suositella…", "Jos aloitan.").
2. Jos juontaja antaa vuoron juuri tälle suosittelijalle välittömästi ennen (1–3 riviä, "Mites Marko?"), aloita juontajan repliikistä.
3. Älä aloita edellisen suosituksen keskeltä.
4. Saman vuoron toinen suositus: rivi, jolla siihen siirrytään.
5. Jos suositusta ei löydy riveiltä, anna null. Älä arvaa.

Vastaa VAIN JSON-listana: [{"r_idx": 0, "rivi": 283}, {"r_idx": 1, "rivi": null}]"""


def normalisoi(t):
    t = unicodedata.normalize("NFD", t.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn" or c in "̈̊")
    return re.sub(r"[^0-9a-zäöå]+", " ", unicodedata.normalize("NFC", t))


def lyhenna(rivi):
    """"Puhuja 2: teksti" → "P2: teksti" """
    return re.sub(r"^Puhuja (\S+):", r"P\1:", rivi)


def ikkunan_alku(rivit, ajat):
    """Suositusosion ensimmäinen rivi (arvio)."""
    loppuleike = next((i for i, t in enumerate(ajat["rivit"]) if t >= ajat["leike"]["alku_s"]), 0)
    eka = next((i for i in range(loppuleike, len(rivit)) if "suosit" in rivit[i].lower()), None)
    return max(loppuleike, (eka if eka is not None else (loppuleike + len(rivit)) // 2) - VARALLA)


def vihje(teos, rivit, alku, loppu):
    """Rivi, jolla teoksen nimen sanoista osuu eniten (sanan 5 ensimmäistä kirjainta riittävät,
    koska taivutus ja Deepgramin kirjoitusasu vaihtelevat)."""
    sanat = [s for s in normalisoi(re.sub(r"\(.*?\)", " ", teos)).split()
             if len(s) >= 4 and s not in TAYTESANAT]
    paras, paras_i = 0, None
    for i in range(alku, loppu):
        teksti = " " + normalisoi(rivit[i])
        osumat = sum(1 for s in sanat if " " + s[:5] in teksti)
        if osumat > paras:
            paras, paras_i = osumat, i
    return paras_i


def jakson_teksti(jakso, rivit, ajat):
    """Paikannettava teksti yhdestä jaksosta: suositukset vihjeineen + suositusosion rivit.
    Palauttaa (teksti, ikkunan_alku)."""
    alku = ikkunan_alku(rivit, ajat)
    recs = [(i, r) for i, r in enumerate(jakso["suositukset"]) if not r.get("piilotettu")]
    osa = [f"=== JAKSO {jakso['id']}", f"{jakso['paivamaara']} – {jakso['jakso_otsikko']}", "SUOSITUKSET:"]
    lisat = []
    for i, r in recs:
        v = vihje(r["teos"], rivit, alku, len(rivit))
        if v is None:
            v = vihje(r["teos"], rivit, 0, alku)
            if v is not None:
                lisat.append((i, v))
        osa.append(f"  r{i}: {r['teos']} — {r['suosittelija']}"
                   + (f"  [vihje: rivi {v}]" if v is not None else "  [vihje: ei löytynyt]"))
    osa.append(f"RIVIT {alku}–{len(rivit) - 1}:")
    osa += [f"{k} {lyhenna(rivit[k])}" for k in range(alku, len(rivit))]
    # Suositus ennen suositusosiota: vihjerivi ympäristöineen
    for i, v in lisat:
        osa.append(f"(lisäksi rivit {max(0, v - 4)}–{v + 2} suositukselle r{i}:)")
        osa += [f"{k} {lyhenna(rivit[k])}" for k in range(max(0, v - 4), min(alku, v + 3))]
    return "\n".join(osa), alku


def jakson_aika(t, leike):
    """Leikkeen aika → jakson aika (leike = alku_s ensimmäistä sekuntia + jakson loppu)."""
    return t if t < leike["alku_s"] else leike["loppu_alku_s"] + (t - leike["alku_s"])


def kohdat_sekunteina(kohdat, jakso, ajat):
    """{r_idx: rivi|None} → {"r_idx": sekunnit}; virheelliset ja null-kohdat jätetään pois."""
    t = {}
    for r_idx, rivi in kohdat.items():
        r = int(r_idx)
        if rivi is None or not (0 <= r < len(jakso["suositukset"])) or jakso["suositukset"][r].get("piilotettu"):
            continue
        if not (isinstance(rivi, int) and 0 <= rivi < len(ajat["rivit"])):
            continue
        t[str(r)] = round(max(0.0, jakson_aika(ajat["rivit"][rivi], ajat["leike"]) - ETUAIKA), 1)
    return t


def lue_kuuntelu():
    if os.path.exists(KUUNTELU_TIEDOSTO):
        with open(KUUNTELU_TIEDOSTO, encoding="utf-8") as f:
            return json.load(f)
    return {}


def tallenna_kuuntelu(data):
    with open(KUUNTELU_TIEDOSTO, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def paikanna_jakso(client, kysy, jakso, rivit, ajat, audio_url):
    """Tuotanto: paikantaa uuden jakson suositukset Claudella ja päivittää kuuntelu.json:n.
    kysy = kysy_claudelta (JSON-listan palauttava kysely). Palauttaa paikannettujen määrän."""
    if not jakso["suositukset"] or len(ajat["rivit"]) != len(rivit):
        return 0
    teksti, _ = jakson_teksti(jakso, rivit, ajat)
    vastaus = kysy(client, PAIKANNUS_PROMPT, teksti) or []
    kohdat = {str(v.get("r_idx")): v.get("rivi") for v in vastaus if isinstance(v, dict)}
    t = kohdat_sekunteina(kohdat, jakso, ajat)
    if t:
        data = lue_kuuntelu()
        data[jakso["id"]] = {"a": audio_url, "k": round(ajat["leike"]["kesto_s"], 1), "t": t}
        tallenna_kuuntelu(data)
    return len(t)
