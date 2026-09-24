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

function applyFilters() {
  const query = document.getElementById('searchInput').value.toLowerCase().trim();
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
    filtered = filtered.filter(r => {
      const searchable = [
        r.teos,
        r.kuvaus,
        r.suosittelija,
        r.paakategoria,
        r.jakso_otsikko,
        ...(r.kategoriat || [])
      ].join(' ').toLowerCase();
      return searchable.includes(query);
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
    links += `<a href="${escapeHtml(rec.google_linkki)}" target="_blank" class="rec-link">🔍 Google</a>`;
  }
  if (rec.lisatieto_linkki && rec.lisatieto_linkki !== rec.google_linkki) {
    let linkLabel = 'Lisätietoa';
    const url = rec.lisatieto_linkki.toLowerCase();
    if (url.includes('goodreads')) linkLabel = '📚 Goodreads';
    else if (url.includes('imdb')) linkLabel = '🎬 IMDb';
    else if (url.includes('spotify')) linkLabel = '🎵 Spotify';
    else if (url.includes('apple')) linkLabel = '🍎 Apple';
    else if (url.includes('tidal')) linkLabel = '🎧 Tidal';
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
            <a href="${escapeHtml(rec.google_linkki || '#')}" target="_blank">${escapeHtml(rec.teos)}</a>
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
  const MINIFY_AT = 100;

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
      if (maxScroll <= MINIFY_AT + SCROLL_THRESHOLD) {
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
          if (currentScrollY > MINIFY_AT && delta > 0) {
            if (document.activeElement !== searchInput) setMinified(true);
          } else if (currentScrollY <= MINIFY_AT) {
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

// Start the app
init();
setupFeedbackForm();
setupAboutModal();
