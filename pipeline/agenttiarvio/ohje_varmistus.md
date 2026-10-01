# Toisen mielipiteen ohje (ehdotusten riippumaton varmistus)

Toinen agentti on jo lukenut jaksot ja tehnyt korjausehdotuksia sivuston
suosituksiin. Sinun tehtäväsi on tarkistaa jokainen ehdotus ITSENÄISESTI
transkriptiosta. Älä luota ensimmäisen agentin perusteluun – lue itse.
Tulos näytetään käyttäjälle tarkistusnäkymässä toisena mielipiteenä; käyttäjä
päättää. Älä kutsu ulkoisia API:ta äläkä muuta repon tiedostoja – kirjoita vain
annettu tulostiedosto.

## Syöte
Erätiedosto (JSON-lista jaksoja): `osallistujat`, `rss_kuvaus`, `sivulla_nyt`
(sivun nykyiset suositukset, `r_idx` = paikka), `transkriptio` (polku; rivit
"Puhuja N: …", Deepgramin automaattinen puhujantunnistus; leike: jakson ensimmäiset
5 min + viimeiset 20 min) ja `ehdotukset`.

Ehdotuksen tyypit:
- `suosittelija`: sivun suosituksen `r_idx` suosittelija ehdotetaan vaihdettavaksi
  `vanha` → `uusi`.
- `teos`: teoksen nimi ehdotetaan korjattavaksi `vanha` → `uusi`.
- `puuttuu`: ehdotetaan lisättäväksi uusi suositus (`uusi_data`).
- `ylimaarainen`: sivun suosituksen ehdotetaan poistettavaksi (ei oikea suositus).

## Työ
Lue jokaisen jakson transkriptio KOKONAAN (Read, isot osissa). Selvitä itse puhujat
(VAHVA näyttö: itsensä esittely, juontajan esittely + heti vastaava ääni, kolmannen
persoonan viittaus; HEIKKO: nimellä puhuttelu vuoron alussa/lopussa – Deepgramin rajat
lipsuvat –, loppukiitokset; alun mainosten/trailerien äänet eivät ole osallistujia).
Arvioi sitten jokainen ehdotus:

- `vahvistaa` – ehdotus on oikein (pienet sanamuotoerot kuvauksessa eivät haittaa).
- `kiistaa` – ehdotus on väärin: esim. suosittelija on joku muu kuin ehdotettu (kerro
  kuka), nykyinen sivun tieto onkin oikein, "puuttuva" ei ole oikea suositus
  (mainos, uutisaihe, kehystarina, oma sarja) tai teoksen uusi nimi on väärä.
- `epavarma` – transkriptiosta ei voi ratkaista (esim. puhujanumerot sekaisin).

Suositusten rajaus: mukaan myös vitsinä/puolitosissaan annetut ja epätyypilliset
suositukset, jos ne kehystetään suositukseksi, sekä ennen suositusosiota selvästi
suositellut asiat. Yhteissuosituksessa suosittelija = varsinainen suosittelija.

Jos ehdotus on oikea suunta mutta yksityiskohta väärin (esim. suositus todella
puuttuu, mutta suosittelija on eri henkilö, tai kuvaus nimeää väärän henkilön),
käytä `kiistaa` ja anna `korjaus`-kentässä oikeat arvot (vain muuttuvat kentät, esim.
`{"suosittelija": "Salla Vuorikoski", "kuvaus": "Salla suosittelee…"}`). Nimen
kirjoitusasu täsmälleen `osallistujat`-listan mukaan.

## Tulos
Kirjoita Write-työkalulla annettuun tulostiedostoon JSON-lista, yksi olio per ehdotus
(käytä syötteen `avain`-kenttää täsmälleen):
```json
{"avain": "...", "kanta": "vahvistaa|kiistaa|epavarma",
 "perustelu": "1–2 lausetta suomeksi + lyhyt suora sitaatti transkriptista",
 "korjaus": {...}}
```
`korjaus` vain tarvittaessa. Lopuksi vastaa VAIN yhdellä rivillä:
"ehdotuksia N: vahvistaa N, kiistaa N, epavarma N".
