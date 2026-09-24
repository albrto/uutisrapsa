# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Uutisraportti-podcastin suomenkieliset kuuntelijat. Kaksi yhtä tärkeää käyttötapaa (vahvistettu 16.9.2026):

1. **Jakson kuuntelija**: kuunteli juuri jakson ja haluaa löytää siinä mainitun suosituksen nopeasti.
2. **Selailija**: etsii jotain katsottavaa/luettavaa/kuunneltavaa ja selaa koko suosituskantaa.

Käyttäjän toive etusivusta (kirjattu ideana, ei sitovana toteutuksena): uusin jakso erikseen korostettuna, sen jälkeen kaikki muu nopeasti selailtavana listana.

Lisäksi ylläpitäjä (sivuston omistaja) käyttää `/admin/`-korjauskäyttöliittymää — tavoitetilanne on iPad sohvalla, mutta kaiken pitää toimia puhelimesta työpöytään.

## Product Purpose

Kerää ja jäsentää HS:n Uutisraportti-podcastin suosittelusegmentin kulttuuri- ja kulutussuositukset selailtavaksi ja haettavaksi arkistoksi (482 jaksoa, ~1240 suositusta; päivittyy automaattisesti viikoittain GitHub Actions -putkella). Menestys = palvelu on kuulijoille aidosti hyödyllinen ja tyylikäs; kyseessä on omistajan harrastusprojekti. Affiliate-tulot olisivat hauska bonus, eivät ajuri — konversio-optimointi ei saa ohjata suunnittelua.

## Positioning

Ainoa paikka, jossa podcastin suositukset ovat koottuna ja jäsenneltynä — virallista vastinetta ei ole. **Epävirallinen fanisivusto**: sivusto ei liity Helsingin Sanomiin / Sanoma Oyj:hin, ja tämä on kerrottava näkyvästi (disclaimer on jo footerissa ja tietoja-modaalissa; sitova).

## Operating Context

- Data tulee automaattiputkesta (RSS → Deepgram → Claude → `suositukset.json`); julkaisu torstaisin GitHub Actionsissa, Netlify julkaisee repon juuren.
- Julkinen sivu on vanilla-staattinen (index.html + app.js + style.css, ei frameworkia eikä build-vaihetta; app.js renderöi `suositukset.json`:sta).
- Korjaukset kulkevat admin-UI:sta gitin kautta putkeen.
- Palautelomake (Netlify Forms) on nykyisin sivun pohjalla — tunnettu kipupiste: lukijapalaute kutsui sijaintia "rasauttavaksi" (koko lista pitää vierittää läpi), ja mobiilisijoittelusta on tullut palautetta 26.5.2026.
- Kävijämäärä n. 800–1200 kävijää / 1500–2000 sivulatausta kuukaudessa; GoatCounter-analytiikka (evästeetön) vain tuotanto-hostnamella.

## Capabilities and Constraints

- Haku ja kategoriasuodattimet ovat olemassa; datan skeema on kiinteä (`suositukset.json`; suositusten järjestys jakson sisällä eli `r_idx` on kantava — ei saa rikkoa).
- Kaikki sisältö ja UI suomeksi.
- Tulossa (roadmap): affiliate-linkit vaativat KKV:n mainosmerkinnän ("mainos"-label) — designin pitää varata tälle paikka; vaihe 3 tuo staattisesti generoidut alasivut (suosittelija-, kategoria- ja tilastosivut) — mallipohjien pitää laajentua niihin; pysyvät suositus-ID:t suunnitteilla.
- Avoin päätös: tumman/vaalean teeman tarkat paletit ja typografia päätetään new-work-vaiheessa.

## Brand Commitments

- Nimi ja domain: **uutisrapsa.fi**.
- Epävirallinen fanisivusto -disclaimer on sitova (ks. Positioning).
- Äänensävy: **podcastin henkinen** — kepeä, pilke silmäkulmassa; UI-tekstit saavat olla leikkisiä Uutisraportin tyyliin (vahvistettu 16.9.2026).
- Käyttäjän sitovat visuaaliset reunaehdot (käyttäjä nimesi itse 16.9.2026, kirjattu laajentamatta): ilme on **flätti ja tyylikäs**, pois nykyisestä "vibe-koodatusta violetista hehkusta"; sivustolla on **sekä tumma että vaalea teema, joka seuraa laitteen asetusta** (`prefers-color-scheme`). Tyylireferenssi, josta käyttäjä pitää: https://promille.jyrki-anttila.workers.dev (lähes musta viileä pohja, kapea harmaa-asteikko, DM Mono + Bebas Neue, hiusviivat, ei gradientteja/hehkuja) — referenssi, ei kopioitava.

## Evidence on Hand

- 482 jaksoa / ~1240 suositusta tuotantodatassa (`suositukset.json` repon juuressa).
- Todellinen lukijapalaute palautelomakkeen sijainnista (26.5.2026 ja myöhempi anonyymi palaute).
- Ei testimoniaaleja tai lehdistömainintoja — ei keksitä sellaisia.

## Product Principles

1. **Data on tuote**: suosituksen löytäminen nopeasti menee kaiken muun edelle.
2. **Molemmat käyttötavat ovat tasavertaisia**: tuorein jakso näkyvästi, koko arkisto vaivatta selailtavana.
3. **Toimii joka laitteella** — myös admin-UI (iPad sohvalla on rima).
4. **Leikkisä, muttei tiellä**: huumori saa näkyä, mutta ei koskaan hidastaa löytämistä.
5. **Rehellinen merkintä**: fanisivusto-disclaimer ja mainosmerkinnät näkyvillä, ei piilotettuina.

## Accessibility & Inclusion

Responsiivisuus puhelimesta työpöytään sekä julkisella sivulla että admin-UI:ssa. Pitkien listojen luettavuus (satoja suosituksia). Molempien teemojen kontrastien on kestettävä tarkastelu (WCAG AA -taso tekstille).
