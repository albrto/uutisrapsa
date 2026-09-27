import subprocess
import anthropic
import os
import json
import re
from datetime import datetime

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

def hae_git_historia():
    print("📜 Luetaan git-historiaa...")
    # Erottimina ohjausmerkit %x1e (commit) ja %x1f (otsikko/body): monirivinen
    # commit-body ei näin hajoa useaksi näennäiscommitiksi, kuten kävi kun
    # historia jaettiin rivinvaihdoilla.
    cmd = ['git', 'log', '-n', '20', '--pretty=format:%s%x1f%b%x1e']
    result = subprocess.run(cmd, capture_output=True, text=True)
    commits = []

    tietueet = [t for t in result.stdout.split('\x1e') if t.strip()]
    print(f"📄 Löydettiin {len(tietueet)} committia.")

    for tietue in tietueet:
        osat = tietue.strip().split('\x1f')
        otsikko = osat[0].strip()
        # Attribuutiorivit (Co-Authored-By) eivät kuulu muutoslokiin
        body_rivit = osat[1].splitlines() if len(osat) > 1 else []
        body = " ".join(
            r.strip() for r in body_rivit
            if r.strip() and not r.strip().lower().startswith("co-authored-by:")
        )

        print(f"  - Tutkitaan: {otsikko}")

        # Pysähdytään edellisen automaatioajon commitiin: kaikki sitä vanhempi
        # on jo käsitelty aiemmissa muutoslokeissa. Automaation omat commitit
        # eivät myöskään koskaan itsessään ole muutoslokiin kuuluvia muutoksia —
        # muuten Claude keksii viikoittain "päivityksiä" tyhjästä (bugi, joka
        # tuotti 16 hallusinoitua entryä kesällä 2026).
        if otsikko.lower().startswith("automaatio:"):
            print("  🛑 Pysähdytään: edellisen automaatioajon commit.")
            break

        print(f"  ✅ Lisätään: {otsikko}")
        commits.append(otsikko + (" - " + body if body else ""))

    return commits

def muotoile_claudella(commits):
    if not commits:
        return None
        
    historia_str = "\n".join(f"- {c}" for c in commits)
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    
    prompt = f"""Olet "Uutisraportti suosittelee" -verkkosivuston rento tiedottaja. 
Koodari on tehnyt taustalla teknisiä päivityksiä. Sinun tehtäväsi on tiivistää nämä tavalliselle käyttäjälle ymmärrettävästi.

TYYLI JA MUOTO:
1. Käytä RANSKALAISIA VIIVOJA (HTML: <ul class="change-list"> ja <li>).
2. Pidä teksti LYHYENÄ ja ytimekkäänä.
3. ÄLÄ paljasta tarkkaa arkkitehtuuria, mallinimiä (kuten Claude 4) tai kirjastojen versioita.
4. Kuvaile tekniset muutokset abstraktisti (esim. "Parannettu automaatiota", "Päivitetty tekoälyä", "Varmistettu sovelluksen vakaus").
5. Korosta käyttäjälle näkyvää hyötyä (jos sellaista on).
6. Palauta VAIN validia HTML-koodia (pelkkä <ul>...</ul>), ei markdownia tai muuta tekstiä.
7. ÄLÄ KEKSI MITÄÄN: mainitse vain muutoksia, jotka näkyvät alla olevissa commiteissa. Jos committi on epäselvä, jätä se mainitsematta. Älä täytä listaa yleisluontoisilla lauseilla.
8. ÄLÄ käytä emojeita.

Koodarin tekniset commitit:
{historia_str}
    """

    models_to_try = [
        "claude-sonnet-4-6",
        "claude-haiku-4-5-20251001"
    ]
    
    for model_name in models_to_try:
        try:
            # HUOM: ei temperature-parametria — nykyinen anthropic-SDK ei
            # hyväksy sitä lainkaan (TypeError), mikä rikkoi lokigeneroinnin
            # 15.8.–15.9.2026 väliseksi ajaksi.
            response = client.messages.create(
                model=model_name,
                max_tokens=800,
                messages=[{"role": "user", "content": prompt}]
            )
            tulos = response.content[0].text.strip()
            # Puhdistus
            tulos = re.sub(r'^```html\s*', '', tulos)
            tulos = re.sub(r'^```\s*', '', tulos)
            tulos = re.sub(r'\s*```$', '', tulos)
            # Varmistus: emojit pois vaikka malli ohittaisi prompt-säännön
            tulos = re.sub('[\U0001F000-\U0001FAFF☀-➿️‍⭐⬆⬇]', '', tulos)
            tulos = re.sub(r'<li>\s+', '<li>', tulos)
            return tulos.strip()
        except Exception as e:
            print(f"  ⚠️ Malli {model_name} epäonnistui: {e}")
            continue
            
    return None

def paivita_footer_versio(uusi_versio):
    # Pidä etusivun footerin versionumero muutoslokin tasalla —
    # kovakoodattu numero jäi aiemmin jälkeen (v1.2.0 vs. muutoslokin v1.13.0)
    polku = "index.html"
    if not os.path.exists(polku):
        print(f"⚠️ Tiedostoa {polku} ei löydy, footerin versio jäi päivittämättä.")
        return
    with open(polku, 'r', encoding='utf-8') as f:
        sisalto = f.read()
    uusi_sisalto, maara = re.subn(r'Versio v\d+\.\d+\.\d+', f'Versio {uusi_versio}', sisalto)
    if maara == 0:
        print("⚠️ Footerin versiomerkintää ei löytynyt index.html:stä.")
        return
    with open(polku, 'w', encoding='utf-8') as f:
        f.write(uusi_sisalto)
    print(f"✅ Footerin versio päivitetty: {uusi_versio}")

def paivita_html(uusi_teksti):
    html_polku = "muutokset.html"
    if not os.path.exists(html_polku):
        print(f"❌ Virhe: Tiedostoa {html_polku} ei löydy.")
        return False
        
    with open(html_polku, 'r', encoding='utf-8') as f:
        sisalto = f.read()
        
    # Etsi viimeisin versionumero diagnostiikkaa tai automaatiota varten
    versio_match = re.search(r'<span class="version-tag">v(\d+)\.(\d+)\.(\d+)</span>', sisalto)
    uusi_versio = "v1.2.0" # Oletus jos ei löydy
    if versio_match:
        major, minor, patch = map(int, versio_match.groups())
        uusi_versio = f"v{major}.{minor + 1}.0"
        
    # Muotoillaan päivämäärä suomeksi: "24. maaliskuuta 2026"
    kuukaudet = {
        1: "tammikuuta", 2: "helmikuuta", 3: "maaliskuuta", 4: "huhtikuuta",
        5: "toukokuuta", 6: "kesäkuuta", 7: "heinäkuuta", 8: "elokuuta",
        9: "syyskuuta", 10: "lokakuuta", 11: "marraskuuta", 12: "joulukuuta"
    }
    nyt = datetime.now()
    nykyinen_pvm = f"{nyt.day}. {kuukaudet[nyt.month]} {nyt.year}"
    
    # Samalle päivälle saa tulla useampi merkintä: muutosloki.yml ajaa tämän
    # jokaisesta mainin koodipushista. Tuplat estää hae_git_historia, joka
    # pysähtyy edelliseen "Automaatio:"-committiin (eli edelliseen lokiajoon).

    uusi_html_lohkare = f'''
    <div class="change-item">
      <span class="version-tag">{uusi_versio}</span>
      <div class="change-date">{nykyinen_pvm}</div>
      {uusi_teksti}
    </div>
'''
    
    # Etsitään h1-tagi välittämättä välilyönneistä tai tarkasta sisällöstä
    pattern = r'(<h1[^>]*>.*?Muutosloki.*?</h1>)'
    match = re.search(pattern, sisalto, re.IGNORECASE | re.DOTALL)
    
    if match:
        kohta = match.end()
        uusi_sisalto = sisalto[:kohta] + uusi_html_lohkare + sisalto[kohta:]
        
        with open(html_polku, 'w', encoding='utf-8') as f:
            f.write(uusi_sisalto)
        print(f"🚀 Muutosloki {uusi_versio} tallennettu onnistuneesti!")
        paivita_footer_versio(uusi_versio)
        return True
    else:
        print("❌ Virhe: Ei löydetty h1-tagia, jossa luki 'Muutosloki'.")
        return False

def main():
    if not ANTHROPIC_API_KEY:
        print("❌ Virhe: ANTHROPIC_API_KEY puuttuu.")
        return
        
    commits = hae_git_historia()
    if not commits:
        print("ℹ️ Ei uusia teknisiä committeja listattavaksi.")
        return
        
    print("🤖 Pyydetään Claudelta tiivistystä (käyttäjäystävällinen muoto)...")
    html_teksti = muotoile_claudella(commits)
    
    if html_teksti:
        paivita_html(html_teksti)
    else:
        print("❌ Virhe: Claude ei palauttanut tekstiä.")

if __name__ == "__main__":
    main()
