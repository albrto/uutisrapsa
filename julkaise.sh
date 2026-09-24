#!/bin/bash
# Kopioi suositukset.json iCloud-kansiosta, luo .js-versio ja pushaa GitHubiin

JUURI="$(cd "$(dirname "$0")" && pwd)"
SOURCE_JSON="$JUURI/pipeline/suositukset.json"
TARGET_DIR="$JUURI"

# 1. Kopioi JSON
cp "$SOURCE_JSON" "$TARGET_DIR/suositukset.json"


# 2.5 Päivitä myös admin/epailyttavat.js ja tyhjennä korjaukset
EPAILYTTAVAT_JS="$JUURI/pipeline/validointidata/epailyttavat.js"
if [ -f "$EPAILYTTAVAT_JS" ]; then
    cp "$EPAILYTTAVAT_JS" "$TARGET_DIR/admin/epailyttavat.js"
fi
echo "[]" > "$TARGET_DIR/admin/korjaukset.json"

# 3. Git-toimenpiteet
cd "$TARGET_DIR"
git add .
git commit -m "Päivitys: $(date '+%d.%m.%Y %H:%M')"
git push

echo "✅ Julkaistu! https://albrto.github.io/uutisraportti-suosittelee/"
