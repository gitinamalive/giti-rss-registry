let INITIAL_FEEDS = [];
let COUNTRIES_MAP = {};
let ALL_FEEDS = [];
let MATRIX_DATA = [];
let sortCol = 'name';
let sortDir = 1;
let mSortCol = 'name';
let mSortDir = 1;
let hasHealthOverlay = false;
const expandedCountries = new Set();
const copyTimers = new WeakMap();
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
let lastStatusMessage = '';

const $ = (s, d) => (d || document).querySelector(s);
const $$ = (s, d) => [...(d || document).querySelectorAll(s)];

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function escXml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function safeHref(u) { const s = String(u || '').trim(); return /^https?:\/\//i.test(s) ? s : ''; }
function csvField(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function announce(msg) {
  const el = $('#copy-status');
  if (!el) return;
  let text = msg;
  if (text === lastStatusMessage) text += '\u00A0';
  lastStatusMessage = msg;
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = text; });
}

const COPY_SVG = '<svg class="icon-copy" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg>';
const CHECK_SVG = '<svg class="icon-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';
const RSS_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="3.5" cy="12.5" r="1" fill="currentColor"/><path d="M2.5 7.5a6 6 0 0 1 6 6"/><path d="M2.5 3.5a10 10 0 0 1 10 10"/></svg>';
const EXT_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5H13.5V6.5"/><path d="M13.5 2.5 7 9"/><path d="M12.5 9.5V12.5A1 1 0 0 1 11.5 13.5H3.5A1 1 0 0 1 2.5 12.5V4.5A1 1 0 0 1 3.5 3.5H6.5"/></svg>';

function isDomestic(f, c) {
  if (f.publisherCountries && f.publisherCountries.length) return f.publisherCountries.includes(c);
  return (f.countries || []).length === 1 && f.countries[0] === c;
}

function computeMatrix(feeds) {
  const map = {};
  for (const [code, name] of Object.entries(COUNTRIES_MAP)) {
    map[code] = { code, name, domestic: [], regional: [] };
  }
  for (const f of feeds) {
    for (const c of (f.countries || [])) {
      if (!map[c]) map[c] = { code: c, name: c, domestic: [], regional: [] };
      if (isDomestic(f, c)) map[c].domestic.push(f);
      else map[c].regional.push(f);
    }
  }
  return Object.values(map).map(e => {
    let tier = 'uncovered';
    if (e.domestic.length >= 2) tier = 'domestic-multi';
    else if (e.domestic.length === 1) tier = 'domestic-single';
    else if (e.regional.length > 0) tier = 'regional-only';
    const total = e.domestic.length + e.regional.length;
    const all = [...e.domestic, ...e.regional];
    const freshCount = all.filter(f => f.healthStatus === 'fresh' || (f.healthScore != null && f.healthScore >= 70)).length;
    const issueCount = all.filter(f => f.healthStatus === 'unreachable' || f.healthStatus === 'invalid-content' || f.healthStatus === 'very-stale' || (f.consecutiveFailures || 0) >= 4).length;
    return {
      code: e.code,
      name: e.name,
      domestic: e.domestic,
      regional: e.regional,
      total,
      tier,
      freshCount,
      issueCount,
    };
  });
}

function updateMatrixSummaryCards() {
  const multi = MATRIX_DATA.filter(e => e.tier === 'domestic-multi').length;
  const single = MATRIX_DATA.filter(e => e.tier === 'domestic-single').length;
  const regional = MATRIX_DATA.filter(e => e.tier === 'regional-only').length;
  const uncovered = MATRIX_DATA.filter(e => e.tier === 'uncovered').length;
  const healthy = MATRIX_DATA.filter(e => e.freshCount > 0).length;
  $('#stat-multi').textContent = multi;
  $('#stat-single').textContent = single;
  $('#stat-regional').textContent = regional;
  $('#stat-uncovered').textContent = uncovered;
  if (hasHealthOverlay) {
    $('#stat-healthy').textContent = healthy;
  }
}

function switchTab(name) {
  const isDir = name === 'directory';
  $('#tab-btn-directory').classList.toggle('active', isDir);
  $('#tab-btn-matrix').classList.toggle('active', !isDir);
  $('#tab-btn-directory').setAttribute('aria-selected', isDir ? 'true' : 'false');
  $('#tab-btn-matrix').setAttribute('aria-selected', !isDir ? 'true' : 'false');
  $('#section-directory').classList.toggle('hidden', !isDir);
  $('#section-matrix').classList.toggle('hidden', isDir);
  const hash = isDir ? '#directory' : '#matrix';
  if (window.location.hash !== hash) {
    history.replaceState(null, '', hash);
  }
}

function viewCountryFeeds(code) {
  switchTab('directory');
  const sel = $('#filter-country');
  if (sel) {
    sel.value = code;
    filterFeeds();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function renderCountryList(f, activeCountry) {
  const list = f.countries || [];
  if (!list.length) return '<span class="text-muted">\u2014</span>';
  const isExpanded = expandedCountries.has(f.id);
  let ordered = list;
  if (activeCountry && list.includes(activeCountry) && list.indexOf(activeCountry) >= 5 && !isExpanded) {
    ordered = [activeCountry, ...list.filter(c => c !== activeCountry)];
  }
  const visible = (!isExpanded && ordered.length > 6) ? ordered.slice(0, 5) : ordered;
  const tags = visible.map(c => {
    const name = COUNTRIES_MAP[c] || c;
    const cls = activeCountry && c === activeCountry ? 'country-tag is-match' : 'country-tag';
    return '<span class="' + cls + '" title="' + escAttr(c + ' \u2014 ' + name) + '">' + esc(c) + '</span>';
  }).join('');
  if (ordered.length <= 6) return tags;
  const remaining = ordered.length - visible.length;
  const btnLabel = isExpanded ? 'Show less' : '+' + remaining + ' more';
  const btnTitle = isExpanded ? 'Collapse country list' : 'Show all ' + ordered.length + ' countries';
  return tags + '<button type="button" class="country-more" data-feed-id="' + escAttr(f.id) + '" aria-expanded="' + (isExpanded ? 'true' : 'false') + '" title="' + escAttr(btnTitle) + '">' + esc(btnLabel) + '</button>';
}

function renderFeeds(feeds) {
  const tbody = $('#table-body');
  const stats = $('#stats');
  const activeCountry = $('#filter-country').value;
  stats.innerHTML = '<strong>' + feeds.length + '</strong> of <strong>' + ALL_FEEDS.length + '</strong> feeds shown';
  if (!feeds.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">No matching feeds found.</td></tr>'; return; }
  tbody.innerHTML = feeds.map(f => {
    const score = f.healthScore ?? '';
    const scoreClass = score === 100 ? 'score-100' : score === 70 ? 'score-70' : score === 40 ? 'score-40' : score === 0 ? 'score-0' : '';
    const status = f.healthStatus || 'unchecked';
    const statusLabel = ({ fresh: 'Fresh', stale: 'Stale article', 'very-stale': 'Very stale article', 'stale-content': 'Stale content', unreachable: 'Unreachable', 'invalid-content': 'Invalid content', unchecked: 'Not checked' })[status] || status;
    const checked = f.lastCheckedAt ? new Date(f.lastCheckedAt).toLocaleDateString() : '\u2014';
    const feedHref = safeHref(f.url);
    const homeHref = safeHref(f.homepage);
    const copyBtn = '<button type="button" class="icon-btn copy-rss-btn" data-url="' + escAttr(f.url || '') + '" data-name="' + escAttr(f.name || '') + '" aria-label="Copy RSS URL for ' + escAttr(f.name || '') + '" title="Copy RSS URL: ' + escAttr(f.url || '') + '">' + COPY_SVG + CHECK_SVG + '<span class="copy-label">Copied</span></button>';
    const openRss = feedHref ? '<a class="icon-btn" href="' + escAttr(feedHref) + '" target="_blank" rel="noopener noreferrer" aria-label="Open RSS feed for ' + escAttr(f.name || '') + '" title="Open RSS feed">' + RSS_SVG + '</a>' : '';
    const openHome = homeHref ? '<a class="icon-btn" href="' + escAttr(homeHref) + '" target="_blank" rel="noopener noreferrer" aria-label="Visit website for ' + escAttr(f.name || '') + '" title="Visit website">' + EXT_SVG + '</a>' : '';
    return '<tr>' +
      '<td class="name-cell"><div class="name-row"><span class="feed-name" title="' + escAttr(f.description || f.name) + '">' + esc(f.name) + '</span><span class="row-actions">' + copyBtn + openRss + openHome + '</span></div></td>' +
      '<td class="pub-cell" title="' + escAttr(f.publisher || '') + '">' + esc(f.publisher) + '</td>' +
      '<td>' + esc(f.category) + '</td>' +
      '<td class="countries-cell"><div class="country-list" data-feed-id="' + escAttr(f.id) + '">' + renderCountryList(f, activeCountry) + '</div></td>' +
      '<td>' + esc(f.language) + '</td>' +
      '<td><span class="health-status health-' + escAttr(status) + '">' + esc(statusLabel) + '</span>' + (scoreClass ? ' <span class="score ' + scoreClass + '">' + score + '</span>' : '') + '</td>' +
      '<td><span class="last-checked">' + esc(checked) + '</span></td>' +
      '</tr>';
  }).join('');
}

function legacyCopy(text) {
  const field = Object.assign(document.createElement('textarea'), { value: text });
  field.setAttribute('readonly', '');
  field.className = 'sr-only';
  document.body.append(field);
  field.select();
  try { return document.execCommand('copy'); } finally { field.remove(); }
}

function setCopyFeedback(button, ok) {
  clearTimeout(copyTimers.get(button));
  button.removeAttribute('data-copied');
  button.removeAttribute('data-failed');
  const label = button.querySelector('.copy-label');
  if (label) label.textContent = ok ? 'Copied' : 'Failed';
  void button.offsetWidth;
  button.setAttribute(ok ? 'data-copied' : 'data-failed', '');
  const feedName = button.dataset.name || 'feed';
  announce(ok ? 'Copied RSS URL for ' + feedName : 'Copy failed for ' + feedName);
  copyTimers.set(button, setTimeout(() => {
    button.removeAttribute('data-copied');
    button.removeAttribute('data-failed');
  }, 2000));
}

async function copyRssUrl(button) {
  const url = button.dataset.url || '';
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    setCopyFeedback(button, true);
  } catch {
    setCopyFeedback(button, Boolean(legacyCopy(url)));
  }
}

function getFilters() {
  const search = ($('#search').value || '').toLowerCase();
  const cat = $('#filter-category').value;
  const country = $('#filter-country').value;
  const lang = $('#filter-language').value;
  const health = $('#filter-health').value;
  const checked = $('#filter-checked').value;
  return { search, cat, country, lang, health, checked };
}

function matchesFilters(f, filters) {
  const { search, cat, country, lang, health, checked } = filters;
  if (search && !(String(f.name || '').toLowerCase().includes(search) || String(f.publisher || '').toLowerCase().includes(search) || (f.description || '').toLowerCase().includes(search) || (f.countries || []).some(c => c.toLowerCase().includes(search)))) return false;
  if (cat && f.category !== cat) return false;
  if (country && !(f.countries || []).includes(country)) return false;
  if (lang && f.language !== lang) return false;
  if (health && (f.healthStatus || 'unchecked') !== health) return false;
  if (checked) {
    if (checked === 'never' && f.lastCheckedAt) return false;
    if (checked !== 'never' && !f.lastCheckedAt) return false;
    if (checked === '7' && Date.now() - new Date(f.lastCheckedAt).getTime() > 7 * 86400000) return false;
    if (checked === '30' && Date.now() - new Date(f.lastCheckedAt).getTime() > 30 * 86400000) return false;
    if (checked === 'older' && Date.now() - new Date(f.lastCheckedAt).getTime() <= 30 * 86400000) return false;
  }
  return true;
}

function getFilteredFeeds() {
  const filters = getFilters();
  const result = ALL_FEEDS.filter(f => matchesFilters(f, filters));
  result.sort((a, b) => {
    const va = a[sortCol] ?? ''; const vb = b[sortCol] ?? '';
    if (sortCol === 'healthScore') return ((va || 0) - (vb || 0)) * sortDir;
    return collator.compare(String(va), String(vb)) * sortDir;
  });
  return result;
}

function filterFeeds() {
  renderFeeds(getFilteredFeeds());
}

function renderMatrix(entries) {
  const tbody = $('#matrix-table-body');
  const stats = $('#matrix-stats');
  stats.innerHTML = '<strong>' + entries.length + '</strong> of <strong>' + MATRIX_DATA.length + '</strong> countries shown';
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No matching countries found.</td></tr>';
    return;
  }
  tbody.innerHTML = entries.map(e => {
    const tierLabel = {
      'domestic-multi': '\u{1F7E2} Robust (2+)',
      'domestic-single': '\u{1F7E1} Single Domestic (1)',
      'regional-only': '\u{1F535} Regional Fallback',
      'uncovered': '\u{1F534} Uncovered'
    }[e.tier] || e.tier;
    const tierClass = 'tier-' + e.tier;
    const domPubs = e.domestic.map(f => '<span class="pub-badge" title="' + escAttr(f.name) + '">' + esc(f.publisher || f.name) + '</span>').join('');
    const regList = e.regional.length ? e.regional.map(f => '<span class="pub-badge" title="' + escAttr(f.name) + '">' + esc(f.publisher || f.name) + '</span>').join('') : '<span class="text-muted">\u2014</span>';

    let healthPill = '<span class="health-status health-unchecked">Unchecked</span>';
    if (hasHealthOverlay) {
      if (e.total > 0 && e.freshCount > 0 && e.issueCount === 0) {
        healthPill = '<span class="health-status health-fresh">' + e.freshCount + ' Fresh</span>';
      } else if (e.issueCount > 0) {
        healthPill = '<span class="health-status health-unreachable">' + e.issueCount + ' Degraded</span>';
        if (e.freshCount > 0) healthPill += ' <span class="health-status health-fresh">' + e.freshCount + ' Fresh</span>';
      } else if (e.total > 0) {
        healthPill = '<span class="health-status health-stale">Stale</span>';
      }
    }

    const suggestUrl = 'https://github.com/gitinamalive/giti-rss-registry/issues/new?template=feed-proposal.yml&country=' + encodeURIComponent(e.code);
    return '<tr>' +
      '<td><strong>' + esc(e.code) + '</strong> \u00B7 ' + esc(e.name) + '</td>' +
      '<td><span class="tier-badge ' + tierClass + '">' + esc(tierLabel) + '</span></td>' +
      '<td><strong>' + e.total + '</strong></td>' +
      '<td>' + (domPubs || '<span class="text-muted">None (fallback only)</span>') + '</td>' +
      '<td>' + regList + '</td>' +
      '<td>' + healthPill + '</td>' +
      '<td>' +
        '<a class="btn btn-sm btn-primary" href="' + escAttr(suggestUrl) + '" target="_blank" rel="noopener noreferrer" title="Propose feed for ' + escAttr(e.name) + '">+ Suggest</a> ' +
        (e.total > 0 ? '<button type="button" class="btn btn-sm view-country-btn" data-country="' + escAttr(e.code) + '">View (' + e.total + ')</button>' : '') +
      '</td>' +
      '</tr>';
  }).join('');
}

function filterMatrix() {
  const search = ($('#matrix-search').value || '').toLowerCase().trim();
  const tier = $('#matrix-filter-tier').value;
  const health = $('#matrix-filter-health').value;

  const result = MATRIX_DATA.filter(e => {
    if (search && !(e.code.toLowerCase().includes(search) || e.name.toLowerCase().includes(search))) return false;
    if (tier && e.tier !== tier) return false;
    if (health) {
      if (health === 'fresh' && e.freshCount === 0) return false;
      if (health === 'has-issues' && e.issueCount === 0) return false;
      if (health === 'unchecked' && (e.freshCount > 0 || e.issueCount > 0)) return false;
    }
    return true;
  });

  result.sort((a, b) => {
    const va = a[mSortCol] ?? ''; const vb = b[mSortCol] ?? '';
    if (mSortCol === 'total') return (a.total - b.total) * mSortDir;
    return String(va).localeCompare(String(vb)) * mSortDir;
  });

  renderMatrix(result);
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV() {
  const result = getFilteredFeeds();
  const csv = 'name,publisher,url,category,countries,language,healthStatus,healthScore,lastCheckedAt,homepage,description\n' +
    result.map(f => [
      csvField(f.name),
      csvField(f.publisher),
      csvField(f.url),
      csvField(f.category),
      csvField((f.countries || []).join('|')),
      csvField(f.language),
      csvField(f.healthStatus || 'unchecked'),
      csvField(f.healthScore ?? ''),
      csvField(f.lastCheckedAt || ''),
      csvField(f.homepage || ''),
      csvField(f.description || '')
    ].join(',')).join('\n');
  downloadBlob(csv, 'text/csv;charset=utf-8', 'giti-rss-registry-filtered.csv');
  announce('Exported ' + result.length + ' feeds as CSV');
}

function exportOPML() {
  const filters = getFilters();
  const result = getFilteredFeeds().slice().sort((a, b) => collator.compare(a.name || '', b.name || ''));
  const parts = [];
  if (filters.country) parts.push('Country: ' + filters.country);
  if (filters.cat) parts.push('Category: ' + filters.cat);
  if (filters.lang) parts.push('Language: ' + filters.lang);
  if (filters.health) parts.push('Health: ' + filters.health);
  if (filters.search) parts.push('Search: ' + filters.search);
  const title = 'Giti RSS Registry \u2014 ' + (parts.length ? parts.join(', ') : 'Filtered Feeds');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    '    <title>' + escXml(title) + '</title>',
    '    <dateCreated>' + escXml(new Date().toUTCString()) + '</dateCreated>',
    '  </head>',
    '  <body>'
  ];
  for (const f of result) {
    lines.push('    <outline type="rss" text="' + escXml(f.name) + '" title="' + escXml(f.name) + '" xmlUrl="' + escXml(f.url) + '" />');
  }
  lines.push('  </body>', '</opml>', '');
  downloadBlob(lines.join('\n'), 'text/x-opml;charset=utf-8', 'giti-rss-registry-filtered.opml');
  announce('Exported ' + result.length + ' feeds as OPML');
}

function exportMatrixCSV() {
  const csv = 'countryCode,countryName,tier,totalFeeds,domesticFeedsCount,regionalFeedsCount,domesticPublishers,healthFreshCount,healthIssueCount\n' +
    MATRIX_DATA.map(e => [
      e.code,
      csvField(e.name),
      e.tier,
      e.total,
      e.domestic.length,
      e.regional.length,
      csvField(e.domestic.map(f => f.publisher || f.name).join(' | ')),
      e.freshCount,
      e.issueCount
    ].join(',')).join('\n');
  downloadBlob(csv, 'text/csv;charset=utf-8', 'giti-rss-country-coverage-matrix.csv');
}

$('.tab-bar').addEventListener('click', (event) => {
  const btn = event.target.closest('.tab-btn[data-tab]');
  if (btn) switchTab(btn.dataset.tab);
});

$('#search').addEventListener('input', filterFeeds);
$('#filter-category').addEventListener('change', filterFeeds);
$('#filter-country').addEventListener('change', filterFeeds);
$('#filter-language').addEventListener('change', filterFeeds);
$('#filter-health').addEventListener('change', filterFeeds);
$('#filter-checked').addEventListener('change', filterFeeds);
$('#export-csv').addEventListener('click', exportCSV);
$('#export-opml').addEventListener('click', exportOPML);
$('#reset-filters').addEventListener('click', () => {
  $('#search').value = '';
  $('#filter-category').value = '';
  $('#filter-country').value = '';
  $('#filter-language').value = '';
  $('#filter-health').value = '';
  $('#filter-checked').value = '';
  expandedCountries.clear();
  filterFeeds();
});

$('#table-body').addEventListener('click', (event) => {
  const copyBtn = event.target.closest('.copy-rss-btn');
  if (copyBtn) {
    copyRssUrl(copyBtn);
    return;
  }
  const moreBtn = event.target.closest('.country-more');
  if (moreBtn) {
    const feedId = moreBtn.dataset.feedId;
    if (!feedId) return;
    if (expandedCountries.has(feedId)) expandedCountries.delete(feedId);
    else expandedCountries.add(feedId);
    const feed = ALL_FEEDS.find(item => item.id === feedId);
    const container = moreBtn.closest('.country-list');
    if (feed && container) {
      container.innerHTML = renderCountryList(feed, $('#filter-country').value);
      const nextBtn = container.querySelector('.country-more');
      if (nextBtn) nextBtn.focus();
    }
  }
});

$('#matrix-table-body').addEventListener('click', (event) => {
  const viewBtn = event.target.closest('.view-country-btn');
  if (viewBtn && viewBtn.dataset.country) {
    viewCountryFeeds(viewBtn.dataset.country);
  }
});

$('#matrix-search').addEventListener('input', filterMatrix);
$('#matrix-filter-tier').addEventListener('change', filterMatrix);
$('#matrix-filter-health').addEventListener('change', filterMatrix);
$('#export-matrix-csv').addEventListener('click', exportMatrixCSV);
$('#reset-matrix-filters').addEventListener('click', () => {
  $('#matrix-search').value = '';
  $('#matrix-filter-tier').value = '';
  $('#matrix-filter-health').value = '';
  filterMatrix();
});

$('#feed-table thead').addEventListener('click', (event) => {
  const btn = event.target.closest('.sort-btn');
  if (!btn) return;
  const th = btn.closest('th[data-sort]');
  if (!th) return;
  const col = th.dataset.sort;
  if (col === sortCol) sortDir *= -1; else { sortCol = col; sortDir = 1; }
  $$('#feed-table th[data-sort]').forEach(h => h.removeAttribute('aria-sort'));
  const dirLabel = sortDir === 1 ? 'ascending' : 'descending';
  th.setAttribute('aria-sort', dirLabel);
  filterFeeds();
  announce('Sorted feeds by ' + btn.textContent.trim() + ', ' + dirLabel);
});

$('#matrix-table thead').addEventListener('click', (event) => {
  const btn = event.target.closest('.sort-btn');
  if (!btn) return;
  const th = btn.closest('th[data-msort]');
  if (!th) return;
  const col = th.dataset.msort;
  if (col === mSortCol) mSortDir *= -1; else { mSortCol = col; mSortDir = 1; }
  $$('#matrix-table th[data-msort]').forEach(h => h.removeAttribute('aria-sort'));
  th.setAttribute('aria-sort', mSortDir === 1 ? 'ascending' : 'descending');
  filterMatrix();
});

if (window.location.hash === '#matrix') {
  switchTab('matrix');
}

async function initDirectory() {
  try {
    const [feedsRes, countriesRes] = await Promise.all([
      fetch('feeds.json'),
      fetch('countries.json'),
    ]);
    if (!feedsRes.ok) throw new Error('HTTP ' + feedsRes.status);
    INITIAL_FEEDS = await feedsRes.json();
    COUNTRIES_MAP = countriesRes.ok ? await countriesRes.json() : {};
    ALL_FEEDS = INITIAL_FEEDS.map(feed => Object.assign({ healthStatus: 'unchecked', lastCheckedAt: null, healthScore: null }, feed));
    MATRIX_DATA = computeMatrix(ALL_FEEDS);
    filterFeeds();
    renderMatrix(MATRIX_DATA);
    updateMatrixSummaryCards();
  } catch {
    $('#table-body').innerHTML = '<tr><td colspan="7" class="empty">Unable to load feeds.json.</td></tr>';
    return;
  }

  try {
    const healthRes = await fetch('feeds-health.json', { cache: 'no-store' });
    if (!healthRes.ok) return;
    const overlay = await healthRes.json();
    if (!overlay || !Array.isArray(overlay.feeds)) return;
    hasHealthOverlay = true;
    const healthById = new Map(overlay.feeds.map(entry => [entry.id, entry]));
    ALL_FEEDS = INITIAL_FEEDS.map(feed => Object.assign({ healthStatus: 'unchecked', lastCheckedAt: null, healthScore: null }, feed, healthById.get(feed.id) || {}));
    MATRIX_DATA = computeMatrix(ALL_FEEDS);
    filterFeeds();
    filterMatrix();
    updateMatrixSummaryCards();
  } catch {
    // The canonical directory remains usable if the overlay is unavailable.
  }
}

initDirectory();
