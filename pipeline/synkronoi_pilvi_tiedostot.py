#!/usr/bin/env python3
import json
import os

# Polut ankkuroidaan tiedoston omaan sijaintiin, jotta kansion voi nimetä/siirtää vapaasti
PIPELINE_KANSIO = os.path.dirname(os.path.abspath(__file__))
ICLOUD_DIR = PIPELINE_KANSIO
GITHUB_DIR = os.path.dirname(PIPELINE_KANSIO)

def lue_json(polku):
    if not os.path.exists(polku):
        return []
    try:
        with open(polku, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def tallenna_json(polku, data):
    with open(polku, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def yhdista_listat(ic_data, gh_data, unique_keys):
    """ Yhdistää kaksi listaa objekteja annettujen avainten perusteella """
    tulos = list(ic_data)
    
    # Rakenna set olemassaolevista avaimista
    olemassa = set()
    for item in tulos:
        key = tuple(item.get(k) for k in unique_keys)
        olemassa.add(key)
        
    lisatyt = 0
    for item in gh_data:
        key = tuple(item.get(k) for k in unique_keys)
        if key not in olemassa:
            tulos.append(item)
            olemassa.add(key)
            lisatyt += 1
            
    return tulos, lisatyt

def main():
    print("🔄 Synkronoidaan tiedostot GitHubista...")
    
    # 1. Ohitukset (uniikki avain: jakso_id, r_idx)
    ic_ohit = lue_json(os.path.join(ICLOUD_DIR, "ohitukset.json"))
    gh_ohit = lue_json(os.path.join(GITHUB_DIR, "admin", "ohitukset.json"))
    
    yhd_ohit, n_ohit = yhdista_listat(ic_ohit, gh_ohit, ["jakso_id", "r_idx"])
    if n_ohit > 0:
        tallenna_json(os.path.join(ICLOUD_DIR, "ohitukset.json"), yhd_ohit)
        print(f"✅ Lisättiin {n_ohit} uutta ohitusta pilvestä.")
        
    # 2. Korjaukset (uniikki avain: jakso_id, r_idx)
    # Vaikka korjauksilla voi olla eri uusi_suosittelija, meitä kiinnostaa vain se jota on korjattu
    ic_korj = lue_json(os.path.join(ICLOUD_DIR, "korjaukset.json"))
    gh_korj = lue_json(os.path.join(GITHUB_DIR, "admin", "korjaukset.json"))
    
    yhd_korj, n_korj = yhdista_listat(ic_korj, gh_korj, ["jakso_id", "r_idx"])
    if n_korj > 0:
        tallenna_json(os.path.join(ICLOUD_DIR, "korjaukset.json"), yhd_korj)
        print(f"✅ Lisättiin {n_korj} uutta korjausta pilvestä.")
        
    if n_ohit == 0 and n_korj == 0:
        print("✅ Kaikki ajan tasalla, ei uusia tietoja pilvessä.")

if __name__ == "__main__":
    main()
