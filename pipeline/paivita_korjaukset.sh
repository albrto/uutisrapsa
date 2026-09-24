#!/bin/bash
# Siirrytään skriptin omaan kansioon (tärkeää jos kutsutaan muualta)
cd "$(dirname "$0")"

# Yhteiset skriptit (../scripts/) ajetaan paikallisessa moodissa
export UUTISRAPSA_DATAKANSIO="$PWD"
export UUTISRAPSA_EPAILYTTAVAT="$PWD/validointidata/epailyttavat.json"

# 1. Hae korjaukset ja ohitukset pilvestä (iPadilta)
echo "☁️ Haetaan uusimmat korjaukset pilvestä..."
git -C .. pull --quiet || true
./venv/bin/python3 synkronoi_pilvi_tiedostot.py

# 2. Tarkista löytyykö korjaukset.json (esim. juuri pilvestä haettu)
if [ ! -f korjaukset.json ] || [ ! -s korjaukset.json ] || [ "$(cat korjaukset.json)" == "[]" ]; then
    echo "ℹ️ Ei korjauksia sovellettavaksi (korjaukset.json on tyhjä tai puuttuu)."
    exit 0
fi

# 3. Sovella korjaukset
echo "⚙️ Sovelletaan korjaukset suositukset.json-tiedostoon..."
./venv/bin/python3 ../scripts/sovella_korjaukset.py korjaukset.json

if [ $? -eq 0 ]; then
    # 4. Päivitä validaattorin data (epailyttavat.js) jotta korjatut häviävät listalta
    echo "🔄 Päivitetään validaattorin data..."
    ./venv/bin/python3 validoi_suosittelijat.py

    # 5. Julkaise muutokset tuotantoon jos soveltaminen onnistui
    echo "🚀 Julkaistaan muutokset tuotantoon..."
    ../julkaise.sh

    # 6. Siivoa korjaukset.json talteen (tai poista)
    mv korjaukset.json korjaukset_applied_$(date +%Y%m%d_%H%M%S).json
else
    echo "❌ Korjausten soveltaminen epäonnistui, keskeytetään julkaisu."
    exit 1
fi
