// Jaettujen alasivulinkkien esikatselu (WhatsApp, Slack, Facebook, Google …).
//
// Sama index.html palvelee kaikkia alasivuja (netlify.toml), joten ilman tätä jokainen
// jaettu /suositus/…- tai /suosittelija/…-linkki näyttäisi etusivun otsikon ja kuvauksen.
// Funktio hakee suositukset.json:n, etsii polkua vastaavan suosituksen tai suosittelijan
// ja kirjoittaa sivun <title>-, description- ja og/twitter-tagit sen mukaan.
// Kaikki virheet → alkuperäinen sivu sellaisenaan (esikatselu ei saa koskaan rikkoa sivua).
//
// Tunnisteen laskenta on sama kuin app.js:n tunniste(): FNV-1a "<jakso_id>:<r_idx>",
// r_idx laskettuna ennen piilotettujen ohitusta. Pidä nämä samoina.

let valimuisti = null; // { haettu, suositukset, suosittelijat }
const VALIMUISTIN_IKA_MS = 10 * 60 * 1000;

function tunniste(teksti) {
  let h = 0x811c9dc5;
  for (let i = 0; i < teksti.length; i++) {
    h ^= teksti.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

function slugiksi(teksti) {
  return String(teksti || '').toLowerCase()
    .replace(/[äå]/g, 'a').replace(/ö/g, 'o')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60).replace(/-+$/, '');
}

const escape = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function lyhenna(teksti, pituus = 200) {
  const t = String(teksti || '').replace(/\s+/g, ' ').trim();
  return t.length <= pituus ? t : t.slice(0, pituus - 1).replace(/\s+\S*$/, '') + '…';
}

async function lataaData(url) {
  if (valimuisti && Date.now() - valimuisti.haettu < VALIMUISTIN_IKA_MS) return valimuisti;
  const vastaus = await fetch(new URL('/suositukset.json', url));
  if (!vastaus.ok) throw new Error(`suositukset.json ${vastaus.status}`);
  const data = await vastaus.json();
  const suositukset = new Map();
  const suosittelijat = new Map();
  for (const jakso of data) {
    (jakso.suositukset || []).forEach((rec, r_idx) => {
      if (rec.piilotettu) return;
      suositukset.set(tunniste(`${jakso.id}:${r_idx}`), { ...rec, paivamaara: jakso.paivamaara });
      const nimi = rec.suosittelija;
      if (nimi && !/^(tuntematon|ei varmuutta)$/i.test(nimi)) {
        const s = suosittelijat.get(slugiksi(nimi)) || { nimi, maara: 0 };
        s.maara++;
        suosittelijat.set(slugiksi(nimi), s);
      }
    });
  }
  valimuisti = { haettu: Date.now(), suositukset, suosittelijat };
  return valimuisti;
}

function korvaaMeta(html, otsikko, kuvaus) {
  const o = escape(otsikko), k = escape(kuvaus);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${o}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${k}$2`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/, `$1${o}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${k}$2`)
    .replace(/(<meta\s+property="twitter:title"\s+content=")[^"]*(")/, `$1${o}$2`)
    .replace(/(<meta\s+property="twitter:description"\s+content=")[^"]*(")/, `$1${k}$2`);
}

export default async (request, context) => {
  const vastaus = await context.next();
  try {
    if (!(vastaus.headers.get('content-type') || '').includes('text/html')) return vastaus;
    const polku = new URL(request.url).pathname.replace(/\/+$/, '');
    const osat = polku.split('/');
    const { suositukset, suosittelijat } = await lataaData(request.url);

    let otsikko = null, kuvaus = null;
    if (osat[1] === 'suositus') {
      const rec = suositukset.get(polku.split('-').pop());
      if (rec) {
        const kuka = rec.suosittelija && !/^(tuntematon|ei varmuutta)$/i.test(rec.suosittelija)
          ? `${rec.suosittelija} suosittelee` : 'Uutisraportti suosittelee';
        otsikko = `${rec.teos} – ${kuka}`;
        kuvaus = lyhenna(`${rec.kuvaus || ''} (Uutisraportti ${rec.paivamaara})`);
      }
    } else if (osat[1] === 'suosittelija') {
      const s = suosittelijat.get(osat[2]);
      if (s) {
        otsikko = `${s.nimi} suosittelee – Uutisrapsa`;
        kuvaus = `${s.nimi} on suositellut Uutisraportti-podcastissa ${s.maara} kertaa – kirjoja, sarjoja, podcasteja ja paljon muuta. Kaikki suositukset yhdessä paikassa.`;
      }
    }
    if (!otsikko) return vastaus;

    const html = korvaaMeta(await vastaus.text(), otsikko, kuvaus);
    const otsakkeet = new Headers(vastaus.headers);
    otsakkeet.delete('content-length');
    otsakkeet.delete('etag');
    return new Response(html, { status: vastaus.status, headers: otsakkeet });
  } catch (virhe) {
    console.error('jakokortti:', virhe);
    return vastaus;
  }
};

export const config = { path: ['/suositus/*', '/suosittelija/*'] };
