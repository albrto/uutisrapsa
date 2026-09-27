#!/bin/bash
# Avaa vanhojen jaksojen tarkistusnäkymän (tarkista_jaksot.py:n ehdotukset)
OSOITE="http://127.0.0.1:5002"

# Jos palvelin on jo käynnissä (esim. toisessa ikkunassa), avataan vain sivu
if curl -s -o /dev/null "$OSOITE/data"; then
    echo "🔎 Tarkistusnäkymä on jo käynnissä — avataan $OSOITE"
    open "$OSOITE"
    exit 0
fi

echo "🔎 Käynnistetään tarkistusnäkymä... (sulje: Ctrl+C)"
cd "$(dirname "$0")/tarkistus"
(sleep 1 && open "$OSOITE") &
python3 palvelin.py
