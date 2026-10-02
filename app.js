// ===== UUTISRAPORTTI SUOSITUKSET – WEB APP =====

let allData = [];
let allRecs = []; // flattened: each rec has jakso info attached

async function init() {
  try {
    // Check if data is already loaded via script tag (for local file:// access)
    if (window.SUOSITUKSET_DATA) {
      allData = window.SUOSITUKSET_DATA;
    } else {
      // Fallback to fetch for web environment
      const res = await fetch('suositukset.json');
      allData = await res.json();
    }
    
    // Flatten: attach episode info to each recommendation
    allRecs = [];
    for (const jakso of allData) {
      for (const rec of jakso.suositukset) {
        // Piilotettu = poistettu sivulta (paikka säilyy datassa, ettei r_idx-viitteet siirry)
        if (rec.piilotettu) continue;
        allRecs.push({
          ...rec,
          jakso_otsikko: jakso.jakso_otsikko,
          paivamaara: jakso.paivamaara,
          jakso_id: jakso.id
        });
      }
    }
    
    populateFilters();
    renderStats();
    applyFilters();
    setupListeners();
  } catch (err) {
    console.error('Virhe datan lataamisessa:', err);
    document.getElementById('results').innerHTML = `
      <div class="empty-state">
        <h3>Dataa ei voitu ladata</h3>
        <p>Varmista, että suositukset.json on samassa kansiossa.</p>
      </div>`;
  }
}

function populateFilters() {
  // Categories
  const categories = [...new Set(allRecs.map(r => r.paakategoria).filter(Boolean))].sort();
  const catSelect = document.getElementById('categoryFilter');
  for (const cat of categories) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
    catSelect.appendChild(opt);
  }
  
  // Recommenders
  const recommenders = [...new Set(allRecs.map(r => r.suosittelija).filter(Boolean))].sort();
  const recSelect = document.getElementById('recommenderFilter');
  for (const rec of recommenders) {
    const opt = document.createElement('option');
    opt.value = rec;
    opt.textContent = rec;
    recSelect.appendChild(opt);
  }
  
  // Years
  const years = [...new Set(allData.map(j => {
    const parts = j.paivamaara ? j.paivamaara.split('.') : [];
    return parts.length === 3 ? parts[2] : null;
  }).filter(Boolean))].sort().reverse();
  const yearSelect = document.getElementById('yearFilter');
  for (const year of years) {
    const opt = document.createElement('option');
    opt.value = year;
    opt.textContent = year;
    yearSelect.appendChild(opt);
  }
}

function renderStats() {
  const totalEpisodes = allData.length;
  const totalRecs = allRecs.length;
  const totalRecommenders = new Set(allRecs.map(r => r.suosittelija).filter(Boolean)).size;
  
  document.getElementById('stats').innerHTML = `
    <div class="stat">
      <div class="stat-number">${totalRecs}</div>
      <div class="stat-label">Suositusta</div>
    </div>
    <div class="stat">
      <div class="stat-number">${totalEpisodes}</div>
      <div class="stat-label">Jaksoa</div>
    </div>
    <div class="stat">
      <div class="stat-number">${totalRecommenders}</div>
      <div class="stat-label">Suosittelijaa</div>
    </div>
  `;
}

// Hakunormalisointi: pienet kirjaimet, tarkkeet pois (á→a, mutta ä/ö/å säilyvät),
// kaikki viivat ja välimerkit välilyönneiksi — "Velkajarru-laaja" löytää otsikon
// "Velkajarru–laaja oppimäärä" ja "orbanin" otsikon "Orbánin …"
function hakuNormalisoi(teksti) {
  return String(teksti || '').toLowerCase()
    .replace(/[äöå]/g, m => ({ 'ä': '\u0001', 'ö': '\u0002', 'å': '\u0003' }[m]))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0001/g, 'ä').replace(/\u0002/g, 'ö').replace(/\u0003/g, 'å')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Sumea osuma: sana löytyy, jos jokin tekstin sana alkaa lähes samalla merkkijonolla
// (1 kirjain eroa, ≥8-kirjaimisissa 2). Alun vertailu sallii taivutuspäätteet:
// "ministerivaihdos" löytää "ministerinvaihdoksesta". Alle 4 merkin sanat tarkasti.
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
  if (sana.length < 4) return false;
  const raja = sana.length >= 8 ? 2 : 1;
  return sanat.some(t => {
    for (let pituus = sana.length - raja; pituus <= sana.length + raja; pituus++) {
      if (pituus > 0 && pituus <= t.length && lahesSama(sana, t.slice(0, pituus), raja)) return true;
    }
    return false;
  });
}

function applyFilters() {
  const query = hakuNormalisoi(document.getElementById('searchInput').value);
  const categoryFilter = document.getElementById('categoryFilter').value;
  const recommenderFilter = document.getElementById('recommenderFilter').value;
  const yearFilter = document.getElementById('yearFilter').value;
  
  let filtered = allRecs;
  
  // Category filter
  if (categoryFilter) {
    filtered = filtered.filter(r => r.paakategoria === categoryFilter);
  }
  
  // Recommender filter
  if (recommenderFilter) {
    filtered = filtered.filter(r => r.suosittelija === recommenderFilter);
  }
  
  // Year filter
  if (yearFilter) {
    filtered = filtered.filter(r => {
      const parts = r.paivamaara ? r.paivamaara.split('.') : [];
      return parts.length === 3 && parts[2] === yearFilter;
    });
  }
  
  // Text search
  if (query) {
    // Jokaisen hakusanan pitää löytyä jostain kentästä, järjestyksellä ei väliä
    const sanat = query.split(' ');
    filtered = filtered.filter(r => {
      // Normalisoitu teksti ja sen sanat lasketaan kerran per suositus
      if (!r._haku) {
        r._haku = hakuNormalisoi([
          r.teos,
          r.kuvaus,
          r.suosittelija,
          r.paakategoria,
          r.jakso_otsikko,
          r.paivamaara,
          ...(r.kategoriat || [])
        ].join(' '));
        r._hakusanat = [...new Set(r._haku.split(' '))];
      }
      return sanat.every(sana => sanaLoytyy(sana, r._haku, r._hakusanat));
    });
  }
  
  renderResults(filtered);
  
  document.getElementById('resultsCount').textContent = 
    `${filtered.length} suositusta löytyi` + (query || categoryFilter || recommenderFilter || yearFilter ? ' suodattimilla' : '');

  // Kahvan merkki kertoo pienennetyssä tilassa, montako rajausta on päällä
  const activeCount = [query, categoryFilter, recommenderFilter, yearFilter].filter(Boolean).length;
  document.getElementById('filterHandleCount').textContent = activeCount || '';
}

function renderResults(recs) {
  const container = document.getElementById('results');
  
  if (recs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <h3>Ei tuloksia</h3>
        <p>Kokeile eri hakusanaa tai poista suodattimia.</p>
      </div>`;
    return;
  }
  
  // Group by episode
  const grouped = new Map();
  for (const rec of recs) {
    const key = rec.jakso_id;
    if (!grouped.has(key)) {
      grouped.set(key, {
        otsikko: rec.jakso_otsikko,
        paivamaara: rec.paivamaara,
        suositukset: []
      });
    }
    grouped.get(key).suositukset.push(rec);
  }
  
  let html = '';
  for (const [id, group] of grouped) {
    html += `<div class="episode-group">`;
    html += `<div class="episode-header">`;
    html += `<div class="episode-title">${escapeHtml(group.otsikko)}</div>`;
    html += `<div class="episode-date">${escapeHtml(group.paivamaara)}</div>`;
    html += `</div>`;
    
    for (const rec of group.suositukset) {
      html += renderCard(rec);
    }
    
    html += `</div>`;
  }
  
  container.innerHTML = html;
}

function renderCard(rec) {
  const badgeClass = (rec.paakategoria || 'muu').replace(/[^a-zä-ö-]/gi, '').toLowerCase();
  
  // Build links
  let links = '';
  if (rec.google_linkki) {
    links += `<a href="${escapeHtml(rec.google_linkki)}" target="_blank" class="rec-link">Google</a>`;
  }
  if (rec.paakategoria === 'podcast') {
    for (const [nimi, url] of podcastLinkit(rec)) {
      links += `<a href="${escapeHtml(url)}" target="_blank" class="rec-link">${nimi}</a>`;
    }
  // Google-haku lisätietolinkkinä olisi tupla Google-linkin kanssa
  } else if (rec.lisatieto_linkki && rec.lisatieto_linkki !== rec.google_linkki && !onGoogleLinkki(rec.lisatieto_linkki)) {
    const linkLabel = linkinNimi(rec.lisatieto_linkki);
    links += `<a href="${escapeHtml(rec.lisatieto_linkki)}" target="_blank" class="rec-link">${linkLabel}</a>`;
  }
  
  // Tags
  let tags = '';
  if (rec.kategoriat && rec.kategoriat.length > 0) {
    tags = rec.kategoriat.map(t => `<span class="rec-tag">${escapeHtml(t)}</span>`).join('');
  }
  
  return `
      <div class="rec-card">
        <div class="rec-top">
          <div class="rec-title">
            ${rec.google_linkki
              ? `<a href="${escapeHtml(rec.google_linkki)}" target="_blank">${escapeHtml(rec.teos)}</a>`
              : escapeHtml(rec.teos)}
            ${rec.kuulijasuositus ? `<span class="rec-badge listener" style="margin-left:8px; vertical-align:middle;">🎧 Kuulijan suositus</span>` : ''}
          </div>
          <span class="rec-badge ${badgeClass}">${escapeHtml(rec.paakategoria || 'muu')}</span>
        </div>
      <div class="rec-desc">${escapeHtml(rec.kuvaus || '')}</div>
      <div class="rec-meta">
        <div class="rec-recommender">${escapeHtml(rec.suosittelija || 'Ei varmuutta')}</div>
      </div>
      <div class="rec-footer">
        ${links ? `<div class="rec-links">${links}</div>` : '<div></div>'}
        ${tags ? `<div class="rec-tags">${tags}</div>` : ''}
      </div>
    </div>`;
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

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setupListeners() {
  let debounceTimer;
  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 200);
  });
  
  document.getElementById('categoryFilter').addEventListener('change', applyFilters);
  document.getElementById('recommenderFilter').addEventListener('change', applyFilters);
  document.getElementById('yearFilter').addEventListener('change', applyFilters);
  
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('categoryFilter').value = '';
    document.getElementById('recommenderFilter').value = '';
    document.getElementById('yearFilter').value = '';
    applyFilters();
  });

  setupScrollListener();
  setupMobileFilters();
}

function setupScrollListener() {
  const controls = document.querySelector('.controls');
  const handle = document.getElementById('filterHandle');
  const searchInput = document.getElementById('searchInput');
  let lastScrollY = window.scrollY;
  let ticking = false;
  let settleUntil = 0;
  const SCROLL_THRESHOLD = 8; // Ignore small deltas (e.g. mobile Safari address bar)
  // Palkki pienennetään heti, kun se on tarttunut ruudun yläreunaan (pieni
  // marginaali), ei jo hero-osion kohdalla, jossa täysikokoinen palkki vielä mahtuu.
  //
  // Palautusraja on pienennysrajaa alempana palkin korkeuseron verran (hystereesi):
  // pienentyessä palkin alla oleva sisältö nousee, ja selain (scroll anchoring)
  // tai mobiilin vauhtivieritys voi siirtää vierityskohtaa saman verran taaksepäin.
  // Jos rajat olisivat samat, palkki ehtisi pienentyä, suurentua hetkeksi ja
  // pienentyä taas.
  const hero = document.querySelector('.hero');
  const MINIFY_MARGIN = 16;
  const stickyAlku = () =>
    hero.offsetTop + hero.offsetHeight + parseFloat(getComputedStyle(hero).marginBottom || 0);
  const minifyAt = () => stickyAlku() + MINIFY_MARGIN;
  let taysiKorkeus = 0; // palkin korkeus juuri ennen pienennystä
  const expandAt = () => {
    const pienennetty = controls.classList.contains('minified') || collapseTimer;
    if (!pienennetty) return minifyAt();
    const kahva = handle.offsetHeight || 26;
    return stickyAlku() - Math.max(0, taysiKorkeus - kahva) - SCROLL_THRESHOLD;
  };

  // Minifying changes the height of the sticky bar, which shifts the page and
  // fires scroll events of its own (scroll anchoring, clamping on short lists).
  // Absorb that shift so it is not mistaken for the user scrolling, otherwise
  // the bar flips between states in a loop.
  //
  // Korkeus vaihtuu yhä kerralla (korkeuden animointi toisi siirtymän joka
  // ruutuun); pehmeys tulee clip-path-rullauksesta ja häivytyksestä (style.css).
  // Sulkeutuessa animaatio ajetaan ensin ja palkki pienennetään vasta sen jälkeen.
  const AUKI_MS = 280;
  const KIINNI_MS = 200;
  let collapseTimer = null;
  let expandTimer = null;

  function setMinified(on) {
    const minified = controls.classList.contains('minified');
    if (on) {
      if (minified || collapseTimer) return;
      taysiKorkeus = controls.offsetHeight;
      clearTimeout(expandTimer);
      controls.classList.remove('expanding');
      controls.classList.add('collapsing');
      collapseTimer = setTimeout(() => {
        collapseTimer = null;
        controls.classList.remove('collapsing');
        applyMinified(true);
      }, KIINNI_MS);
    } else {
      if (collapseTimer) {
        // Sulkeutuminen kesken: perutaan, palkki on vielä täysikokoinen
        clearTimeout(collapseTimer);
        collapseTimer = null;
        controls.classList.remove('collapsing');
        return;
      }
      if (!minified) return;
      applyMinified(false);
      controls.classList.add('expanding');
      expandTimer = setTimeout(() => controls.classList.remove('expanding'), AUKI_MS);
    }
  }

  function applyMinified(on) {
    controls.classList.toggle('minified', on);
    if (on) {
      // Not worth minifying if the page would become too short to stay past
      // the threshold (e.g. a filter leaves only a few results).
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll <= minifyAt() + SCROLL_THRESHOLD) {
        controls.classList.remove('minified');
      }
    }
    handle.setAttribute('aria-expanded', String(!controls.classList.contains('minified')));
    lastScrollY = window.scrollY;
    // Scroll anchoring may apply the shift only on a later frame, so ignore
    // scroll deltas for a moment after every state change.
    settleUntil = performance.now() + 250;
  }

  handle.addEventListener('click', () => {
    setMinified(false);
    // Suodatinsymbolista avattaessa suodattimet näkyviin myös mobiilissa
    setFilterRowOpen(true);
    lastScrollY = window.scrollY;
  });

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        const currentScrollY = window.scrollY;
        const delta = currentScrollY - lastScrollY;

        // Skip when at the bottom of the page (Safari rubber-band / overscroll)
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const atBottom = currentScrollY >= maxScroll - 5;

        if (performance.now() < settleUntil) {
          lastScrollY = currentScrollY;
        } else if (Math.abs(delta) > SCROLL_THRESHOLD && !atBottom) {
          lastScrollY = currentScrollY;
          // Ylöspäin vieritys ei tuo palkkia takaisin (se ponnahti liian herkästi
          // sisällön päälle) – palkki aukeaa vain kahvasta tai sivun yläosassa.
          // Hakukentän ollessa aktiivinen palkkia ei piiloteta kirjoittajan alta.
          if (currentScrollY > minifyAt() && delta > 0) {
            if (document.activeElement !== searchInput) setMinified(true);
          } else if (currentScrollY <= expandAt()) {
            setMinified(false);
          }
        }

        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

function setFilterRowOpen(open) {
  const toggleBtn = document.getElementById('mobileFilterToggle');
  const filterRow = document.getElementById('filterRow');
  filterRow.classList.toggle('show', open);
  toggleBtn.classList.toggle('active', open);
  toggleBtn.querySelector('span').textContent = open ? 'Piilota suodattimet' : 'Näytä suodattimet';
}

function setupMobileFilters() {
  const toggleBtn = document.getElementById('mobileFilterToggle');
  const filterRow = document.getElementById('filterRow');

  if (!toggleBtn || !filterRow) return;

  toggleBtn.addEventListener('click', () => {
    setFilterRowOpen(!filterRow.classList.contains('show'));
  });
}

// --- Feedback Form Handling ---
function setupFeedbackForm() {
  const form = document.querySelector('form[name="palaute"]');
  const btn = document.getElementById('submitBtn');
  
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (btn) {
      btn.textContent = "Lähetetään...";
      btn.disabled = true;
    }

    const formData = new FormData(form);

    fetch('/', {
      method: 'POST',
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(formData).toString()
    })
    .then(() => {
      window.location.href = '/kiitos.html';
    })
    .catch((error) => {
      console.error('Error:', error);
      if (btn) {
        btn.textContent = "Virhe. Yritä uudelleen.";
        btn.disabled = false;
        btn.style.backgroundColor = "var(--tag-ruoka)"; // Red-ish error color
      }
    });
  });
}

// --- About Modal Handling ---
function setupAboutModal() {
  const modal = document.getElementById('aboutModal');
  const link = document.getElementById('aboutLink');
  const close = document.querySelector('.close-modal');

  if (!modal || !link || !close) return;

  link.addEventListener('click', (e) => {
    e.preventDefault();
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden'; // Prevent scroll
  });

  close.addEventListener('click', () => {
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
  });

  window.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
      document.body.style.overflow = 'auto';
    }
  });
}

// --- Teemakytkin ---
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
  });

  laiteVaalea.addEventListener('change', paivita);
  paivita();
}

// Start the app
setupTeemakytkin();
init();
setupFeedbackForm();
setupAboutModal();
