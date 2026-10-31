// netlify/lib/tarkistus.js
// Tarkistus-välilehden päätökset → korjaukset.json-merkinnät.
//
// Sama logiikka kuin paikallisen tarkistustyökalun "Vie" (pipeline/tarkistus/
// palvelin.py, vie_korjauksiin): hyväksytty suosittelija-/teosero = täysi tietue
// (saman suosituksen useampi ero yhdistetään), puuttuva = tyyppi "lisays",
// "Piilota sivulta" = tyyppi "poisto". Lisäysten r_idx lasketaan tallenna.js:ssä
// samalla säännöllä kuin admin-näkymän omille lisäyksille.

const REC_KENTAT = ['teos', 'paakategoria', 'google_linkki', 'lisatieto_linkki', 'kuvaus', 'suosittelija', 'kategoriat'];
// Viedään vain, jos päätöksen datassa on arvo (podcastin alkuperä ohjaa kuuntelulinkkejä)
const VALINNAISET_KENTAT = ['alkupera', 'lisalinkit', 'antisuositus'];
const PAATOKSET = ['hyvaksytty', 'hylatty', 'poista'];

class TarkistusVirhe extends Error {
  constructor(viesti, koodi = 409) { super(viesti); this.koodi = koodi; }
}

const onArvo = v => Array.isArray(v) ? v.length > 0 : !!v;

// Suosituksen nykytila: mainin suositukset.json + saman paikan korjaukset, joita
// tuotantoajo ei ehkä ole vielä soveltanut (uudelleensoveltaminen ei muuta mitään)
function nykyinenSuositus(jakso, r_idx, korjaukset) {
  const rec = { ...(jakso.suositukset[r_idx] || {}) };
  for (const k of korjaukset) {
    if (k.jakso_id !== jakso.id || k.r_idx !== r_idx || k.tyyppi === 'poisto') continue;
    if (k.uusi_data) Object.assign(rec, k.uusi_data);
    else if (k.uusi_suosittelija) rec.suosittelija = k.uusi_suosittelija;
  }
  return rec;
}

// Ehdotuksen r_idx on ehdotuksen tekohetken paikka. Jos jakson järjestystä on muutettu
// sen jälkeen ("Muuta järjestystä"), sama teos on nyt muualla: etsitään se teoksen nimellä
// (sivun tai korjausten mukaisella). Ilman yksiselitteistä vastinetta pidetään alkuperäinen paikka.
function oikeaPaikka(jakso, r_idx, teos, korjaukset) {
  const recs = jakso.suositukset || [];
  const sama = i => i < recs.length && (recs[i].teos === teos || nykyinenSuositus(jakso, i, korjaukset).teos === teos);
  if (!teos || !Number.isInteger(r_idx) || sama(r_idx)) return r_idx;
  const loydetyt = recs.map((_, i) => i).filter(sama);
  return loydetyt.length === 1 ? loydetyt[0] : r_idx;
}

/**
 * @param paatokset  selaimen lähettämät: [{avain, paatos: hyvaksytty|hylatty|poista|null, r_idx, teos, data}]
 * @param tallennetut admin/tarkistuspaatokset.json ({avain: {paatos, r_idx, data, aika, viety?}})
 * @param suositukset mainin suositukset.json
 * @param korjaukset  korjaukset.json + saman tallennuksen admin-korjaukset
 * @returns {korjaukset: uudet merkinnät (lisäysten r_idx = null), tallennetut: päivitetty kirjanpito}
 */
function muunnaPaatokset(paatokset, tallennetut, suositukset, korjaukset, aika) {
  const jaksot = new Map(suositukset.map(j => [j.id, j]));
  const uusiKirjanpito = { ...tallennetut };
  const muokkaukset = new Map();   // "jakso_id\u0000r_idx" → merkintä (useampi ero samaan suositukseen)
  const lisaykset = [], poistot = [];

  for (let p of paatokset) {
    const vanha = tallennetut[p.avain];
    // Jo korjauksiin viety päätös on lukittu (esim. vanhentunut luonnos toisesta selaimesta)
    if (vanha && vanha.viety) continue;
    if (p.paatos === null) { delete uusiKirjanpito[p.avain]; continue; }
    if (!PAATOKSET.includes(p.paatos)) throw new TarkistusVirhe(`Tuntematon päätös: ${p.paatos}`, 400);

    const [jakso_id, tyyppi] = p.avain.split('::');
    const merkinta = { paatos: p.paatos, r_idx: p.r_idx ?? null, data: p.paatos === 'hyvaksytty' ? (p.data || {}) : null, aika };
    uusiKirjanpito[p.avain] = merkinta;
    if (p.paatos === 'hylatty') continue;

    const jakso = jaksot.get(jakso_id);
    if (!jakso) throw new TarkistusVirhe(`Jaksoa ei löydy: ${jakso_id}`);
    if (tyyppi !== 'puuttuu') p = { ...p, r_idx: oikeaPaikka(jakso, p.r_idx, p.teos, korjaukset) };
    merkinta.r_idx = p.r_idx ?? null;
    const otsikko = { jakso_id, jakso_otsikko: jakso.jakso_otsikko, paivamaara: jakso.paivamaara };
    const recs = jakso.suositukset || [];
    const data = p.data || {};

    if (p.paatos === 'poista') {
      if (tyyppi !== 'ylimaarainen') throw new TarkistusVirhe(`Piilotus sopii vain ylimääräiselle: ${p.avain}`, 400);
      // Teos-vahti: jos jakson järjestys on muuttunut, ei piiloteta väärää suositusta
      if (!(p.r_idx < recs.length) || recs[p.r_idx].teos !== p.teos) {
        throw new TarkistusVirhe(`Piilotettava paikka ${p.r_idx} ei enää ole ”${p.teos}” (${jakso.paivamaara})`);
      }
      poistot.push({ tyyppi: 'poisto', ...otsikko, r_idx: p.r_idx, teos: recs[p.r_idx].teos });
    } else if (tyyppi === 'suosittelija' || tyyppi === 'teos') {
      if (!(p.r_idx < recs.length)) throw new TarkistusVirhe(`Suositusta ${p.r_idx} ei löydy jaksosta ${jakso.paivamaara}`);
      const tunnus = `${jakso_id}\u0000${p.r_idx}`;
      if (!muokkaukset.has(tunnus)) {
        const nyt = nykyinenSuositus(jakso, p.r_idx, korjaukset);
        const pohja = Object.fromEntries(REC_KENTAT.map(k => [k, nyt[k] ?? (k === 'kategoriat' ? [] : '')]));
        muokkaukset.set(tunnus, { ...otsikko, r_idx: p.r_idx, teos: recs[p.r_idx].teos, uusi_data: pohja });
      }
      const uusi = muokkaukset.get(tunnus).uusi_data;
      for (const [k, v] of Object.entries(data)) {
        if (REC_KENTAT.includes(k) || (VALINNAISET_KENTAT.includes(k) && onArvo(v))) uusi[k] = v;
      }
    } else if (tyyppi === 'puuttuu') {
      const uusi = Object.fromEntries(REC_KENTAT.map(k => [k, data[k] ?? (k === 'kategoriat' ? [] : '')]));
      for (const k of VALINNAISET_KENTAT) if (onArvo(data[k])) uusi[k] = data[k];
      if (!uusi.teos) throw new TarkistusVirhe(`Lisättävältä suositukselta puuttuu teos: ${p.avain}`, 400);
      lisaykset.push({ tyyppi: 'lisays', ...otsikko, r_idx: null, teos: uusi.teos, uusi_data: uusi });
    } else {
      throw new TarkistusVirhe(`Hyväksyntä ei sovi tyypille ${tyyppi}: ${p.avain}`, 400);
    }
    merkinta.viety = aika;
  }
  // lahde: admin-näkymän Muutetut-välilehti erottaa tarkistuksesta tulleet käsin tehdyistä
  const uudet = [...muokkaukset.values(), ...poistot, ...lisaykset].map(k => ({ ...k, lahde: 'tarkistus' }));
  return { korjaukset: uudet, tallennetut: uusiKirjanpito };
}

module.exports = { muunnaPaatokset, TarkistusVirhe };
