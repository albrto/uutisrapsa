# Ohje: suositusten kuuntelukohtien paikannus

Saat erätiedoston (`erat/era_N.txt`), jossa on Uutisraportti-podcastin jaksoja. Jokaisesta jaksosta:

- `=== JAKSO <jakso_id>` ja jakson päivä + otsikko
- `SUOSITUKSET:` – rivit `rX: <teos> — <suosittelija>  [vihje: rivi N]`. `X` on suosituksen `r_idx`.
  Vihje on rivi, jolla teoksen nimen sanoja esiintyy (automaattinen, voi olla väärä tai puuttua).
- `RIVIT a–b:` – litteroinnin rivit numeroineen muodossa `<rivinro> P<puhuja>: <teksti>`.
  Litterointi on Deepgramin konetekstiä: nimet ovat usein väärin kirjoitettuja ("Slow Horces"),
  ja puhujanvaihdot voivat lipsahtaa sanan tai kaksi. Mukana voi olla myös `(lisäksi rivit …)`-
  pätkä, jos teoksen nimi löytyi vain suositusosion ulkopuolelta.

## Tehtävä

Etsi jokaiselle suositukselle **rivi, josta kuuntelijan kannattaa aloittaa**, jotta hän kuulee
suosituksen alusta:

1. Aloita kohdasta, jossa suosittelija **alkaa esitellä tätä suositusta** – usein ennen kuin
   teoksen nimi mainitaan ("Mä haluan suositella…", "Mulla on kirja…", "Jos aloitan.").
2. Jos juontaja antaa vuoron juuri tälle suosittelijalle välittömästi ennen (1–3 riviä,
   esim. "Mites Marko?", "Salla, mitä sulla on?"), aloita juontajan vuororepliikistä.
3. Älä aloita edellisen suosituksen keskeltä tai sen kommenteista. Jos edellinen suositus ja
   vuoronvaihto ovat samalla rivillä, valitse se rivi.
4. Jos samassa vuorossa suositellaan useita teoksia peräkkäin, jälkimmäisen aloitus on rivi,
   jolla siihen siirrytään ("Ja toinen suositus on…", tai nimen mainintarivi).
5. Yhteissuositus tai ohimennen mainittu teos: rivi, jolla teos tulee puheeksi.
6. Jos suositusta ei löydy riveiltä lainkaan (litteroinnista puuttuu tai kyse on aivan muusta),
   anna `null`. Älä arvaa.

Käytä vihjettä apuna, mutta tarkista se aina lukemalla ympäristö: vihje osoittaa usein nimen
maininnan, joka voi olla muutaman rivin esittelyn alun jälkeen – tai kokonaan väärä kohta
(sama sana muussa yhteydessä).

## Tulos

Kirjoita tiedostoon `tulokset/era_N.json` (sama N kuin erällä) yksi JSON-objekti:

```json
{
  "<jakso_id>": {"0": 283, "1": 308, "2": null},
  "<jakso_id>": {"0": 412}
}
```

- Avaimena `jakso_id` täsmälleen kuten `=== JAKSO` -rivillä (myös `tag:soundcloud,2010:…`-muotoiset).
- Sisällä avaimena `r_idx` merkkijonona, arvona rivinumero (kokonaisluku) tai `null`.
- Jokaiselle erän jaksolle ja jokaiselle sen suositukselle on oltava merkintä.
- Kirjoita tiedosto Write-työkalulla. Älä muokkaa muita tiedostoja.

Lopuksi raportoi lyhyesti: montako suositusta paikansit, montako `null`, ja korkeintaan viisi
esimerkkiä tapauksista, joissa olit epävarma.
