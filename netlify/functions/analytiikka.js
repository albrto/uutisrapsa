// netlify/functions/analytiikka.js
// Hakee kävijätilastot GoatCounterin API:sta admin/analytiikka.html-näkymälle.
// API-avain (GOATCOUNTER_TOKEN) pysyy palvelimella; selain todistaa olevansa
// ylläpitäjä samalla ADMIN_PASSWORD-salasanalla kuin muut admin-funktiot.
//
// GET ?alku=<RFC3339>&loppu=<RFC3339>            → yleiskuva (summat, päivät, sivut, lähteet, laitteet …)
// GET ?alku=…&loppu=…&polku=<path_id>            → mistä tälle sivulle tultiin
// GET ?alku=…&loppu=…&lahde=<ref id>             → mille sivuille tästä lähteestä tultiin
//
// Ympäristömuuttujat: GOATCOUNTER_TOKEN (pakollinen, GoatCounter → Settings → API,
// oikeus "Read statistics"), GOATCOUNTER_SITE (valinnainen, oletus "uutisrapsa").

const VALIMUISTI = new Map();          // avain → { aika, data }; elää funktion instanssin ajan
const VALIMUISTI_MS = 5 * 60 * 1000;
const AIKA = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00(Z|[+-]\d{2}:\d{2})$/;

const odota = ms => new Promise(r => setTimeout(r, ms));

function vastaus(status, data) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(data),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return vastaus(405, { virhe: 'Method Not Allowed' });

  const adminPswd = process.env.ADMIN_PASSWORD;
  const authHeader = event.headers.authorization;
  if (!adminPswd || !authHeader || authHeader !== `Bearer ${adminPswd}`) {
    return vastaus(401, { virhe: 'Unauthorized' });
  }

  const token = process.env.GOATCOUNTER_TOKEN;
  if (!token) return vastaus(503, { virhe: 'avain-puuttuu' });
  const sivusto = process.env.GOATCOUNTER_SITE || 'uutisrapsa';
  const pohja = `https://${sivusto}.goatcounter.com/api/v0`;

  const q = event.queryStringParameters || {};
  const { alku, loppu, edAlku, edLoppu } = q;
  for (const t of [alku, loppu, edAlku, edLoppu]) {
    if (t !== undefined && !AIKA.test(t)) return vastaus(400, { virhe: 'Virheellinen aikaväli' });
  }
  if (!alku || !loppu) return vastaus(400, { virhe: 'alku ja loppu puuttuvat' });

  const avain = JSON.stringify(q);
  const muistissa = VALIMUISTI.get(avain);
  if (muistissa && Date.now() - muistissa.aika < VALIMUISTI_MS) return vastaus(200, muistissa.data);

  // GoatCounter rajoittaa API-kutsut muutamaan sekunnissa → kutsut peräkkäin
  // pienellä välillä, ja 429:n jälkeen yksi uusi yritys.
  let edellinen = 0;
  async function hae(polku, parametrit) {
    const url = new URL(pohja + polku);
    for (const [k, v] of Object.entries(parametrit)) url.searchParams.set(k, v);
    for (let yritys = 0; yritys < 3; yritys++) {
      const vali = 270 - (Date.now() - edellinen);
      if (vali > 0) await odota(vali);
      edellinen = Date.now();
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      if (res.status === 429) {
        await odota(Math.min(3000, (Number(res.headers.get('Retry-After')) || 1) * 1000));
        continue;
      }
      if (!res.ok) {
        const teksti = (await res.text()).slice(0, 300);
        throw new Error(`GoatCounter ${res.status} (${polku}): ${teksti}`);
      }
      return res.json();
    }
    throw new Error(`GoatCounter: liikaa pyyntöjä (${polku})`);
  }

  const vali = { start: alku, end: loppu };

  try {
    let data;
    if (q.polku) {
      if (!/^\d+$/.test(q.polku)) return vastaus(400, { virhe: 'Virheellinen polku' });
      const r = await hae(`/stats/hits/${q.polku}`, { ...vali, limit: 50 });
      data = { lahteet: (r.refs || []).map(x => ({ nimi: x.name, maara: x.count, tyyppi: x.ref_scheme })) };
    } else if (q.lahde !== undefined) {
      const r = await hae(`/stats/toprefs/${encodeURIComponent(q.lahde)}`, { ...vali, limit: 50 });
      data = { sivut: (r.stats || []).map(x => ({ nimi: x.name, maara: x.count })) };
    } else {
      const total = await hae('/stats/total', vali);
      const ed = edAlku && edLoppu ? await hae('/stats/total', { start: edAlku, end: edLoppu }) : null;
      const hits = await hae('/stats/hits', { ...vali, limit: 100 });
      const listat = {};
      for (const sivu of ['toprefs', 'sizes', 'browsers', 'systems', 'locations']) {
        const r = await hae(`/stats/${sivu}`, { ...vali, limit: sivu === 'toprefs' ? 50 : 20 });
        listat[sivu] = (r.stats || []).map(x => ({ id: x.id, nimi: x.name, maara: x.count, tyyppi: x.ref_scheme }));
      }

      // Tunnit viikonpäivittäin (paikallista aikaa), jos GoatCounter palauttaa tuntisarjat
      const tunnit = Array.from({ length: 7 }, () => new Array(24).fill(0));
      let tunteja = false;
      for (const p of total.stats || []) {
        if (!Array.isArray(p.hourly) || p.hourly.length !== 24) continue;
        const vp = (new Date(p.day + 'T12:00:00Z').getUTCDay() + 6) % 7; // ma = 0
        p.hourly.forEach((n, h) => { tunnit[vp][h] += n; if (n) tunteja = true; });
      }

      data = {
        haettu: new Date().toISOString(),
        yhteensa: total.total,
        tapahtumat: total.total_events,
        edellinen: ed ? ed.total : null,
        paivat: (total.stats || []).map(p => ({ pvm: p.day, maara: p.daily })),
        tunnit: tunteja ? tunnit : null,
        // Päivä- ja tuntisarjat pois: 100 sivua × 365 päivää × 24 tuntia olisi megatavuja
        sivut: (hits.hits || []).map(h => ({ id: h.path_id, polku: h.path, otsikko: h.title, maara: h.count, tapahtuma: h.event })),
        sivujaLisaa: !!hits.more,
        lahteet: listat.toprefs,
        koot: listat.sizes,
        selaimet: listat.browsers,
        jarjestelmat: listat.systems,
        maat: listat.locations,
      };
    }
    VALIMUISTI.set(avain, { aika: Date.now(), data });
    if (VALIMUISTI.size > 50) VALIMUISTI.delete(VALIMUISTI.keys().next().value);
    return vastaus(200, data);
  } catch (e) {
    console.error(e);
    return vastaus(502, { virhe: e.message });
  }
};
