#!/bin/bash
echo "📡 Käynnistetään validaattori-palvelin..."
cd "$(dirname "$0")/validointidata"
open "http://127.0.0.1:5001"
python3 palvelin.py
