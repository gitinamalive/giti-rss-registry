import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { FeedEntry, BootstrapPayload } from '../src/types.ts';
import { escapeCsv, escapeJsonForScript, escapeXml, toFileSafeSegment } from '../src/escape.ts';
import { findPossibleDuplicateUrls, type PossibleDuplicateFinding } from '../src/urlFingerprint.ts';
import {
    ISO_3166_1_ALPHA2_COUNTRIES,
    buildCountryCoverageMatrix,
    isDomesticFeed,
    type CountryCoverageEntry,
} from '../src/countries.ts';

const execFileAsync = promisify(execFile);
export const GENERATOR_VERSION = '1.1.0';
export const SCHEMA_VERSION = '1.0.0';

const args = process.argv.slice(2);
const fileArg = args.findIndex(arg => arg === '--file');
const outArg = args.findIndex(arg => arg === '--out');

const filePath = fileArg !== -1 && args[fileArg + 1] ? args[fileArg + 1] : 'data/feeds.json';
const outPath = outArg !== -1 && args[outArg + 1] ? args[outArg + 1] : 'dist';

const bootstrapPath = resolve(filePath);
const distPath = resolve(outPath);
const opmlPath = resolve(distPath, 'opml');

export function buildIndex(feeds: FeedEntry[], selector: (entry: FeedEntry) => string[]): Record<string, FeedEntry[]> {
    const grouped: Record<string, FeedEntry[]> = {};

    feeds.forEach((feed) => {
        const keys = selector(feed).filter(Boolean);
        keys.forEach((key) => {
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(feed);
        });
    });

    const collator = new Intl.Collator('en', { sensitivity: 'base' });
    Object.keys(grouped).forEach((key) => {
        // The id tie-break keeps member order fully deterministic regardless of the
        // input feed order (some feeds legitimately share the same display name).
        grouped[key] = grouped[key].sort(
            (a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id)
        );
    });

    return Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => collator.compare(a, b)));
}

async function writeJson(relativePath: string, value: unknown): Promise<void> {
    const fullPath = resolve(distPath, relativePath);
    await mkdir(resolve(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export interface ArtifactHashEntry {
    sha256: string;
    bytes: number;
}

export interface RegistryManifest {
    schemaVersion: string;
    generatorVersion: string;
    sourceCommit: string;
    sourceChecksum: string;
    generatedAt: string;
    registryRevision?: string;
    healthRevision?: string;
    artifactCounts: Record<string, number>;
    artifacts?: Record<string, ArtifactHashEntry>;
}

export function createManifest(input: Omit<RegistryManifest, 'schemaVersion' | 'generatorVersion'>): RegistryManifest {
    return {
        schemaVersion: SCHEMA_VERSION,
        generatorVersion: GENERATOR_VERSION,
        ...input,
    };
}

export function createDuplicateReport(
    findings: PossibleDuplicateFinding[],
    generatedAt: string,
    sourceChecksum: string,
): { generatedAt: string; sourceChecksum: string; possibleDuplicates: PossibleDuplicateFinding[] } {
    return { generatedAt, sourceChecksum, possibleDuplicates: findings };
}

async function getSourceCommit(): Promise<string> {
    try {
        const result = await execFileAsync('git', ['rev-parse', 'HEAD']);
        return result.stdout.trim();
    } catch {
        return 'unknown';
    }
}

export function generateOpml(
    title: string,
    feeds: FeedEntry[],
    generatedAt: string = new Date().toISOString(),
): string {
    const timestamp = new Date(generatedAt).toUTCString();
    const collator = new Intl.Collator('en', { sensitivity: 'base' });
    const lines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<opml version="2.0">',
        '  <head>',
        `    <title>${escapeXml(title)}</title>`,
        `    <dateCreated>${escapeXml(timestamp)}</dateCreated>`,
        '  </head>',
        '  <body>'
    ];

    feeds
        .slice()
        .sort((a, b) => collator.compare(a.name, b.name))
        .forEach((feed) => {
            lines.push(
                `    <outline type="rss" text="${escapeXml(feed.name)}" title="${escapeXml(feed.name)}" xmlUrl="${escapeXml(feed.url)}" />`
            );
        });

    lines.push('  </body>', '</opml>');
    return `${lines.join('\n')}\n`;
}

async function writeOpml(relativePath: string, title: string, feeds: FeedEntry[], generatedAt?: string): Promise<void> {
    const fullPath = resolve(opmlPath, relativePath);
    await mkdir(resolve(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, generateOpml(title, feeds, generatedAt), 'utf8');
}

export function generateIndexHtml(feeds: FeedEntry[], generatedAt: string = new Date().toISOString()): string {
    const feedsJson = escapeJsonForScript(feeds);
    const countriesJson = escapeJsonForScript(ISO_3166_1_ALPHA2_COUNTRIES);
    const matrix = buildCountryCoverageMatrix(feeds);
    const matrixMulti = matrix.filter((e) => e.tier === 'domestic-multi').length;
    const matrixSingle = matrix.filter((e) => e.tier === 'domestic-single').length;
    const matrixRegional = matrix.filter((e) => e.tier === 'regional-only').length;
    const matrixUncovered = matrix.filter((e) => e.tier === 'uncovered').length;

    // Unique sorted values for dropdowns
    const categories = [...new Set(feeds.map(f => f.category))].sort();
    const countries = [...new Set(feeds.flatMap(f => f.countries))].filter(Boolean).sort();
    const languages = [...new Set(feeds.map(f => f.language))].filter(Boolean).sort();
    const catOpts = categories.map(c => `<option value="${c}">${c}</option>`).join('');
    const countryOpts = countries.map(c => `<option value="${c}">${c} \u2014 ${ISO_3166_1_ALPHA2_COUNTRIES[c] || c}</option>`).join('');
    const langOpts = languages.map(l => `<option value="${l}">${l}</option>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Giti RSS Registry \u2014 ${feeds.length} Feeds across 206 Countries</title>
<style>
:root{--bg:#f8f9fa;--card:#fff;--border:#dee2e6;--text:#212529;--muted:#6c757d;--link:#0d6efd;--green:#198754;--yellow:#fd7e14;--orange:#e8590c;--red:#dc3545;--radius:6px;--blue:#0d6efd}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,sans-serif;background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh}
header{background:var(--card);border-bottom:1px solid var(--border);padding:1rem 1.5rem;position:sticky;top:0;z-index:10;box-shadow:0 1px 3px rgba(0,0,0,.05);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem}
header h1{font-size:1.25rem;font-weight:600;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
header .badge{background:var(--link);color:#fff;font-size:.75rem;padding:.15em .5em;border-radius:999px;font-weight:500}
header .sub{color:var(--muted);font-size:.8rem;margin-top:.25rem}
.tab-bar{display:flex;gap:.5rem;padding:.75rem 1.5rem 0;background:var(--card);border-bottom:1px solid var(--border)}
.tab-btn{padding:.5rem 1rem;border:none;background:transparent;cursor:pointer;font-size:.88rem;font-weight:500;color:var(--muted);border-bottom:2px solid transparent;transition:color .15s,border-color .15s}
.tab-btn:hover{color:var(--text)}
.tab-btn.active{color:var(--link);border-bottom-color:var(--link);font-weight:600}
.summary-cards{display:flex;flex-wrap:wrap;gap:.75rem;padding:1rem 1.5rem .5rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:.75rem 1rem;min-width:140px;flex:1;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.card .num{font-size:1.35rem;font-weight:700;color:var(--text);line-height:1.2}
.card .label{font-size:.75rem;color:var(--muted);margin-top:.2rem}
.controls{padding:1rem 1.5rem;display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.controls input,.controls select{font-size:.85rem;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-width:120px}
.controls input{flex:1;min-width:200px;max-width:400px}
.controls select{cursor:pointer}
.btn{font-size:.8rem;padding:.35rem .7rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);cursor:pointer;white-space:nowrap;text-decoration:none;color:var(--text);display:inline-flex;align-items:center;gap:.3rem}
.btn:hover{background:#e9ecef}
.btn-primary{background:var(--link);color:#fff;border-color:var(--link)}
.btn-primary:hover{background:#0b5ed7}
.btn-sm{font-size:.72rem;padding:.2rem .45rem}
.stats{display:flex;flex-wrap:wrap;gap:1rem;padding:0 1.5rem 1rem;color:var(--muted);font-size:.8rem}
.stats strong{color:var(--text)}
.table-wrap{overflow-x:auto;padding:0 1.5rem 2rem}
table{width:100%;border-collapse:collapse;font-size:.82rem;background:var(--card);border-radius:var(--radius);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04)}
thead{background:#e9ecef;position:sticky;top:125px;z-index:5}
th{padding:.55rem .6rem;text-align:left;font-weight:600;cursor:pointer;user-select:none;white-space:nowrap;border-bottom:2px solid var(--border)}
th:hover{color:var(--link)}
th .sort-arrow{font-size:.65rem;margin-left:.15rem}
td{padding:.45rem .6rem;border-bottom:1px solid var(--border);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
tr:hover{background:#f1f3f5}
td.url{max-width:320px;font-family:monospace;font-size:.75rem}
td.url a{color:var(--link);text-decoration:none}
td.url a:hover{text-decoration:underline}
.score{display:inline-block;width:28px;height:18px;line-height:18px;text-align:center;border-radius:3px;font-size:.7rem;font-weight:600;color:#fff}
.score-100{background:var(--green)}
.score-70{background:var(--yellow)}
.score-40{background:var(--orange)}
.score-0{background:var(--red)}
.health-status{display:inline-block;font-size:.7rem;font-weight:600;border-radius:3px;padding:.08rem .3rem;background:#e9ecef;color:var(--text)}
.health-fresh{background:#d1e7dd;color:#0f5132}.health-stale,.health-very-stale{background:#fff3cd;color:#664d03}.health-stale-content{background:#ffe5d0;color:#7a3510}.health-unreachable,.health-invalid-content{background:#f8d7da;color:#842029}.health-unchecked{background:#e2e3e5;color:#41464b}
.tier-badge{display:inline-block;font-size:.72rem;font-weight:600;border-radius:3px;padding:.12rem .4rem}
.tier-domestic-multi{background:#d1e7dd;color:#0f5132}
.tier-domestic-single{background:#fff3cd;color:#664d03}
.tier-regional-only{background:#cfe2ff;color:#084298}
.tier-uncovered{background:#f8d7da;color:#842029}
.last-checked{display:block;color:var(--muted);font-size:.68rem;margin-top:.15rem}
.country-tag{display:inline-block;background:#e9ecef;padding:0 .35em;border-radius:3px;font-size:.7rem;margin:1px}
.pub-badge{display:inline-block;background:#e9ecef;border-radius:3px;font-size:.72rem;padding:.1rem .35rem;margin:1px;max-width:200px;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}
.empty{color:var(--muted);text-align:center;padding:2rem}
.hidden{display:none !important}
footer{text-align:center;padding:1.5rem;color:var(--muted);font-size:.75rem;border-top:1px solid var(--border)}
footer a{color:var(--link)}
@media(max-width:768px){
header h1{font-size:1rem}
.controls{flex-direction:column;align-items:stretch}
.controls input{max-width:none}
thead{top:60px}
table{font-size:.75rem}
th,td{padding:.35rem .4rem}
}
</style>
</head>
<body>
<header>
<h1>\u{1F4E1} Giti RSS Registry <span class="badge">${feeds.length} feeds</span> <span class="badge" style="background:var(--green)">206 countries</span></h1>
<div class="sub">Curated global news feed directory \u2014 filterable, sortable, open data</div>
<a class="btn btn-primary" href="https://github.com/gitinamalive/giti-rss-registry/issues/new?template=feed-proposal.yml" target="_blank" rel="noopener" style="margin-left:auto">+ Propose Feed</a>
</header>
<nav class="tab-bar" aria-label="Views">
  <button type="button" class="tab-btn active" id="tab-btn-directory" onclick="switchTab('directory')">\u{1F4F0} Feed Directory (${feeds.length})</button>
  <button type="button" class="tab-btn" id="tab-btn-matrix" onclick="switchTab('matrix')">\u{1F30D} 206-Country Coverage Matrix</button>
</nav>

<section id="section-directory">
<div class="controls">
<input type="search" id="search" placeholder="\u{1F50D}  Search by name, publisher, description, or country\u2026" aria-label="Search feeds">
<select id="filter-category" aria-label="Filter by category">
<option value="">\u{1F4C2} All categories</option>
${catOpts}
</select>
<select id="filter-country" aria-label="Filter by country">
<option value="">\u{1F30D} All countries</option>
${countryOpts}
</select>
<select id="filter-language" aria-label="Filter by language">
<option value="">\u{1F5E3} All languages</option>
${langOpts}
</select>
<select id="filter-health" aria-label="Filter by health">
<option value="">\u2764\uFE0F All health</option>
<option value="fresh">Healthy / fresh</option>
<option value="stale">Stale article</option>
<option value="very-stale">Very stale article</option>
<option value="stale-content">Stale content / no recent article</option>
<option value="unreachable">Unreachable</option>
<option value="invalid-content">Invalid feed content</option>
<option value="unchecked">Not checked</option>
</select>
<select id="filter-checked" aria-label="Filter by last checked">
<option value="">\u23F1 Any last checked</option>
<option value="7">Checked within 7 days</option>
<option value="30">Checked within 30 days</option>
<option value="older">Checked more than 30 days ago</option>
<option value="never">Never checked</option>
</select>
<button class="btn btn-primary" id="export-csv" aria-label="Export filtered results as CSV">\u2B07 CSV</button>
<button class="btn" id="reset-filters" aria-label="Reset all filters">\u21BA Reset</button>
</div>
<div class="stats" id="stats"></div>
<div class="table-wrap">
<table id="feed-table" role="grid" aria-label="Feed registry">
<thead>
<tr>
<th data-sort="name">Name <span class="sort-arrow">\u25BC</span></th>
<th data-sort="publisher">Publisher</th>
<th data-sort="category">Category</th>
<th data-sort="countries">Country</th>
<th data-sort="language">Lang</th>
<th data-sort="healthScore">Health status</th>
<th data-sort="lastCheckedAt">Last checked</th>
<th>URL</th>
</tr>
</thead>
<tbody id="table-body"></tbody>
</table>
</div>
</section>

<section id="section-matrix" class="hidden">
<div class="summary-cards">
  <div class="card"><div class="num">206</div><div class="label">Countries Tracked</div></div>
  <div class="card"><div class="num" id="stat-multi">${matrixMulti}</div><div class="label">Robust Domestic (2+)</div></div>
  <div class="card"><div class="num" id="stat-single">${matrixSingle}</div><div class="label">Single Domestic (1)</div></div>
  <div class="card"><div class="num" id="stat-regional">${matrixRegional}</div><div class="label">Regional Fallback (0 Domestic)</div></div>
  <div class="card"><div class="num" id="stat-uncovered">${matrixUncovered}</div><div class="label">Uncovered</div></div>
  <div class="card"><div class="num" id="stat-healthy">\u2014</div><div class="label">Verified Fresh / Usable</div></div>
</div>
<div class="controls">
<input type="search" id="matrix-search" placeholder="\u{1F50D} Search country name or code (e.g., France, FR, Nigeria, NG)\u2026" aria-label="Search countries">
<select id="matrix-filter-tier" aria-label="Filter by coverage tier">
<option value="">\u{1F310} All Coverage Tiers</option>
<option value="domestic-multi">\u{1F7E2} Robust Domestic (2+)</option>
<option value="domestic-single">\u{1F7E1} Single Domestic (1)</option>
<option value="regional-only">\u{1F535} Regional Fallback (0 Domestic)</option>
<option value="uncovered">\u{1F534} Uncovered</option>
</select>
<select id="matrix-filter-health" aria-label="Filter by health status">
<option value="">\u2764\uFE0F All Health States</option>
<option value="fresh">Fresh / Usable Only</option>
<option value="has-issues">Has Degraded / Unreachable Feeds</option>
<option value="unchecked">Unchecked Only</option>
</select>
<button class="btn btn-primary" id="export-matrix-csv" aria-label="Export matrix as CSV">\u2B07 CSV</button>
<button class="btn" id="reset-matrix-filters" aria-label="Reset matrix filters">\u21BA Reset</button>
</div>
<div class="stats" id="matrix-stats"></div>
<div class="table-wrap">
<table id="matrix-table" role="grid" aria-label="Country coverage matrix">
<thead>
<tr>
<th data-msort="name">Country <span class="msort-arrow">\u25BC</span></th>
<th data-msort="tier">Coverage Tier</th>
<th data-msort="total">Total Feeds</th>
<th>Domestic Publishers</th>
<th>Regional Fallbacks</th>
<th>Health Status</th>
<th>Action</th>
</tr>
</thead>
<tbody id="matrix-table-body"></tbody>
</table>
</div>
</section>

<footer>
Generated ${generatedAt.split('T')[0]} \u00B7
<a href="https://github.com/gitinamalive/giti-rss-registry">giti-rss-registry</a> \u00B7
MIT Licensed \u00B7 <a href="feeds.json">Raw JSON</a> \u00B7 <a href="coverage-matrix.json">Coverage Matrix JSON</a> \u00B7 <a href="feeds.csv">CSV</a> \u00B7 <a href="opml/all.opml">OPML</a>
</footer>
<script>
const INITIAL_FEEDS = ${feedsJson};
const COUNTRIES_MAP = ${countriesJson};
let ALL_FEEDS = INITIAL_FEEDS.map(feed => Object.assign({healthStatus:'unchecked',lastCheckedAt:null,healthScore:null}, feed));
let MATRIX_DATA = [];
let sortCol = 'name';
let sortDir = 1;
let mSortCol = 'name';
let mSortDir = 1;
let hasHealthOverlay = false;

const $ = (s,d) => (d||document).querySelector(s);
const $$ = (s,d) => [...(d||document).querySelectorAll(s)];

function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

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

window.switchTab = function(name) {
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
};

window.viewCountryFeeds = function(code) {
  switchTab('directory');
  const sel = $('#filter-country');
  if (sel) {
    sel.value = code;
    filterFeeds();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

function renderFeeds(feeds) {
  const tbody = $('#table-body');
  const stats = $('#stats');
  stats.innerHTML = '<strong>' + feeds.length + '</strong> of <strong>' + ALL_FEEDS.length + '</strong> feeds shown';
  if (!feeds.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty">No matching feeds found.</td></tr>'; return; }
  tbody.innerHTML = feeds.map(f => {
    const score = f.healthScore ?? '';
    const scoreClass = score === 100 ? 'score-100' : score === 70 ? 'score-70' : score === 40 ? 'score-40' : score === 0 ? 'score-0' : '';
    const status = f.healthStatus || 'unchecked';
    const statusLabel = ({fresh:'Fresh',stale:'Stale article','very-stale':'Very stale article','stale-content':'Stale content',unreachable:'Unreachable','invalid-content':'Invalid content',unchecked:'Not checked'})[status] || status;
    const checked = f.lastCheckedAt ? new Date(f.lastCheckedAt).toLocaleDateString() : '\u2014';
    const countries = (f.countries||[]).map(c => '<span class="country-tag">' + c + '</span>').join('');
    const url = (f.url||'').substring(0, 80) + ((f.url||'').length > 80 ? '\u2026' : '');
    return '<tr>' +
      '<td>' + (f.homepage ? '<a href="' + escAttr(f.homepage) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a>' : esc(f.name)) + '</td>' +
      '<td>' + esc(f.publisher) + '</td>' +
      '<td>' + esc(f.category) + '</td>' +
      '<td>' + countries + '</td>' +
      '<td>' + esc(f.language) + '</td>' +
      '<td><span class="health-status health-' + escAttr(status) + '">' + esc(statusLabel) + '</span>' + (scoreClass ? ' <span class="score ' + scoreClass + '">' + score + '</span>' : '') + '</td>' +
      '<td><span class="last-checked">' + esc(checked) + '</span></td>' +
      '<td class="url"><a href="' + escAttr(f.url) + '" target="_blank" rel="noopener" title="' + escAttr(f.url||'') + '">' + esc(url) + '</a></td>' +
      '</tr>';
  }).join('');
}

function getFilters() {
  const search = ($('#search').value||'').toLowerCase();
  const cat = $('#filter-category').value;
  const country = $('#filter-country').value;
  const lang = $('#filter-language').value;
  const health = $('#filter-health').value;
  const checked = $('#filter-checked').value;
  return {search, cat, country, lang, health, checked};
}

function matchesFilters(f, filters) {
  const {search, cat, country, lang, health, checked} = filters;
  if (search && !(String(f.name||'').toLowerCase().includes(search) || String(f.publisher||'').toLowerCase().includes(search) || (f.description||'').toLowerCase().includes(search) || (f.countries||[]).some(c => c.toLowerCase().includes(search)))) return false;
  if (cat && f.category !== cat) return false;
  if (country && !(f.countries||[]).includes(country)) return false;
  if (lang && f.language !== lang) return false;
  if (health && (f.healthStatus || 'unchecked') !== health) return false;
  if (checked) {
    if (checked === 'never' && f.lastCheckedAt) return false;
    if (checked !== 'never' && !f.lastCheckedAt) return false;
    if (checked === '7' && Date.now() - new Date(f.lastCheckedAt).getTime() > 7*86400000) return false;
    if (checked === '30' && Date.now() - new Date(f.lastCheckedAt).getTime() > 30*86400000) return false;
    if (checked === 'older' && Date.now() - new Date(f.lastCheckedAt).getTime() <= 30*86400000) return false;
  }
  return true;
}

function filterFeeds() {
  const filters = getFilters();
  let result = ALL_FEEDS.filter(f => matchesFilters(f, filters));
  result.sort((a,b) => {
    const va = a[sortCol] ?? ''; const vb = b[sortCol] ?? '';
    if (sortCol === 'healthScore') return ((va||0)-(vb||0))*sortDir;
    if (sortCol === 'countries') return String(va).localeCompare(String(vb))*sortDir;
    return String(va).localeCompare(String(vb))*sortDir;
  });
  renderFeeds(result);
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
    const regList = e.regional.length ? e.regional.map(f => '<span class="pub-badge" title="' + escAttr(f.name) + '">' + esc(f.publisher || f.name) + '</span>').join('') : '<span style="color:var(--muted)">\u2014</span>';

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
      '<td>' + (domPubs || '<span style="color:var(--muted)">None (fallback only)</span>') + '</td>' +
      '<td>' + regList + '</td>' +
      '<td>' + healthPill + '</td>' +
      '<td>' +
        '<a class="btn btn-sm btn-primary" href="' + escAttr(suggestUrl) + '" target="_blank" rel="noopener" title="Propose feed for ' + escAttr(e.name) + '">+ Suggest</a> ' +
        (e.total > 0 ? '<button type="button" class="btn btn-sm" onclick="viewCountryFeeds(\'' + escAttr(e.code) + '\')">View (' + e.total + ')</button>' : '') +
      '</td>' +
      '</tr>';
  }).join('');
}

function filterMatrix() {
  const search = ($('#matrix-search').value||'').toLowerCase().trim();
  const tier = $('#matrix-filter-tier').value;
  const health = $('#matrix-filter-health').value;

  let result = MATRIX_DATA.filter(e => {
    if (search && !(e.code.toLowerCase().includes(search) || e.name.toLowerCase().includes(search))) return false;
    if (tier && e.tier !== tier) return false;
    if (health) {
      if (health === 'fresh' && e.freshCount === 0) return false;
      if (health === 'has-issues' && e.issueCount === 0) return false;
      if (health === 'unchecked' && (e.freshCount > 0 || e.issueCount > 0)) return false;
    }
    return true;
  });

  result.sort((a,b) => {
    let va = a[mSortCol] ?? ''; let vb = b[mSortCol] ?? '';
    if (mSortCol === 'total') return (a.total - b.total) * mSortDir;
    return String(va).localeCompare(String(vb)) * mSortDir;
  });

  renderMatrix(result);
}

function exportCSV() {
  const filters = getFilters();
  let result = ALL_FEEDS.filter(f => matchesFilters(f, filters));
  const csv = 'name,publisher,url,category,countries,language,healthStatus,healthScore,lastCheckedAt,homepage,description\\n' +
    result.map(f => ['"'+esc(f.name)+'"','"'+esc(f.publisher)+'"','"'+escAttr(f.url)+'"',f.category,(f.countries||[]).join('|'),f.language,f.healthStatus||'unchecked',f.healthScore??'',f.lastCheckedAt||'','"'+escAttr(f.homepage||'')+'"','"'+esc(f.description||'')+'"'].join(',')).join('\\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='giti-rss-registry-filtered.csv'; a.click();
}

function exportMatrixCSV() {
  const csv = 'countryCode,countryName,tier,totalFeeds,domesticFeedsCount,regionalFeedsCount,domesticPublishers,healthFreshCount,healthIssueCount\\n' +
    MATRIX_DATA.map(e => [
      e.code,
      '"' + esc(e.name) + '"',
      e.tier,
      e.total,
      e.domestic.length,
      e.regional.length,
      '"' + e.domestic.map(f => f.publisher || f.name).join(' | ') + '"',
      e.freshCount,
      e.issueCount
    ].join(',')).join('\\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='giti-rss-country-coverage-matrix.csv'; a.click();
}

$('#search').addEventListener('input', filterFeeds);
$('#filter-category').addEventListener('change', filterFeeds);
$('#filter-country').addEventListener('change', filterFeeds);
$('#filter-language').addEventListener('change', filterFeeds);
$('#filter-health').addEventListener('change', filterFeeds);
$('#filter-checked').addEventListener('change', filterFeeds);
$('#export-csv').addEventListener('click', exportCSV);
$('#reset-filters').addEventListener('click', () => { $('#search').value='';$('#filter-category').value='';$('#filter-country').value='';$('#filter-language').value='';$('#filter-health').value='';$('#filter-checked').value='';filterFeeds(); });

$('#matrix-search').addEventListener('input', filterMatrix);
$('#matrix-filter-tier').addEventListener('change', filterMatrix);
$('#matrix-filter-health').addEventListener('change', filterMatrix);
$('#export-matrix-csv').addEventListener('click', exportMatrixCSV);
$('#reset-matrix-filters').addEventListener('click', () => { $('#matrix-search').value='';$('#matrix-filter-tier').value='';$('#matrix-filter-health').value='';filterMatrix(); });

$$('#feed-table th[data-sort]').forEach(th => th.addEventListener('click', () => {
  const col = th.dataset.sort;
  if (col === sortCol) sortDir *= -1; else { sortCol = col; sortDir = 1; }
  $$('#feed-table th .sort-arrow').forEach(a => a.textContent='');
  th.querySelector('.sort-arrow').textContent = sortDir===1?'\u25BC':'\u25B2';
  filterFeeds();
}));

$$('#matrix-table th[data-msort]').forEach(th => th.addEventListener('click', () => {
  const col = th.dataset.msort;
  if (col === mSortCol) mSortDir *= -1; else { mSortCol = col; mSortDir = 1; }
  $$('#matrix-table th .msort-arrow').forEach(a => a.textContent='');
  let arrow = th.querySelector('.msort-arrow');
  if (!arrow) {
    arrow = document.createElement('span');
    arrow.className = 'msort-arrow';
    th.appendChild(arrow);
  }
  arrow.textContent = mSortDir===1?'\u25BC':'\u25B2';
  filterMatrix();
}));

// Initialize directory and matrix
MATRIX_DATA = computeMatrix(ALL_FEEDS);
renderFeeds(ALL_FEEDS);
renderMatrix(MATRIX_DATA);
updateMatrixSummaryCards();

if (window.location.hash === '#matrix') {
  switchTab('matrix');
}

fetch('feeds-health.json', {cache:'no-store'}).then(response => response.ok ? response.json() : null).then(overlay => {
  if (!overlay || !Array.isArray(overlay.feeds)) return;
  hasHealthOverlay = true;
  const healthById = new Map(overlay.feeds.map(entry => [entry.id, entry]));
  ALL_FEEDS = INITIAL_FEEDS.map(feed => Object.assign({healthStatus:'unchecked',lastCheckedAt:null,healthScore:null}, feed, healthById.get(feed.id) || {}));
  MATRIX_DATA = computeMatrix(ALL_FEEDS);
  filterFeeds();
  filterMatrix();
  updateMatrixSummaryCards();
}).catch(() => { /* The canonical directory remains usable if the overlay is unavailable. */ });
<\/script>
</body>
</html>`;
}

async function main(): Promise<void> {
    const raw = await readFile(bootstrapPath, 'utf8');
    const payload = JSON.parse(raw) as BootstrapPayload;
    const feeds = payload.feeds;
    const generatedAt = payload.generatedAt;
    const sourceChecksum = createHash('sha256').update(raw).digest('hex');
    const sourceCommit = await getSourceCommit();
    const manifestGeneratedAt = new Date().toISOString();

    await mkdir(distPath, { recursive: true });
    await mkdir(opmlPath, { recursive: true });

    const byCountry = buildIndex(feeds, (f) => f.countries);
    const byCategory = buildIndex(feeds, (f) => [f.category]);
    const byPublisher = buildIndex(feeds, (f) => [f.publisher]);
    const byLanguage = buildIndex(feeds, (f) => [f.language]);

    await writeJson('feeds.json', feeds);

    const csvHeader = [
        'id', 'name', 'publisher', 'url', 'homepage', 'language', 'countries', 'region', 'category', 'tags',
        'perspective', 'mediaType', 'format', 'official', 'active', 'lastCheckedAt', 'lastItemPublishedAt', 'healthScore', 'notes', 'description', 'alwaysSchedule'
    ].join(',');
    const csvRows = feeds.map((feed) => [
        feed.id,
        feed.name,
        feed.publisher,
        feed.url,
        feed.homepage ?? '',
        feed.language,
        (feed.countries || []).join('|'),
        feed.region ?? '',
        feed.category,
        (feed.tags || []).join('|'),
        feed.perspective ?? '',
        feed.mediaType ?? '',
        feed.format ?? '',
        feed.official ?? '',
        feed.active ?? '',
        feed.lastCheckedAt ?? '',
        feed.lastItemPublishedAt ?? '',
        feed.healthScore ?? '',
        feed.notes ?? '', feed.description ?? '', feed.alwaysSchedule ?? ''
    ].map((v) => escapeCsv(v, { formulaSafe: true })).join(','));

    await writeFile(resolve(distPath, 'feeds.csv'), `${csvHeader}\n${csvRows.join('\n')}\n`, 'utf8');
    await writeJson('by-country.json', byCountry);
    await writeJson('by-category.json', byCategory);
    await writeJson('by-publisher.json', byPublisher);
    await writeJson('by-language.json', byLanguage);

    const coverageMatrix = buildCountryCoverageMatrix(feeds);
    await writeJson('coverage-matrix.json', coverageMatrix);

    await writeOpml('all.opml', 'Giti RSS Registry \u2014 All Feeds', feeds, generatedAt);

    for (const [country, entries] of Object.entries(byCountry)) {
        await writeOpml(`countries/${toFileSafeSegment(country)}.opml`, `Giti RSS Registry \u2014 Country: ${country}`, entries, generatedAt);
    }

    for (const [category, entries] of Object.entries(byCategory)) {
        await writeOpml(`categories/${toFileSafeSegment(category)}.opml`, `Giti RSS Registry \u2014 Category: ${category}`, entries, generatedAt);
    }

    const possibleDuplicates = findPossibleDuplicateUrls(feeds);
    await writeJson('duplicate-report.json', createDuplicateReport(possibleDuplicates, manifestGeneratedAt, sourceChecksum));

    const artifactsMap: Record<string, ArtifactHashEntry> = {};
    const trackedArtifactFiles = [
        'feeds.json',
        'feeds.csv',
        'by-country.json',
        'by-category.json',
        'by-publisher.json',
        'by-language.json',
        'coverage-matrix.json',
        'feeds-health.json',
    ];

    for (const relFile of trackedArtifactFiles) {
        try {
            const fileBytes = await readFile(resolve(distPath, relFile));
            const sha256 = createHash('sha256').update(fileBytes).digest('hex');
            artifactsMap[relFile] = { sha256, bytes: fileBytes.byteLength };
        } catch {
            // File may not exist yet (e.g. feeds-health.json before health-check runs)
        }
    }

    const healthRevision = artifactsMap['feeds-health.json']?.sha256;

    await writeJson('manifest.json', createManifest({
        sourceCommit,
        sourceChecksum,
        generatedAt: manifestGeneratedAt,
        registryRevision: sourceChecksum,
        ...(healthRevision ? { healthRevision } : {}),
        artifactCounts: {
            feeds: feeds.length,
            countries: Object.keys(byCountry).length,
            categories: Object.keys(byCategory).length,
            publishers: Object.keys(byPublisher).length,
            languages: Object.keys(byLanguage).length,
            opml: 1 + Object.keys(byCountry).length + Object.keys(byCategory).length,
            possibleDuplicates: possibleDuplicates.length,
        },
        artifacts: artifactsMap,
    }));

    // Generate browsable HTML directory
    const html = generateIndexHtml(feeds, generatedAt);
    await writeFile(resolve(distPath, 'index.html'), html, 'utf8');

    process.stdout.write(
        `Generated registry artifacts in ${distPath} (feeds: ${feeds.length}, countries: ${Object.keys(byCountry).length}, categories: ${Object.keys(byCategory).length}, possible duplicates: ${possibleDuplicates.length}).\n`
    );
}

// Only run the build when executed directly (not when imported by tests or the
// parity checker, which need the pure exported functions without side effects).
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch((error: unknown) => {
        console.error(`[build-artifacts] Failed:`, error);
        process.exitCode = 1;
    });
}
