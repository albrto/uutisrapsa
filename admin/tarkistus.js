// admin/tarkistus.js — admin-näkymän Tarkistus-välilehti
//
// Vanhan datan tarkistusajon ehdotukset (admin/tarkistus.json, koostaa
// pipeline/julkaise_tarkistus.py) ja Clauden suositukset. Korvaa paikallisen
// tarkistustyökalun (pipeline/tarkistus/). Päätökset ovat tallentamattomia
// muutoksia kuten muutkin admin-korjaukset: "Tallenna muutokset" lähettää ne
// tallenna.js:lle, joka kirjoittaa hyväksytyt korjauksiksi ja kaikki päätökset
// admin/tarkistuspaatokset.json:iin samassa commitissa.
//
// Clauden suositus on vain suositus — vain käyttäjän oma napautus tekee päätöksen
// (käyttäjän toive 1.10.2026), eikä kaikkien hyväksyntään ole nappia.

const Tarkistus = (() => {
  const TYYPIT = {
    puuttuu: 'Puuttuva suositus',
    suosittelija: 'Suosittelija vaihtuu',
    teos: 'Teoksen nimi',
    ylimaarainen: 'Ei löytynyt uudesta poiminnasta',
  };
  // Mitkä kentät voi korjata ennen hyväksyntää
  const MUOKATTAVAT = {
    suosittelija: ['suosittelija', 'kuvaus'],
    teos: ['teos'],
    puuttuu: ['teos', 'suosittelija', 'kuvaus', 'paakategoria'],
    ylimaarainen: [],
  };
  const NIMET = { teos: 'Teos', suosittelija: 'Suosittelija', kuvaus: 'Kuvaus', paakategoria: 'Pääkategoria' };
  const SUOSITUSNIMI = { hyvaksy: 'hyväksy', hylkaa: 'hylkää', poista: 'piilota sivulta' };
  const KANTA = { vahvistaa: '✓ vahvistaa', kiistaa: '✗ kiistää', epavarma: '? epävarma' };
  const TILANIMI = { hyvaksytty: 'Hyväksytty', hylatty: 'Hylätty', poista: 'Piilotetaan sivulta' };
  const LUONNOS_AVAIN = 'tarkistusLuonnos';

  let ladattu = null;          // lupaus: data ladattu
  let DATA = { jaksot: [], arviot: {} };
  let TALLENNETUT = {};        // admin/tarkistuspaatokset.json
  // Tallentamattomat: avain → {paatos, r_idx, teos, data}. Luonnos säilyy selaimessa,
  // jottei pitkä tarkistusrupeama katoa, vaikka välilehti sulkeutuisi.
  let ODOTTAVAT = {};
  try { ODOTTAVAT = JSON.parse(localStorage.getItem(LUONNOS_AVAIN) || '{}'); } catch (e) {}
  let LIVE = new Map();        // jakso_id → suositukset.json:n jakso
  const KORJAUS_KAYTOSSA = {}; // avain → toisen mielipiteen korjaus, jonka käyttäjä otti käyttöön
  let transkriptiJakso = null, osumat = [], osumaIdx = -1, AANI = null;

  const esc = s => escHtml(s ?? '');
  const juuri = () => document.getElementById('tarkistus-nakyma');
  const $ = id => document.getElementById(id);

  // --- Lataus ---
  function lataa() {
    if (ladattu) return ladattu;
    ladattu = (async () => {
      const hae = async (osoite, oletus) => {
        const r = await fetch(osoite + (osoite.includes('?') ? '&' : '?') + 'v=' + Date.now());
        if (r.status === 404 && oletus !== undefined) return oletus;
        if (!r.ok) throw new Error(`${osoite}: ${r.status}`);
        return r.json();
      };
      const [data, tallennetut, suositukset] = await Promise.all([
        hae('tarkistus.json'), haeAdminJson('tarkistuspaatokset.json'), hae('/suositukset.json'),
      ]);
      DATA = data;
      TALLENNETUT = tallennetut || {};
      LIVE = new Map(suositukset.map(j => [j.id, j]));
      for (const avain of Object.keys(ODOTTAVAT)) if (TALLENNETUT[avain]?.viety) delete ODOTTAVAT[avain];
      tallennaLuonnos();
      // Tallennettujen hakuteksti valmiiksi
      for (const j of DATA.jaksot) {
        j._haku = hakuNormalisoi([j.jakso_otsikko, j.paivamaara, ...(j.osallistujat || []),
          ...j.erot.flatMap(e => [e.teos, e.vanha, e.uusi])].filter(Boolean).join(' '));
        j._hakusanat = [...new Set(j._haku.split(' '))];
      }
      updateSaveBtn();
    })();
    ladattu.catch(() => { ladattu = null; });
    return ladattu;
  }

  function tallennaLuonnos() {
    try {
      if (Object.keys(ODOTTAVAT).length) localStorage.setItem(LUONNOS_AVAIN, JSON.stringify(ODOTTAVAT));
      else localStorage.removeItem(LUONNOS_AVAIN);
    } catch (e) {}
  }

  // Päätös: tallentamaton ensin, sitten tallennettu. Tallentamaton null = peruttu
  // tallennettu hylkäys → kortti näkyy taas avoimena.
  function paatos(avain) {
    const o = ODOTTAVAT[avain];
    if (o) return o.paatos === null ? null : o;
    return TALLENNETUT[avain] || null;
  }

  // --- Ehdotuksen lähtöarvot ---
  function oletusData(ero) {
    const u = ero.uusi_data || {};
    if (ero.tyyppi === 'suosittelija') return { suosittelija: ero.uusi, kuvaus: u.kuvaus || '' };
    if (ero.tyyppi === 'teos') return { teos: ero.uusi, google_linkki: u.google_linkki || '', lisatieto_linkki: u.lisatieto_linkki || '' };
    if (ero.tyyppi === 'puuttuu') return {
      teos: u.teos || ero.teos, suosittelija: ero.uusi || u.suosittelija, kuvaus: u.kuvaus || '',
      paakategoria: u.paakategoria || 'muu', kategoriat: u.kategoriat || [],
      google_linkki: u.google_linkki || '', lisatieto_linkki: u.lisatieto_linkki || '',
    };
    return {};
  }

  // Clauden korjaamat arvot, jos Claude suosittelee hyväksymään; toisen mielipiteen
  // korjaus päälle, jos käyttäjä otti sen käyttöön
  function lahtoData(ero) {
    const a = DATA.arviot[ero.avain];
    const pohja = a && a.suositus === 'hyvaksy' && a.data ? { ...oletusData(ero), ...a.data } : oletusData(ero);
    return KORJAUS_KAYTOSSA[ero.avain] ? { ...pohja, ...KORJAUS_KAYTOSSA[ero.avain] } : pohja;
  }

  const kiistanalainen = avain => { const a = DATA.arviot[avain]; return !!(a && a.toinen && a.toinen.kanta !== 'vahvistaa'); };
  const kahdestiVahvistettu = avain => { const a = DATA.arviot[avain]; return !!(a && a.toinen && a.toinen.kanta === 'vahvistaa' && a.suositus !== 'hylkaa'); };
  const epavarma = avain => { const a = DATA.arviot[avain]; return !!(a && a.varmuus !== 'varma'); };

  // Onko suositusta korjattu käsin admin-näkymässä (hyväksyntä ylikirjoittaisi sen)
  function kasikorjattu(jakso_id, r_idx) {
    return (window.KORJAUKSET || []).some(k => k.jakso_id === jakso_id && k.r_idx === r_idx && k.tyyppi !== 'lisays');
  }

  // --- Piirto ---
  function piirra() {
    const el = juuri();
    if (!el || el.hidden) return;
    const suodatin = $('tk-suodatin').value;
    const haku = hakuNormalisoi(currentSearch).split(' ').filter(Boolean);
    const osat = [];
    for (const j of DATA.jaksot) {
      if (haku.length && !haku.every(s => sanaLoytyy(s, j._haku, j._hakusanat))) continue;
      const avoin = e => !paatos(e.avain);
      const avoimia = j.erot.filter(avoin).length;
      if (suodatin === 'avoimet' && avoimia === 0) continue;
      if (suodatin === 'tallentamatta' && !j.erot.some(e => ODOTTAVAT[e.avain])) continue;
      if (suodatin === 'paatetyt' && avoimia === j.erot.length) continue;
      if (suodatin === 'epavarmat' && !j.erot.some(e => avoin(e) && epavarma(e.avain))) continue;
      if (suodatin === 'kiistanalaiset' && !j.erot.some(e => avoin(e) && kiistanalainen(e.avain))) continue;
      if (suodatin === 'vahvistetut' && !j.erot.some(e => avoin(e) && kahdestiVahvistettu(e.avain))) continue;
      osat.push(j);
    }
    // Pitkä lista piirretään erissä, ettei välilehden avaus jumita
    const lista = $('tk-jaksot');
    const ERA = 25;
    lista.innerHTML = osat.slice(0, ERA).map(piirraJakso).join('')
      || `<div class="empty"><h2>Ei näytettävää</h2><p>${currentSearch ? 'Muuta hakua tai suodatinta.' : 'Tällä suodattimella kaikki on käsitelty.'}</p></div>`;
    if (osat.length > ERA) {
      lista.insertAdjacentHTML('beforeend', `<button class="filter-btn tk-lisaa" data-toiminto="lisaa">Näytä loput ${osat.length - ERA} jaksoa</button>`);
      lista.querySelector('.tk-lisaa').onclick = ev => {
        ev.target.remove();
        lista.insertAdjacentHTML('beforeend', osat.slice(ERA).map(piirraJakso).join(''));
      };
    }
    laskeTilanne();
  }

  function laskeTilanne() {
    let kaikki = 0, paatetty = 0;
    for (const j of DATA.jaksot) for (const e of j.erot) { kaikki++; if (paatos(e.avain)) paatetty++; }
    const odottaa = Object.keys(ODOTTAVAT).length;
    $('tk-edistyminen').textContent = `${paatetty} / ${kaikki} päätetty · ${kaikki - paatetty} avoinna`
      + (odottaa ? ` · ${odottaa} tallentamatta` : '');
    $('tk-palkki').style.transform = `scaleX(${kaikki ? paatetty / kaikki : 0})`;
  }

  function piirraJakso(j) {
    const live = LIVE.get(j.jakso_id);
    const vanhat = live ? live.suositukset || [] : [];
    const nykyiset = vanhat.map((r, i) =>
      `<li value="${i}"${r.piilotettu ? ' class="tk-piilotettu"' : ''}><strong>${esc(r.suosittelija)}</strong> — ${esc(r.teos)}${r.piilotettu ? ' (piilotettu)' : ''}</li>`).join('');
    return `
    <section class="tk-jakso${transkriptiJakso === j.jakso_id ? ' aktiivinen' : ''}" id="tk-j-${esc(j.jakso_id)}">
      <div class="tk-jakso-otsikko">
        <h2>${esc(j.jakso_otsikko)}</h2>
        <span class="tk-meta">${esc(j.paivamaara)}</span>
        ${typeof j.pisteet === 'number' ? `<span class="tk-tagi" title="Epäilyttävyyspisteet">${j.pisteet} p</span>` : ''}
        ${j.otos && j.otos !== '-' ? `<span class="tk-tagi">${esc(j.otos)}</span>` : ''}
      </div>
      <div class="tk-meta">Studiossa: ${j.osallistujat.length ? esc(j.osallistujat.join(', ')) : 'ei tiedossa (RSS)'} · sivulla ${vanhat.length}, uusi poiminta ${esc(j.uusia ?? '?')}</div>
      ${j.puhujat ? `<div class="tk-meta">Puhujat (Clauden tulkinta): ${esc(j.puhujat)}</div>` : ''}
      ${(j.huomiot || []).length ? `<details class="tk-details"><summary>Clauden muut huomiot (${j.huomiot.length})</summary><ul>${j.huomiot.map(h => `<li>${esc(h)}</li>`).join('')}</ul></details>` : ''}
      <details class="tk-details"><summary>Sivulla nyt (${vanhat.length})</summary><ol start="0">${nykyiset || '<li>—</li>'}</ol></details>
      ${j.erot.map((e, i) => piirraEro(j, e, i)).join('')}
    </section>`;
  }

  function piirraEro(j, e, i) {
    const p = paatos(e.avain);
    const tallentamatta = !!ODOTTAVAT[e.avain];
    const a = DATA.arviot[e.avain];
    const data = (p && p.data) || lahtoData(e);
    const suosittelee = toiminto => a && !p && ({ hyvaksy: 'hyvaksytty', hylkaa: 'hylatty', poista: 'poista' }[a.suositus] === toiminto);
    const idx = e.r_idx != null ? ` #${e.r_idx}` : '';
    let muutos;
    if (e.tyyppi === 'suosittelija') muutos = `”${esc(e.teos)}”: <del>${esc(e.vanha)}</del> → <ins>${esc(e.uusi)}</ins>`;
    else if (e.tyyppi === 'teos') muutos = `<del>${esc(e.vanha)}</del> → <ins>${esc(e.uusi)}</ins>`;
    else if (e.tyyppi === 'puuttuu') muutos = `<ins>${esc(e.teos)}</ins> — ${esc(e.uusi)}`;
    else muutos = `”${esc(e.teos)}” (${esc(e.vanha)}) — uusi poiminta ei löytänyt tätä. Heikko signaali: tuore poimintakin voi missata.`;

    const kentat = MUOKATTAVAT[e.tyyppi].map(k => {
      const arvo = data[k] ?? '';
      const kentta = k === 'kuvaus'
        ? `<textarea data-kentta="${k}" rows="3">${esc(arvo)}</textarea>`
        : `<input data-kentta="${k}" value="${escAttr(arvo)}">`;
      return `<label>${NIMET[k]}</label>${kentta}`;
    }).join('');

    const huomiot = [];
    if (e.r_idx != null && !p && kasikorjattu(j.jakso_id, e.r_idx)) huomiot.push('Tätä suositusta on jo korjattu admin-näkymässä — tarkista Sivulla nyt -listasta, onko ehdotus vielä ajankohtainen.');
    if (e.tyyppi === 'puuttuu' && /,/.test(data.suosittelija || '')) huomiot.push('Yhteissuositus: valitse yksi suosittelija (toinen kuvaukseen).');
    if (p && p.paatos === 'hyvaksytty' && p.data) {
      const muut = kuvauksenMuutNimet(j, p.data);
      if (muut.length) huomiot.push(`Kuvauksessa mainitaan ${muut.join(', ')}, mutta suosittelija on ${p.data.suosittelija} — peru ja korjaa kuvaus, jos se on väärin.`);
    }

    let napit;
    if (p && p.viety) napit = `<span class="tk-tila hyvaksytty">✓ Tallennettu korjauksiin${p.paatos === 'poista' ? ' (piilotus)' : ''}</span>`;
    else if (p) napit = `<span class="tk-tila ${p.paatos}">${TILANIMI[p.paatos]}${tallentamatta ? ' — tallentamatta' : ''}</span>
        <button class="action-btn" data-toiminto="peru">Peru</button>`;
    else if (e.tyyppi === 'ylimaarainen') napit = `
        <button class="action-btn${suosittelee('hylatty') ? ' tk-suositeltu' : ''}" data-toiminto="hylatty">Pidä sivulla</button>
        <button class="action-btn tk-hylkaa${suosittelee('poista') ? ' tk-suositeltu' : ''}" data-toiminto="poista">Piilota sivulta</button>`;
    else napit = `
        <button class="action-btn${!a || suosittelee('hyvaksytty') ? ' tk-suositeltu' : ''}" data-toiminto="hyvaksytty">Hyväksy</button>
        <button class="action-btn tk-hylkaa${suosittelee('hylatty') ? ' tk-suositeltu' : ''}" data-toiminto="hylatty">Hylkää</button>`;

    return `
    <div class="tk-ero ${p ? p.paatos : ''}${tallentamatta ? ' tallentamatta' : ''}" data-avain="${escAttr(e.avain)}" data-jakso="${escAttr(j.jakso_id)}" data-i="${i}">
      <div class="tk-ero-otsikko"><span class="tk-laji ${e.tyyppi}">${TYYPIT[e.tyyppi]}${idx}</span></div>
      <div class="tk-muutos">${muutos}</div>
      ${e.peruste ? `<div class="tk-peruste">Näyttö: ${esc(e.peruste)}</div>` : ''}
      ${huomiot.map(h => `<div class="tk-huom">⚠️ ${esc(h)}</div>`).join('')}
      ${a && !p ? `<div class="tk-arvio${a.varmuus === 'varma' ? '' : ' epavarma'}">
        <strong>Clauden suositus: ${SUOSITUSNIMI[a.suositus]}${a.varmuus === 'varma' ? '' : ' (epävarma)'}.</strong>
        ${a.suositus === 'hyvaksy' ? 'Kentissä on Clauden korjaamat arvot. ' : ''}${esc(a.perustelu || '')}</div>` : ''}
      ${a && a.toinen && !p ? `<div class="tk-toinen ${a.toinen.kanta}">
        <strong>Toinen mielipide: ${KANTA[a.toinen.kanta] || esc(a.toinen.kanta)}.</strong> ${esc(a.toinen.perustelu || '')}
        ${a.toinen.korjaus ? `<div>Ehdottaa: ${Object.entries(a.toinen.korjaus).map(([k, v]) => `${esc(NIMET[k] || k)}: <strong>${esc(Array.isArray(v) ? v.join(', ') : v)}</strong>`).join(' · ')}
          ${KORJAUS_KAYTOSSA[e.avain] ? ' (käytössä)' : `<button class="action-btn tk-pieni" data-toiminto="kayta-korjaus">Käytä tätä</button>`}</div>` : ''}
      </div>` : ''}
      ${kentat && !p ? `<div class="tk-kentat">${kentat}</div>` : ''}
      ${p && p.paatos === 'hyvaksytty' && p.data ? `<div class="tk-kentat tallennettu">${
        MUOKATTAVAT[e.tyyppi].map(k => `<label>${NIMET[k]}</label><div>${esc(p.data[k])}</div>`).join('')
      }</div>` : ''}
      <div class="tk-toiminnot">
        ${napit}
        <button class="action-btn" data-toiminto="kuuntele">${IKONI_TOISTA} Kuuntele kohta</button>
        <button class="action-btn" data-toiminto="nayta">Näytä transkriptiossa</button>
      </div>
    </div>`;
  }

  // Jakson henkilöiden etunimet (+ Anna-Sofia Bernerin lempinimi Sohvi), joilla
  // tunnistetaan kuvaus, joka puhuu eri ihmisestä kuin suosittelija
  function jaksonEtunimet(j) {
    const nimet = new Set();
    const lisaa = n => {
      if (!n || n === 'tuntematon') return;
      nimet.add(n.split(/\s+/)[0]);
      if (n.startsWith('Anna-Sofia')) nimet.add('Sohvi');
    };
    (j.osallistujat || []).forEach(lisaa);
    (LIVE.get(j.jakso_id)?.suositukset || []).forEach(r => lisaa(r.suosittelija));
    j.erot.forEach(e => { lisaa(e.uusi); lisaa(e.vanha); });
    return nimet;
  }

  function kuvauksenMuutNimet(j, data) {
    if (!data.kuvaus || !data.suosittelija) return [];
    const etu = data.suosittelija.split(/\s+/)[0];
    const omat = new Set(etu.startsWith('Anna-Sofia') ? [etu, 'Sohvi'] : [etu]);
    return [...jaksonEtunimet(j)].filter(n => !omat.has(n) && new RegExp(`(^|[^\\p{L}])${n}`, 'u').test(data.kuvaus));
  }

  function etsiEro(jakso_id, i) {
    return DATA.jaksot.find(j => j.jakso_id === jakso_id).erot[i];
  }

  function keraaData(eroEl, ero) {
    // Pohjana Clauden korjaamat arvot (mm. linkit ja alkuperä, joille ei ole kenttää)
    const data = { ...lahtoData(ero) };
    eroEl.querySelectorAll('[data-kentta]').forEach(k => { data[k.dataset.kentta] = k.value.trim(); });
    return data;
  }

  function asetaPaatos(eroEl, toiminto) {
    const ero = etsiEro(eroEl.dataset.jakso, +eroEl.dataset.i);
    const avain = ero.avain;
    if (toiminto === 'peru') {
      if (ODOTTAVAT[avain] && ODOTTAVAT[avain].paatos !== null) delete ODOTTAVAT[avain];
      // Tallennetun hylkäyksen peruminen on oma tallennettava muutoksensa
      else if (TALLENNETUT[avain] && !TALLENNETUT[avain].viety) ODOTTAVAT[avain] = { paatos: null, r_idx: ero.r_idx ?? null, teos: ero.teos };
    } else {
      ODOTTAVAT[avain] = {
        paatos: toiminto, r_idx: ero.r_idx ?? null, teos: ero.teos || '',
        data: toiminto === 'hyvaksytty' ? keraaData(eroEl, ero) : null,
      };
    }
    tallennaLuonnos();
    updateSaveBtn();
    // Piirretään vain tämä kortti uudelleen, ettei lista hyppää
    const jakso = DATA.jaksot.find(j => j.jakso_id === eroEl.dataset.jakso);
    eroEl.outerHTML = piirraEro(jakso, ero, +eroEl.dataset.i);
    laskeTilanne();
  }

  // --- Tapahtumat ---
  function alusta() {
    const el = juuri();
    $('tk-suodatin').addEventListener('change', piirra);
    $('tk-jaksot').addEventListener('click', async ev => {
      const nappi = ev.target.closest('[data-toiminto]');
      if (!nappi || nappi.dataset.toiminto === 'lisaa') return;
      const eroEl = nappi.closest('.tk-ero');
      const toiminto = nappi.dataset.toiminto;
      if (toiminto === 'nayta' || toiminto === 'kuuntele') {
        await naytaTranskriptio(eroEl.dataset.jakso, +eroEl.dataset.i);
        if (toiminto === 'kuuntele') {
          const p = osumat[osumaIdx];
          if (p) kelaaRiville(+p.dataset.i, true);
          else showToast('Teoksen nimeä ei löytynyt transkriptiosta — hae sanalla tai napauta riviä.', 4000);
        }
        return;
      }
      if (toiminto === 'kayta-korjaus') {
        const ero = etsiEro(eroEl.dataset.jakso, +eroEl.dataset.i);
        KORJAUS_KAYTOSSA[ero.avain] = DATA.arviot[ero.avain].toinen.korjaus;
        const jakso = DATA.jaksot.find(j => j.jakso_id === eroEl.dataset.jakso);
        eroEl.outerHTML = piirraEro(jakso, ero, +eroEl.dataset.i);
        return;
      }
      asetaPaatos(eroEl, toiminto);
    });
    // Suosittelijan vaihto vaihtaa kuvauksen etunimen samalla ("Marko suosittelee" → "Tuomas suosittelee")
    $('tk-jaksot').addEventListener('focusin', ev => {
      if (ev.target.dataset.kentta === 'suosittelija') ev.target.dataset.edellinen = ev.target.value;
    });
    $('tk-jaksot').addEventListener('change', ev => {
      const kentta = ev.target;
      if (kentta.dataset.kentta !== 'suosittelija') return;
      const vanha = (kentta.dataset.edellinen || '').split(/\s+/)[0];
      const uusi = kentta.value.trim().split(/\s+/)[0];
      kentta.dataset.edellinen = kentta.value;
      const kuvaus = kentta.closest('.tk-ero').querySelector('[data-kentta="kuvaus"]');
      if (!kuvaus || !vanha || !uusi || vanha === uusi) return;
      const re = new RegExp(`(^|[^\\p{L}])${vanha}(?![\\p{L}-])`, 'gu');
      const korvattu = kuvaus.value.replace(re, `$1${uusi}`);
      if (korvattu !== kuvaus.value) {
        kuvaus.value = korvattu;
        showToast(`Kuvauksen nimi vaihdettu: ${vanha} → ${uusi}. Tarkista taivutusmuodot (esim. ”Markon”).`, 4000);
      }
    });
    el.querySelector('.tk-kelaus').addEventListener('click', ev => {
      const b = ev.target.closest('[data-kelaa]');
      if (!b) return;
      const soitin = $('tk-soitin');
      soitin.currentTime = Math.max(0, soitin.currentTime + +b.dataset.kelaa);
    });
    $('tk-rivit').addEventListener('click', ev => {
      const p = ev.target.closest('p[data-i]');
      if (p) kelaaRiville(+p.dataset.i, true);
    });
    $('tk-seuraava').addEventListener('click', seuraavaOsuma);
    $('tk-haku').addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      korosta(ev.target.value.split(/\s+/).filter(s => s.length >= 2));
    });
    $('tk-sulje').addEventListener('click', () => {
      el.classList.remove('transkripti-auki');
      $('tk-soitin').pause();
    });
  }

  // --- Transkriptio ---
  // Yleissanat, jotka esiintyvät teosten kuvauksissa mutta eivät yksilöi kohtaa transkriptiosta
  const HUKKASANAT = new Set(['the', 'and', 'with', 'from', 'that', 'this', 'podcast', 'podcastia', 'sarja', 'sarjan',
    'kirja', 'kirjan', 'kirjat', 'elokuva', 'elokuvan', 'jakso', 'jakson', 'toimittaja', 'toimittajan', 'kirjailija',
    'artikkeli', 'artikkelin', 'dokumentti', 'dokumenttisarja', 'ohjelma', 'kolumni', 'juttu', 'jutut', 'netflix',
    'yle', 'areena', 'areenan', 'hesari', 'suomi', 'suomen', 'sanomat', 'sanomien', 'helsingin', 'teos', 'levy', 'albumi']);

  function hakusanat(ero) {
    const sanat = [];
    const teos = ero.tyyppi === 'teos' ? `${ero.vanha} ${ero.uusi}` : (ero.teos || '');
    for (const s of teos.split(/[\s–—\-:,()"'””.!?]+/))
      if (s.length >= 4 && !HUKKASANAT.has(s.toLowerCase())) sanat.push(s);
    return sanat.slice(0, 4);
  }

  const tiedostonimi = jakso_id => jakso_id.replace(/[^A-Za-z0-9_-]/g, '_');

  async function naytaTranskriptio(jakso_id, i) {
    const jakso = DATA.jaksot.find(j => j.jakso_id === jakso_id);
    const ero = jakso.erot[i];
    juuri().classList.add('transkripti-auki');
    if (transkriptiJakso !== jakso_id) {
      const nimi = '/transkriptit/' + encodeURIComponent(tiedostonimi(jakso_id));
      const [tr, ajat] = await Promise.all([
        fetch(nimi + '.txt').then(r => r.ok ? r.text() : null),
        fetch(nimi + '.ajat.json').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      const rivit = (tr || '').split('\n');
      $('tk-rivit').innerHTML = tr === null
        ? '<p class="tk-tyhja">Tälle jaksolle ei ole transkriptiota.</p>'
        : rivit.map((rivi, n) => {
          const m = rivi.match(/^Puhuja (\d+):\s?(.*)$/);
          if (!m) return `<p data-i="${n}">${esc(rivi)}</p>`;
          return `<p data-i="${n}" data-teksti="${escAttr(m[2])}"><span class="tk-puhuja tk-p${+m[1] % 6}">P${m[1]}</span><span class="rt">${esc(m[2])}</span></p>`;
        }).join('');
      // Arvio merkkimäärän osuudesta, jos rivien aikaleimoja ei ole
      const kum = [0];
      for (const r of rivit) kum.push(kum[kum.length - 1] + r.length);
      AANI = { ajat, kum };
      const soitin = $('tk-soitin');
      soitin.src = jakso.audio || '';
      $('tk-soitin-tila').textContent = jakso.audio
        ? (ajat ? 'Napauta riviä kuunnellaksesi sen kohdan.' : 'Napauta riviä — kohta on arvio (yleensä ±10–40 s).')
        : 'Tälle jaksolle ei löytynyt äänitiedostoa.';
      transkriptiJakso = jakso_id;
      $('tk-otsikko').textContent = `${jakso.paivamaara} · transkriptio`;
      document.querySelectorAll('.tk-jakso').forEach(el => el.classList.toggle('aktiivinen', el.id === 'tk-j-' + jakso_id));
    }
    const sanat = hakusanat(ero);
    $('tk-haku').value = sanat.join(' ');
    korosta(sanat);
  }

  function korosta(sanat) {
    const rivit = [...document.querySelectorAll('#tk-rivit p[data-i]')];
    const lausekkeet = sanat.filter(Boolean).map(s => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    osumat = [];
    for (const p of rivit) {
      const rt = p.querySelector('.rt') || p;
      const alkuperainen = p.dataset.teksti ?? p.textContent;
      let html = esc(alkuperainen), osui = false;
      for (const re of lausekkeet) {
        if (re.test(alkuperainen)) { osui = true; html = html.replace(new RegExp(re.source, 'gi'), m => `<mark>${m}</mark>`); }
      }
      rt.innerHTML = html;
      p.classList.remove('nykyinen');
      if (osui) osumat.push(p);
    }
    // Aloituskohdaksi rivi, jolla on eniten ja harvinaisimpia hakusanoja (sana, joka esiintyy
    // monella rivillä, painaa vähän) — muuten esim. "toimittaja" vei jakson alkuun
    const harvinaisuus = lausekkeet.map(re => 1 / Math.max(1, rivit.filter(p => re.test(p.dataset.teksti ?? p.textContent)).length));
    let paras = -1, parasPisteet = 0;
    osumat.forEach((p, n) => {
      const teksti = p.dataset.teksti ?? p.textContent;
      const pisteet = lausekkeet.reduce((summa, re, k) => summa + (re.test(teksti) ? harvinaisuus[k] : 0), 0);
      if (pisteet > parasPisteet + 1e-9) { paras = n; parasPisteet = pisteet; }
    });
    osumaIdx = paras - 1;
    $('tk-osumat').textContent = sanat.length ? `${osumat.length} osumaa` : '';
    seuraavaOsuma();
  }

  function seuraavaOsuma() {
    if (!osumat.length) return;
    osumat[osumaIdx]?.classList.remove('nykyinen');
    osumaIdx = (osumaIdx + 1) % osumat.length;
    const p = osumat[osumaIdx];
    p.classList.add('nykyinen');
    // Vain transkriptiolaatikko vierii, ei koko sivu
    const laatikko = $('tk-rivit');
    laatikko.scrollTo({ top: p.offsetTop - laatikko.clientHeight / 2, behavior: 'smooth' });
    kelaaRiville(+p.dataset.i, false);
    $('tk-osumat').textContent = `${osumaIdx + 1} / ${osumat.length}`;
  }

  // --- Soitin: transkription rivi → kohta täydessä jaksossa ---
  // Transkriptio on leike: jakson ensimmäiset 5 min + viimeiset 20 min.
  const ALKU_S = 300, LOPPU_S = 1200;

  function rivinKohta(i) {
    const soitin = $('tk-soitin');
    if (!AANI) return null;
    if (AANI.ajat && AANI.ajat.rivit[i] != null) {
      const t = AANI.ajat.rivit[i], l = AANI.ajat.leike;
      return { aika: t < l.alku_s ? t : l.loppu_alku_s + (t - l.alku_s), tarkka: true };
    }
    const kesto = soitin.duration;
    if (!isFinite(kesto) || !kesto) return null;
    // Arvio: rivin osuus leikkeestä × leikkeen kesto (puhenopeus oletetaan tasaiseksi)
    const leike = Math.min(kesto, ALKU_S + LOPPU_S);
    const t = (AANI.kum[i] / Math.max(AANI.kum[AANI.kum.length - 1], 1)) * leike;
    return { aika: t < ALKU_S ? t : Math.max(ALKU_S, kesto - LOPPU_S) + (t - ALKU_S), tarkka: false };
  }

  const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  function kelaaRiville(i, soita) {
    const soitin = $('tk-soitin');
    if (!soitin.src) return;
    const tee = () => {
      const k = rivinKohta(i);
      if (!k) return;
      // Pari sekuntia ennen riviä, ja arviossa enemmän, jotta puhuja ehtii kuulua
      soitin.currentTime = Math.max(0, k.aika - (k.tarkka ? 2 : 15));
      $('tk-soitin-tila').textContent = `Kohta ${mmss(k.aika)}${k.tarkka ? '' : ' (arvio, yleensä ±10–40 s)'} — napauta mitä tahansa riviä.`;
      if (soita) soitin.play().catch(() => {});
    };
    if (soitin.readyState >= 1) tee(); else soitin.addEventListener('loadedmetadata', tee, { once: true });
  }

  // --- Julkinen rajapinta admin-näkymälle ---
  return {
    async nayta() {
      const el = juuri();
      el.hidden = false;
      if (!el.dataset.alustettu) { alusta(); el.dataset.alustettu = '1'; }
      if (!ladattu) $('tk-jaksot').innerHTML = '<div class="empty"><h2>Ladataan ehdotuksia…</h2></div>';
      try {
        await lataa();
        piirra();
      } catch (err) {
        $('tk-jaksot').innerHTML = `<div class="empty"><h2>Ehdotusten lataus epäonnistui</h2><p>${esc(err.message)}</p></div>`;
      }
    },
    piilota() {
      const el = juuri();
      if (el) el.hidden = true;
      $('tk-soitin')?.pause();
    },
    piirra,
    odottavia: () => Object.keys(ODOTTAVAT).length,
    // Tallenna-napin runko: kaikki tallentamattomat päätökset
    tallennettavat: () => Object.entries(ODOTTAVAT).map(([avain, p]) => ({ avain, ...p })),
    tallennettu() { ODOTTAVAT = {}; tallennaLuonnos(); },
  };
})();
