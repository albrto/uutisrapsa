#!/usr/bin/env python3
import json
import os
import requests
from pydub import AudioSegment
from dotenv import load_dotenv
import anthropic
from datetime import datetime
# Yhteiset skriptit (mm. uutisraportti_automaatio_deepgram_claude) asuvat
# 16.9.2026 alkaen vain scripts/-kansiossa — lisätään se importtipolkuun
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from uutisraportti_automaatio_deepgram_claude import tallenna_transkripti, analysoi_claudella

load_dotenv(override=True)

# Tärkeät tiedostot
URL_TIEDOSTO = "supla_audio_urlit.json"
TULOS_TIEDOSTO = "suositukset.json"
HISTORIA_TIEDOSTO = "historia_json.txt"
LEIKKAUS_SEKUNTIA = 600

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

def transkriboi_deepgram(audio_path):
    print("Lähetetään ääni Deepgramille transkriptioon...")
    url = "https://api.deepgram.com/v1/listen?model=nova-2&language=fi&smart_format=true&diarize=true&utterances=true"
    headers = {
        "Authorization": f"Token {DEEPGRAM_API_KEY}",
        "Content-Type": "audio/mp3"
    }
    with open(audio_path, "rb") as audio:
        response = requests.post(url, headers=headers, data=audio)

    if response.status_code == 200:
        data = response.json()
        # Ensisijaisesti puhujittain eroteltu teksti ("Puhuja N: ...")
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

# analysoi_claudella tuodaan pääskriptistä — aiempi lähes identtinen
# promptikopio poistettu, jotta prompti elää vain yhdessä paikassa.

def lataa_data(tiedosto, oletus=[]):
    if os.path.exists(tiedosto):
        try:
            with open(tiedosto, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Virhe luettaessa {tiedosto}: {e}")
    return oletus

def sort_by_date(item):
    try:
        return datetime.strptime(item.get("paivamaara", ""), "%d.%m.%Y")
    except ValueError:
        return datetime.min

def main():
    if not DEEPGRAM_API_KEY or not ANTHROPIC_API_KEY:
        print("VIRHE: Deepgram tai Anthropic API-avain puuttuu!")
        return

    historia = set()
    if os.path.exists(HISTORIA_TIEDOSTO):
        with open(HISTORIA_TIEDOSTO, "r", encoding="utf-8") as f:
            historia = set(f.read().splitlines())

    suositukset = lataa_data(TULOS_TIEDOSTO)
    jaksot = lataa_data(URL_TIEDOSTO)

    if not jaksot:
        print("Ei prosessoitavia jaksoja URL-tiedostossa.")
        return

    # Etsitään vain ne, joilla on audio_url ja joita ei ole vielä prosessoitu
    to_process = [j for j in jaksot if j.get("audio_url") and j["id"] not in historia]
    print(f"Löytyi {len(to_process)} uutta vahaa jaksoa prosessoitavaksi.")

    for jakso in to_process:
        print(f"\n--- ALOITETAAN JAKSO: {jakso['title']} ({jakso['date_str']}) ---")
        mp3_temp = "temp_full_dg.mp3"
        clip_temp = "temp_clip_dg.mp3"

        print("Ladataan audiota url:stä...")
        try:
            r = requests.get(jakso["audio_url"])
            if r.status_code != 200:
                print(f"Virhe ladatessa audiota: {r.status_code}")
                continue
            with open(mp3_temp, 'wb') as f:
                f.write(r.content)
            
            print(f"Leikataan alun esittelyt ja loppuosa ({LEIKKAUS_SEKUNTIA // 60} min)...")
            audio = AudioSegment.from_file(mp3_temp)
            kesto_ms = len(audio)
            
            alku_osa = audio[:120000]
            loppu_osa_alku_ms = max(0, kesto_ms - (LEIKKAUS_SEKUNTIA * 1000))
            loppu_osa = audio[loppu_osa_alku_ms:]
            
            yhdistetty_audio = alku_osa + loppu_osa
            yhdistetty_audio.export(clip_temp, format="mp3")
            
            raakateksti = transkriboi_deepgram(clip_temp)

            if raakateksti:
                tallenna_transkripti(jakso["id"], raakateksti)
                suositukset_json, varoitukset = analysoi_claudella(raakateksti)
                for v in varoitukset:
                    print(f"  ⚠️ {v}")
                
                jakso_data = {
                    "id": jakso["id"],
                    "jakso_otsikko": jakso["title"],
                    "paivamaara": jakso["date_str"],
                    "suositukset": suositukset_json
                }
                
                suositukset.append(jakso_data)
                
                # Jälkeenpäin lajitellaan date_srt:n mukaan, uusin ensin (käänteinen)
                suositukset.sort(key=sort_by_date, reverse=True)
                
                with open(TULOS_TIEDOSTO, "w", encoding="utf-8") as f_out:
                    json.dump(suositukset, f_out, ensure_ascii=False, indent=2)
                
                with open(HISTORIA_TIEDOSTO, "a", encoding="utf-8") as h:
                    h.write(jakso["id"] + "\n")
                    historia.add(jakso["id"])
                    
                print(f"✅ Jakso valmis ja tallennettu suositukset.json -tiedostoon! (Löydettiin {len(suositukset_json)} suositusta)")
            else:
                print("❌ Tekstitys epäonnistui, ohitetaan JSON-analyysi.")
                
        except Exception as e:
            print(f"Virhe prosessoinnissa: {e}")
            
        finally:
            if os.path.exists(mp3_temp): os.remove(mp3_temp)
            if os.path.exists(clip_temp): os.remove(clip_temp)

if __name__ == "__main__":
    main()
