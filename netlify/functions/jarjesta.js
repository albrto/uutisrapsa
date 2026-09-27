// netlify/functions/jarjesta.js
// Muuttaa jakson suositusten järjestyksen (admin-näkymän "Muuta järjestystä").
//
// Kirjoittaa YHDEN commitin, jossa suositukset.json ja kaikki r_idx-viitteet
// (korjaukset.json, ohitukset.json, epailyttavat.json/.js) muuttuvat yhdessä —
// erillisinä tallennuksina välitila rikkoisi korjausten uudelleenajon.
// Käyttää Git Data API:a (contents-API ei osaa monen tiedoston committia).
// Jos main ehtii liikkua lukemisen ja kirjoittamisen välissä, yritetään uudelleen.

const { jarjestaJakso, JarjestysVirhe } = require('../lib/jarjestys');

const REPO = 'albrto/uutisrapsa';
const API = `https://api.github.com/repos/${REPO}`;
const JS_ETULIITE = 'window.VALIDATION_DATA = ';
const TIEDOSTOT = {
  suositukset: 'suositukset.json',
  korjaukset: 'admin/korjaukset.json',
  ohitukset: 'admin/ohitukset.json',
  epailyttavat: 'admin/epailyttavat.json',
  epailyttavatJs: 'admin/epailyttavat.js',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const adminPswd = process.env.ADMIN_PASSWORD;
  if (!adminPswd || event.headers.authorization !== `Bearer ${adminPswd}`) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) return vastaus(500, { error: 'GITHUB_TOKEN puuttuu Netlifyn ympäristömuuttujista' });

  let pyynto;
  try {
    pyynto = JSON.parse(event.body);
  } catch (e) {
    return vastaus(400, { error: 'Virheellinen pyyntö' });
  }
  const { jakso_id, jarjestys, teokset } = pyynto;

  const gh = async (polku, asetukset = {}) => {
    const res = await fetch(`${API}${polku}`, {
      ...asetukset,
      headers: {
        'Authorization': `token ${token}`,
        'Accept': asetukset.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
    });
    return res;
  };
  const lueTiedosto = async (polku, ref) => {
    // raw-muoto: contents-API:n JSON-vastaus ei kanna yli 1 Mt tiedostoja
    const res = await gh(`/contents/${polku}?ref=${ref}`, { raw: true });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${polku} lukeminen epäonnistui: ${res.status} ${res.statusText}`);
    return res.text();
  };

  try {
    for (let yritys = 1; yritys <= 3; yritys++) {
      const refRes = await gh('/git/ref/heads/main');
      if (!refRes.ok) throw new Error(`main-haaran luku epäonnistui: ${refRes.statusText}`);
      const pohjaSha = (await refRes.json()).object.sha;
      const commitRes = await gh(`/git/commits/${pohjaSha}`);
      const pohjaPuu = (await commitRes.json()).tree.sha;

      const raaka = {};
      for (const [avain, polku] of Object.entries(TIEDOSTOT)) raaka[avain] = await lueTiedosto(polku, pohjaSha);
      if (raaka.suositukset === null) throw new Error('suositukset.json puuttuu');

      const data = {
        suositukset: JSON.parse(raaka.suositukset),
        korjaukset: raaka.korjaukset ? JSON.parse(raaka.korjaukset) : [],
        ohitukset: raaka.ohitukset ? JSON.parse(raaka.ohitukset) : [],
        epailyttavat: raaka.epailyttavat ? JSON.parse(raaka.epailyttavat) : null,
      };
      const tulos = jarjestaJakso(data, jakso_id, jarjestys, teokset);
      const jakso = tulos.suositukset.find(j => j.id === jakso_id);

      // Sama muoto kuin Python-skriptien json.dump(indent=2, ensure_ascii=False)
      const json = x => JSON.stringify(x, null, 2);
      const uudet = { suositukset: json(tulos.suositukset) };
      if (tulos.korjauksia) uudet.korjaukset = json(tulos.korjaukset);
      if (tulos.ohituksia) uudet.ohitukset = json(tulos.ohitukset);
      if (tulos.epailyttavat) {
        uudet.epailyttavat = json(tulos.epailyttavat);
        if (raaka.epailyttavatJs !== null) uudet.epailyttavatJs = `${JS_ETULIITE}${uudet.epailyttavat};\n`;
      }

      const puu = [];
      for (const [avain, sisalto] of Object.entries(uudet)) {
        if (sisalto === raaka[avain]) continue;
        const blobRes = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: sisalto, encoding: 'utf-8' }) });
        if (!blobRes.ok) throw new Error(`Tiedoston ${TIEDOSTOT[avain]} tallennus epäonnistui: ${blobRes.statusText}`);
        puu.push({ path: TIEDOSTOT[avain], mode: '100644', type: 'blob', sha: (await blobRes.json()).sha });
      }

      const treeRes = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: pohjaPuu, tree: puu }) });
      if (!treeRes.ok) throw new Error(`Tree-luonti epäonnistui: ${treeRes.statusText}`);
      const viesti = `Järjestä suositukset: ${jakso.jakso_otsikko} (${jakso.paivamaara})\n\n`
        + `Uusi järjestys: ${jakso.suositukset.map(r => r.teos).join(' / ')}\n`
        + `Siirretty viitteitä: ${tulos.korjauksia} korjausta, ${tulos.ohituksia} ohitusta (admin-näkymästä)`;
      const uusiCommitRes = await gh('/git/commits', {
        method: 'POST',
        body: JSON.stringify({ message: viesti, tree: (await treeRes.json()).sha, parents: [pohjaSha] }),
      });
      if (!uusiCommitRes.ok) throw new Error(`Commitin luonti epäonnistui: ${uusiCommitRes.statusText}`);
      const uusiSha = (await uusiCommitRes.json()).sha;

      // force: false → hylätään, jos main liikkui välissä (esim. tuotantoajo tallensi)
      const paivitysRes = await gh('/git/refs/heads/main', { method: 'PATCH', body: JSON.stringify({ sha: uusiSha, force: false }) });
      if (paivitysRes.ok) {
        return vastaus(200, {
          success: true,
          commit: uusiSha,
          jarjestys: jakso.suositukset.map(r => r.teos),
          korjauksia: tulos.korjauksia,
          ohituksia: tulos.ohituksia,
        });
      }
      if (paivitysRes.status !== 422 || yritys === 3) {
        throw new Error(`main-haaran päivitys epäonnistui: ${paivitysRes.status} ${paivitysRes.statusText}`);
      }
      // 422 = ei fast-forward: joku tallensi välissä → luetaan tuore tila ja yritetään uudelleen
    }
  } catch (virhe) {
    if (virhe instanceof JarjestysVirhe) return vastaus(virhe.koodi, { error: virhe.message });
    console.error('Järjestyksen tallennus epäonnistui:', virhe);
    return vastaus(500, { error: virhe.message });
  }
};

function vastaus(statusCode, runko) {
  return { statusCode, body: JSON.stringify(runko) };
}
