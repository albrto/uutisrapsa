# Agenttiarvioinnin ohje (vanhan datan tarkistus ilman API-kutsuja)

Tämän ohjeen saa jokainen arviointiagentti. Agentti lukee jaksojen transkriptiot itse,
poimii suositukset ja vertaa niitä sivuston nykyisiin. Tulokset muuttuvat
tarkistusnäkymään avoimiksi ehdotuksiksi + Clauden suosituksiksi
(`pipeline/agenttiarvio/yhdista.py`). Käyttäjä päättää jokaisesta itse.

Älä kutsu ulkoisia API:ta äläkä aja skriptejä, jotka kutsuvat Anthropicin tai Deepgramin
rajapintoja. Älä muuta repon tiedostoja – kirjoita vain annettu tulostiedosto.

## Syöte
Erätiedosto (JSON-lista jaksoja): `osallistujat` (studio-osallistujat RSS-kuvauksesta),
`rss_kuvaus`, `sivulla_nyt` (sivun nykyiset suositukset, `r_idx` = paikka) ja
`transkriptio` (polku; rivit "Puhuja N: …", Deepgramin automaattinen puhujantunnistus,
leikkaus: jakson ensimmäiset 5 min + viimeiset 20 min).

## Työ jokaiselle jaksolle
Lue transkriptio KOKONAAN (Read, isot tiedostot osissa).

1. **Puhujat.** Selvitä, kuka puhujanumero on kukin. VAHVA näyttö: itsensä esittely
   ("mun nimi on…", "X tässä"), juontajan esittely + heti vastaava ääni, kolmannen
   persoonan viittaus ("Salla puhuu siitä…" → puhuja ei ole Salla). HEIKKO: nimellä
   puhuttelu puheenvuoron alussa/lopussa (Deepgramin rajat lipsuvat sanan tai pari),
   loppukiitokset. Sama ääni voi saada välillä väärän numeron, ja kaksi ääntä voi
   sulautua samaan numeroon – päättele myös vuorojärjestyksestä ("mites Marko?").
   **Mainokset:** alussa tai välissä voi olla mainoksia ja muiden podcastien trailereita
   (esim. "Mun uusi podcast Menetetyt miljardit… kuuntele Hesarin sovelluksesta").
   Niiden äänet eivät ole osallistujia, eikä mainos ole suositus. Varsinainen jakso
   alkaa juontajan tervehdyksestä ("tervetuloa Uutisraportti-podcastiin").
2. **Suositukset.** Poimi KAIKKI jaksossa annetut kulttuuri-, kulutus- ja
   elämäntapasuositukset. Mukaan myös vitsinä/puolitosissaan annetut ja epätyypilliset
   (elämäntavat, havainnot), jos ne kehystetään suositukseksi, sekä ennen varsinaista
   suositusosiota keskustellut ja selvästi suositellut asiat. EI: puhujan oman
   tuotteen/sarjan mainos, pelkkä uutisaihe jota ei suositella, juontajan kuvitteellinen
   kehystarina/aasinsilta suositusosion pohjustuksena, mainosten sisältö. Poikkeus:
   vinkki kuunnella tietty toisen median jakso, jossa puhuja oli vieraana, ON suositus.
   Yhteissuositus (A aloittaa, B suosittelee) → yksi suositus, suosittelija = varsinainen
   suosittelija; toinen voi mainita kuvauksessa.
3. **Vertaa** löytämiäsi suosituksia `sivulla_nyt`-listaan (sama teos/asia, vaikka nimi
   olisi kirjoitettu eri tavalla tai käännetty) ja kirjaa erot.

## Erotyypit
- `suosittelija` – sama suositus, väärä suosittelija sivulla. `r_idx`, `vanha`, `uusi`.
  `uusi_data`: `{"suosittelija", "kuvaus"}` – kirjoita kuvaus uudelleen, jos nykyinen
  nimeää väärän henkilön.
- `teos` – teoksen nimi sivulla väärin (litterointivirhe, väärä nimi). Vain kun olet
  varma oikeasta nimestä. `r_idx`, `vanha`, `uusi`. `uusi_data`:
  `{"teos", "google_linkki", "lisatieto_linkki"}` (+ `"kuvaus"`, jos se pitää korjata).
- `puuttuu` – suositus, jota sivulla ei ole. `r_idx`: null, `teos`, `uusi` = suosittelija.
  `uusi_data`: `{"teos", "suosittelija", "kuvaus", "paakategoria", "kategoriat",
  "google_linkki", "lisatieto_linkki"}` (+ `"alkupera"` podcasteille, ks. alla).
- `ylimaarainen` – sivun suositus, joka ei ole oikea suositus (mainos, uutisaihe,
  kehystarina) tai jota jaksossa ei ole lainkaan. `r_idx`, `teos`, `vanha`. Ilmoita vain,
  kun olet melko varma – leikkauksen ulkopuolelle jäänyt suositus voi olla oikea.

Älä ilmoita eroa, jos sivun tieto on oikein. Kirjoitusasun pikkuerot (iso/pieni
kirjain, tarkenne suluissa) eivät ole eroja.

## Datan säännöt
- Suosittelijan nimi TÄSMÄLLEEN `osallistujat`-listan kirjoitusasussa; vieraalle oikea
  koko nimi. Jos et pysty ratkaisemaan puhujaa, `"tuntematon"` ja varmuus `epävarma`.
- `paakategoria` yksi: kirja, elokuva, tv-sarja, podcast, artikkeli, musiikki, ruoka,
  kulttuuri, urheilu, muu. `kategoriat` 1–3 lyhyttä tägiä.
- `kuvaus` 1–2 lausetta sujuvaa yleiskieltä; suosittelijaan viitataan etunimellä
  (Anna-Sofia Berner = "Sohvi" tai "Anna-Sofia"); ei koskaan sanoja "puhuja" tai
  "suosittelija". Tarkista, että kuvauksen muut nimet ovat oikein.
- `google_linkki` = `https://www.google.com/search?q=…` (+ välilyönneille). Yleiselle
  tekemiselle/elämänohjeelle (ei tiettyä teosta/paikkaa/tuotetta) sekä `google_linkki`
  että `lisatieto_linkki` = "".
- `lisatieto_linkki`: kirjat `https://www.goodreads.com/search?q=…`, elokuvat/sarjat
  `https://www.imdb.com/find/?q=…`, musiikki/podcastit `https://open.spotify.com/search/…`,
  muuten "" – ei koskaan Google-hakua.
- Podcasteille `alkupera`: "yle" (Yle Areenan podcast), "hs" (HS:n oma, Suplassa),
  "kotimainen", "ulkomainen".
- Korjaa teoksen nimen litterointivirhe vain kun tunnistat teoksen varmasti; käännä
  yleiskieliset asiat suomeksi (suomennetuille kirjoille suomenkielinen nimi).

## Tulos
Kirjoita Write-työkalulla annettuun tulostiedostoon JSON-lista, yksi olio per jakso
(myös jaksot, joissa ei ole eroja):

```json
{"jakso_id": "...", "puhujat": "lyhyesti kuka on kuka (esim. 0=Tuomas, 1=Salla)",
 "suosituksia_jaksossa": 4,
 "erot": [{"tyyppi": "...", "r_idx": 0, "teos": "...", "vanha": "...", "uusi": "...",
           "peruste": "lyhyt suora sitaatti, joka osoittaa puhujan/suosituksen",
           "uusi_data": {...}, "varmuus": "varma|epävarma",
           "perustelu": "1–2 lausetta suomeksi miksi"}],
 "huomiot": ["muut havainnot, esim. kuvauksen kirjoitusvirhe sivun suosituksessa"]}
```
Ole rehellinen epävarmuudesta. Lopuksi vastaa lyhyesti: jaksot, erojen määrä
tyypeittäin ja epävarmojen määrä.
