// netlify/lib/jarjestys.js
// Jakson suositusten järjestyksen muutos (admin-näkymän "Muuta järjestystä").
//
// Suosituksiin viitataan kaikkialla paikkanumerolla r_idx, ja koko
// korjaukset.json ajetaan uudelleen jokaisella tuotantoajolla. Siksi järjestystä
// ei voi muuttaa korjausmerkinnällä, vaan kerralla kaikkiin paikkoihin:
// suositukset.json (itse järjestys) sekä korjaukset.json, ohitukset.json ja
// epailyttavat.json/.js (r_idx-viitteet uusiin paikkoihin). Puhdas funktio —
// GitHub-luku ja -kirjoitus ovat netlify/functions/jarjesta.js:ssä.

class JarjestysVirhe extends Error {
  constructor(viesti, koodi = 400) {
    super(viesti);
    this.koodi = koodi;
  }
}

/**
 * @param {object} data  { suositukset, korjaukset, ohitukset, epailyttavat } (jäsennettyinä)
 * @param {string} jakso_id
 * @param {number[]} jarjestys  vanhat r_idx:t uudessa järjestyksessä, esim. [0, 2, 3, 1, 4]
 * @param {string[]} teokset   selaimen näkemät teosnimet uudessa järjestyksessä (vanhentuneen datan tarkistus)
 * @returns {object} uudet { suositukset, korjaukset, ohitukset, epailyttavat } + laskurit
 */
function jarjestaJakso(data, jakso_id, jarjestys, teokset) {
  const jakso = data.suositukset.find(j => j.id === jakso_id);
  if (!jakso) throw new JarjestysVirhe(`Jaksoa ei löydy: ${jakso_id}`, 404);
  const recs = jakso.suositukset || [];
  const n = recs.length;

  const onPermutaatio = Array.isArray(jarjestys) && jarjestys.length === n
    && new Set(jarjestys).size === n && jarjestys.every(i => Number.isInteger(i) && i >= 0 && i < n);
  if (!onPermutaatio) throw new JarjestysVirhe('Järjestys ei vastaa jakson suosituksia.');
  if (jarjestys.every((vanha, uusi) => vanha === uusi)) throw new JarjestysVirhe('Järjestys ei muuttunut.');

  // Selaimen data voi olla deployn verran jäljessä (esim. juuri tallennettu
  // edellinen järjestys ei vielä näy) — silloin paikat eivät vastaa toisiaan
  if (!Array.isArray(teokset) || teokset.length !== n || jarjestys.some((vanha, i) => recs[vanha].teos !== teokset[i])) {
    throw new JarjestysVirhe('Sivun tiedot ovat vanhentuneet. Odota hetki ja lataa sivu uudelleen.', 409);
  }

  // Tallennettu mutta vielä soveltamaton lisäys varaa paikan jakson lopusta —
  // sen paikka riippuu nykyisestä pituudesta, joten järjestys odottaa sen julkaisua
  const odottava = (data.korjaukset || []).some(k => k.tyyppi === 'lisays' && k.jakso_id === jakso_id && k.r_idx >= n);
  if (odottava) throw new JarjestysVirhe('Jaksossa on tallennettu lisäys, jota ei ole vielä julkaistu. Odota tuotantoajon valmistumista.', 409);

  const uusiPaikka = {};
  jarjestys.forEach((vanha, uusi) => { uusiPaikka[vanha] = uusi; });
  const siirra = r_idx => (Number.isInteger(r_idx) && r_idx in uusiPaikka ? uusiPaikka[r_idx] : r_idx);

  let korjauksia = 0, ohituksia = 0;
  const korjaukset = (data.korjaukset || []).map(k => {
    if (k.jakso_id !== jakso_id || siirra(k.r_idx) === k.r_idx) return k;
    korjauksia++;
    return { ...k, r_idx: siirra(k.r_idx) };
  });
  const ohitukset = (data.ohitukset || []).map(o => {
    if (o.jakso_id !== jakso_id || siirra(o.r_idx) === o.r_idx) return o;
    ohituksia++;
    return { ...o, r_idx: siirra(o.r_idx) };
  });

  const suositukset = data.suositukset.map(j =>
    j.id === jakso_id ? { ...j, suositukset: jarjestys.map(vanha => recs[vanha]) } : j);

  // Validointidata: jakson suositukset kantavat oman r_idx-kenttänsä
  const epailyttavat = data.epailyttavat && data.epailyttavat.map(j => {
    if (j.jakso_id !== jakso_id) return j;
    const uudet = j.suositukset
      .map(r => ({ ...r, r_idx: siirra(r.r_idx) }))
      .sort((a, b) => a.r_idx - b.r_idx);
    return { ...j, suositukset: uudet };
  });

  return { suositukset, korjaukset, ohitukset, epailyttavat, korjauksia, ohituksia };
}

module.exports = { jarjestaJakso, JarjestysVirhe };
