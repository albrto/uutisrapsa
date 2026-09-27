#!/bin/sh
# Renderöi faviconin, Apple touch -ikonin ja jakokuvan kuvalahteet/-kansion
# HTML-lähteistä Chromen headless-tilassa (fontit Google Fontsista).
# Aja repon juuresta: sh kuvalahteet/tee_kuvat.sh
set -e
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP=$(mktemp -d)
"$CH" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=5000 \
  --window-size=720,720 --screenshot="$TMP/ikoni.png" "file://$PWD/kuvalahteet/ikoni.html" 2>/dev/null
sips -z 180 180 "$TMP/ikoni.png" --out apple-touch-icon.png >/dev/null
sips -z 48 48 "$TMP/ikoni.png" --out "$TMP/f48.png" >/dev/null
ffmpeg -y -loglevel error -i "$TMP/f48.png" favicon.ico
"$CH" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=8000 \
  --window-size=1200,630 --screenshot=og-image.png "file://$PWD/kuvalahteet/og-image.html" 2>/dev/null
rm -rf "$TMP"
echo "Valmis: favicon.ico, apple-touch-icon.png, og-image.png (favicon.svg on käsin tehty)"
