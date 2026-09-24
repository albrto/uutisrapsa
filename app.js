// ===== UUTISRAPORTTI SUOSITTELEE – WEB APP =====

let allData = [];
let allRecs = []; // flattened: each rec has jakso info attached
let lastRendered = []; // flat list of currently visible recs, in render order
let activeCategory = '';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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
        <h2>Dataa ei voitu ladata</h2>
        <p>Varmista, että suositukset.json on samassa kansiossa.</p>
      </div>`;
  }
}

function categoryClass(cat) {
  return (cat || 'muu').replace(/[^a-zä-ö-]/gi, '').toLowerCase();
}

// Osassa jaksoja otsikko alkaa päivämäärällä, joka näkyy jo omassa leimassaan
function cleanEpisodeTitle(title) {
  return (title || '').replace(/^\s*\d{1,2}\.\d{1,2}\.\d{4}\s*[:–-]\s*/, '');
}

function populateFilters() {
  // Kategoriachipit: kaikki arvot aina esillä, yleisin ensin
  const counts = new Map();
  for (const r of allRecs) {
    if (!r.paakategoria) continue;
    counts.set(r.paakategoria, (counts.get(r.paakategoria) || 0) + 1);
  }
  const categories = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const row = document.getElementById('stickerRow');
  let html = `<button type="button" class="sticker all" data-cat="" aria-pressed="true">Kaikki</button>`;
  for (const [cat, count] of categories) {
    html += `<button type="button" class="sticker ${categoryClass(cat)}" data-cat="${escapeHtml(cat)}" aria-pressed="false">
      ${escapeHtml(cat)}<span class="sticker-count">${count}</span>
    </button>`;
  }
  row.innerHTML = html;

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
      <span class="stat-number">${totalRecs}</span>
      <span class="stat-label">suositusta</span>
    </div>
    <div class="stat">
      <span class="stat-number">${totalEpisodes}</span>
      <span class="stat-label">jaksoa</span>
    </div>
    <div class="stat">
      <span class="stat-number">${totalRecommenders}</span>
      <span class="stat-label">suosittelijaa</span>
    </div>
  `;
}

function getFiltered() {
  const query = document.getElementById('searchInput').value.toLowerCase().trim();
  const recommenderFilter = document.getElementById('recommenderFilter').value;
  const yearFilter = document.getElementById('yearFilter').value;

  let filtered = allRecs;

  if (activeCategory) {
    filtered = filtered.filter(r => r.paakategoria === activeCategory);
  }

  if (recommenderFilter) {
    filtered = filtered.filter(r => r.suosittelija === recommenderFilter);
  }

  if (yearFilter) {
    filtered = filtered.filter(r => {
      const parts = r.paivamaara ? r.paivamaara.split('.') : [];
      return parts.length === 3 && parts[2] === yearFilter;
    });
  }

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

  return { filtered, hasFilters: Boolean(query || activeCategory || recommenderFilter || yearFilter) };
}

let hasRenderedOnce = false;

function applyFilters() {
  const { filtered, hasFilters } = getFiltered();

  // Suodatus latoo listan yhtenä liikkeenä — mutta vain kun sivu on
  // näkyvissä ja kyse on uudelleenladonnasta, ei ensirenderöinnistä
  if (hasRenderedOnce && !document.hidden && document.startViewTransition && !reducedMotion.matches) {
    document.startViewTransition(() => renderResults(filtered));
  } else {
    renderResults(filtered);
  }
  hasRenderedOnce = true;

  document.getElementById('resultsCount').textContent =
    hasFilters ? `${filtered.length} suositusta löytyi` : `${filtered.length} suositusta`;
}

function renderResults(recs) {
  const container = document.getElementById('results');
  lastRendered = recs;

  if (recs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg aria-hidden="true"><use href="#i-search" /></svg>
        <h2>Ei osumia</h2>
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
  let cardIndex = 0;
  let groupIndex = 0;
  for (const [id, group] of grouped) {
    // Nimetyt view-transition-ryhmät ylimmille jaksoille: suodatus latoo
    // näkyvän listan yhtenä liikkeenä (loput riittää ristihäivyttää).
    // Nimi johdetaan jakson id:stä, jotta ryhmä seuraa samaa jaksoa
    // eikä listasijaintia, kun suodatus järjestää listan uusiksi.
    const vtName = groupIndex < 24
      ? ` style="view-transition-name: ep-${String(id).replace(/[^a-zA-Z0-9-]/g, '')}"`
      : '';
    groupIndex++;
    html += `<section class="episode-group"${vtName}>`;
    html += `<div class="episode-header">`;
    html += `<span class="episode-date">${escapeHtml(group.paivamaara)}</span>`;
    html += `<h2 class="episode-title">${escapeHtml(cleanEpisodeTitle(group.otsikko))}</h2>`;
    html += `</div>`;
    html += `<div class="episode-recs">`;

    for (const rec of group.suositukset) {
      html += renderCard(rec, cardIndex++);
    }

    html += `</div></section>`;
  }

  container.innerHTML = html;
}

function linkMeta(url) {
  const u = url.toLowerCase();
  if (u.includes('goodreads')) return { icon: 'i-book', label: 'Goodreads' };
  if (u.includes('imdb')) return { icon: 'i-film', label: 'IMDb' };
  if (u.includes('spotify')) return { icon: 'i-note', label: 'Spotify' };
  if (u.includes('apple')) return { icon: 'i-note', label: 'Apple' };
  if (u.includes('tidal')) return { icon: 'i-note', label: 'Tidal' };
  return { icon: 'i-link', label: 'Lisätietoa' };
}

function renderCard(rec, index) {
  const catClass = categoryClass(rec.paakategoria);

  // Build links
  let links = '';
  if (rec.google_linkki) {
    links += `<a href="${escapeHtml(rec.google_linkki)}" target="_blank" rel="noopener" class="rec-link">
      <svg aria-hidden="true"><use href="#i-search" /></svg>Google</a>`;
  }
  if (rec.lisatieto_linkki && rec.lisatieto_linkki !== rec.google_linkki) {
    const meta = linkMeta(rec.lisatieto_linkki);
    links += `<a href="${escapeHtml(rec.lisatieto_linkki)}" target="_blank" rel="noopener" class="rec-link">
      <svg aria-hidden="true"><use href="#${meta.icon}" /></svg>${meta.label}</a>`;
  }

  // Tags
  let tags = '';
  if (rec.kategoriat && rec.kategoriat.length > 0) {
    tags = rec.kategoriat.map(t => `<span class="rec-tag">${escapeHtml(t)}</span>`).join('');
  }

  const listenerFlag = rec.kuulijasuositus
    ? `<div class="listener-flag"><svg aria-hidden="true"><use href="#i-headphones" /></svg>kuulijan vinkki</div>`
    : '';

  return `
    <article class="rec-card ${catClass}" data-card-i="${index}">
      ${listenerFlag}
      <div class="rec-top">
        <h3 class="rec-title">
          <a href="${escapeHtml(rec.google_linkki || '#')}" target="_blank" rel="noopener">${escapeHtml(rec.teos)}</a>
        </h3>
        <span class="rec-cat">${escapeHtml(rec.paakategoria || 'muu')}</span>
      </div>
      <p class="rec-desc">${escapeHtml(rec.kuvaus || '')}</p>
      <div class="rec-recommender">${escapeHtml(rec.suosittelija || 'suosittelija ei tiedossa')}</div>
      <div class="rec-footer">
        ${links ? `<div class="rec-links">${links}</div>` : '<div></div>'}
        ${tags ? `<div class="rec-tags">${tags}</div>` : ''}
      </div>
    </article>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Yllätä minut: satunnainen nosto ---
function surpriseMe() {
  if (lastRendered.length === 0) return;
  const index = Math.floor(Math.random() * lastRendered.length);
  const card = document.querySelector(`[data-card-i="${index}"]`);
  if (!card) return;

  document.querySelectorAll('.rec-card.picked').forEach(el => el.classList.remove('picked'));
  card.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
  card.classList.add('picked');
}

function setupListeners() {
  let debounceTimer;
  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 200);
  });

  document.getElementById('stickerRow').addEventListener('click', (e) => {
    const btn = e.target.closest('.sticker');
    if (!btn) return;
    activeCategory = btn.dataset.cat;
    document.querySelectorAll('#stickerRow .sticker').forEach(s => {
      s.setAttribute('aria-pressed', s === btn ? 'true' : 'false');
    });
    applyFilters();
  });

  document.getElementById('recommenderFilter').addEventListener('change', applyFilters);
  document.getElementById('yearFilter').addEventListener('change', applyFilters);

  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('recommenderFilter').value = '';
    document.getElementById('yearFilter').value = '';
    activeCategory = '';
    document.querySelectorAll('#stickerRow .sticker').forEach(s => {
      s.setAttribute('aria-pressed', s.dataset.cat === '' ? 'true' : 'false');
    });
    applyFilters();
  });

  document.getElementById('surpriseBtn').addEventListener('click', surpriseMe);

  setupScrollListener();
  setupMobileFilters();
}

function setupScrollListener() {
  const controls = document.querySelector('.controls');
  let lastScrollY = window.scrollY;
  let ticking = false;
  const SCROLL_THRESHOLD = 8; // Ignore small deltas (e.g. mobile Safari address bar)
  const MINIFY_AT = 140;

  // Minifying changes the height of the sticky bar, which shifts the page and
  // fires scroll events of its own (scroll anchoring, clamping on short lists).
  // Absorb that shift so it is not mistaken for the user scrolling, otherwise
  // the bar flips between states in a loop.
  function setMinified(on) {
    if (controls.classList.contains('minified') === on) return;
    controls.classList.toggle('minified', on);
    if (on) {
      // Not worth minifying if the page would become too short to stay past
      // the threshold (e.g. a filter leaves only a few results).
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll <= MINIFY_AT + SCROLL_THRESHOLD) {
        controls.classList.remove('minified');
      }
    }
    lastScrollY = window.scrollY;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        const currentScrollY = window.scrollY;
        const delta = currentScrollY - lastScrollY;

        controls.classList.toggle('stuck', currentScrollY > 40);

        // Skip when at the bottom of the page (Safari rubber-band / overscroll)
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const atBottom = currentScrollY >= maxScroll - 5;

        if (Math.abs(delta) > SCROLL_THRESHOLD && !atBottom) {
          lastScrollY = currentScrollY;
          if (currentScrollY > MINIFY_AT && delta > 0) {
            setMinified(true);
          } else if (delta < 0 || currentScrollY <= MINIFY_AT) {
            setMinified(false);
          }
        }

        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

function setupMobileFilters() {
  const toggleBtn = document.getElementById('mobileFilterToggle');
  const filterRow = document.getElementById('filterRow');

  if (!toggleBtn || !filterRow) return;

  toggleBtn.addEventListener('click', () => {
    const isShowing = filterRow.classList.toggle('show');
    toggleBtn.classList.toggle('active', isShowing);
    toggleBtn.querySelector('span').textContent = isShowing ? 'Piilota suodattimet' : 'Tarkemmat suodattimet';
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
        btn.textContent = "Lähetys epäonnistui. Yritä uudelleen.";
        btn.disabled = false;
        btn.style.backgroundColor = "var(--cat-ruoka)";
        btn.style.borderColor = "var(--cat-ruoka)";
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

  const openModal = () => {
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden'; // Prevent scroll
    close.focus();
  };

  const closeModal = () => {
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
    link.focus();
  };

  link.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  });

  close.addEventListener('click', closeModal);

  window.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'block') closeModal();
  });
}

// Start the app
init();
setupFeedbackForm();
setupAboutModal();
