import difflib
import feedparser
import requests
import os
import re
import json
from pydub import AudioSegment
from dotenv import load_dotenv
import anthropic
from nimet import poimi_osallistujat_rss, TUNNETUT_NIMET

# --- POLUT ---
# Sama skripti ajaa sekä GitHub Actionsin (data repon juuressa) että
# paikallisen putken (datakopiot pipeline/-kansiossa). Paikallinen ajo
# asettaa UUTISRAPSA_DATAKANSIO-ympäristömuuttujan; oletus on repon juuri,
# jolloin käytös on täsmälleen entinen Actions-käytös.
JUURI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATAKANSIO = os.environ.get("UUTISRAPSA_DATAKANSIO", JUURI)

# Actionsissa avaimet tulevat ympäristöstä; paikallisesti pipeline/.env:stä
load_dotenv(os.path.join(DATAKANSIO, ".env"), override=True)

# --- ASETUKSET ---
RSS_URL = "https://feeds.captivate.fm/uutisraportti-podcast/"
LATAA_MÄÄRÄ = 421
LEIKKAUS_SEKUNTIA = 1200  # Viimeiset 20 min
ALKU_SEKUNTIA = 300  # Ensimmäiset 5 min — esittelykierros voi alkaa vasta ~3 min kohdalla (alun mainokset, aiheet ennen esittelyjä)
TULOS_TIEDOSTO = os.path.join(DATAKANSIO, "suositukset.json")
HISTORIA_TIEDOSTO = os.path.join(DATAKANSIO, "historia_json.txt")
TRANSKRIPTIT_KANSIO = os.path.join(JUURI, "transkriptit")  # jaettu välimuisti, aina repon juuressa
AJON_TULOS_TIEDOSTO = os.path.join(DATAKANSIO, "ajon_tulos.json")

# --- API AVAIMET ---
# Nämä pitää lisätä .env-tiedostoon!
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

def transkriptin_polku(jakso_id):
    turvallinen = re.sub(r'[^A-Za-z0-9_-]', '_', jakso_id)
    return os.path.join(TRANSKRIPTIT_KANSIO, f"{turvallinen}.txt")

def tallenna_transkripti(jakso_id, teksti):
    os.makedirs(TRANSKRIPTIT_KANSIO, exist_ok=True)
    polku = transkriptin_polku(jakso_id)
    with open(polku, "w", encoding="utf-8") as f:
        f.write(teksti)
    return polku

def lue_transkripti(jakso_id):
    polku = transkriptin_polku(jakso_id)
    if os.path.exists(polku):
        with open(polku, "r", encoding="utf-8") as f:
            return f.read()
    return None

def transkriboi_deepgram(audio_path):
    print("Lähetetään ääni Deepgramille transkriptioon (tämä kestää vain pari sekuntia)...")
    url = "https://api.deepgram.com/v1/listen?model=nova-2&language=fi&smart_format=true&diarize=true&utterances=true"
    headers = {
        "Authorization": f"Token {DEEPGRAM_API_KEY}",
        "Content-Type": "audio/mp3"
    }
    with open(audio_path, "rb") as audio:
        response = requests.post(url, headers=headers, data=audio)

    if response.status_code == 200:
        data = response.json()
        # Ensisijaisesti puhujittain eroteltu teksti ("Puhuja N: ..."), jotta
        # suosittelija voidaan päätellä puhujasta eikä pelkästä asiayhteydestä
        try:
            utterances = data['results']['utterances']
            rivit = []
            for u in utterances:
                puhuja = u.get('speaker', '?')
                transcript = u.get('transcript', '').strip()
                if transcript:
                    rivit.append(f"Puhuja {puhuja}: {transcript}")
            if rivit:
                return "\n".join(rivit)
        except KeyError:
            pass
        try:
            return data['results']['channels'][0]['alternatives'][0]['transcript']
        except KeyError:
            return ""
    else:
        print(f"Deepgram virhe: {response.status_code} - {response.text}")
        return ""

# Mallit fallback-järjestyksessä. Huom: Sonnet 5 ei hyväksy temperature-parametria,
# joten sitä ei anneta millekään mallille.
MALLIT = [
    "claude-sonnet-5",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-6"
]

# Kentät, jotka malli tuottaa laadunvarmistusta varten mutta joita ei
# tallenneta suositukset.json-tiedostoon (sivuston skeema pysyy ennallaan)
SISAISET_KENTAT = ("puhuja_peruste", "epavarma_teos")


def normalisoi_kirjoitusasu(nimi, tunnetut):
    """Napsauttaa täsmäävän tai lähes täsmäävän kirjoitusasun tunnettuun nimeen
    (esim. "Johnn Helin" → "John Helin"). Ilman osumaa nimi palautuu ennallaan."""
    for tunnettu in tunnetut:
        if nimi.lower() == tunnettu.lower():
            return tunnettu
    for tunnettu in tunnetut:
        if difflib.SequenceMatcher(None, nimi.lower(), tunnettu.lower()).ratio() >= 0.85:
            return tunnettu
    return nimi


def normalisoi_suosittelija(nimi, osallistujat):
    """Palauttaa suosittelijan tarkassa kanonisessa kirjoitusasussa.

    Kun jakson osallistujat tunnetaan RSS-kuvauksesta, ne ovat ainoa sallittu
    arvojoukko: kirjoitusasu ei jää mallin varaan, ja täysin vieras nimi
    muuttuu arvoksi "tuntematon". Ilman osallistujalistaa korjataan vain
    kirjoitusasu TUNNETUT_NIMET-listaa vasten — vieras nimi säilyy ennallaan,
    koska kyseessä voi olla aito vieras (validaattori liputtaa sen silti).
    """
    if not nimi or nimi.strip().lower() == "tuntematon":
        return "tuntematon"
    nimi = nimi.strip()
    if not osallistujat:
        return normalisoi_kirjoitusasu(nimi, TUNNETUT_NIMET)
    tulos = normalisoi_kirjoitusasu(nimi, osallistujat)
    if tulos != nimi or tulos in osallistujat:
        return tulos
    osat = nimi.split()
    for osallistuja in osallistujat:
        o_osat = osallistuja.split()
        if osat[-1].lower() == o_osat[-1].lower() and len(osat[-1]) > 2:
            return osallistuja
        if osat[0].lower() == o_osat[0].lower() and len(osat[0]) > 3:
            return osallistuja
    return "tuntematon"


def rakenna_system_prompt(osallistujat):
    # Suosittelija-sääntö rakennetaan jaksokohtaisesti: RSS-kuvauksesta poimitut
    # osallistujat ovat ainoat sallitut nimet — ei kiinteää nimilistaa, joka
    # ohjaisi mallia arvaamaan henkilöitä, jotka eivät ole studiossa.
    puhujaohje = (
        "Teksti sisältää jakson alkupuolen ja lopun suositusosion. Jos rivit on merkitty "
        "puhujittain (\"Puhuja 0:\", \"Puhuja 1:\" jne.), selvitä ensin, kuka puhujanumero on "
        "kukin henkilö: alkuesittelyt, nimeltä puhuttelut ja tervehdykset ovat todisteita. "
        "Lisää jokaiseen suositukseen kenttä \"puhuja_peruste\": lyhyt suora sitaatti "
        "transkriptista, joka osoittaa mistä päättelit puhujanumeron ja henkilön vastaavuuden. "
    )
    if osallistujat:
        suosittelija_saanto = (
            f"4. SUOSITTELIJA JA PERUSTELU: Tässä jaksossa ovat RSS-kuvauksen mukaan äänessä: {', '.join(osallistujat)}. "
            "Suosittelijan on oltava joku näistä henkilöistä. " + puhujaohje +
            "Jos suosituksen antaa selvästi joku muu, joka esitellään jakson alussa nimeltä, käytä sitä nimeä. "
            "Jos et pysty osoittamaan puhuja_peruste-sitaattia tai päättelemään suosittelijaa varmasti, "
            "käytä arvoa \"tuntematon\" — älä koskaan arvaa."
        )
    else:
        suosittelija_saanto = (
            "4. SUOSITTELIJA JA PERUSTELU: " + puhujaohje +
            "Jos et pysty osoittamaan puhuja_peruste-sitaattia tai päättelemään suosittelijaa varmasti, "
            "käytä arvoa \"tuntematon\" — älä koskaan arvaa."
        )

    return f"""Olet ammattimainen suomalainen toimitussihteeri. Tehtäväsi on poimia Uutisraportti-podcastin raakatekstistä KAIKKI jakson suositusosiossa annetut kulttuuri-, kulutus- ja elämäntapasuositukset.
Palauta TISMALLEEN JA AINOASTAAN validia JSON-rakennetta, ei mitään muuta tekstiä.

SÄÄNNÖT:
1. POIMI KAIKKI SUOSITUKSET: Ota mukaan myös vitsinä tai puolitosissaan annetut sekä epätyypilliset suositukset (havainnot, elämäntavat, toiveet — esim. kainalosauvat, tikanheitto, "suosittelen että X on hiljaa loppukesän"). Jos asia kehystetään jaksossa suositukseksi, se on suositus — huumori näkyköön kuvauksessa ja kategorioissa, ei poisjättönä. Sama puhuja voi antaa useita suosituksia putkeen — käy suositusosio huolellisesti läpi loppuun asti äläkä jätä yhtään väliin.
2. ÄLÄ POIMI MAINOKSIA, PUHEENAIHEITA TAI KEHYSTARINOITA: Puhujan oman tuotteen esittely, jonka hän itse kehystää mainokseksi, ei ole suositus. Jakson uutis- tai haastatteluaiheena käsiteltyä asiaa ei poimita, ellei sitä suositella varsinaisessa suositusosiossa (yleensä jakson lopussa). Juontajan kuvitteellinen kehystarina tai skenaario, jolla suositusosio pohjustetaan (esim. "kun kävelette terassille ja otatte siinä yhden kuplivan..."), ei ole suositus — poimi vain se, mitä puhujat itse suosittelevat vastauksissaan.
3. KORJAA VAIN VARMAT VIRHEET JA KÄÄNNÄ: Korjaa teosten nimien ilmeiset litterointivirheet VAIN kun tunnistat teoksen varmasti (esim. "weathering heights" -> "Humiseva harju"). Jos asiayhteys viittaa uuteen tai tuoreeseen julkaisuun, jota et varmuudella tunne, säilytä nimi kuullussa muodossa ja lisää suositukseen kenttä "epavarma_teos": true. ÄLÄ KOSKAAN korvaa teosta saman tekijän toisella, tunnetummalla teoksella. Kuvaus ei saa olla ristiriidassa teoksen nimen kanssa (jos puhuja sanoo "uusi levy", teos ei voi olla vuosia vanha julkaisu). Käännä yleiskieliset asiat suomeksi (esim. "pistachio spread" -> "pistaasilevite").
{suosittelija_saanto}
5. KATEGORIAT: Määritä AINA jokaiselle suositukselle ylätason "paakategoria", jonka on TISMALLEEN YKSI SEURAAVISTA: "kirja", "elokuva", "tv-sarja", "podcast", "artikkeli", "musiikki", "ruoka", "kulttuuri", "urheilu", tai "muu" (jos mikään edeltävistä ei sovi). Keksi lisäksi 1-3 tarkempaa, vapaamuotoista tägiä "kategoriat"-listaan (esim. "teatteri", "historia", "viini").
6. LINKIT: Lisää Goodreads-linkki (`https://www.goodreads.com/search?q=Nimi`) kirjoille ja IMDb-linkki (`https://www.imdb.com/find/?q=Nimi`) elokuville/sarjoille. Musiikille ja podcasteille lisää suoratoistolinkki "lisatieto_linkki" -kenttään (esim. `https://open.spotify.com/search/Nimi` tai vastaava haku Apple Musiciin, Tidaliin tai Suplaan). Kaikille "google_linkki" -kenttään hakulinkki `https://www.google.com/search?q=Nimi`.
7. KUVAUS: Kirjoita 1-2 lauseen kuvaus sujuvaa yleiskieltä. Kun viittaat suosituksen antajaan, käytä hänen etunimeään (esim. "Salla pitää sarjaa yhtenä aikamme parhaista") tai koko nimeä, jos jaksossa on toinen samanniminen. Jos suosittelija on "tuntematon", muotoile lause viittaamatta henkilöön. ÄLÄ KOSKAAN käytä kuvauksessa sanoja "puhuja", "Puhuja N" tai "suosittelija" — puhujanumerot ovat vain sisäistä apua suosittelijan päättelyyn.

VASTAUKSEN RAKENNE (palauta taulukko):
[
  {{
    "teos": "Oikea Nimi",
    "paakategoria": "kirja",
    "google_linkki": "https://www.google.com/...",
    "lisatieto_linkki": "https://www.goodreads.com/...",
    "kuvaus": "Tuomas suosittelee...",
    "suosittelija": "Tuomas Peltomäki",
    "puhuja_peruste": "Puhuja 2 esittelee itsensä: 'Mun nimi on Tuomas Peltomäki'",
    "kategoriat": ["historia", "elämäkerrat"]
  }}
]
Kenttä "epavarma_teos": true lisätään vain, jos teoksen nimen kirjoitusasu jäi epävarmaksi.
Palauta pelkkä suora lista `[]`. Älä käytä markdown-koodiblokkeja (```json ... ```). Jos suosituksia ei ole, palauta `[]`.
"""


def kysy_claudelta(client, system_prompt, viesti):
    """Kysyy JSON-listan malleilta fallback-järjestyksessä.

    Palauttaa jäsennetyn listan tai None, jos yksikään malli ei tuottanut
    kelvollista JSONia. JSON-jäsennysvirhe siirtyy seuraavaan malliin sen
    sijaan, että se tulkittaisiin tyhjäksi tulokseksi.
    """
    for model_name in MALLIT:
        try:
            response = client.messages.create(
                model=model_name,
                max_tokens=8000,
                system=system_prompt,
                messages=[
                    {"role": "user", "content": viesti}
                ]
            )
            # Uudemmat mallit voivat palauttaa thinking-lohkoja tekstin edellä
            tulos = "".join(b.text for b in response.content if b.type == "text").strip()
            if tulos.startswith("```json"):
                tulos = tulos[7:]
            if tulos.endswith("```"):
                tulos = tulos[:-3]
            jasennetty = json.loads(tulos.strip())
            if not isinstance(jasennetty, list):
                raise ValueError(f"Odotettiin JSON-listaa, saatiin {type(jasennetty).__name__}")
            print(f"Käytettiin mallia: {model_name}")
            return jasennetty
        except Exception as e:
            print(f"⚠️ Malli {model_name} epäonnistui: {e}")
            continue
    return None


def analysoi_claudella(teksti, osallistujat=None, jakso_kuvaus=""):
    """Poimii suositukset kaksivaiheisesti: pääpoiminta + täydennystarkistus.

    Palauttaa parin (suositukset, varoitukset). Varoitukset ovat ihmiselle
    tarkoitettuja huomioita (epävarmat teosnimet, tuntemattomiksi jääneet
    suosittelijat), jotka päätyvät sähköposti-ilmoitukseen.
    """
    print("Pyydetään Claude-mallia poimimaan suositukset JSON-muodossa...")
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    system_prompt = rakenna_system_prompt(osallistujat)

    viesti = ""
    if jakso_kuvaus:
        viesti += f"Jakson RSS-kuvaus (taustatietoa puhujista):\n{jakso_kuvaus}\n\n"
    viesti += f"Analysoi tämä teksti ja palauta JSON:\n\n{teksti}"

    suositukset = kysy_claudelta(client, system_prompt, viesti)
    if suositukset is None:
        print("Virhe: Yksikään Anthropic-malli ei palauttanut kelvollista JSON-listaa.")
        return [], ["Poiminta epäonnistui kokonaan — yksikään malli ei palauttanut kelvollista JSONia."]

    varoitukset = []

    # Täydennystarkistus: annetaan sama transkripti ja jo löydetyt suositukset,
    # kysytään mitä jäi poimimatta. Halpa toinen kutsu, joka paikkaa yhden
    # läpikäynnin recall-puutteet (esim. monta suositusta putkeen samalta puhujalta).
    print("Ajetaan täydennystarkistus...")
    loydetyt_tiivistelma = json.dumps(
        [{"teos": s.get("teos", ""), "suosittelija": s.get("suosittelija", "")} for s in suositukset],
        ensure_ascii=False,
    )
    tarkistusviesti = (
        f"{viesti}\n\n---\n\nTästä transkriptista on jo poimittu seuraavat suositukset:\n{loydetyt_tiivistelma}\n\n"
        "Käy suositusosio uudelleen läpi ja palauta samassa JSON-muodossa PELKÄSTÄÄN ne suositukset, "
        "jotka puuttuvat yllä olevalta listalta. Muista myös vitsinä annetut ja epätyypilliset suositukset. "
        "Jos mitään ei puutu, palauta []."
    )
    puuttuvat = kysy_claudelta(client, system_prompt, tarkistusviesti)
    if puuttuvat:
        olemassa = {s.get("teos", "").strip().lower() for s in suositukset}
        uudet = [p for p in puuttuvat if p.get("teos", "").strip().lower() not in olemassa]
        if uudet:
            print(f"Täydennystarkistus löysi {len(uudet)} lisäsuositusta.")
            varoitukset.append(
                f"Täydennystarkistus löysi {len(uudet)} suositusta, jotka jäivät ensimmäisellä kierroksella poimimatta: "
                + ", ".join(f"\"{u.get('teos', '?')}\"" for u in uudet)
            )
            suositukset.extend(uudet)

    # Deterministinen jälkikäsittely: suosittelijan kirjoitusasu ei jää mallin
    # varaan, ja sisäiset laadunvarmistuskentät siivotaan pois ennen tallennusta.
    for s in suositukset:
        alkuperainen = s.get("suosittelija", "")
        s["suosittelija"] = normalisoi_suosittelija(alkuperainen, osallistujat or [])
        if s["suosittelija"] != alkuperainen and alkuperainen and s["suosittelija"] != "tuntematon":
            print(f"  ✏️ Suosittelija normalisoitu: \"{alkuperainen}\" → \"{s['suosittelija']}\"")
        if s["suosittelija"] == "tuntematon":
            varoitukset.append(
                f"Suosittelija jäi tuntemattomaksi: \"{s.get('teos', '?')}\" (mallin ehdotus: \"{alkuperainen or '-'}\")."
            )
        if s.get("epavarma_teos"):
            varoitukset.append(
                f"Epävarma teosnimi: \"{s.get('teos', '?')}\" ({s['suosittelija']}) — tarkista kirjoitusasu, kyseessä voi olla uutuusjulkaisu."
            )
        # Transkriptin "Puhuja N:" -merkinnät ovat vain poiminnan apuväline
        # eivätkä saa näkyä julkaistussa kuvauksessa.
        if re.search(r"\b(puhuja|suosittelija)\b", s.get("kuvaus", ""), re.IGNORECASE):
            varoitukset.append(
                f"Kuvauksessa viitataan \"puhujaan\" tai \"suosittelijaan\" nimen sijaan: \"{s.get('teos', '?')}\" ({s['suosittelija']}) — muotoile kuvaus uudelleen."
            )
        for kentta in SISAISET_KENTAT:
            s.pop(kentta, None)

    return suositukset, varoitukset

def aja_prosessi():
    if not DEEPGRAM_API_KEY or not ANTHROPIC_API_KEY:
        print("VIRHE: Deepgram tai Anthropic API-avain puuttuu .env-tiedostosta!")
        return

    kasitellyt = []
    if os.path.exists(HISTORIA_TIEDOSTO):
        with open(HISTORIA_TIEDOSTO, "r", encoding="utf-8") as h:
            kasitellyt = h.read().splitlines()

    kaikki_data = []
    if os.path.exists(TULOS_TIEDOSTO):
        with open(TULOS_TIEDOSTO, "r", encoding="utf-8") as f:
            try:
                kaikki_data = json.load(f)
            except:
                kaikki_data = []

    # Sähköposti-ilmoituksen tulostiedosto kerää kaikki tämän ajon jaksot listaksi.
    # Mahdollinen edellisen ajon jämätiedosto poistetaan heti, ettei vanha jakso
    # päädy uuteen ilmoitukseen.
    ajon_tulokset = []
    if os.path.exists(AJON_TULOS_TIEDOSTO):
        os.remove(AJON_TULOS_TIEDOSTO)

    feed = feedparser.parse(RSS_URL)

    for entry in reversed(feed.entries[:LATAA_MÄÄRÄ]):
        jakson_tunniste = entry.id
        otsikko = entry.title
        
        pvm_teksti = ""
        if hasattr(entry, 'published_parsed') and entry.published_parsed:
            tm = entry.published_parsed
            pvm_teksti = f"{tm.tm_mday}.{tm.tm_mon}.{tm.tm_year}"
            
        if jakson_tunniste in kasitellyt:
            print(f"⏩ Skippataan: '{otsikko}' (Löytyy jo historiasta)")
            continue

        audio_url = next((l.href for l in entry.links if 'audio' in l.type), None)
        if audio_url:
            print(f"\n--- ALOITETAAN UUSI JAKSO: {otsikko} ---")
            mp3_temp = "temp_full_dg.mp3"
            clip_temp = "temp_clip_dg.mp3"
            
            print("Ladataan audiota...")
            r = requests.get(audio_url)
            with open(mp3_temp, 'wb') as f:
                f.write(r.content)
            
            print(f"Leikataan alun esittelyt ja loppuosa ({LEIKKAUS_SEKUNTIA // 60} min)...")
            audio = AudioSegment.from_file(mp3_temp)
            kesto_ms = len(audio)
            
            # Otetaan alkuosa (esittelyt) ja varsinainen loppuosa. Loppuosa ei
            # ala koskaan ennen alkuosan loppua, ettei lyhyissä jaksoissa synny
            # päällekkäistä tekstiä.
            alku_osa = audio[:ALKU_SEKUNTIA * 1000]
            loppu_osa_alku_ms = max(ALKU_SEKUNTIA * 1000, kesto_ms - (LEIKKAUS_SEKUNTIA * 1000))
            loppu_osa = audio[loppu_osa_alku_ms:]
            
            yhdistetty_audio = alku_osa + loppu_osa
            yhdistetty_audio.export(clip_temp, format="mp3")
            
            # 1. Ääni tekstiksi Deepgramilla
            raakateksti = transkriboi_deepgram(clip_temp)
            
            if raakateksti:
                # Talletetaan raakatranskripti (commitoidaan repoon), jotta
                # uudelleenanalyysi ei vaadi audion uudelleenlatausta
                tallenna_transkripti(jakson_tunniste, raakateksti)
                # 2. Tekstistä JSONiks Claudella — jaksokohtaiset osallistujat RSS-kuvauksesta
                jakso_kuvaus = entry.get("summary", "") or entry.get("description", "")
                osallistujat = poimi_osallistujat_rss(jakso_kuvaus)
                if osallistujat:
                    print(f"Osallistujat RSS-kuvauksesta: {', '.join(osallistujat)}")
                else:
                    print("⚠️ Osallistujia ei löytynyt RSS-kuvauksesta — suosittelija päätellään pelkästä tekstistä.")
                suositukset_json, varoitukset = analysoi_claudella(raakateksti, osallistujat, jakso_kuvaus)

                # Yleensä jokainen studiossa olija suosittelee jotain suositusosiossa —
                # osallistuja ilman yhtään suositusta on merkki poimimatta jääneestä.
                if osallistujat and suositukset_json:
                    suosittelijat = {s.get("suosittelija") for s in suositukset_json}
                    ilman_suositusta = [o for o in osallistujat if o not in suosittelijat]
                    if ilman_suositusta:
                        varoitukset.append(
                            "Osallistujilta ei löytynyt yhtään suositusta: "
                            + ", ".join(ilman_suositusta)
                            + " — tarkista jäikö jotain poimimatta."
                        )
                for v in varoitukset:
                    print(f"  ⚠️ {v}")

                # Vaikka olisi tyhjä lista ([]), tallennetaan silti että jakso on käsitelty
                jakso_data = {
                    "id": jakson_tunniste,
                    "jakso_otsikko": otsikko,
                    "paivamaara": pvm_teksti,
                    "suositukset": suositukset_json
                }
                
                # Työnnetään lista alkuun, koska reversed() käy jaksot vanhimmasta uusimpaan
                kaikki_data.insert(0, jakso_data)
                
                with open(TULOS_TIEDOSTO, "w", encoding="utf-8") as f_out:
                    json.dump(kaikki_data, f_out, ensure_ascii=False, indent=2)
                
                with open(HISTORIA_TIEDOSTO, "a", encoding="utf-8") as h:
                    h.write(jakson_tunniste + "\n")
                    
                # Tallennetaan tilapäistieto sähköposti-ilmoitusta varten.
                # Lista kirjoitetaan joka jakson jälkeen, jotta kesken kaatunut
                # ajo raportoi silti jo valmistuneet jaksot.
                ajon_tulokset.append({
                    "jakso_otsikko": otsikko,
                    "suosituksia_kpl": len(suositukset_json),
                    "jakson_id": jakson_tunniste,
                    "varoitukset": varoitukset
                })
                with open(AJON_TULOS_TIEDOSTO, "w", encoding="utf-8") as ft:
                    json.dump(ajon_tulokset, ft, ensure_ascii=False)
                    
                print(f"✅ Jakso valmis ja tallennettu suositukset.json -tiedostoon!")
            else:
                print("❌ Tekstitys epäonnistui, ohitetaan JSON-analyysi.")
            
            if os.path.exists(mp3_temp): os.remove(mp3_temp)
            if os.path.exists(clip_temp): os.remove(clip_temp)

if __name__ == "__main__":
    aja_prosessi()
