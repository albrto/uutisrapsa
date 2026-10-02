// ===== UUTISRAPSA – WEB-SOVELLUS =====
//
// Yksi sivu palvelee kaikkia näkymiä (netlify.toml ohjaa alasivut index.html:ään):
//   /                         etusivu (hero + kaikki suositukset)
//   /suosittelija/<nimi>      suosittelijan oma sivu (profiili + hänen suosituksensa)
//   /suosittelijat            kaikki suosittelijat
//   /suosikit                 omat suosikit (tallessa tässä selaimessa)
//   /suositus/<teos>-<id>     suosituksen oma näkymä (dialogi edellisen näkymän päällä)
// Haku ja suodattimet kulkevat kyselyparametreina (?q=, ?kategoria=, ?vuosi=,
// ?jarjestys=vanhin), joten jokainen näkymä on jaettava linkki.

'use strict';

let allData = [];
let dataValmis = false;
let allRecs = [];                 // litistetty: jokaisessa suosituksessa jakson tiedot
const recById = new Map();        // pysyvä tunniste → suositus
const suosittelijat = new Map();  // nimi → { nimi, slug, savy, maara, kategoriat, eka, vika }
const suosittelijaSlugista = new Map();
const teosRyhmat = new Map();     // teoksen slug → { nimi, recs, jaksot, henkilot, kertoja }

// ---------- Apufunktiot ----------

const $ = sel => document.querySelector(sel);

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const luku = n => n.toLocaleString('fi-FI');

// "Iida Sofia Hirvonen" → "iida-sofia-hirvonen", "Tuija Siltamäki" → "tuija-siltamaki"
function slugiksi(teksti) {
  return String(teksti || '').toLowerCase()
    .replace(/[äå]/g, 'a').replace(/ö/g, 'o')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60).replace(/-+$/, '');
}

// Pysyvä suositustunniste: FNV-1a-tiiviste parista (jakso_id, r_idx). Pari ei muutu,
// koska lisäykset menevät jakson loppuun ja poistot vain piilotetaan (CLAUDE.md:
// r_idx on kantava). Teoksen nimi URL:ssa on koristetta – nimen korjaus ei riko linkkiä.
function tunniste(teksti) {
  let h = 0x811c9dc5;
  for (let i = 0; i < teksti.length; i++) {
    h ^= teksti.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

function parsiPvm(pvm) {
  const [p, k, v] = String(pvm || '').split('.').map(Number);
  return v ? new Date(v, k - 1, p) : null;
}

// Sävyt nimikirjainmerkeille: valikoidut, jotta kaikki näyttävät hyviltä molemmissa teemoissa
const AVATAR_SAVYT = [20, 45, 75, 140, 170, 200, 230, 260, 295, 330];

function nimikirjaimet(nimi) {
  const osat = String(nimi || '?').split(/[\s-]+/).filter(Boolean);
  return ((osat[0] || '?')[0] + (osat.length > 1 ? osat[osat.length - 1][0] : '')).toUpperCase();
}

function ikoni(nimi, luokka = '') {
  return `<svg class="ikoni ${luokka}" aria-hidden="true"><use href="#i-${nimi}"/></svg>`;
}

function avatar(nimi, luokka = '') {
  const s = suosittelijat.get(nimi);
  const savy = s ? s.savy : 230;
  return `<span class="avatar ${luokka}" style="--savy:${savy}" aria-hidden="true">${escapeHtml(nimikirjaimet(nimi))}</span>`;
}

const onTuntematon = nimi => !nimi || /^(tuntematon|ei varmuutta)$/i.test(nimi);

// ---------- Kategoriat ----------
// savy = OKLCH-sävykulma ikonille (vaaleus ja kylläisyys tulevat teematokeneista)

const KATEGORIAT = {
  kirja:      { nimi: 'Kirja',      monikko: 'Kirjat',      savy: 60 },
  'tv-sarja': { nimi: 'TV-sarja',   monikko: 'TV-sarjat',   savy: 250 },
  podcast:    { nimi: 'Podcast',    monikko: 'Podcastit',   savy: 165 },
  elokuva:    { nimi: 'Elokuva',    monikko: 'Elokuvat',    savy: 300 },
  artikkeli:  { nimi: 'Artikkeli',  monikko: 'Artikkelit',  savy: 215 },
  kulttuuri:  { nimi: 'Kulttuuri',  monikko: 'Kulttuuri',   savy: 25 },
  musiikki:   { nimi: 'Musiikki',   monikko: 'Musiikki',    savy: 340 },
  urheilu:    { nimi: 'Urheilu',    monikko: 'Urheilu',     savy: 130 },
  ruoka:      { nimi: 'Ruoka',      monikko: 'Ruoka',       savy: 90 },
  dokumentti: { nimi: 'Dokumentti', monikko: 'Dokumentit',  savy: 275 },
  peli:       { nimi: 'Peli',       monikko: 'Pelit',       savy: 195 },
  muu:        { nimi: 'Muu',        monikko: 'Muut',        savy: 0, harmaa: true },
};

function kategoria(avain) {
  const k = KATEGORIAT[avain];
  if (k) return { avain, ...k };
  const nimi = avain ? avain.charAt(0).toUpperCase() + avain.slice(1) : 'Muu';
  return { avain: avain || 'muu', nimi, monikko: nimi, savy: 0, harmaa: true };
}

function kategoriaMerkki(avain) {
  const k = kategoria(avain);
  const ikoniNimi = KATEGORIAT[k.avain] ? k.avain : 'muu';
  return `<span class="kat${k.harmaa ? ' kat-harmaa' : ''}" style="--savy:${k.savy}">${ikoni(ikoniNimi, 'kat-ikoni')}${escapeHtml(k.nimi)}</span>`;
}

// ---------- Datan lataus ----------

async function init() {
  try {
    if (window.SUOSITUKSET_DATA) {
      allData = window.SUOSITUKSET_DATA;
    } else {
      const res = await fetch('/suositukset.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      allData = await res.json();
    }
    rakennaIndeksit();
    dataValmis = true;
    renderStaattiset();
    setupListeners();
    sovellaReitti({ alku: true });
    kaynnistaHiljaisuusvahti();
  } catch (err) {
    console.error('Virhe datan lataamisessa:', err);
    $('#results').innerHTML = `
      <div class="empty-state">
        <h3>Suosituksia ei saatu ladattua</h3>
        <p>Tarkista verkkoyhteys ja yritä uudelleen.</p>
        <button type="button" class="nappi nappi-toissijainen" onclick="location.reload()">Lataa uudelleen</button>
      </div>`;
  }
}

function rakennaIndeksit() {
  allRecs = [];
  for (const jakso of allData) {
    const jaksoTunniste = tunniste(jakso.id);
    const pvm = parsiPvm(jakso.paivamaara);
    // r_idx lasketaan ennen piilotettujen ohitusta, jotta se vastaa datan paikkaa
    jakso.suositukset.forEach((rec, r_idx) => {
      // Piilotettu = poistettu sivulta (paikka säilyy datassa, ettei r_idx-viitteet siirry)
      if (rec.piilotettu) return;
      const id = tunniste(`${jakso.id}:${r_idx}`);
      const r = {
        ...rec,
        id,
        r_idx,
        jakso_otsikko: jakso.jakso_otsikko,
        paivamaara: jakso.paivamaara,
        jakso_id: jakso.id,
        jakso_tunniste: jaksoTunniste,
        vuosi: pvm ? String(pvm.getFullYear()) : '',
        kuukausi: pvm ? pvm.getMonth() : 0,
      };
      if (recById.has(id)) console.warn('Tunnistetörmäys', id, r.teos);
      recById.set(id, r);
      allRecs.push(r);
    });
  }

  // Sama teos useassa jaksossa: ryhmitellään siistityn nimen mukaan
  for (const r of allRecs) {
    const avain = teosAvain(r.teos);
    if (!avain) continue;
    const slug = slugiksi(avain);
    let g = teosRyhmat.get(slug);
    if (!g) {
      g = { slug, recs: [], jaksot: new Set(), henkilot: new Set(), nimet: new Map() };
      teosRyhmat.set(slug, g);
    }
    g.recs.push(r);
    g.jaksot.add(r.jakso_id);
    if (!onTuntematon(r.suosittelija)) g.henkilot.add(r.suosittelija);
    const nimi = siistiTeos(r.teos);
    g.nimet.set(nimi, (g.nimet.get(nimi) || 0) + 1);
    r.teosSlug = slug;
  }
  for (const g of teosRyhmat.values()) {
    g.nimi = [...g.nimet.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    g.kertoja = g.jaksot.size;
    for (const r of g.recs) r.toisto = g.kertoja;
  }

  for (const r of allRecs) {
    if (onTuntematon(r.suosittelija)) continue;
    let s = suosittelijat.get(r.suosittelija);
    if (!s) {
      s = {
        nimi: r.suosittelija,
        slug: slugiksi(r.suosittelija),
        savy: AVATAR_SAVYT[parseInt(tunniste(r.suosittelija), 36) % AVATAR_SAVYT.length],
        maara: 0,
        kategoriat: {},
        vika: r,  // data on uusin ensin
        eka: r,
      };
      suosittelijat.set(r.suosittelija, s);
      suosittelijaSlugista.set(s.slug, s);
    }
    s.maara++;
    s.eka = r;
    const k = r.paakategoria || 'muu';
    s.kategoriat[k] = (s.kategoriat[k] || 0) + 1;
  }
}

// Teoksen tunnistus toistoja varten: "The Rest Is History – Odysseus-erikoisjakso"
// ja "Rest Is History" ovat sama teos; sulkeet ("kausi 2"), alaotsikot ja artikkelit pois
// sekä "Slow Horses, kausi 3" ja "Wind of Change -podcast" (tarkenne pois)
function siistiTeos(teos) {
  return String(teos || '').replace(/\s*\([^)]*\)/g, '')
    .split(/\s+[–—-]\s|:\s|,\s*(?:kausi|osa|season)\b/i)[0]
    .replace(/\s+-[\p{L}-]+$/u, '')
    .trim();
}

function teosAvain(teos) {
  return hakuNormalisoi(siistiTeos(teos).toLowerCase().replace(/^(the|a|an)\s+/, ''));
}

const recUrl = r => `/suositus/${slugiksi(r.teos) || 'suositus'}-${r.id}`;
const suosittelijaUrl = nimi => `/suosittelija/${slugiksi(nimi)}`;

// ---------- Suosikit ----------
// Tallessa tässä selaimessa (localStorage). Rajapinta on tarkoituksella pieni, jotta
// myöhemmin kirjautuminen (esim. Supabase + Google/Apple) voi synkronoida saman
// listan palvelimelle vaihtamatta käyttöliittymää.

const Suosikit = (() => {
  const AVAIN = 'suosikit';
  const kuuntelijat = new Set();
  const lue = () => {
    try {
      const arvo = JSON.parse(localStorage.getItem(AVAIN));
      return Array.isArray(arvo) ? arvo : [];
    } catch { return []; }
  };
  let lista = lue();
  const ilmoita = () => kuuntelijat.forEach(fn => fn());
  const tallenna = () => {
    try { localStorage.setItem(AVAIN, JSON.stringify(lista)); } catch {}
    ilmoita();
  };
  window.addEventListener('storage', e => {
    if (e.key === AVAIN) { lista = lue(); ilmoita(); }
  });
  return {
    onko: id => lista.includes(id),
    vaihda(id) {
      const oli = lista.includes(id);
      lista = oli ? lista.filter(x => x !== id) : [...lista, id];
      tallenna();
      return !oli;
    },
    kaikki: () => [...lista],
    maara: () => lista.filter(id => recById.has(id)).length,
    kuuntele: fn => kuuntelijat.add(fn),
  };
})();

// ---------- Tila ja osoite ----------

// suosittelija = valintalistan rajaus (?suosittelija=<slug>, pysyy samassa näkymässä);
// profiili = suosittelijan oma sivu (/suosittelija/<slug>), johon tullaan nimeä klikkaamalla
let tila = { nakyma: 'koti', q: '', kategoria: '', suosittelija: '', profiili: '', vuosi: '', teos: '', toistuvat: '', jarjestys: 'uusin' };

// Rajaukset, jotka "Tyhjennä rajaukset" nollaa (suosittelijan sivu itse säilyy)
const TYHJAT_RAJAUKSET = { q: '', kategoria: '', suosittelija: '', vuosi: '', teos: '', toistuvat: '' };

const onSuositusPolku = polku => polku.startsWith('/suositus/');

// Pohjanäkymän osoite: avoimen suositusdialogin alla näkyy se näkymä, josta se avattiin
function pohjaOsoite() {
  if (onSuositusPolku(location.pathname)) return (history.state && history.state.paluu) || '/';
  return location.pathname + location.search;
}

function parsiOsoite(osoite) {
  const url = new URL(osoite, location.origin);
  const p = url.searchParams;
  const uusi = {
    nakyma: 'koti',
    q: p.get('q') || '',
    kategoria: p.get('kategoria') || '',
    suosittelija: (suosittelijaSlugista.get(p.get('suosittelija')) || {}).nimi || '',
    profiili: '',
    vuosi: p.get('vuosi') || '',
    teos: teosRyhmat.has(p.get('teos')) ? p.get('teos') : '',
    toistuvat: p.get('toistuvat') === '1' ? '1' : '',
    jarjestys: p.get('jarjestys') === 'vanhin' ? 'vanhin' : 'uusin',
    valilehti: 'top',
  };
  const polku = url.pathname.replace(/\/+$/, '') || '/';
  const osa = polku.split('/');
  if (osa[1] === 'suosittelija' && osa[2]) {
    const s = suosittelijaSlugista.get(osa[2]);
    if (s) uusi.profiili = s.nimi;
    uusi.suosittelija = '';
  } else if (polku === '/suosittelijat') {
    uusi.nakyma = 'suosittelijat';
  } else if (osa[1] === 'tilastot') {
    uusi.nakyma = 'tilastot';
    uusi.valilehti = osa[2] === 'kuviot' ? 'kuviot' : 'top';
  } else if (polku === '/suosikit') {
    uusi.nakyma = 'suosikit';
  }
  return uusi;
}

function rakennaOsoite(t) {
  let polku = '/';
  const p = new URLSearchParams();
  if (t.nakyma === 'suosittelijat') {
    polku = '/suosittelijat';
  } else if (t.nakyma === 'tilastot') {
    polku = t.valilehti === 'kuviot' ? '/tilastot/kuviot' : '/tilastot';
  } else {
    if (t.nakyma === 'suosikit') polku = '/suosikit';
    else if (t.profiili) polku = suosittelijaUrl(t.profiili);
    if (t.suosittelija && !t.profiili) p.set('suosittelija', slugiksi(t.suosittelija));
    if (t.q) p.set('q', t.q);
    if (t.kategoria) p.set('kategoria', t.kategoria);
    if (t.vuosi) p.set('vuosi', t.vuosi);
    if (t.teos) p.set('teos', t.teos);
    if (t.toistuvat) p.set('toistuvat', '1');
    if (t.jarjestys === 'vanhin') p.set('jarjestys', 'vanhin');
  }
  const kysely = p.toString();
  return polku + (kysely ? '?' + kysely : '');
}

function tallennaVieritys() {
  try {
    history.replaceState({ ...(history.state || {}), y: window.scrollY }, '', location.href);
  } catch {} // Safari rajoittaa replaceState-kutsujen tiheyttä
}

// Vierityskohta pidetään ajan tasalla, jotta Eteenpäin, uudelleenlataus ja paluu
// muutoslokista osuvat samaan kohtaan
let vieritysAjastin = null;
window.addEventListener('scroll', () => {
  if (vieritysAjastin || avoinModaali) return;
  vieritysAjastin = setTimeout(() => {
    vieritysAjastin = null;
    if (!avoinModaali) tallennaVieritys();
  }, 700);
}, { passive: true });
window.addEventListener('pagehide', () => { if (!avoinModaali) tallennaVieritys(); });

// Uusi näkymä (eri polku): oma historiamerkintä, jotta Takaisin palaa edelliseen
function siirry(osoite) {
  if (avoinModaali) {
    const { el, paluu } = avoinModaali;
    if (osoite === paluu) {
      // Linkki dialogista sen alla olevaan näkymään: suljetaan dialogi (oma merkintä pois)
      // ja näytetään näkymä alusta – ei kahta samaa merkintää peräkkäin
      ylosPaluunJalkeen = true;
      history.back();
      return;
    }
    // Dialogin historiamerkintä muuttuu uudeksi näkymäksi (Takaisin palaa dialogin alle)
    suljeElementti(el);
    avoinModaali = null;
    history.replaceState({ y: 0, edellinen: paluu }, '', osoite);
    sovellaReitti({ ylos: true });
    return;
  }
  const edellinen = location.pathname + location.search;
  tallennaVieritys();
  history.pushState({ y: 0, edellinen }, '', osoite);
  sovellaReitti({ ylos: true });
}

// Haun ja suodattimien muutos samassa näkymässä: korvataan nykyinen merkintä
function paivitaTila(muutos, { vieritys = true } = {}) {
  const vanha = tila;
  const uusi = { ...tila, ...muutos };
  const vanhaPolku = rakennaOsoite(vanha).split('?')[0];
  const uusiPolku = rakennaOsoite(uusi).split('?')[0];
  if (vanhaPolku !== uusiPolku) {
    siirry(rakennaOsoite(uusi));
    return;
  }
  tila = uusi;
  history.replaceState({ ...(history.state || {}), y: 0 }, '', rakennaOsoite(tila));
  // Suodatinpaneelin ollessa auki osoite päivittyy paneelin historiamerkintään;
  // paneelia suljettaessa (Takaisin) sama osoite siirretään pohjamerkintään
  if (avoinModaali) avoinModaali.siirtoOsoite = rakennaOsoite(tila);
  renderNakyma();
  if (vieritys) vieritaTuloksiin();
}

let edellinenAvain = '';

const recOsoitteesta = () => recById.get(location.pathname.split('-').pop());

// Poistaa merkinnästä dialogin tiedot (dialogia ei enää ole auki)
function siivoaModaaliMerkinta() {
  const { modaali, avain, pushed, paluu, ...muut } = history.state || {};
  history.replaceState(muut, '', location.href);
}

function sovellaReitti({ alku = false, ylos = false } = {}) {
  if (alku) {
    const s = history.state || {};
    if (onSuositusPolku(location.pathname)) {
      const r = recOsoitteesta();
      if (!r) {
        history.replaceState({}, '', '/');
        toast('Suositusta ei löytynyt – ehkä linkki on vanhentunut.');
      } else if (!(s.modaali === 'suositus' && s.paluu)) {
        // Suora lataus (jaettu linkki): pohjanäkymä omaksi merkinnäkseen alle, jotta
        // Takaisin sulkee dialogin eikä poistu sivustolta
        history.replaceState({ y: 0 }, '', '/');
        history.pushState({ modaali: 'suositus', avain: uusiAvain(), pushed: true, paluu: '/' }, '', recUrl(r));
      } else if (location.pathname !== recUrl(r)) {
        history.replaceState(s, '', recUrl(r)); // vanha teoksen nimi osoitteessa → nykyinen
      }
    } else if (s.modaali) {
      // Uudelleenlataus muun dialogin ollessa auki: dialogi ei palaa, merkintä siivotaan
      siivoaModaaliMerkinta();
    }
  }

  // Tuntematon suosittelija (nimi korjattu tai linkissä kirjoitusvirhe)
  const osat = location.pathname.split('/');
  if (osat[1] === 'suosittelija' && !suosittelijaSlugista.has((osat[2] || '').replace(/\/$/, ''))) {
    history.replaceState({ y: 0 }, '', '/suosittelijat');
    toast('Suosittelijaa ei löytynyt – tässä kaikki suosittelijat.');
  }

  tila = parsiOsoite(pohjaOsoite());
  const avain = JSON.stringify(tila);
  const muuttui = avain !== edellinenAvain;
  if (muuttui) renderNakyma();

  // Suositusdialogi osoitteesta (jaettu linkki, uudelleenlataus, Eteenpäin-nuoli)
  if (onSuositusPolku(location.pathname)) {
    const s = history.state || {};
    const r = recOsoitteesta();
    if (r && !(avoinModaali && avoinModaali.avain === s.avain)) {
      naytaSuositus(r, { historia: false, avain: s.avain, paluu: s.paluu || '/', laske: !alku });
    }
  }

  if (alku && !(history.state && history.state.y) && tila.nakyma === 'koti' && aktiivisiaRajauksia(tila)) {
    // Jaettu haku- tai suodatinlinkki: tulokset heti näkyviin heron ohi
    window.scrollTo({ top: tulostenAlku(), behavior: 'instant' });
  } else if (ylos) {
    window.scrollTo({ top: 0, behavior: 'instant' });
  } else if (alku || muuttui) {
    const y = (history.state && history.state.y) || 0;
    if (y) {
      valmistaLista();
      window.scrollTo({ top: y, behavior: 'instant' });
    }
  }
  paivitaOtsikko();
  if (!alku && muuttui) laskeSivu();
}

// Alasivujen vaihdot GoatCounteriin (vain tuotannossa, ks. index.html)
function laskeSivu() {
  if (window.goatcounter && window.goatcounter.count) {
    window.goatcounter.count({ path: location.pathname });
  }
}

// ---------- Haku (sumea) ----------

// Hakunormalisointi: pienet kirjaimet, tarkkeet pois (á→a, mutta ä/ö/å säilyvät),
// kaikki viivat ja välimerkit välilyönneiksi — "Velkajarru-laaja" löytää otsikon
// "Velkajarru–laaja oppimäärä" ja "orbanin" otsikon "Orbánin …"
function hakuNormalisoi(teksti) {
  return String(teksti || '').toLowerCase()
    .replace(/[äöå]/g, m => ({ 'ä': '\u0001', 'ö': '\u0002', 'å': '\u0003' }[m]))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'ä').replace(/\u0002/g, 'ö').replace(/\u0003/g, 'å')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Sumea osuma: sana löytyy, jos jokin tekstin sana alkaa lähes samalla merkkijonolla
// (1 kirjain eroa, ≥8-kirjaimisissa 2). Alun vertailu sallii taivutuspäätteet:
// "ministerivaihdos" löytää "ministerinvaihdoksesta". Alle 5 merkin sanat ja numeroita
// sisältävät sanat tarkasti – muuten "john" löytäisi "jonka" ja "2020" kaikki 2020-luvun päivät.
function lahesSama(a, b, raja) {
  if (Math.abs(a.length - b.length) > raja) return false;
  let edellinen = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const rivi = [i];
    let pienin = i;
    for (let j = 1; j <= b.length; j++) {
      rivi[j] = Math.min(edellinen[j] + 1, rivi[j - 1] + 1, edellinen[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      pienin = Math.min(pienin, rivi[j]);
    }
    if (pienin > raja) return false;
    edellinen = rivi;
  }
  return edellinen[b.length] <= raja;
}

function sanaLoytyy(sana, teksti, sanat) {
  if (teksti.includes(sana)) return true;
  if (sana.length < 5 || /\d/.test(sana)) return false;
  const raja = sana.length >= 8 ? 2 : 1;
  return sanat.some(t => {
    for (let pituus = sana.length; pituus <= sana.length + raja; pituus++) {
      if (pituus > 0 && pituus <= t.length && lahesSama(sana, t.slice(0, pituus), raja)) return true;
    }
    return false;
  });
}

const hakuValimuisti = new Map(); // normalisoitu haku → Set(id), viimeisimmät haut

function hakuOsumat(query) {
  if (hakuValimuisti.has(query)) return hakuValimuisti.get(query);
  // Jokaisen hakusanan pitää löytyä jostain kentästä, järjestyksellä ei väliä
  const sanat = query.split(' ');
  const osumat = new Set();
  for (const r of allRecs) {
    if (!r._haku) {
      r._haku = hakuNormalisoi([
        r.teos, r.kuvaus, r.suosittelija, r.paakategoria, kategoria(r.paakategoria).monikko,
        r.jakso_otsikko, r.paivamaara, ...(r.kategoriat || [])
      ].join(' '));
      r._hakusanat = [...new Set(r._haku.split(' '))];
    }
    if (sanat.every(sana => sanaLoytyy(sana, r._haku, r._hakusanat))) osumat.add(r.id);
  }
  if (hakuValimuisti.size > 30) hakuValimuisti.clear();
  hakuValimuisti.set(query, osumat);
  return osumat;
}

// Suodatus. "ohita" jättää yhden rajauksen pois – sillä lasketaan chippien lukumäärät
// (montako osumaa kategoria antaisi muiden rajausten kanssa).
function suodata(t, ohita = '') {
  let recs = allRecs;
  if (t.nakyma === 'suosikit') {
    const ids = new Set(Suosikit.kaikki());
    recs = recs.filter(r => ids.has(r.id));
  }
  if (t.profiili) recs = recs.filter(r => r.suosittelija === t.profiili);
  if (t.suosittelija && ohita !== 'suosittelija') recs = recs.filter(r => r.suosittelija === t.suosittelija);
  if (t.kategoria && ohita !== 'kategoria') recs = recs.filter(r => (r.paakategoria || 'muu') === t.kategoria);
  if (t.vuosi && ohita !== 'vuosi') recs = recs.filter(r => r.vuosi === t.vuosi);
  if (t.teos) recs = recs.filter(r => r.teosSlug === t.teos);
  if (t.toistuvat && ohita !== 'toistuvat') recs = recs.filter(r => r.toisto > 1);
  const q = hakuNormalisoi(t.q);
  if (q && ohita !== 'q') {
    const osumat = hakuOsumat(q);
    recs = recs.filter(r => osumat.has(r.id));
  }
  return recs;
}

const aktiivisiaRajauksia = t =>
  [t.q, t.kategoria, t.suosittelija, t.vuosi, t.teos, t.toistuvat].filter(Boolean).length;

// Hakusanojen korostus kortin otsikossa ja kuvauksessa
let korostus = null;

function asetaKorostus(q) {
  const sanat = hakuNormalisoi(q).split(' ').filter(s => s.length >= 2)
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  korostus = sanat.length ? new RegExp(`(${sanat.join('|')})`, 'gi') : null;
}

function korosta(teksti) {
  if (!teksti) return '';
  if (!korostus) return escapeHtml(teksti);
  return String(teksti).split(korostus)
    .map((osa, i) => (i % 2 ? `<mark>${escapeHtml(osa)}</mark>` : escapeHtml(osa))).join('');
}

// ---------- Renderöinti: staattiset osat ----------

function renderStaattiset() {
  const jaksoja = allData.length;
  $('#tervehdysLuvut').textContent =
    `: ${luku(allRecs.length)} suositusta ${luku(jaksoja)} jaksosta ja ${luku(suosittelijat.size)} suosittelijalta`;
  renderAikajana();
  renderSuosittelijavalinta();
  paivitaSuosikkiMaara();
}

// Aikajana: jokainen vuosi on nappi, jonka pylväät ovat kuukausien suositusmääriä
// (podcastin ääniaalto, joka on samalla vuosisuodatin). Kaksi kerrosta samassa
// mittakaavassa: haalea = koko arkisto, vihreä = nykyisten rajausten osumat (renderVuodet).
let aikajanaMaksimi = 1;
const kkAvain = r => `${r.vuosi}-${r.kuukausi}`;

function laskeKuukaudet(recs) {
  const m = new Map();
  for (const r of recs) if (r.vuosi) m.set(kkAvain(r), (m.get(kkAvain(r)) || 0) + 1);
  return m;
}

// Pylvään korkeus osuutena (0–1); pieninkin osuma näkyy (vähintään 0,07 ≈ 3 px).
// Osumapylväs skaalataan transformilla, jotta muutos animoituu ilman asettelulaskentaa.
const pylvasKorkeus = m => (m ? Math.max(0.07, m / aikajanaMaksimi).toFixed(3) : '0');

function renderAikajana() {
  const kaikki = laskeKuukaudet(allRecs);
  aikajanaMaksimi = Math.max(1, ...kaikki.values());
  const vuodet = allRecs.map(r => Number(r.vuosi)).filter(Boolean);
  const eka = Math.min(...vuodet), vika = Math.max(...vuodet);
  let html = '';
  let i = 0;
  for (let v = eka; v <= vika; v++) {
    let kuukaudet = '';
    for (let k = 0; k < 12; k++) {
      const m = kaikki.get(`${v}-${k}`) || 0;
      kuukaudet += `<span class="aj-kk" data-kk="${v}-${k}" style="--i:${i++};--kaikki:${pylvasKorkeus(m)};--osuma:${pylvasKorkeus(m)}"></span>`;
    }
    html += `<button type="button" class="aj-vuosi" data-vuosi="${v}" aria-pressed="false">
      <span class="aj-palkit" aria-hidden="true">${kuukaudet}</span>
      <span class="aj-vuosi-nimi"><span class="aj-pitka">${v}</span><span class="aj-lyhyt">’${String(v).slice(2)}</span></span>
    </button>`;
  }
  $('#aikajana').innerHTML = html;
}

function renderSuosittelijavalinta() {
  const kaikki = [...suosittelijat.values()];
  const ahkerimmat = [...kaikki].sort((a, b) => b.maara - a.maara).slice(0, 8);
  const aakkoset = [...kaikki].sort((a, b) => a.nimi.localeCompare(b.nimi, 'fi'));
  const opt = s => `<option value="${escapeHtml(s.nimi)}">${escapeHtml(s.nimi)} (${s.maara})</option>`;
  $('#recommenderFilter').innerHTML =
    `<option value="">Kaikki suosittelijat</option>
     <optgroup label="Ahkerimmat">${ahkerimmat.map(opt).join('')}</optgroup>
     <optgroup label="Kaikki A–Ö">${aakkoset.map(opt).join('')}</optgroup>`;
}

function paivitaSuosikkiMaara() {
  const n = Suosikit.maara();
  $('#suosikkiMaara').textContent = n || '';
}

// ---------- Renderöinti: näkymä ----------

// Tilasto-osion välilehdet: Top-listat, Kuviot ja Suosittelijat
const onTilastoOsio = t => t.nakyma === 'tilastot' || t.nakyma === 'suosittelijat';

function renderNakyma() {
  edellinenAvain = JSON.stringify(tila);
  const koti = tila.nakyma === 'koti' && !tila.profiili;
  const erikois = onTilastoOsio(tila);

  document.body.dataset.nakyma = tila.profiili ? 'suosittelija' : tila.nakyma;
  $('#alku').hidden = !koti;
  document.querySelectorAll('.nav-linkki[data-nakyma]').forEach(a => {
    const nyt = a.dataset.nakyma === tila.nakyma || (a.dataset.nakyma === 'tilastot' && erikois);
    if (nyt) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  // Aikajana on etusivun herossa ja suosittelijan sivun otsakkeessa (sama elementti).
  // Otsake piirretään uudelleen innerHTML:llä, joten aikajana nostetaan ensin talteen heroon.
  const aikajana = $('#aikajana');
  $('#alku .hero-content').appendChild(aikajana);
  renderSivuotsake();
  if (tila.profiili) {
    const paikka = $('#sivuotsake .aikajana-paikka');
    if (paikka) paikka.appendChild(aikajana);
  }
  $('#tyokalupalkki').hidden = erikois;
  $('#palkkiAnkkuri').hidden = erikois;
  $('#kategoriarivi').hidden = erikois;
  $('#tulosotsake').hidden = erikois;
  $('#results').hidden = erikois;
  $('#suosittelijaRuudukko').hidden = tila.nakyma !== 'suosittelijat';
  $('#tilastot').hidden = tila.nakyma !== 'tilastot';
  piilotaVihje();

  paivitaOtsikko();
  if (erikois) {
    if (tila.nakyma === 'suosittelijat') renderSuosittelijaRuudukko();
    else renderTilastot(tila.valilehti);
    return;
  }

  // Hakukenttä seuraa tilaa (esim. Takaisin-nuoli), muttei keskeytä kirjoittajaa
  const kentta = $('#searchInput');
  if (document.activeElement !== kentta && kentta.value !== tila.q) kentta.value = tila.q;
  $('#hakuTyhjenna').hidden = !kentta.value;

  const tulos = suodata(tila);
  asetaKorostus(tila.q);
  renderKategoriat();
  renderVuodet();
  renderTulosotsake(tulos);
  renderLista(tulos);
  $('#recommenderFilter').value = tila.suosittelija;
  $('#suosittelijaTeksti').textContent = tila.suosittelija || 'Suosittelija';
  $('#suosittelijaValinta').classList.toggle('valittu', Boolean(tila.suosittelija));
  // Suosittelijan omalla sivulla valinta olisi ristiriitainen (sivu kertoo jo kenen)
  $('#suosittelijaValinta').hidden = Boolean(tila.profiili);
  tarkistaPaasiaismuna(tila.q);
}

function paivitaOtsikko() {
  let otsikko = 'Uutisraportti suosittelee';
  if (tila.nakyma === 'suosittelijat') otsikko = 'Suosittelijat – Uutisraportti suosittelee';
  else if (tila.nakyma === 'tilastot') otsikko = `${tila.valilehti === 'kuviot' ? 'Kuviot' : 'Top-listat'} – Uutisraportti suosittelee`;
  else if (tila.nakyma === 'suosikit') otsikko = 'Suosikit – Uutisraportti suosittelee';
  else if (tila.profiili) otsikko = `${tila.profiili} suosittelee – Uutisrapsa`;
  if (avoinModaali && avoinModaali.nimi === 'suositus' && avoinModaali.otsikko) otsikko = avoinModaali.otsikko;
  document.title = otsikko;
  // Kanoninen: suosituksella sen nykyinen osoite, muilla näkymä ilman hakua ja rajauksia
  const rec = onSuositusPolku(location.pathname) && avoinModaali && avoinModaali.rec;
  const polku = rec ? recUrl(rec) : rakennaOsoite({ ...tila, ...TYHJAT_RAJAUKSET, jarjestys: 'uusin' });
  $('#kanoninen').href = 'https://uutisrapsa.fi' + polku;
}

function renderSivuotsake() {
  const el = $('#sivuotsake');
  if (tila.profiili) {
    el.innerHTML = renderProfiili(suosittelijat.get(tila.profiili));
    el.hidden = false;
  } else if (tila.nakyma === 'suosikit') {
    const n = Suosikit.maara();
    el.innerHTML = `
      <div class="sivuotsake-sisa">
        <h1 class="sivuotsake-otsikko">Suosikit</h1>
        <p class="sivuotsake-meta">${n ? `${luku(n)} ${n === 1 ? 'tallennettu suositus' : 'tallennettua suositusta'}. ` : ''}Suosikit säilyvät tässä selaimessa.</p>
      </div>`;
    el.hidden = false;
  } else if (onTilastoOsio(tila)) {
    const ekaVuosi = allRecs.length ? allRecs[allRecs.length - 1].vuosi : '';
    const valilehdet = [
      ['/tilastot', 'Top-listat', tila.nakyma === 'tilastot' && tila.valilehti === 'top'],
      ['/tilastot/kuviot', 'Kuviot', tila.nakyma === 'tilastot' && tila.valilehti === 'kuviot'],
      ['/suosittelijat', 'Suosittelijat', tila.nakyma === 'suosittelijat'],
    ];
    el.innerHTML = `
      <div class="sivuotsake-sisa">
        <h1 class="sivuotsake-otsikko">Tilastot</h1>
        <p class="sivuotsake-meta">${luku(allRecs.length)} suositusta, ${luku(allData.length)} jaksoa ja ${luku(suosittelijat.size)} suosittelijaa vuodesta ${ekaVuosi} lähtien. Kuka suosittelee mitäkin?</p>
        <nav class="valilehdet" aria-label="Tilastojen osiot">
          ${valilehdet.map(([href, nimi, nyt]) =>
            `<a href="${href}" class="valilehti" data-reitti${nyt ? ' aria-current="page"' : ''}>${nimi}</a>`).join('')}
        </nav>
      </div>`;
    el.hidden = false;
  } else {
    el.hidden = true;
    el.innerHTML = '';
  }
}

function renderProfiili(s) {
  if (!s) return '';
  const jarjestetty = Object.entries(s.kategoriat).sort((a, b) => b[1] - a[1]);
  const osuus = m => Math.round((m / s.maara) * 100);
  // Palkki kaavioiden kiinteässä kategoriajärjestyksessä (sama väri = sama kategoria kaikkialla)
  const osat = {};
  for (const [k, m] of jarjestetty) osat[kaavioOsa(k)] = (osat[kaavioOsa(k)] || 0) + m;
  const palkki = [...KAAVIO_KATEGORIAT, 'muut'].filter(k => osat[k]).map(k =>
    `<span class="jakauma-osa ${kaavioTyyli(k)}" style="--savy:${kaavioSavy(k) ?? 0}; flex-grow:${osat[k]}" title="${escapeHtml(kaavioNimi(k))}: ${osat[k]}"></span>`
  ).join('');
  const selite = jarjestetty.slice(0, 5).map(([k, m]) => {
    const kat = kategoria(k);
    const paalla = tila.kategoria === k;
    const osa = kaavioOsa(k);
    return `<button type="button" class="jakauma-selite ${kaavioTyyli(osa)}" style="--savy:${kaavioSavy(osa) ?? 0}"
      data-kategoria="${escapeHtml(k)}" aria-pressed="${paalla}">
      <span class="jakauma-pallo" aria-hidden="true"></span>${escapeHtml(kat.monikko)} <span class="himmea">${osuus(m)} %</span></button>`;
  }).join('');
  const ekaVuosi = s.eka.vuosi, vikaVuosi = s.vika.vuosi;
  const vuodet = ekaVuosi === vikaVuosi ? ekaVuosi : `${ekaVuosi}–${vikaVuosi}`;
  return `
    <div class="sivuotsake-sisa">
      ${history.state && history.state.edellinen
        ? `<a class="takaisin tekstilinkki" href="${escapeHtml(history.state.edellinen)}" data-takaisin>${ikoni('vasen')}Takaisin</a>`
        : `<a class="takaisin tekstilinkki" href="/suosittelijat" data-reitti>${ikoni('vasen')}Kaikki suosittelijat</a>`}
      <div class="profiili">
        ${avatar(s.nimi, 'avatar-xl')}
        <div>
          <h1 class="sivuotsake-otsikko">${escapeHtml(s.nimi)}</h1>
          <p class="sivuotsake-meta">${luku(s.maara)} ${s.maara === 1 ? 'suositus' : 'suositusta'} · ${vuodet} · viimeksi ${escapeHtml(s.vika.paivamaara)}</p>
        </div>
      </div>
      <div class="jakauma" role="img" aria-label="${jarjestetty.map(([k, m]) => `${kategoria(k).monikko} ${osuus(m)} %`).join(', ')}">${palkki}</div>
      <div class="jakauma-selitteet">${selite}</div>
      <div class="aikajana-paikka"></div>
    </div>`;
}

function renderSuosittelijaRuudukko() {
  const kaikki = [...suosittelijat.values()].sort((a, b) => b.maara - a.maara || a.nimi.localeCompare(b.nimi, 'fi'));
  const kortti = s => {
    const [paaKat] = Object.entries(s.kategoriat).sort((a, b) => b[1] - a[1])[0];
    return `
      <a class="henkilokortti" href="${suosittelijaUrl(s.nimi)}" data-reitti>
        ${avatar(s.nimi, 'avatar-l')}
        <span class="henkilokortti-nimi">${escapeHtml(s.nimi)}</span>
        <span class="henkilokortti-meta">${luku(s.maara)} ${s.maara === 1 ? 'suositus' : 'suositusta'} · eniten ${escapeHtml(kategoria(paaKat).monikko.toLowerCase())}</span>
      </a>`;
  };
  const ahkerat = kaikki.filter(s => s.maara >= 10);
  const muut = kaikki.filter(s => s.maara < 10).sort((a, b) => a.nimi.localeCompare(b.nimi, 'fi'));
  $('#suosittelijaRuudukko').innerHTML = `
    <h2 class="ruudukko-otsikko">Ahkerimmat</h2>
    <div class="ruudukko">${ahkerat.map(kortti).join('')}</div>
    <h2 class="ruudukko-otsikko">Kaikki muut A–Ö</h2>
    <div class="ruudukko ruudukko-tiivis">${muut.map(kortti).join('')}</div>`;
}

// Chippien kategoriaikonit: pois minimalistisemman ilmeen kokeiluna (2.10.2026).
// Takaisin saa vaihtamalla arvoksi true – korttien ikonit eivät riipu tästä.
const CHIP_IKONIT = false;

function renderKategoriat() {
  const pohja = suodata(tila, 'kategoria');
  const maarat = {};
  for (const r of pohja) {
    const k = r.paakategoria || 'muu';
    maarat[k] = (maarat[k] || 0) + 1;
  }
  // Järjestys koko arkiston koon mukaan, jotta chipit eivät hypi suodatettaessa
  if (!renderKategoriat.jarjestys) {
    const kaikki = {};
    for (const r of allRecs) kaikki[r.paakategoria || 'muu'] = (kaikki[r.paakategoria || 'muu'] || 0) + 1;
    renderKategoriat.jarjestys = Object.keys(kaikki)
      .sort((a, b) => (a === 'muu') - (b === 'muu') || kaikki[b] - kaikki[a]);
  }
  const chippi = (avain, nimi, maara, savy, harmaa, ikoniNimi) => {
    const paalla = tila.kategoria === avain;
    return `<button type="button" class="chippi${harmaa ? ' kat-harmaa' : ''}" style="--savy:${savy}" data-kategoria="${escapeHtml(avain)}"
      aria-pressed="${paalla}"${!maara && !paalla ? ' disabled' : ''}>${ikoniNimi && CHIP_IKONIT ? ikoni(ikoniNimi, 'kat-ikoni') : ''}${escapeHtml(nimi)}<span class="chippi-maara">${luku(maara)}</span></button>`;
  };
  const html = chippi('', 'Kaikki', pohja.length, 0, true, '') +
    renderKategoriat.jarjestys.map(k => {
      const kat = kategoria(k);
      return chippi(k, kat.monikko, maarat[k] || 0, kat.savy, kat.harmaa, KATEGORIAT[k] ? k : 'muu');
    }).join('');
  // Erikoissuodatin: teokset, joita on suositeltu useassa jaksossa
  const toistuvia = suodata(tila, 'toistuvat').filter(r => r.toisto > 1).length;
  const toistuvatChip = `<button type="button" class="chippi chippi-toisto" data-toistuvat aria-pressed="${Boolean(tila.toistuvat)}"
    ${!toistuvia && !tila.toistuvat ? 'disabled' : ''}>${CHIP_IKONIT ? ikoni('toisto') : ''}Useasti suositellut<span class="chippi-maara">${luku(toistuvia)}</span></button>`;
  $('#kategoriarivi').innerHTML = html + '<span class="chippi-erotin" aria-hidden="true"></span>' + toistuvatChip;
  // Valittu chip näkyviin rivillä (vain vaakasuunnassa – sivu ei saa liikkua)
  const rivi = $('#kategoriarivi');
  const valittu = rivi.querySelector('.chippi[aria-pressed="true"]');
  if (valittu && valittu.dataset.kategoria !== '') {
    const vasen = valittu.offsetLeft - 32;
    const oikea = valittu.offsetLeft + valittu.offsetWidth - rivi.clientWidth + 32;
    if (rivi.scrollLeft > vasen) rivi.scrollLeft = vasen;
    else if (rivi.scrollLeft < oikea) rivi.scrollLeft = oikea;
  }
  requestAnimationFrame(paivitaKategoriaRulla);
}

// Aikajana seuraa rajauksia: vihreät pylväät näyttävät, mihin kuukausiin nykyiset rajaukset
// osuvat. Vuosirajaus jätetään laskusta pois, jotta jakauma näkyy kaikilta vuosilta ja
// valittu vuosi korostuu (uusi napautus poistaa sen). Vuodet ilman osumia himmenevät.
function renderVuodet() {
  const pohja = suodata(tila, 'vuosi');
  const osumat = laskeKuukaudet(pohja);
  const aikajana = $('#aikajana');
  aikajana.classList.toggle('rajattu', pohja.length !== allRecs.length);
  aikajana.classList.toggle('valittu', Boolean(tila.vuosi));
  aikajana.querySelectorAll('.aj-kk').forEach(kk => {
    kk.style.setProperty('--osuma', pylvasKorkeus(osumat.get(kk.dataset.kk) || 0));
  });
  aikajana.querySelectorAll('.aj-vuosi').forEach(nappi => {
    const v = nappi.dataset.vuosi;
    let n = 0;
    for (let k = 0; k < 12; k++) n += osumat.get(`${v}-${k}`) || 0;
    const valittu = v === tila.vuosi;
    nappi.setAttribute('aria-pressed', String(valittu));
    nappi.disabled = !n && !valittu;
    nappi.setAttribute('aria-label', `${v}: ${luku(n)} ${n === 1 ? 'suositus' : 'suositusta'}${valittu ? ', valittu' : ''}`);
    nappi.title = valittu ? 'Poista vuosirajaus' : `${v}: ${luku(n)} ${n === 1 ? 'suositus' : 'suositusta'}`;
  });
}

// Tulosotsikko kertoo, mitä katsotaan ("Kulttuuri · 2023", teoksen nimi …) – erillistä
// rajausriviä ei tarvita, koska kategoria näkyy chipeistä ja vuosi aikajanasta
function renderTulosotsake(tulos) {
  const osat = [];
  if (tila.kategoria) osat.push(kategoria(tila.kategoria).monikko);
  if (tila.vuosi) osat.push(tila.vuosi);
  if (tila.toistuvat) osat.push('Useasti suositellut');
  if (tila.suosittelija) osat.push(tila.suosittelija);
  let otsikko = 'Kaikki suositukset';
  if (tila.teos) otsikko = teosRyhmat.get(tila.teos).nimi;
  else if (osat.length) otsikko = osat.join(' · ');
  else if (tila.q) otsikko = 'Hakutulokset';
  else if (tila.nakyma === 'suosikit') otsikko = 'Tallennetut';
  else if (tila.profiili) otsikko = 'Suositukset';
  $('#tulosOtsikko').textContent = otsikko;
  const jaksoja = new Set(tulos.map(r => r.jakso_id)).size;
  $('#resultsCount').textContent = tulos.length
    ? `${luku(tulos.length)} ${tulos.length === 1 ? 'suositus' : 'suositusta'} · ${luku(jaksoja)} ${jaksoja === 1 ? 'jakso' : 'jaksoa'}`
    : 'Ei osumia';
  $('#tyhjennaRajaukset').hidden = !aktiivisiaRajauksia(tila);
  $('#jarjestysTeksti').textContent = tila.jarjestys === 'vanhin' ? 'Vanhimmat ensin' : 'Uusimmat ensin';
}

// ---------- Renderöinti: lista ----------

let listaJono = { kierros: 0, loput: null };

function ryhmittele(recs) {
  const ryhmat = [];
  const loydetty = new Map();
  for (const r of recs) {
    let g = loydetty.get(r.jakso_id);
    if (!g) {
      g = { tunniste: r.jakso_tunniste, otsikko: r.jakso_otsikko, paivamaara: r.paivamaara, jakso_id: r.jakso_id, recs: [] };
      loydetty.set(r.jakso_id, g);
      ryhmat.push(g);
    }
    g.recs.push(r);
  }
  return tila.jarjestys === 'vanhin' ? ryhmat.reverse() : ryhmat;
}

// Lista piirretään erissä: ensimmäinen erä heti, loput selaimen joutoaikana, jotta
// haku tuntuu välittömältä myös vanhoilla puhelimilla
function renderLista(recs) {
  const kontti = $('#results');
  const kierros = ++listaJono.kierros;
  listaJono.loput = null;

  if (recs.length === 0) {
    kontti.innerHTML = tyhjaTila();
    return;
  }

  const uusinId = allRecs[0] && allRecs[0].jakso_id;
  const korostaUusin = tila.nakyma === 'koti' && !tila.profiili && !aktiivisiaRajauksia(tila) && tila.jarjestys === 'uusin';
  const ryhmat = ryhmittele(recs);
  const html = g => renderRyhma(g, korostaUusin && g.jakso_id === uusinId);

  const ERA = 20;
  kontti.innerHTML = ryhmat.slice(0, ERA).map(html).join('');
  let i = ERA;
  const seuraava = () => {
    if (kierros !== listaJono.kierros || i >= ryhmat.length) { listaJono.loput = null; return; }
    kontti.insertAdjacentHTML('beforeend', ryhmat.slice(i, i + ERA * 2).map(html).join(''));
    i += ERA * 2;
    ajasta();
  };
  const ajasta = () => {
    if (i >= ryhmat.length) { listaJono.loput = null; return; }
    listaJono.loput = () => {
      kontti.insertAdjacentHTML('beforeend', ryhmat.slice(i).map(html).join(''));
      i = ryhmat.length;
      listaJono.loput = null;
    };
    (window.requestIdleCallback || (f => setTimeout(f, 40)))(seuraava);
  };
  ajasta();
}

// Piirtää loputkin heti (vierityskohdan palautus, hyppy jaksoon)
function valmistaLista() {
  if (listaJono.loput) listaJono.loput();
}

function renderRyhma(g, uusin) {
  return `
    <section class="jakso${uusin ? ' jakso-uusin' : ''}" id="jakso-${g.tunniste}" aria-labelledby="jo-${g.tunniste}">
      <header class="episode-header">
        <h3 class="episode-title" id="jo-${g.tunniste}">${korosta(g.otsikko)}</h3>
        <span class="episode-date">${uusin ? '<span class="uusin-merkki">Uusin jakso</span>' : ''}${escapeHtml(g.paivamaara)}</span>
      </header>
      <div class="jakso-kortit">${g.recs.map(renderCard).join('')}</div>
    </section>`;
}

function tyhjaTila() {
  if (tila.nakyma === 'suosikit' && Suosikit.maara() === 0) {
    return `
      <div class="empty-state">
        <svg class="ikoni tyhja-ikoni" aria-hidden="true"><use href="#i-sydan"/></svg>
        <h3>Ei vielä suosikkeja</h3>
        <p>Napauta sydäntä suosituksen kulmassa, niin se tallentuu tänne.</p>
        <a class="nappi nappi-toissijainen" href="/" data-reitti>Selaa suosituksia</a>
      </div>`;
  }
  const haku = tila.q ? ` haulla ”${escapeHtml(tila.q)}”` : '';
  return `
    <div class="empty-state">
      <svg class="ikoni tyhja-ikoni" aria-hidden="true"><use href="#i-haku"/></svg>
      <h3>Pitkä epämukava hiljaisuus.</h3>
      <p>Suosituksia ei löytynyt${haku}. Kokeile toista sanaa tai väljennä rajauksia.</p>
      <div class="empty-toiminnot">
        <button type="button" class="nappi nappi-toissijainen" data-poista="kaikki">Tyhjennä rajaukset</button>
        <button type="button" class="nappi nappi-haamu" data-arvo>${ikoni('noppa')}Arvo suositus</button>
      </div>
    </div>`;
}

// Linkit: Google-haku, lisätietolinkki palvelun nimellä, podcasteille kuuntelulinkit
function rakennaLinkit(rec) {
  const linkit = [];
  if (rec.google_linkki) linkit.push(['Google', rec.google_linkki]);
  if (rec.paakategoria === 'podcast') {
    linkit.push(...podcastLinkit(rec));
  // Google-haku lisätietolinkkinä olisi tupla Google-linkin kanssa
  } else if (rec.lisatieto_linkki && rec.lisatieto_linkki !== rec.google_linkki && !onGoogleLinkki(rec.lisatieto_linkki)) {
    linkit.push([linkinNimi(rec.lisatieto_linkki), rec.lisatieto_linkki]);
  }
  return linkit;
}

// Mainosmerkintä (KKV): kun affiliate-linkit tulevat, linkki saa luokan "mainos",
// jolloin chippiin tulee näkyvä Mainos-merkintä (style.css .rec-link.mainos)
const linkkiHtml = ([nimi, url], luokka = 'rec-link') =>
  `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="${luokka}">${escapeHtml(nimi)}${ikoni('ulos')}</a>`;

// "6× suositeltu": sama teos usean jakson suosituksena. Napautus näyttää kaikki kerrat.
function toistoMerkki(rec) {
  if (!(rec.toisto > 1)) return '';
  const g = teosRyhmat.get(rec.teosSlug);
  const nyt = tila.teos === rec.teosSlug;
  return `<button type="button" class="toisto-merkki" data-teos="${rec.teosSlug}" aria-pressed="${nyt}"
    title="${escapeHtml(g.nimi)} on suositeltu ${rec.toisto} eri jaksossa – näytä kaikki">${ikoni('toisto')}${rec.toisto}× suositeltu</button>`;
}

function renderCard(rec) {
  const linkit = rakennaLinkit(rec);
  const suosikki = Suosikit.onko(rec.id);
  const suosittelija = onTuntematon(rec.suosittelija)
    ? `<span class="henkilo henkilo-tuntematon">${avatar('?')}Tuntematon</span>`
    : `<a class="henkilo" href="${suosittelijaUrl(rec.suosittelija)}" data-reitti>${avatar(rec.suosittelija)}${korosta(rec.suosittelija)}</a>`;

  return `
    <article class="rec-card" data-id="${rec.id}">
      <div class="rec-top">
        ${kategoriaMerkki(rec.paakategoria)}
        ${rec.kuulijasuositus ? `<span class="rec-badge listener">${ikoni('kuulokkeet')}Kuulijan suositus</span>` : ''}
        ${toistoMerkki(rec)}
        <button type="button" class="suosikki-nappi" data-suosikki="${rec.id}" aria-pressed="${suosikki}"
          aria-label="Suosikki: ${escapeHtml(rec.teos)}">${ikoni('sydan')}</button>
      </div>
      <h4 class="rec-title"><a href="${recUrl(rec)}" class="rec-avaa" data-suositus="${rec.id}">${korosta(rec.teos)}</a></h4>
      ${rec.kuvaus ? `<p class="rec-desc">${korosta(rec.kuvaus)}</p>` : ''}
      <div class="rec-footer">
        ${suosittelija}
        ${linkit.length ? `<div class="rec-links">${linkit.map(l => linkkiHtml(l)).join('')}</div>` : ''}
      </div>
    </article>`;
}

// Lisätietolinkin nimi palvelun mukaan. Tarkemmat osoitteet ennen yleisempiä
// (areena.yle.fi ennen yle.fi). Tuntematon palvelu → "Lisätietoa".
const LINKKIEN_NIMET = [
  ['goodreads.com', 'Goodreads'],
  ['imdb.com', 'IMDb'],
  ['spotify.com', 'Spotify'],
  ['apple.com', 'Apple'],
  ['tidal.com', 'Tidal'],
  ['supla.fi', 'Supla'],
  ['areena.yle.fi', 'Yle Areena'],
  ['yle.fi', 'Yle'],
  ['hs.fi', 'HS'],
  ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['instagram.com', 'Instagram'],
  ['tiktok.com', 'TikTok'],
  ['facebook.com', 'Facebook'],
  ['twitter.com', 'X'],
  ['x.com', 'X'],
  ['cooking.nytimes.com', 'NYT Cooking'],
  ['nytimes.com', 'NYT'],
  ['newyorker.com', 'New Yorker'],
  ['theatlantic.com', 'The Atlantic'],
  ['wired.com', 'Wired'],
  ['rollingstone.com', 'Rolling Stone'],
  ['bbc.com', 'BBC'],
  ['bbc.co.uk', 'BBC'],
  ['theguardian.com', 'Guardian'],
  ['politico.com', 'Politico'],
  ['vox.com', 'Vox'],
  ['nymag.com', 'New York Mag'],
  ['theathletic.com', 'The Athletic'],
  ['theconversation.com', 'The Conversation'],
  ['wikipedia.org', 'Wikipedia'],
  ['store.steampowered.com', 'Steam'],
  ['igdb.com', 'IGDB'],
  ['longplay.fi', 'Long Play'],
  ['kansallisteatteri.fi', 'Kansallisteatteri'],
  ['q-teatteri.fi', 'Q-teatteri'],
  ['ateneum.fi', 'Ateneum'],
  ['kansallismuseo.fi', 'Kansallismuseo'],
  ['digi.kansalliskirjasto.fi', 'Kansalliskirjasto'],
  ['suomenlinna.fi', 'Suomenlinna'],
  ['linnanmaki.fi', 'Linnanmäki'],
  ['luontoon.fi', 'Luontoon.fi'],
  ['docpoint.info', 'DocPoint'],
  ['superpesis.fi', 'Superpesis'],
  ['journalisti.fi', 'Journalisti'],
  ['cineast.fi', 'Cineast'],
  ['chat.openai.com', 'ChatGPT'],
  ['openai.com', 'OpenAI'],
  ['midjourney.com', 'Midjourney'],
  ['duolingo.com', 'Duolingo'],
  ['chess.com', 'Chess.com'],
  ['ifixit.com', 'iFixit'],
  ['myfitnesspal.com', 'MyFitnessPal'],
];

// Podcastien kuuntelulinkit alkuperän mukaan ("alkupera"-kenttä):
// Ylen podcastit ovat vain Areenassa, HS:n podcastit vain HS:n sivuilla ja
// Suplassa, muut kotimaiset Spotifyssa, Apple Podcastsissa ja Suplassa, Podmen
// ja ulkomaiset Spotifyssa ja Apple Podcastsissa. Lisätietolinkki korvaa saman palvelun
// haun, jos se osoittaa suoraan sarjan sivulle (ei hakusivulle).
const PODCASTPALVELUT = {
  areena: ['Yle Areena', 'areena.yle.fi', q => `https://areena.yle.fi/hae?q=${q}&service=radio`],
  spotify: ['Spotify', 'spotify.com', q => `https://open.spotify.com/search/${q}`],
  apple: ['Apple Podcasts', 'apple.com', q => `https://podcasts.apple.com/fi/search?term=${q}`],
  supla: ['Supla', 'supla.fi', q => `https://www.supla.fi/haku?search_term=${q}`],
  hs: ['HS', 'hs.fi', q => `https://www.hs.fi/haku/?query=${q}`],
};

const PODCASTIEN_PALVELUT = {
  yle: ['areena'],
  hs: ['hs', 'supla'],
  // HS:n erikoissarjat (esim. Menetetyt miljardit), joita ei ole edes Suplassa
  'hs-vain': ['hs'],
  kotimainen: ['spotify', 'apple', 'supla'],
};

function podcastLinkit(rec) {
  const palvelut = PODCASTIEN_PALVELUT[rec.alkupera] || ['spotify', 'apple'];
  // Suorat linkit: lisätietolinkki + valinnainen "lisalinkit"-lista (esim. kun
  // sarjalla on sekä Supla-sivu että HS:n esittelyartikkeli)
  const suorat = [rec.lisatieto_linkki, ...(rec.lisalinkit || [])].flatMap(osoite => {
    try {
      const u = new URL(osoite);
      return [{
        osoite,
        host: u.hostname.toLowerCase().replace(/^www\./, ''),
        haku: /search|haku|hae/i.test(u.pathname + u.search),
      }];
    } catch { return []; }
  });
  const samaPalvelu = (l, osoite) => l.host === osoite || l.host.endsWith('.' + osoite);
  const q = encodeURIComponent(podcastHakusana(rec));

  const linkit = palvelut.map(p => {
    const [nimi, osoite, haku] = PODCASTPALVELUT[p];
    const suora = suorat.find(l => samaPalvelu(l, osoite) && !l.haku);
    return [nimi, suora ? suora.osoite : haku(q)];
  });
  // Muun palvelun linkki (esim. sarjan oma sivu tai YouTube) jää mukaan.
  // Saman palvelun toinen suora linkki (esim. HS:n kuuntelusivun lisäksi
  // esittelyartikkeli) näkyy omana "HS-esittely"-linkkinään.
  const kaytetyt = new Set(linkit.map(([, osoite]) => osoite));
  for (const l of suorat) {
    if (kaytetyt.has(l.osoite) || onGoogleLinkki(l.osoite)) continue;
    const palvelu = palvelut.map(p => PODCASTPALVELUT[p]).find(([, osoite]) => samaPalvelu(l, osoite));
    const tunnettu = Object.values(PODCASTPALVELUT).some(([, osoite]) => samaPalvelu(l, osoite));
    if (palvelu && !l.haku) linkit.push([`${palvelu[0]}-esittely`, l.osoite]);
    else if (!tunnettu) linkit.push([linkinNimi(l.osoite), l.osoite]);
    kaytetyt.add(l.osoite);
  }
  return linkit;
}

// Hakusana: lisätietolinkin (Spotify-, Areena- ym.) haun sana on yleensä
// valmiiksi siisti, muuten teoksen nimi ilman sulkeita, alaotsikkoa ja
// "-podcast"-päätettä.
function podcastHakusana(rec) {
  try {
    const u = new URL(rec.lisatieto_linkki);
    const m = u.pathname.match(/\/search\/([^/]+)/);
    const sana = m ? decodeURIComponent(m[1].replace(/\+/g, ' '))
      : ['q', 'term', 'search_term', 'query'].map(k => u.searchParams.get(k)).find(Boolean);
    if (sana) return sana;
  } catch {}
  return rec.teos
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+[–—]\s.*$/, '')
    .replace(/\s*-?podcast\b/gi, '')
    .trim() || rec.teos;
}

function onGoogleLinkki(url) {
  try {
    return /(^|\.)google\.[a-z.]+$/.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function linkinNimi(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'Lisätietoa';
  }
  const osuma = LINKKIEN_NIMET.find(([osoite]) => host === osoite || host.endsWith('.' + osoite));
  return osuma ? osuma[1] : 'Lisätietoa';
}

// ---------- Tilastot ----------

// Kaavioiden kategoriat kiinteässä järjestyksessä: värit on testattu värisokeussimulaatiolla
// (vierekkäiset parit, molemmat teemat), joten järjestystä ei pidä vaihtaa. Loput
// kategoriat niputetaan harmaaksi "Muut"-osaksi.
const KAAVIO_KATEGORIAT = ['kirja', 'tv-sarja', 'podcast', 'elokuva', 'kulttuuri', 'artikkeli'];
const kaavioOsa = k => (KAAVIO_KATEGORIAT.includes(k) ? k : 'muut');
const kaavioNimi = k => (k === 'muut' ? 'Muut' : kategoria(k).monikko);
const kaavioSavy = k => (k === 'muut' ? null : kategoria(k).savy);
const kaavioTyyli = k => (kaavioSavy(k) === null ? 'kaavio-muut' : '');

let tilastoValimuisti = null;

function laskeTilastot() {
  if (tilastoValimuisti) return tilastoValimuisti;
  const vuodet = [...new Set(allRecs.map(r => r.vuosi).filter(Boolean))].sort();
  const henkilot = [...suosittelijat.values()].sort((a, b) => b.maara - a.maara);

  const toistuvat = [...teosRyhmat.values()].filter(g => g.kertoja > 1)
    .sort((a, b) => b.kertoja - a.kertoja || b.henkilot.size - a.henkilot.size || a.nimi.localeCompare(b.nimi, 'fi'));

  const aiheet = new Map();
  for (const r of allRecs) {
    for (const t of r.kategoriat || []) {
      const k = String(t).toLowerCase().trim();
      if (k) aiheet.set(k, (aiheet.get(k) || 0) + 1);
    }
  }
  const topAiheet = [...aiheet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  const kategoriat = {};
  for (const r of allRecs) kategoriat[r.paakategoria || 'muu'] = (kategoriat[r.paakategoria || 'muu'] || 0) + 1;
  const topKategoriat = Object.entries(kategoriat).sort((a, b) => b[1] - a[1]);

  const jaksot = new Map();
  for (const r of allRecs) {
    let j = jaksot.get(r.jakso_id);
    if (!j) {
      j = { otsikko: r.jakso_otsikko, pvm: r.paivamaara, maara: 0, henkilot: new Set() };
      jaksot.set(r.jakso_id, j);
    }
    j.maara++;
    if (!onTuntematon(r.suosittelija)) j.henkilot.add(r.suosittelija);
  }
  const topJaksot = [...jaksot.values()].sort((a, b) => b.maara - a.maara).slice(0, 6);

  // Kategoriaosuudet vuosittain (100 % pinotut pylväät)
  const vuosiOsuudet = vuodet.map(vuosi => ({ vuosi, yhteensa: 0, osat: {} }));
  const vuosiIndeksi = new Map(vuodet.map((v, i) => [v, vuosiOsuudet[i]]));
  // Suosittelija × vuosi
  const perVuosi = new Map();
  for (const r of allRecs) {
    const rivi = vuosiIndeksi.get(r.vuosi);
    if (rivi) {
      const k = kaavioOsa(r.paakategoria || 'muu');
      rivi.osat[k] = (rivi.osat[k] || 0) + 1;
      rivi.yhteensa++;
    }
    if (!onTuntematon(r.suosittelija) && r.vuosi) {
      if (!perVuosi.has(r.suosittelija)) perVuosi.set(r.suosittelija, {});
      const m = perVuosi.get(r.suosittelija);
      m[r.vuosi] = (m[r.vuosi] || 0) + 1;
    }
  }
  const lampo = henkilot.slice(0, 12).map(s => ({ s, vuodet: perVuosi.get(s.nimi) || {} }));
  const lampoMax = Math.max(1, ...lampo.flatMap(x => Object.values(x.vuodet)));

  // Tittelit: suosittelijat, joilla vähintään 20 suositusta
  const isot = henkilot.filter(s => s.maara >= 20);
  const osuus = (s, k) => (s.kategoriat[k] || 0) / s.maara;
  const entropia = s => -Object.values(s.kategoriat).reduce((acc, m) => acc + (m / s.maara) * Math.log(m / s.maara), 0);
  const tittelit = [];
  if (isot.length) {
    for (const [k, nimi, monikko] of [
      ['kirja', 'Kirjatoukka', 'kirjoja'],
      ['tv-sarja', 'Sarjahirmu', 'tv-sarjoja'],
      ['podcast', 'Korvat höröllä', 'podcasteja'],
      ['elokuva', 'Valkokangasvalo', 'elokuvia'],
    ]) {
      const s = isot.reduce((a, b) => (osuus(b, k) > osuus(a, k) ? b : a));
      if (osuus(s, k) > 0) tittelit.push({ nimi, s, kuvaus: `${Math.round(osuus(s, k) * 100)} % suosituksista ${monikko}` });
    }
    const monip = isot.reduce((a, b) => (entropia(b) > entropia(a) ? b : a));
    tittelit.push({ nimi: 'Kaikkiruokaisin', s: monip, kuvaus: `${Object.keys(monip.kategoriat).length} eri kategoriaa, ei selvää suosikkia` });
  }
  let ahkerin = null;
  for (const [nimi, m] of perVuosi) {
    for (const [v, maara] of Object.entries(m)) {
      if (!ahkerin || maara > ahkerin.maara) ahkerin = { s: suosittelijat.get(nimi), v, maara };
    }
  }
  if (ahkerin) tittelit.push({ nimi: 'Vuoden suosittelukone', s: ahkerin.s, kuvaus: `${ahkerin.maara} suositusta vuonna ${ahkerin.v}` });
  const ura = s => Number(s.vika.vuosi) - Number(s.eka.vuosi);
  const pisin = henkilot.reduce((a, b) => (ura(b) > ura(a) ? b : a), henkilot[0]);
  if (pisin) tittelit.push({ nimi: 'Pitkän linjan suosittelija', s: pisin, kuvaus: `suosituksia vuosina ${pisin.eka.vuosi}–${pisin.vika.vuosi}` });

  // Hiihtomittari: suositukset, joissa vilahtaa hiihto, latu tai sukset
  const HIIHTO = /hiih|ladu|latu|suks|vasaloppet|salpausselä/i;
  const hiihto = new Map();
  for (const r of allRecs) {
    if (onTuntematon(r.suosittelija)) continue;
    if (!HIIHTO.test([r.teos, r.kuvaus, ...(r.kategoriat || [])].join(' '))) continue;
    if (!hiihto.has(r.suosittelija)) hiihto.set(r.suosittelija, []);
    hiihto.get(r.suosittelija).push(r);
  }

  tilastoValimuisti = { vuodet, henkilot, toistuvat, topAiheet, topKategoriat, topJaksot, vuosiOsuudet, lampo, lampoMax, tittelit, hiihto };
  return tilastoValimuisti;
}

function renderTilastot(valilehti) {
  const t = laskeTilastot();
  $('#tilastot').innerHTML = valilehti === 'kuviot' ? renderKuviot(t) : renderTopListat(t);
  sovitaLampoTekstit();
}

// Lämpökartan numeroiden väri solun todellisen taustan mukaan (valkoinen tai musta sen
// mukaan, kumpi erottuu paremmin) – toimii molemmissa teemoissa ilman kiinteitä rajoja
function sovitaLampoTekstit() {
  const solut = document.querySelectorAll('.lampo-solu:not(.tyhja)');
  if (!solut.length) return;
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const lin = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  solut.forEach(solu => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = getComputedStyle(solu).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const valkoinen = 1.05 / (L + 0.05);
    const musta = (L + 0.05) / (0.0056 + 0.05); // #0f0f14
    solu.classList.toggle('tumma-pohja', valkoinen >= musta);
    solu.classList.toggle('vaalea-pohja', valkoinen < musta);
  });
}

const etunimi = nimi => String(nimi).split(' ')[0];

// Top-listan rivi: sija, nimi (linkki tai nappi), vaakapalkki ja arvo palkin päässä
function topRivi(sija, nimiHtml, arvo, suurin, arvoTeksti = luku(arvo), meta = '') {
  return `
    <li class="toprivi">
      <span class="toprivi-sija">${sija}</span>
      <span class="toprivi-nimi">${nimiHtml}${meta ? `<span class="toprivi-meta">${meta}</span>` : ''}</span>
      <span class="toprivi-palkki" aria-hidden="true"><span style="--osuus:${(arvo / suurin).toFixed(4)}"></span></span>
      <span class="toprivi-arvo">${arvoTeksti}</span>
    </li>`;
}

function renderTopListat(t) {
  const henkilot = t.henkilot.slice(0, 10);
  const maxH = henkilot[0] ? henkilot[0].maara : 1;
  const teokset = t.toistuvat.slice(0, 10);
  const maxT = teokset[0] ? teokset[0].kertoja : 1;
  const maxK = t.topKategoriat[0] ? t.topKategoriat[0][1] : 1;
  const maxA = t.topAiheet[0] ? t.topAiheet[0][1] : 1;
  const maxJ = t.topJaksot[0] ? t.topJaksot[0].maara : 1;
  const toistuviaRecs = allRecs.filter(r => r.toisto > 1).length;

  return `
    <div class="tilastoruudukko">
      <section class="tilastopaneeli">
        <h2 class="tilastopaneeli-otsikko">Ahkerimmat suosittelijat</h2>
        <ol class="toplista">${henkilot.map((s, i) => topRivi(i + 1,
          `<a href="${suosittelijaUrl(s.nimi)}" data-reitti class="toprivi-linkki">${avatar(s.nimi)}${escapeHtml(s.nimi)}</a>`,
          s.maara, maxH)).join('')}</ol>
        <a class="tekstilinkki" href="/suosittelijat" data-reitti>Kaikki ${luku(t.henkilot.length)} suosittelijaa</a>
      </section>

      <section class="tilastopaneeli">
        <h2 class="tilastopaneeli-otsikko">Eniten suositellut teokset</h2>
        <ol class="toplista">${teokset.map((g, i) => topRivi(i + 1,
          `<button type="button" class="toprivi-linkki top-teos" data-teos="${g.slug}">${kategoriaIkoni(g.recs[0].paakategoria)}${escapeHtml(g.nimi)}</button>`,
          g.kertoja, maxT, `${g.kertoja}×`,
          escapeHtml([...g.henkilot].map(etunimi).join(', ')))).join('')}</ol>
        <a class="tekstilinkki" href="/?toistuvat=1" data-reitti>Kaikki useasti suositellut (${luku(toistuviaRecs)} suositusta, ${luku(t.toistuvat.length)} teosta)</a>
      </section>

      <section class="tilastopaneeli">
        <h2 class="tilastopaneeli-otsikko">Kategoriat</h2>
        <ol class="toplista">${t.topKategoriat.map(([k, m], i) => topRivi(i + 1,
          `<a href="/?kategoria=${encodeURIComponent(k)}" data-reitti class="toprivi-linkki">${kategoriaIkoni(k)}${escapeHtml(kategoria(k).monikko)}</a>`,
          m, maxK)).join('')}</ol>
      </section>

      <section class="tilastopaneeli">
        <h2 class="tilastopaneeli-otsikko">Suosituimmat aiheet</h2>
        <ol class="toplista">${t.topAiheet.map(([a, m], i) => topRivi(i + 1,
          `<a href="/?q=${encodeURIComponent(a)}" data-reitti class="toprivi-linkki">${escapeHtml(a.charAt(0).toUpperCase() + a.slice(1))}</a>`,
          m, maxA)).join('')}</ol>
      </section>

      <section class="tilastopaneeli tilastopaneeli-leveä">
        <h2 class="tilastopaneeli-otsikko">Runsaimmat jaksot</h2>
        <ol class="toplista">${t.topJaksot.map((j, i) => topRivi(i + 1,
          `<a href="/?q=${encodeURIComponent(j.otsikko)}" data-reitti class="toprivi-linkki toprivi-jakso">${escapeHtml(j.otsikko)}</a>`,
          j.maara, maxJ, luku(j.maara),
          `${escapeHtml(j.pvm)} · ${escapeHtml([...j.henkilot].map(etunimi).join(', '))}`)).join('')}</ol>
      </section>
    </div>`;
}

function kategoriaIkoni(avain) {
  const k = kategoria(avain);
  return `<span class="${k.harmaa ? 'kat-harmaa' : ''}" style="--savy:${k.savy}">${ikoni(KATEGORIAT[k.avain] ? k.avain : 'muu', 'kat-ikoni')}</span>`;
}

function renderKuviot(t) {
  const osat = [...KAAVIO_KATEGORIAT, 'muut'];
  const selite = `<ul class="kaavio-selite">${osat.map(k =>
    `<li><span class="kaavio-pallo ${kaavioTyyli(k)}" style="--savy:${kaavioSavy(k) ?? 0}"></span>${kaavioNimi(k)}</li>`).join('')}</ul>`;

  // 1. Maku muuttuu: kategorioiden osuudet vuosittain
  const pylvaat = t.vuosiOsuudet.map(rivi => {
    const segmentit = osat.map(k => {
      const m = rivi.osat[k] || 0;
      if (!m) return '';
      const pros = Math.round((m / rivi.yhteensa) * 100);
      return `<span class="pino-osa ${kaavioTyyli(k)}" style="--savy:${kaavioSavy(k) ?? 0}; flex-grow:${m}"
        data-vihje="${rivi.vuosi} · ${kaavioNimi(k)}: ${m} (${pros} %)"></span>`;
    }).join('');
    return `<div class="pino">
      <div class="pino-palkki">${segmentit}</div>
      <span class="pino-vuosi">${rivi.vuosi}</span>
      <span class="pino-n">${luku(rivi.yhteensa)}</span>
    </div>`;
  }).join('');
  const taulukko = `
    <details class="taulukkonakyma">
      <summary>Näytä luvut taulukkona</summary>
      <div class="taulukko-kehys"><table>
        <thead><tr><th scope="col">Vuosi</th>${osat.map(k => `<th scope="col">${kaavioNimi(k)}</th>`).join('')}<th scope="col">Yhteensä</th></tr></thead>
        <tbody>${t.vuosiOsuudet.map(rivi => `<tr><th scope="row">${rivi.vuosi}</th>${osat.map(k => `<td>${rivi.osat[k] || 0}</td>`).join('')}<td>${rivi.yhteensa}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>`;

  // 2. Kuka suositteli milloin: lämpökartta
  const lampoRivit = t.lampo.map(({ s, vuodet }) => `
    <a class="lampo-nimi" href="${suosittelijaUrl(s.nimi)}" data-reitti>${avatar(s.nimi, 'avatar-s')}<span class="aj-pitka">${escapeHtml(s.nimi)}</span><span class="aj-lyhyt">${escapeHtml(etunimi(s.nimi))}</span></a>
    ${t.vuodet.map(v => {
      const m = vuodet[v] || 0;
      const voima = m / t.lampoMax;
      return `<span class="lampo-solu${m ? '' : ' tyhja'}" style="--voima:${m ? Math.round(14 + voima * 86) : 0}%"
        data-vihje="${escapeHtml(s.nimi)} · ${v}: ${m} ${m === 1 ? 'suositus' : 'suositusta'}">${m || ''}</span>`;
    }).join('')}`).join('');

  // 3. Tittelit
  const tittelit = t.tittelit.map(x => `
    <li class="titteli">
      ${avatar(x.s.nimi, 'avatar-l')}
      <span class="titteli-teksti">
        <span class="titteli-nimi">${escapeHtml(x.nimi)}</span>
        <a class="titteli-henkilo" href="${suosittelijaUrl(x.s.nimi)}" data-reitti>${escapeHtml(x.s.nimi)}</a>
        <span class="titteli-kuvaus">${escapeHtml(x.kuvaus)}</span>
      </span>
    </li>`).join('');

  return `
    <section class="tilastopaneeli kuvio">
      <h2 class="tilastopaneeli-otsikko">Maku muuttuu</h2>
      <p class="tilastopaneeli-kuvaus">Mitä suositeltiin minäkin vuonna – kategorioiden osuudet vuoden suosituksista. Vuosien alla suositusten määrä; vuodet 2016–2018 ovat ohuempia, koska vanhoista jaksoista on poimittu vähemmän.</p>
      ${selite}
      <div class="pinot" role="img" aria-label="Kategorioiden osuudet vuosittain, luvut taulukossa alla">${pylvaat}</div>
      ${taulukko}
    </section>

    <section class="tilastopaneeli kuvio">
      <h2 class="tilastopaneeli-otsikko">Kuka suositteli milloin</h2>
      <p class="tilastopaneeli-kuvaus">Ahkerimpien suosittelijoiden suositukset vuosittain. Mitä tummempi ruutu, sitä enemmän suosituksia.</p>
      <div class="lampo" style="--vuosia:${t.vuodet.length}">
        <span></span>${t.vuodet.map(v => `<span class="lampo-vuosi"><span class="aj-pitka">${v}</span><span class="aj-lyhyt">’${v.slice(2)}</span></span>`).join('')}
        ${lampoRivit}
      </div>
    </section>

    <section class="tilastopaneeli kuvio">
      <h2 class="tilastopaneeli-otsikko">Tittelit</h2>
      <p class="tilastopaneeli-kuvaus">Datasta lasketut kunnianosoitukset suosittelijoille, joilla on vähintään 20 suositusta.</p>
      <ul class="tittelit">${tittelit}</ul>
    </section>

    ${renderHiihtomittari(t)}`;
}

// Salla rakastaa hiihtoa, Tuomas ei. Data ratkaiskoon.
function renderHiihtomittari(t) {
  const salla = [...suosittelijat.keys()].find(n => /^Salla Vuorikoski$/.test(n));
  const tuomas = [...suosittelijat.keys()].find(n => /^Tuomas Peltomäki$/.test(n));
  if (!salla || !tuomas) return '';
  const s = t.hiihto.get(salla) || [];
  const tu = t.hiihto.get(tuomas) || [];
  const muut = [...t.hiihto.entries()].filter(([n]) => n !== salla && n !== tuomas)
    .sort((a, b) => b[1].length - a[1].length);
  const suurin = Math.max(1, s.length, tu.length);
  const rivi = (nimi, recs) => `
    <div class="hiihtorivi">
      <a class="hiihtorivi-nimi" href="${suosittelijaUrl(nimi)}" data-reitti>${avatar(nimi, 'avatar-l')}${escapeHtml(etunimi(nimi))}</a>
      <span class="toprivi-palkki hiihto-palkki" aria-hidden="true"><span style="--osuus:${(recs.length / suurin).toFixed(4)}"></span></span>
      <span class="hiihtorivi-arvo">${recs.length}</span>
      <ul class="hiihtorivi-teokset">${recs.map(r => `<li><a href="${recUrl(r)}" data-suositus="${r.id}">${escapeHtml(r.teos)}</a></li>`).join('')}</ul>
    </div>`;
  const tulos = s.length > tu.length ? `Salla johtaa ${s.length}–${tu.length}.`
    : s.length === tu.length ? `Tasapeli ${s.length}–${tu.length}. Tuomas, oletko kunnossa?`
    : `Tuomas johtaa ${tu.length}–${s.length}?! Joku tarkistakoon transkriptit.`;
  return `
    <section class="tilastopaneeli kuvio hiihtomittari">
      <h2 class="tilastopaneeli-otsikko">Hiihtomittari</h2>
      <p class="tilastopaneeli-kuvaus">Suositukset, joissa vilahtaa hiihto, latu tai sukset. Salla rakastaa hiihtoa, Tuomas ei. ${tulos}
        Katso tarkemmin, millaisia Tuomaksen osumat ovat.</p>
      ${rivi(salla, s)}
      ${rivi(tuomas, tu)}
      ${muut.length ? `<p class="hiihto-muut">Muut ladulla: ${muut.map(([n, r]) => `<a href="${suosittelijaUrl(n)}" data-reitti>${escapeHtml(n)}</a> ${r.length}`).join(' · ')}</p>` : ''}
    </section>`;
}

// Kaavioiden vihjelaatikko (hiiri ja kosketus)
function naytaVihje(el, x, y) {
  const vihje = $('#kaavioVihje');
  vihje.textContent = el.dataset.vihje;
  vihje.hidden = false;
  const leveys = vihje.offsetWidth;
  const vasen = Math.min(window.innerWidth - leveys - 8, Math.max(8, x - leveys / 2));
  vihje.style.left = `${vasen}px`;
  vihje.style.top = `${Math.max(8, y - vihje.offsetHeight - 14)}px`;
}

function piilotaVihje() {
  const vihje = $('#kaavioVihje');
  if (vihje) vihje.hidden = true;
}

function setupVihjeet() {
  const kontti = $('#tilastot');
  kontti.addEventListener('pointermove', e => {
    const el = e.target.closest('[data-vihje]');
    if (el) naytaVihje(el, e.clientX, e.clientY);
    else piilotaVihje();
  });
  kontti.addEventListener('pointerleave', piilotaVihje);
  window.addEventListener('scroll', piilotaVihje, { passive: true });
}

// ---------- Dialogit ----------
// Jokainen avattu dialogi saa oman historiamerkinnän, joten puhelimen Takaisin-ele
// sulkee dialogin eikä poistu sivulta. Kerrallaan on auki yksi dialogi.

// Jokaisella dialogimerkinnällä on oma avain: näin Eteenpäin-nuolen tai uudelleenlatauksen
// jättämä vanha merkintä ei sekoitu uuteen samannimiseen dialogiin.
let avoinModaali = null; // { nimi, el, avain, paluu, otsikko, rec, siirtoOsoite }
let palautaFokus = null;
let modaaliLaskuri = 0;
let ylosPaluunJalkeen = false;
const uusiAvain = () => `${Date.now().toString(36)}${++modaaliLaskuri}`;

function avaaModaali(nimi, el, { url = null, otsikko = null, rec = null } = {}) {
  if (avoinModaali) {
    // Vaihdetaan dialogia (esim. suosituksesta "Ilmoita virheestä"): sama merkintä jatkaa
    const vanha = avoinModaali;
    if (vanha.el !== el) suljeElementti(vanha.el);
    history.replaceState({ ...(history.state || {}), modaali: nimi }, '', url || location.href);
    avoinModaali = { ...vanha, nimi, el, otsikko, rec: rec || vanha.rec, siirtoOsoite: null };
  } else {
    palautaFokus = document.activeElement;
    tallennaVieritys();
    const paluu = location.pathname + location.search;
    const avain = uusiAvain();
    history.pushState({ modaali: nimi, avain, pushed: true, paluu, y: window.scrollY }, '', url || location.href);
    avoinModaali = { nimi, el, avain, paluu, otsikko, rec };
  }
  if (!el.open) el.showModal();
  paivitaOtsikko();
  if (nimi === 'suositus' && url) laskeSivu();
}

function suljeElementti(el) {
  if (el.open) el.close();
}

function suljeModaali() {
  if (!avoinModaali) return;
  if (history.state && history.state.avain === avoinModaali.avain) {
    history.back(); // popstate sulkee dialogin
    return;
  }
  // Varakeino: dialogilla ei ole omaa merkintää – suljetaan paikallaan
  const { paluu, siirtoOsoite } = avoinModaali;
  suljeElementti(avoinModaali.el);
  avoinModaali = null;
  history.replaceState({ y: window.scrollY }, '',
    siirtoOsoite || (onSuositusPolku(location.pathname) ? paluu || '/' : location.href));
  if (dataValmis) sovellaReitti();
  palautaFokusLahteelle();
}

function palautaFokusLahteelle() {
  if (palautaFokus && document.contains(palautaFokus)) palautaFokus.focus({ preventScroll: true });
  palautaFokus = null;
}

window.addEventListener('popstate', () => {
  const s = history.state || {};
  if (avoinModaali && s.avain !== avoinModaali.avain) {
    const { siirtoOsoite, paluu } = avoinModaali;
    suljeElementti(avoinModaali.el);
    avoinModaali = null;
    // Suodatinpaneelissa tehdyt rajaukset siirtyvät pohjamerkintään – vain jos palattiin
    // juuri siihen (ei esim. historiavalikosta kauemmas)
    if (siirtoOsoite && location.pathname + location.search === paluu) {
      history.replaceState({ ...s, y: window.scrollY }, '', siirtoOsoite);
    }
    palautaFokusLahteelle();
  }
  // Eteenpäin-nuoli suljetun dialogin merkintään: siivotaan (suosituksen dialogi avataan uudelleen)
  if (!avoinModaali && s.modaali && !onSuositusPolku(location.pathname)) siivoaModaaliMerkinta();
  if (!dataValmis) return;
  sovellaReitti();
  if (ylosPaluunJalkeen) {
    ylosPaluunJalkeen = false;
    window.scrollTo({ top: 0, behavior: pehmea() });
  }
});

function setupDialogit() {
  document.querySelectorAll('dialog.paneeli').forEach(d => {
    d.addEventListener('cancel', e => { e.preventDefault(); suljeModaali(); });
    d.addEventListener('click', e => {
      // Klikkaus taustaverhoon (dialogin ulkopuolelle) sulkee
      if (e.target === d || e.target.closest('[data-sulje]')) suljeModaali();
    });
  });
}

// --- Suosituksen oma näkymä ---

// Tuomaksen suositusosion alustus: "Sitten kun…" – arvonnan kehyslause kategorian mukaan
const SITTEN_KUN = {
  kirja: ['Sitten kun mökin sähköt katkeavat ja jäljellä on vain otsalamppu…', 'Sitten kun juna seisoo Tikkurilassa vartin ilman selitystä…'],
  'tv-sarja': ['Sitten kun sataa koko viikonlopun eikä kukaan jaksa lähteä minnekään…', 'Sitten kun sohva kutsuu ja kaukosäädin on jo kädessä…'],
  podcast: ['Sitten kun lenkkipolku on pitkä ja kuulokkeissa riittää akkua…', 'Sitten kun Uutisraportin uusin jakso on jo kuunneltu…'],
  elokuva: ['Sitten kun on perjantai-ilta ja popcornit on poksautettu…'],
  musiikki: ['Sitten kun kotimatka venyy ja tarvitaan soundtrack…'],
  artikkeli: ['Sitten kun kahvi jäähtyy ja on vartti aikaa…'],
  kulttuuri: ['Sitten kun sataa ja museon ovet ovat auki…'],
  urheilu: ['Sitten kun Salla lähtee ladulle ja Tuomas jää sohvalle…'],
  ruoka: ['Sitten kun nälkä yllättää ja jääkaappi ammottaa tyhjyyttään…'],
  dokumentti: ['Sitten kun haluaa tietää, miten kaikki oikeasti meni…'],
  muu: ['Sitten kun tulee niitä pitkiä epämukavia hiljaisuuksia…'],
};

function sittenKun(rec) {
  const vaihtoehdot = SITTEN_KUN[rec.paakategoria] || SITTEN_KUN.muu;
  return vaihtoehdot[parseInt(rec.id, 36) % vaihtoehdot.length];
}

function naytaSuositus(rec, { historia = true, arvottu = false, avain = null, paluu = '/', laske = false } = {}) {
  const el = $('#suositusDialogi');
  $('#suositusSisalto').innerHTML = renderTarkka(rec, arvottu);
  $('#suositusSisalto').scrollTop = 0;
  const otsikko = `${rec.teos} – Uutisraportti suosittelee`;
  if (historia) {
    avaaModaali('suositus', el, { url: recUrl(rec), otsikko, rec });
  } else {
    // Merkintä on jo historiassa (osoitteesta avattu)
    if (avoinModaali && avoinModaali.el !== el) suljeElementti(avoinModaali.el);
    avoinModaali = { nimi: 'suositus', el, avain, paluu, otsikko, rec };
    if (!el.open) el.showModal();
    paivitaOtsikko();
    if (laske) laskeSivu();
  }
}

function renderTarkka(rec, arvottu) {
  const linkit = rakennaLinkit(rec);
  const suosikki = Suosikit.onko(rec.id);
  const samaJakso = allRecs.filter(r => r.jakso_id === rec.jakso_id && r.id !== rec.id);
  const s = suosittelijat.get(rec.suosittelija);
  const g = rec.toisto > 1 ? teosRyhmat.get(rec.teosSlug) : null;
  const toistot = g ? g.recs.filter(r => r.id !== rec.id) : [];
  const toistoIdt = new Set(toistot.map(r => r.id));
  const muutSamalta = s ? allRecs.filter(r => r.suosittelija === rec.suosittelija && r.id !== rec.id
    && r.jakso_id !== rec.jakso_id && !toistoIdt.has(r.id)).slice(0, 3) : [];
  const pieniLista = recs => `<ul class="minilista">${recs.map(r => `
    <li><a href="${recUrl(r)}" data-suositus="${r.id}">${kategoriaMerkki(r.paakategoria)}<span class="minilista-teos">${escapeHtml(r.teos)}</span>
    <span class="minilista-meta">${escapeHtml(r.suosittelija || '')} · ${escapeHtml(r.paivamaara)}</span></a></li>`).join('')}</ul>`;

  return `
    ${arvottu ? `<p class="kupla kupla-tervehdys sitten-kun">${escapeHtml(sittenKun(rec))}</p>` : ''}
    <article class="tarkka">
      <div class="rec-top">
        ${kategoriaMerkki(rec.paakategoria)}
        ${rec.kuulijasuositus ? `<span class="rec-badge listener">${ikoni('kuulokkeet')}Kuulijan suositus</span>` : ''}
      </div>
      <h2 class="tarkka-otsikko" id="tarkkaOtsikko">${escapeHtml(rec.teos)}</h2>
      ${onTuntematon(rec.suosittelija)
        ? `<p class="henkilo henkilo-iso henkilo-tuntematon">${avatar('?', 'avatar-l')}<span>Suosittelija ei tiedossa</span></p>`
        : `<a class="henkilo henkilo-iso" href="${suosittelijaUrl(rec.suosittelija)}" data-reitti>${avatar(rec.suosittelija, 'avatar-l')}
            <span><span class="henkilo-nimi">${escapeHtml(rec.suosittelija)}</span><span class="henkilo-rooli">suosittelee · ${s ? luku(s.maara) : 1} suositusta</span></span></a>`}
      ${rec.kuvaus ? `<p class="tarkka-kuvaus">${escapeHtml(rec.kuvaus)}</p>` : ''}
      ${(rec.kategoriat || []).length ? `<p class="rec-tags">${rec.kategoriat.map(t => `<span class="rec-tag">${escapeHtml(t)}</span>`).join('')}</p>` : ''}
      ${linkit.length ? `<div class="tarkka-linkit">${linkit.map(l => linkkiHtml(l, 'rec-link rec-link-iso')).join('')}</div>` : ''}
      <div class="tarkka-toiminnot">
        <button type="button" class="nappi nappi-toissijainen suosikki-iso" data-suosikki="${rec.id}" aria-pressed="${suosikki}">
          ${ikoni('sydan')}<span>${suosikki ? 'Suosikeissa' : 'Tallenna suosikiksi'}</span></button>
        <button type="button" class="nappi nappi-haamu" data-jaa="${rec.id}">${ikoni('jaa')}Jaa</button>
        <button type="button" class="nappi nappi-haamu" data-ilmoita="${rec.id}">${ikoni('lippu')}Ilmoita virheestä</button>
        ${arvottu ? `<button type="button" class="nappi nappi-haamu" data-arvo>${ikoni('noppa')}Arvo uusi</button>` : ''}
      </div>
    </article>
    ${g ? `
    <section class="tarkka-osio tarkka-toistot">
      <h3 class="tarkka-osio-otsikko">${ikoni('toisto')}Suositeltu ${g.kertoja} eri jaksossa${g.henkilot.size > 1 ? `, ${g.henkilot.size} suosittelijaa` : ''}</h3>
      ${pieniLista(toistot)}
      <a class="tekstilinkki" href="/?teos=${g.slug}" data-reitti>Näytä kaikki kerrat listana</a>
    </section>` : ''}
    <section class="tarkka-osio">
      <h3 class="tarkka-osio-otsikko">Jaksosta ${escapeHtml(rec.paivamaara)}</h3>
      <p class="tarkka-jakso">${escapeHtml(rec.jakso_otsikko)}</p>
      ${samaJakso.length ? pieniLista(samaJakso) : '<p class="himmea pieni">Jakson ainoa suositus.</p>'}
    </section>
    ${muutSamalta.length ? `
    <section class="tarkka-osio">
      <h3 class="tarkka-osio-otsikko">Lisää suosittelijalta ${escapeHtml(rec.suosittelija)}</h3>
      ${pieniLista(muutSamalta)}
      <a class="tekstilinkki" href="${suosittelijaUrl(rec.suosittelija)}" data-reitti>Kaikki ${luku(s.maara)} suositusta</a>
    </section>` : ''}`;
}

function arvoSuositus() {
  const pohja = suodata({ ...tila, nakyma: tila.nakyma === 'suosittelijat' ? 'koti' : tila.nakyma });
  const lahde = pohja.length ? pohja : allRecs;
  const rec = lahde[Math.floor(Math.random() * lahde.length)];
  if (rec) naytaSuositus(rec, { arvottu: true });
}

async function jaaSuositus(rec) {
  const url = location.origin + recUrl(rec);
  const teksti = `${rec.teos} – ${rec.suosittelija || 'Uutisraportti'} suosittelee`;
  if (navigator.share) {
    try { await navigator.share({ title: rec.teos, text: teksti, url }); } catch {}
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Linkki kopioitu leikepöydälle.');
  } catch {
    toast(`Kopioi linkki: ${url}`, { kesto: 8000 });
  }
}

// --- Suosikki-napit (kortti ja suosituksen näkymä) ---

function vaihdaSuosikki(id) {
  const rec = recById.get(id);
  if (!rec) return;
  const nyt = Suosikit.vaihda(id);
  document.querySelectorAll(`[data-suosikki="${id}"]`).forEach(nappi => {
    nappi.setAttribute('aria-pressed', String(nyt));
    const teksti = nappi.querySelector('span');
    if (teksti) teksti.textContent = nyt ? 'Suosikeissa' : 'Tallenna suosikiksi';
    nappi.classList.remove('pomppu');
    void nappi.offsetWidth;
    if (nyt) nappi.classList.add('pomppu');
  });
  toast(nyt ? `Tallennettu suosikkeihin: <strong>${escapeHtml(rec.teos)}</strong>` : 'Poistettu suosikeista.', {
    toiminto: nyt ? ['Näytä suosikit', () => siirry('/suosikit')] : ['Kumoa', () => vaihdaSuosikki(id)],
  });
}

Suosikit.kuuntele(() => {
  paivitaSuosikkiMaara();
  if (tila.nakyma === 'suosikit') {
    // Koko lista heti, jotta vierityskohta pysyy (muuten vain ensimmäinen erä)
    const y = window.scrollY;
    renderNakyma();
    valmistaLista();
    window.scrollTo({ top: y, behavior: 'instant' });
  }
});

// --- Palaute ---

function avaaPalaute(rec = null) {
  const form = $('#feedbackForm');
  const kiitos = $('#palauteKiitos');
  form.hidden = false;
  kiitos.hidden = true;
  $('#palauteVirhe').hidden = true;
  $('#palauteSuositus').value = rec ? `${rec.teos} | ${rec.paivamaara} | ${rec.id} | ${location.origin}${recUrl(rec)}` : '';
  $('#palauteOtsikko').textContent = rec ? 'Ilmoita virheestä' : 'Anna palautetta';
  $('#palauteOhje').innerHTML = rec
    ? `Mikä suosituksessa <strong>${escapeHtml(rec.teos)}</strong> (${escapeHtml(rec.paivamaara)}) on pielessä? Väärä suosittelija, nimi tai kuvaus – kerro, niin korjataan.`
    : 'Kehu, risu tai ehdota korjausta – kaikki luetaan.';
  avaaModaali('palaute', $('#palauteDialogi'));
  setTimeout(() => $('#palauteViesti').focus(), 60);
}

function setupFeedbackForm() {
  const form = $('#feedbackForm');
  const btn = $('#submitBtn');
  if (!form) return;

  form.addEventListener('submit', e => {
    e.preventDefault();
    btn.textContent = 'Lähetetään…';
    btn.disabled = true;
    $('#palauteVirhe').hidden = true;

    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)).toString()
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        form.reset();
        form.hidden = true;
        $('#palauteKiitos').hidden = false;
      })
      .catch(error => {
        console.error('Virhe:', error);
        const virhe = $('#palauteVirhe');
        virhe.textContent = 'Lähetys epäonnistui. Tarkista verkkoyhteys ja yritä uudelleen – viestisi on yhä tallessa.';
        virhe.hidden = false;
      })
      .finally(() => {
        btn.textContent = 'Lähetä palaute';
        btn.disabled = false;
      });
  });
}

// ---------- Toastit ----------

function toast(html, { kesto = 4000, toiminto = null } = {}) {
  const kontti = $('#toastit');
  const isanta = avoinModaali ? avoinModaali.el : document.body;
  if (kontti.parentElement !== isanta) isanta.appendChild(kontti);
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="toast-teksti">${html}</span>`;
  if (toiminto) {
    const nappi = document.createElement('button');
    nappi.type = 'button';
    nappi.className = 'toast-toiminto';
    nappi.textContent = toiminto[0];
    nappi.addEventListener('click', () => { poista(); toiminto[1](); });
    el.appendChild(nappi);
  }
  // Uusin korvaa edellisen – ei pinoa
  kontti.querySelectorAll('.toast').forEach(t => t.remove());
  kontti.appendChild(el);
  let ajastin = setTimeout(poista, kesto);
  el.addEventListener('pointerenter', () => clearTimeout(ajastin));
  el.addEventListener('pointerleave', () => { ajastin = setTimeout(poista, 1500); });
  function poista() {
    clearTimeout(ajastin);
    el.classList.add('poistuu');
    setTimeout(() => el.remove(), 220);
  }
}

// ---------- Vieritys ----------

const pehmea = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');

function tulostenAlku() {
  const main = $('#tulokset');
  const palkki = $('#tyokalupalkki');
  const palkinKorkeus = palkki.hidden ? 0 : palkki.offsetHeight;
  return main.getBoundingClientRect().top + window.scrollY - palkinKorkeus;
}

// Suodatuksen jälkeen lista alkaa alusta: jos käyttäjä on jo listan sisällä,
// hypätään listan alkuun (ei pehmeää vieritystä – sisältö vaihtui joka tapauksessa)
function vieritaTuloksiin() {
  const alku = tulostenAlku();
  if (window.scrollY > alku + 1) window.scrollTo({ top: alku, behavior: 'instant' });
}

// Kategoriat yhdellä rivillä: hiirellä selattaessa nuolinapit, reunat häivytetään vain sillä
// puolella, jolla on lisää chippejä
function paivitaKategoriaRulla() {
  const rivi = $('#kategoriarivi');
  const vasen = rivi.scrollLeft > 4;
  const oikea = rivi.scrollLeft + rivi.clientWidth < rivi.scrollWidth - 4;
  const kontti = rivi.parentElement;
  kontti.classList.toggle('yli-vasen', vasen);
  kontti.classList.toggle('yli-oikea', oikea);
}

function setupKategoriaRulla() {
  const rivi = $('#kategoriarivi');
  rivi.addEventListener('scroll', paivitaKategoriaRulla, { passive: true });
  window.addEventListener('resize', paivitaKategoriaRulla);
  document.querySelectorAll('[data-rulla]').forEach(nappi => nappi.addEventListener('click', () => {
    rivi.scrollBy({ left: Number(nappi.dataset.rulla) * rivi.clientWidth * 0.7, behavior: pehmea() });
  }));
}

// Hakupalkin "tarttunut"-tila: vain ulkoasu (reunaviiva) vaihtuu, ei korkeus, joten
// mikään sivulla ei siirry. Seurataan ankkuria IntersectionObserverilla – ei
// vierityskuuntelijaa eikä kynnysarvoja, joiden välillä palkki voisi heilua.
function setupPalkki() {
  const ankkuri = $('#palkkiAnkkuri');
  const palkki = $('#tyokalupalkki');
  new IntersectionObserver(([e]) => {
    palkki.classList.toggle('kiinni', !e.isIntersecting && e.boundingClientRect.top < 0);
  }).observe(ankkuri);
}

// ---------- Tapahtumat ----------

function setupListeners() {
  const kentta = $('#searchInput');
  // Kapealla näytöllä pitkä vihjeteksti katkeaisi kesken
  const kapea = matchMedia('(max-width: 640px)');
  const asetaVihjeteksti = () => {
    kentta.placeholder = kapea.matches ? 'Hae suosituksista' : 'Etsi teosta, suosittelijaa tai jaksoa';
  };
  kapea.addEventListener('change', asetaVihjeteksti);
  asetaVihjeteksti();
  let hakuAjastin;
  kentta.addEventListener('input', () => {
    $('#hakuTyhjenna').hidden = !kentta.value;
    clearTimeout(hakuAjastin);
    hakuAjastin = setTimeout(() => {
      paivitaTila({ q: kentta.value.trim() }, { vieritys: false });
      // Kirjoitettaessa palkki nostetaan yläreunaan, jotta tulokset näkyvät näppäimistön yläpuolella
      const alku = tulostenAlku();
      if (window.scrollY < alku - 1 && kentta.value) {
        window.scrollTo({ top: alku, behavior: pehmea() });
      } else {
        vieritaTuloksiin();
      }
    }, 180);
  });
  kentta.addEventListener('keydown', e => {
    if (e.key === 'Escape' && kentta.value) {
      e.preventDefault();
      kentta.value = '';
      $('#hakuTyhjenna').hidden = true;
      paivitaTila({ q: '' });
    } else if (e.key === 'Enter') {
      kentta.blur(); // mobiilissa näppäimistö pois, tulokset näkyviin
    }
  });
  $('#hakuTyhjenna').addEventListener('click', () => {
    kentta.value = '';
    $('#hakuTyhjenna').hidden = true;
    paivitaTila({ q: '' });
    kentta.focus();
  });

  // "/" kohdistaa haun mistä tahansa (kuten GitHubissa ja YouTubessa)
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || avoinModaali) return;
    const t = e.target;
    if (t.matches && t.matches('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    kentta.focus();
    kentta.select();
  });

  $('#recommenderFilter').addEventListener('change', e => paivitaTila({ suosittelija: e.target.value }));
  $('#jarjestys').addEventListener('click', () =>
    paivitaTila({ jarjestys: tila.jarjestys === 'vanhin' ? 'uusin' : 'vanhin' }));


  // Yksi delegoitu kuuntelija kaikille dynaamisille napeille ja sisäisille linkeille
  document.addEventListener('click', e => {
    const kohde = e.target.closest('a, button');
    if (!kohde) return;
    const uusiValilehti = e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1;

    if (kohde.dataset.suosikki) { e.preventDefault(); vaihdaSuosikki(kohde.dataset.suosikki); return; }
    if (kohde.dataset.jaa) { const r = recById.get(kohde.dataset.jaa); if (r) jaaSuositus(r); return; }
    if (kohde.dataset.ilmoita) { const r = recById.get(kohde.dataset.ilmoita); if (r) avaaPalaute(r); return; }
    if (kohde.hasAttribute('data-arvo')) { arvoSuositus(); return; }
    if (kohde.dataset.teos !== undefined && kohde.matches('.toisto-merkki, .top-teos')) {
      e.preventDefault();
      const slug = kohde.dataset.teos;
      if (tila.nakyma === 'koti' && !tila.profiili) paivitaTila({ teos: tila.teos === slug ? '' : slug });
      else siirry(`/?teos=${slug}`);
      return;
    }
    if (kohde.dataset.toistuvat !== undefined) {
      paivitaTila({ toistuvat: tila.toistuvat ? '' : '1' });
      return;
    }


    if (kohde.hasAttribute('data-takaisin') && !uusiValilehti) {
      e.preventDefault();
      history.back();
      return;
    }
    if (kohde.dataset.suositus && !uusiValilehti) {
      e.preventDefault();
      const r = recById.get(kohde.dataset.suositus);
      if (r) naytaSuositus(r);
      return;
    }
    if (kohde.hasAttribute('data-reitti') && !uusiValilehti) {
      e.preventDefault();
      const osoite = kohde.getAttribute('href');
      if (osoite === location.pathname + location.search && !avoinModaali) {
        window.scrollTo({ top: 0, behavior: pehmea() });
      } else {
        siirry(osoite);
      }
      return;
    }
    if (kohde.dataset.kategoria !== undefined && kohde.matches('.chippi, .jakauma-selite')) {
      const k = kohde.dataset.kategoria;
      paivitaTila({ kategoria: tila.kategoria === k ? '' : k });
      return;
    }
    if (kohde.dataset.vuosi !== undefined && kohde.matches('.aj-vuosi')) {
      const v = kohde.dataset.vuosi;
      // Aikajanasta valittaessa vieritetään pehmeästi tuloksiin
      paivitaTila({ vuosi: tila.vuosi === v ? '' : v }, { vieritys: false });
      window.scrollTo({ top: tulostenAlku(), behavior: pehmea() });
      return;
    }
    if (kohde.dataset.poista) {
      const p = kohde.dataset.poista;
      if (p === 'kaikki') {
        kentta.value = '';
        paivitaTila({ ...TYHJAT_RAJAUKSET });
      } else {
        if (p === 'q') kentta.value = '';
        paivitaTila({ [p]: '' });
      }
    }
  });

  setupPalkki();
  setupVihjeet();
  setupKategoriaRulla();
}

// ---------- Pääsiäismunat ----------

// Hiihto: Salla rakastaa hiihtoa, Tuomas ei. Hakusana "hiihto", "latu", "sukset"…
// lähettää ladulle hiihtäjän ja vähän lunta. Kerran latausta kohden, ei koskaan tiellä.
let hiihtoNahty = false;

function tarkistaPaasiaismuna(q) {
  if (hiihtoNahty || !q) return;
  if (!/(^| )(hiih|ladu|latu|suks|vasalop)/.test(hakuNormalisoi(q))) return;
  hiihtoNahty = true;
  toast('Salla lähti ladulle. Tuomas jäi sisälle lämpimään ja suosittelee jotain muuta.', { kesto: 6000 });
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const lumi = Array.from({ length: 36 }, () => {
    const koko = (2 + Math.random() * 4).toFixed(1);
    return `<i style="left:${(Math.random() * 100).toFixed(1)}%;width:${koko}px;height:${koko}px;` +
      `animation-delay:${(Math.random() * 2.5).toFixed(2)}s;animation-duration:${(3.5 + Math.random() * 3).toFixed(2)}s;` +
      `--ajelehdi:${(Math.random() * 60 - 30).toFixed(0)}px"></i>`;
  }).join('');
  const el = document.createElement('div');
  el.className = 'hiihto';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="lumi">${lumi}</div>
    <div class="hiihtaja"><div class="hiihtaja-keinu">
      <svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="34" cy="8.5" r="3.6"/>
        <path d="M31.2 5.6c1.5-2.3 4.4-2.6 6.2-.6" stroke-width="2.6"/>
        <circle cx="39" cy="3.4" r="1.4" fill="currentColor" stroke="none"/>
        <path d="M32.5 12.5 27 25"/>
        <path d="M31.5 14c-2.6.4-5.6 1.4-8 3.2M30.5 13.6c-3 0-6.4-.6-8.6-2.4" stroke-width="1.8"/>
        <path d="M31 15.5l7.5 5.5M38.5 21l3.5 19"/>
        <path d="M29.5 16.5 20 21.5M20 21.5 11 40"/>
        <path d="M27 25l8.5 6.5L33 41M27 25l-7 8.5-3.5 7.5"/>
        <path d="M5 42.5h44c3 0 5-1.2 6.5-3.5"/>
      </svg>
    </div></div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 7500);
}

// Pitkä epämukava hiljaisuus: jos etusivulla ei tapahdu mitään hetkeen, tarjotaan
// keskustelunaihe – kerran istuntoa kohden.
function kaynnistaHiljaisuusvahti() {
  try { if (sessionStorage.getItem('hiljaisuus')) return; } catch {}
  const ODOTUS = 50000;
  let ajastin;
  const nollaa = () => {
    clearTimeout(ajastin);
    ajastin = setTimeout(hiljaisuus, ODOTUS);
  };
  const tapahtumat = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'];
  const lopeta = () => {
    clearTimeout(ajastin);
    tapahtumat.forEach(t => window.removeEventListener(t, nollaa));
  };
  function hiljaisuus() {
    if (document.hidden || avoinModaali || tila.nakyma !== 'koti') return nollaa();
    lopeta();
    try { sessionStorage.setItem('hiljaisuus', '1'); } catch {}
    const rec = allRecs[Math.floor(Math.random() * allRecs.length)];
    toast(`Pitkä epämukava hiljaisuus? Tässä keskustelunaihe: <strong>${escapeHtml(rec.teos)}</strong>`, {
      kesto: 12000,
      toiminto: ['Kerro lisää', () => naytaSuositus(rec)],
    });
  }
  tapahtumat.forEach(t => window.addEventListener(t, nollaa, { passive: true }));
  nollaa();
}

// ---------- Teemakytkin ----------
// Oletuksena seurataan laitteen asetusta (prefers-color-scheme). Kytkin asettaa
// <html data-theme>. Jos valinta osuu samaksi kuin laitteen asetus, tallennettu
// valinta poistetaan, jolloin sivu palaa seuraamaan laitetta.
function setupTeemakytkin() {
  const kytkin = document.getElementById('teemakytkin');
  if (!kytkin) return;
  const laiteVaalea = window.matchMedia('(prefers-color-scheme: light)');

  const nykyinen = () => document.documentElement.dataset.theme || (laiteVaalea.matches ? 'light' : 'dark');
  const paivita = () => kytkin.setAttribute('aria-checked', String(nykyinen() === 'light'));

  kytkin.addEventListener('click', () => {
    const uusi = nykyinen() === 'light' ? 'dark' : 'light';
    const laitteen = laiteVaalea.matches ? 'light' : 'dark';
    try {
      if (uusi === laitteen) {
        delete document.documentElement.dataset.theme;
        localStorage.removeItem('teema');
      } else {
        document.documentElement.dataset.theme = uusi;
        localStorage.setItem('teema', uusi);
      }
    } catch (e) {
      document.documentElement.dataset.theme = uusi;
    }
    paivita();
    sovitaLampoTekstit();
  });

  laiteVaalea.addEventListener('change', () => { paivita(); sovitaLampoTekstit(); });
  paivita();
}

// Palaute, Tietoa ja Takaisin ylös toimivat heti, myös jos datan lataus epäonnistuu
function setupPerustoiminnot() {
  setupDialogit();
  document.addEventListener('click', e => {
    const kohde = e.target.closest('a, button');
    if (!kohde) return;
    if (kohde.hasAttribute('data-avaa-palaute')) { e.preventDefault(); avaaPalaute(); }
    else if (kohde.id === 'aboutLink') { e.preventDefault(); avaaModaali('tietoa', $('#aboutModal')); }
    else if (kohde.matches('.ylos-linkki')) { e.preventDefault(); window.scrollTo({ top: 0, behavior: pehmea() }); }
  });
}

// Käynnistys
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
setupTeemakytkin();
setupPerustoiminnot();
setupFeedbackForm();
init();
