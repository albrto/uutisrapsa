#!/bin/sh
# Renderöi ikonit ja jakokuvan kuvalahteet/-kansion HTML-lähteistä Chromen headless-tilassa
# (fontit Google Fontsista; jakokuvan vuosirengaskuvio luetaan suositukset.jsonista).
# Aja repon juuresta: sh kuvalahteet/tee_kuvat.sh
set -e
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP=$(mktemp -d)
kuva() { # leveys korkeus kohde lähde
  "$CH" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --virtual-time-budget=8000 --default-background-color=00000000 \
    --window-size="$1,$2" --screenshot="$3" "$4" 2>/dev/null
}
kuva 720 720 "$TMP/ikoni.png" "file://$PWD/kuvalahteet/ikoni.html"
kuva 720 720 "$TMP/pyorea.png" "file://$PWD/kuvalahteet/ikoni.html?pyorea"
sips -z 180 180 "$TMP/ikoni.png" --out apple-touch-icon.png >/dev/null
sips -z 192 192 "$TMP/ikoni.png" --out ikoni-192.png >/dev/null
sips -z 512 512 "$TMP/ikoni.png" --out ikoni-512.png >/dev/null
sips -z 48 48 "$TMP/pyorea.png" --out "$TMP/f48.png" >/dev/null
ffmpeg -y -loglevel error -i "$TMP/f48.png" favicon.ico
kuva 1200 630 og-image.png "file://$PWD/kuvalahteet/og-image.html"
rm -rf "$TMP"
echo "Valmis: favicon.ico, apple-touch-icon.png, ikoni-192/512.png, og-image.png (favicon.svg on käsin tehty)"
