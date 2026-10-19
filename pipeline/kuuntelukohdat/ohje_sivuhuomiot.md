# Ohje: sivuhuomiot → tarkistusnäkymän ehdotukset

Kuuntelukohtien paikannuksessa agentit huomasivat litterointeja lukiessaan mahdollisia
datavirheitä (`sivuhuomiot.md`). Tehtäväsi on muuttaa sinulle annettu osa niistä jäsennellyiksi
korjausehdotuksiksi, jotka käyttäjä käy läpi tarkistusnäkymässä. **Sinä et päätä mitään** –
kirjoitat ehdotuksen ja oman suosituksesi perusteluineen.

## Lähteet (vain luku)

- Suositukset: `/Users/antero/Koodi/uutisrapsa/.claude/worktrees/dev2/suositukset.json`
  (lista jaksoja: `id`, `jakso_otsikko`, `paivamaara`, `suositukset` = lista; `r_idx` on paikka
  listassa, laskettuna myös `piilotettu: true` -suositukset mukaan).
- Litteroinnit: `/Users/antero/Koodi/uutisrapsa/.claude/worktrees/dev2/transkriptit/<id>.txt`,
  missä `<id>` = jakson id, jossa kaikki muut kuin `A–Z a–z 0–9 _ -` on korvattu `_`:lla
  (esim. `tag:soundcloud,2010:tracks/123` → `tag_soundcloud_2010_tracks_123.txt`). Rivit ovat
  muotoa `Puhuja N: teksti`; puhujanumerot ovat jaksokohtaisia, ja Deepgramin vaihdot voivat
  lipsahtaa sanan tai kaksi. Esittelyt ("Minä olen Tuomas Peltomäki"), puhuttelu ("Marko?") ja
  loppukiitokset auttavat päättelemään, kuka on kukin puhuja; loppukiitos ja vuoron alun
  vokatiivi ovat heikkoa näyttöä, itse-esittely ja kolmannen persoonan viittaus vahvaa.
- Jo olemassa olevat ehdotukset: `/Users/antero/Koodi/uutisrapsa/pipeline/tarkistusehdotukset.json`
  (lista jaksoja, kentässä `erot` ehdotukset). Jos sama korjaus (sama jakso + tyyppi + r_idx,
  tai puuttuvalle sama teos) on siellä jo, **älä tee siitä uutta** – merkitse se tulokseen
  `"jo_olemassa": true` ilman muita kenttiä.

Älä aja skriptejä äläkä muokkaa mitään muuta kuin tulostiedostoasi. Käytä Read/Grep-työkaluja.

## Mitä teet jokaiselle sivuhuomiolle

1. Etsi jakso (`suositukset.json`): id-pätkä (esim. `d3fc6922…`, `…1010448784`) tai päivämäärä.
2. Etsi kyseinen suositus (`r_idx`, `teos`) ja lue litteroinnista kohta itse.
3. Päätä, onko huomio oikeassa. Jos litterointi ei tue sitä, tee silti ehdotus mutta suosittele
   hylkäämistä (`"suositus": "hylkaa"`) ja perustele.
4. Kirjoita ehdotus yhdellä seuraavista tyypeistä:
   - `suosittelija`: väärä suosittelija. `vanha` = nykyinen nimi, `uusi` = oikea nimi täsmälleen
     samassa kirjoitusasussa kuin muualla datassa (esim. "Tuomas Peltomäki", "Anni Keski-Heikkilä",
     "Iida Sofia Hirvonen"). `uusi_data` = `{"suosittelija": …, "kuvaus": …}` – **kirjoita
     kuvaus uudelleen**, koska vanha kuvaus nimeää väärän henkilön ("Marko suosittelee…" →
     "Tuomas suosittelee…"); säilytä muu sisältö.
   - `teos`: väärä teoksen nimi (esim. Landman → Lowdown). `vanha`/`uusi` = nimet, `uusi_data` =
     `{"teos": …, "kuvaus": …, "google_linkki": "https://www.google.com/search?q=…"}`.
   - `puuttuu`: suositus puuttuu listasta. `r_idx: null`. `uusi_data` = `{"teos", "suosittelija",
     "kuvaus", "paakategoria", "kategoriat", "google_linkki", "lisatieto_linkki"}`;
     `paakategoria` on TASAN yksi: kirja, elokuva, tv-sarja, podcast, artikkeli, musiikki, ruoka,
     kulttuuri, urheilu, muu. Kuvaus suomeksi samaan tyyliin kuin muut ("X suosittelee …",
     1–2 virkettä). `lisatieto_linkki` voi olla tyhjä.
     Pelkät elämäntapavinkit ("juo vettä helteellä") ja ohimennen mainitut asiat: tee ehdotus,
     mutta suosittele hylkäämistä, ellei puhuja selvästi suosittele.
   - `ylimaarainen`: listalla oleva "suositus", joka ei ole suositus (esim. "Shakki", tuplaus
     samasta suosituksesta). `uusi_data: {}`, suositus `"poista"` (= piilotetaan sivulta).
5. `peruste`: lyhyt sitaatti litteroinnista rivinumeroineen ja puhujapäättely,
   esim. `"Puhuja 0 (r. 380): \"Mä haluan suositella…\"; P0 esittäytyy lopussa Tuomakseksi"`.

## Tulos

Kirjoita `tulostiedosto` (annetaan tehtävässä) JSON-listana:

```json
[
  {"jakso_id": "…", "tyyppi": "suosittelija", "r_idx": 3, "teos": "We Own This City",
   "vanha": "Marko Junkkari", "uusi": "Tuomas Peltomäki",
   "peruste": "…", "uusi_data": {"suosittelija": "Tuomas Peltomäki", "kuvaus": "…"},
   "suositus": "hyvaksy", "varmuus": "varma", "perustelu": "…"},
  {"jakso_id": "…", "tyyppi": "puuttuu", "r_idx": null, "teos": "…", "vanha": null, "uusi": "…",
   "peruste": "…", "uusi_data": {…}, "suositus": "hyvaksy", "varmuus": "epävarma", "perustelu": "…"},
  {"jakso_id": "…", "tyyppi": "suosittelija", "r_idx": 1, "jo_olemassa": true}
]
```

- `suositus`: `hyvaksy`, `hylkaa` tai `poista` (vain ylimaarainen).
- `varmuus`: `varma` tai `epävarma`. Ole rehellinen: jos puhujat jäävät epäselviksi, `epävarma`.
- `perustelu`: 1–2 virkettä, miksi suosittelet näin (käyttäjä näkee tämän kortissa).
- Kun huomio koskee kahta suositusta ristiin (A ↔ B), tee kaksi `suosittelija`-ehdotusta.

Lopuksi raportoi: montako ehdotusta teit, montako oli jo olemassa, montako suosittelet hylättäväksi.
