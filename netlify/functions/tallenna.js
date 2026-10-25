// netlify/functions/tallenna.js
// Tallentaa admin-näkymän korjaukset admin/korjaukset.json-tiedostoon ja
// Tarkistus-välilehden päätökset admin/tarkistuspaatokset.json-tiedostoon.
//
// Runko: joko pelkkä korjauslista (vanha muoto) tai
// { korjaukset: [...], tarkistus: [{avain, paatos, r_idx, teos, data}] }.
// Hyväksytyt tarkistuspäätökset muunnetaan korjausmerkinnöiksi täällä (mainin
// tuoreimmasta datasta), ja molemmat tiedostot kirjoitetaan YHTEEN committiin
// Git Data API:lla, jotta päätös ja sen korjaus eivät voi erota toisistaan.
// Jos main ehtii liikkua lukemisen ja kirjoittamisen välissä, yritetään uudelleen.

const { muunnaPaatokset, TarkistusVirhe } = require('../lib/tarkistus');

const REPO = 'albrto/uutisrapsa';
const API = `https://api.github.com/repos/${REPO}`;
const KORJAUKSET = 'admin/korjaukset.json';
const PAATOKSET = 'admin/tarkistuspaatokset.json';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers.authorization;
  const adminPswd = process.env.ADMIN_PASSWORD;

  if (!adminPswd || !authHeader || authHeader !== `Bearer ${adminPswd}`) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let runko;
  try {
    runko = JSON.parse(event.body);
  } catch (e) {
    return vastaus(400, { error: 'Virheellinen pyyntö' });
  }
  const corrections = Array.isArray(runko) ? runko : (runko.korjaukset || []);
  const tarkistus = Array.isArray(runko) ? [] : (runko.tarkistus || []);
  if (corrections.length === 0 && tarkistus.length === 0) {
    return vastaus(200, { success: true, message: 'Ei tallennettavaa' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return vastaus(500, { error: 'GITHUB_TOKEN puuttuu Netlifyn ympäristömuuttujista' });

  const gh = (polku, asetukset = {}) => fetch(`${API}${polku}`, {
    ...asetukset,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': asetukset.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
  });
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

      const raakaKorjaukset = await lueTiedosto(KORJAUKSET, pohjaSha);
      const currentList = raakaKorjaukset ? JSON.parse(raakaKorjaukset) : [];
      // Kopio: uudelleenyritys alkaa samasta selaimen lähettämästä tilasta
      const uudet = corrections.map(k => ({ ...k }));

      const tarvitaanSuositukset = tarkistus.length > 0 || uudet.some(k => k.tyyppi === 'lisays');
      const suositukset = tarvitaanSuositukset ? JSON.parse(await lueTiedosto('suositukset.json', pohjaSha)) : null;

      let raakaPaatokset = null, paatokset = null;
      if (tarkistus.length > 0) {
        raakaPaatokset = await lueTiedosto(PAATOKSET, pohjaSha);
        const aika = new Date().toISOString().slice(0, 19);
        const tulos = muunnaPaatokset(tarkistus, raakaPaatokset ? JSON.parse(raakaPaatokset) : {},
                                      suositukset, currentList.concat(uudet), aika);
        uudet.push(...tulos.korjaukset);
        paatokset = tulos.tallennetut;
      }

      // Lisäykset ("Lisää suositus" ja tarkistuksen puuttuvat): paikka (r_idx)
      // lasketaan täällä eikä selaimessa, koska sivuston suositukset.json voi
      // olla deployn verran jäljessä. Paikka = jakson loppu mainin
      // suositukset.json:ssa, tai odottavien lisäysten perään, jos niitä ei ole
      // vielä sovellettu.
      const seuraava = {};
      for (const k of uudet.filter(k => k.tyyppi === 'lisays')) {
        if (!(k.jakso_id in seuraava)) {
          const jakso = suositukset.find(j => j.id === k.jakso_id);
          if (!jakso) throw new TarkistusVirhe(`Jaksoa ei löydy: ${k.jakso_id}`);
          let paikka = (jakso.suositukset || []).length;
          for (const o of currentList) {
            if (o.tyyppi === 'lisays' && o.jakso_id === k.jakso_id) paikka = Math.max(paikka, o.r_idx + 1);
          }
          seuraava[k.jakso_id] = paikka;
        }
        k.r_idx = seuraava[k.jakso_id]++;
      }

      // Sama muoto kuin Python-skriptien json.dump(indent=2, ensure_ascii=False)
      const json = x => JSON.stringify(x, null, 2);
      const tiedostot = [];
      if (uudet.length) tiedostot.push([KORJAUKSET, json(currentList.concat(uudet))]);
      if (paatokset) tiedostot.push([PAATOKSET, json(paatokset)]);

      const puu = [];
      for (const [polku, sisalto] of tiedostot) {
        const blobRes = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: sisalto, encoding: 'utf-8' }) });
        if (!blobRes.ok) throw new Error(`Tiedoston ${polku} tallennus epäonnistui: ${blobRes.statusText}`);
        puu.push({ path: polku, mode: '100644', type: 'blob', sha: (await blobRes.json()).sha });
      }
      const treeRes = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: pohjaPuu, tree: puu }) });
      if (!treeRes.ok) throw new Error(`Tree-luonti epäonnistui: ${treeRes.statusText}`);

      const tarkistuksia = tarkistus.filter(p => p.paatos).length;
      const viesti = corrections.length && !tarkistuksia
        ? `Tallenna ${corrections.length} korjausta admin-näkymästä`
        : `Tallenna admin-näkymästä: ${corrections.length} korjausta, ${tarkistuksia} tarkistuspäätöstä`
          + `\n\nTarkistuksesta korjauksiin: ${uudet.length - corrections.length} merkintää`;
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
          message: `Tallennettu ${uudet.length} korjausta`,
          tallennetut: uudet,
        });
      }
      if (paivitysRes.status !== 422 || yritys === 3) {
        throw new Error(`main-haaran päivitys epäonnistui: ${paivitysRes.status} ${paivitysRes.statusText}`);
      }
      // 422 = ei fast-forward: joku tallensi välissä → luetaan tuore tila ja yritetään uudelleen
    }
  } catch (virhe) {
    if (virhe instanceof TarkistusVirhe) return vastaus(virhe.koodi, { error: virhe.message });
    console.error('Error saving to github:', virhe);
    return vastaus(500, { error: virhe.message });
  }
};

function vastaus(statusCode, runko) {
  return { statusCode, body: JSON.stringify(runko) };
}
