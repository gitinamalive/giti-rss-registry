import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FeedEntry, BootstrapPayload } from '../src/types.ts';

const args = process.argv.slice(2);
const fileArg = args.findIndex(arg => arg === '--file');
const outArg = args.findIndex(arg => arg === '--out');

const filePath = fileArg !== -1 && args[fileArg + 1] ? args[fileArg + 1] : 'data/feeds.json';
const outPath = outArg !== -1 && args[outArg + 1] ? args[outArg + 1] : 'dist';

const bootstrapPath = resolve(filePath);
const distPath = resolve(outPath);
const opmlPath = resolve(distPath, 'opml');

function escapeCsv(value: unknown): string {
    const raw = value == null ? '' : String(value);
    if (/[",\n]/.test(raw)) {
        return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
}

function escapeXml(value: string | null | undefined): string {
    if (!value) return '';
    return value.replace(/[&<>'"]/g, (char) => {
        switch (char) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case "'": return '&apos;';
            case '"': return '&quot;';
            default: return char;
        }
    });
}

function toFileSafeSegment(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
}

function buildIndex(feeds: FeedEntry[], selector: (entry: FeedEntry) => string[]): Record<string, FeedEntry[]> {
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
        grouped[key] = grouped[key].sort((a, b) => collator.compare(a.name, b.name));
    });

    return Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => collator.compare(a, b)));
}

async function writeJson(relativePath: string, value: unknown): Promise<void> {
    const fullPath = resolve(distPath, relativePath);
    await mkdir(resolve(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function generateOpml(title: string, feeds: FeedEntry[]): string {
    const timestamp = new Date().toUTCString();
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

async function writeOpml(relativePath: string, title: string, feeds: FeedEntry[]): Promise<void> {
    const fullPath = resolve(opmlPath, relativePath);
    await mkdir(resolve(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, generateOpml(title, feeds), 'utf8');
}

function generateIndexHtml(feeds: FeedEntry[]): string {
    const feedsJson = JSON.stringify(feeds);
    // Unique sorted values for dropdowns
    const categories = [...new Set(feeds.map(f => f.category))].sort();
    const countries = [...new Set(feeds.flatMap(f => f.countries))].filter(Boolean).sort();
    const languages = [...new Set(feeds.map(f => f.language))].filter(Boolean).sort();
    const catOpts = categories.map(c => `<option value="${c}">${c}</option>`).join('');
    const countryOpts = countries.map(c => `<option value="${c}">${c}</option>`).join('');
    const langOpts = languages.map(l => `<option value="${l}">${l}</option>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Giti RSS Registry — ${feeds.length} Feeds</title>
<style>
:root{--bg:#f8f9fa;--card:#fff;--border:#dee2e6;--text:#212529;--muted:#6c757d;--link:#0d6efd;--green:#198754;--yellow:#fd7e14;--orange:#e8590c;--red:#dc3545;--radius:6px}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,sans-serif;background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh}
header{background:var(--card);border-bottom:1px solid var(--border);padding:1rem 1.5rem;position:sticky;top:0;z-index:10;box-shadow:0 1px 3px rgba(0,0,0,.05)}
header h1{font-size:1.25rem;font-weight:600;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
header .badge{background:var(--link);color:#fff;font-size:.75rem;padding:.15em .5em;border-radius:999px;font-weight:500}
header .sub{color:var(--muted);font-size:.8rem;margin-top:.25rem}
.controls{padding:1rem 1.5rem;display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.controls input,.controls select{font-size:.85rem;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--text);min-width:120px}
.controls input{flex:1;min-width:200px;max-width:400px}
.controls select{cursor:pointer}
.btn{font-size:.8rem;padding:.35rem .7rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);cursor:pointer;white-space:nowrap;text-decoration:none;color:var(--text)}
.btn:hover{background:#e9ecef}
.btn-primary{background:var(--link);color:#fff;border-color:var(--link)}
.btn-primary:hover{background:#0b5ed7}
.stats{display:flex;flex-wrap:wrap;gap:1rem;padding:0 1.5rem 1rem;color:var(--muted);font-size:.8rem}
.stats strong{color:var(--text)}
.table-wrap{overflow-x:auto;padding:0 1.5rem 2rem}
table{width:100%;border-collapse:collapse;font-size:.82rem;background:var(--card);border-radius:var(--radius);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04)}
thead{background:#e9ecef;position:sticky;top:76px;z-index:5}
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
.country-tag{display:inline-block;background:#e9ecef;padding:0 .35em;border-radius:3px;font-size:.7rem;margin:1px}
.empty{color:var(--muted);text-align:center;padding:2rem}
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
<h1>📡 Giti RSS Registry <span class="badge">${feeds.length} feeds</span></h1>
<div class="sub">Curated global news feed directory — filterable, sortable, open data</div>
</header>
<div class="controls">
<input type="search" id="search" placeholder="🔍  Search by name, publisher, description, or country…" aria-label="Search feeds">
<select id="filter-category" aria-label="Filter by category">
<option value="">📂 All categories</option>
${catOpts}
</select>
<select id="filter-country" aria-label="Filter by country">
<option value="">🌍 All countries</option>
${countryOpts}
</select>
<select id="filter-language" aria-label="Filter by language">
<option value="">🗣 All languages</option>
${langOpts}
</select>
<select id="filter-health" aria-label="Filter by health">
<option value="">❤️ All health</option>
<option value="100">Active (<7 days)</option>
<option value="70">Stale (7–30 days)</option>
<option value="40">Very stale (>30 days)</option>
<option value="0">Dead / unchecked</option>
</select>
<button class="btn btn-primary" id="export-csv" aria-label="Export filtered results as CSV">⬇ CSV</button>
<button class="btn" id="reset-filters" aria-label="Reset all filters">↺ Reset</button>
</div>
<div class="stats" id="stats"></div>
<div class="table-wrap">
<table id="feed-table" role="grid" aria-label="Feed registry">
<thead>
<tr>
<th data-sort="name">Name <span class="sort-arrow">▼</span></th>
<th data-sort="publisher">Publisher</th>
<th data-sort="category">Category</th>
<th data-sort="countries">Country</th>
<th data-sort="language">Lang</th>
<th data-sort="healthScore">Health</th>
<th>URL</th>
</tr>
</thead>
<tbody id="table-body"></tbody>
</table>
</div>
<footer>
Generated ${new Date().toISOString().split('T')[0]} · 
<a href="https://github.com/gitinamalive/giti/tree/develop/public-rss-registry">giti-rss-registry</a> · 
MIT Licensed · <a href="feeds.json">Raw JSON</a> · <a href="feeds.csv">CSV</a> · <a href="opml/all.opml">OPML</a>
</footer>
<script>
const ALL_FEEDS = ${feedsJson};
let sortCol = 'name';
let sortDir = 1;

const $ = (s,d) => (d||document).querySelector(s);
const $$ = (s,d) => [...(d||document).querySelectorAll(s)];

function render(feeds) {
  const tbody = $('#table-body');
  const stats = $('#stats');
  stats.innerHTML = '<strong>' + feeds.length + '</strong> of <strong>' + ALL_FEEDS.length + '</strong> feeds shown';
  if (!feeds.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">No matching feeds found.</td></tr>'; return; }
  tbody.innerHTML = feeds.map(f => {
    const score = f.healthScore ?? '';
    const scoreClass = score === 100 ? 'score-100' : score === 70 ? 'score-70' : score === 40 ? 'score-40' : score === 0 ? 'score-0' : '';
    const countries = (f.countries||[]).map(c => '<span class="country-tag">' + c + '</span>').join('');
    const url = (f.url||'').substring(0, 80) + ((f.url||'').length > 80 ? '…' : '');
    return '<tr>' +
      '<td>' + (f.homepage ? '<a href="' + f.homepage + '" target="_blank" rel="noopener">' + esc(f.name) + '</a>' : esc(f.name)) + '</td>' +
      '<td>' + esc(f.publisher) + '</td>' +
      '<td>' + esc(f.category) + '</td>' +
      '<td>' + countries + '</td>' +
      '<td>' + esc(f.language) + '</td>' +
      '<td>' + (scoreClass ? '<span class="score ' + scoreClass + '">' + score + '</span>' : '—') + '</td>' +
      '<td class="url"><a href="' + escAttr(f.url) + '" target="_blank" rel="noopener" title="' + escAttr(f.url||'') + '">' + esc(url) + '</a></td>' +
      '</tr>';
  }).join('');
}

function esc(s) { return String(s||'').replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"'); }
function escAttr(s) { return String(s||'').replace(/&/g,'&').replace(/"/g,'"').replace(/'/g,'&#39;'); }

function getFilters() {
  const search = ($('#search').value||'').toLowerCase();
  const cat = $('#filter-category').value;
  const country = $('#filter-country').value;
  const lang = $('#filter-language').value;
  const health = $('#filter-health').value;
  return {search, cat, country, lang, health};
}

function filterFeeds() {
  const {search, cat, country, lang, health} = getFilters();
  let result = ALL_FEEDS;
  if (search) result = result.filter(f => esc(f.name).toLowerCase().includes(search) || esc(f.publisher).toLowerCase().includes(search) || (f.description||'').toLowerCase().includes(search) || (f.countries||[]).some(c => c.toLowerCase().includes(search)));
  if (cat) result = result.filter(f => f.category === cat);
  if (country) result = result.filter(f => (f.countries||[]).includes(country));
  if (lang) result = result.filter(f => f.language === lang);
  if (health === '100') result = result.filter(f => f.healthScore === 100);
  else if (health === '70') result = result.filter(f => f.healthScore === 70);
  else if (health === '40') result = result.filter(f => f.healthScore === 40);
  else if (health === '0') result = result.filter(f => !f.healthScore || f.healthScore === 0);
  result.sort((a,b) => {
    const va = a[sortCol] ?? ''; const vb = b[sortCol] ?? '';
    if (sortCol === 'healthScore') return ((va||0)-(vb||0))*sortDir;
    if (sortCol === 'countries') return String(va).localeCompare(String(vb))*sortDir;
    return String(va).localeCompare(String(vb))*sortDir;
  });
  render(result);
}

function exportCSV() {
  const {search, cat, country, lang, health} = getFilters();
  let result = ALL_FEEDS;
  if (search) result = result.filter(f => esc(f.name).toLowerCase().includes(search) || esc(f.publisher).toLowerCase().includes(search) || (f.description||'').toLowerCase().includes(search) || (f.countries||[]).some(c => c.toLowerCase().includes(search)));
  if (cat) result = result.filter(f => f.category === cat);
  if (country) result = result.filter(f => (f.countries||[]).includes(country));
  if (lang) result = result.filter(f => f.language === lang);
  if (health==='100') result=result.filter(f=>f.healthScore===100);
  else if (health==='70') result=result.filter(f=>f.healthScore===70);
  else if (health==='40') result=result.filter(f=>f.healthScore===40);
  else if (health==='0') result=result.filter(f=>!f.healthScore||f.healthScore===0);
  const csv = 'name,publisher,url,category,countries,language,healthScore,homepage,description\\n' +
    result.map(f => ['"'+esc(f.name)+'"','"'+esc(f.publisher)+'"','"'+escAttr(f.url)+'"',f.category,(f.countries||[]).join('|'),f.language,f.healthScore??'','"'+escAttr(f.homepage||'')+'"','"'+esc(f.description||'')+'"'].join(',')).join('\\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='giti-rss-registry-filtered.csv'; a.click();
}

$$('#controls input, #controls select').forEach(el => el.addEventListener('input', filterFeeds));
$$('.controls input, .controls select').forEach(el => el.addEventListener('input', filterFeeds));
$$('.controls select').forEach(el => el.addEventListener('change', filterFeeds));
$('#search').addEventListener('input', filterFeeds);
$('#filter-category').addEventListener('change', filterFeeds);
$('#filter-country').addEventListener('change', filterFeeds);
$('#filter-language').addEventListener('change', filterFeeds);
$('#filter-health').addEventListener('change', filterFeeds);
$('#export-csv').addEventListener('click', exportCSV);
$('#reset-filters').addEventListener('click', () => { $('#search').value='';$('#filter-category').value='';$('#filter-country').value='';$('#filter-language').value='';$('#filter-health').value='';filterFeeds(); });
$$('th[data-sort]').forEach(th => th.addEventListener('click', () => {
  const col = th.dataset.sort;
  if (col === sortCol) sortDir *= -1; else { sortCol = col; sortDir = 1; }
  $$('th .sort-arrow').forEach(a => a.textContent='');
  th.querySelector('.sort-arrow').textContent = sortDir===1?'▼':'▲';
  filterFeeds();
}));
render(ALL_FEEDS);
</script>
</body>
</html>`;
}

async function main(): Promise<void> {
    const raw = await readFile(bootstrapPath, 'utf8');
    const payload = JSON.parse(raw) as BootstrapPayload;
    const feeds = payload.feeds;

    await mkdir(distPath, { recursive: true });
    await mkdir(opmlPath, { recursive: true });

    const byCountry = buildIndex(feeds, (f) => f.countries);
    const byCategory = buildIndex(feeds, (f) => [f.category]);
    const byPublisher = buildIndex(feeds, (f) => [f.publisher]);
    const byLanguage = buildIndex(feeds, (f) => [f.language]);

    await writeJson('feeds.json', feeds);

    const csvHeader = [
        'id', 'name', 'publisher', 'url', 'homepage', 'language', 'countries', 'region', 'category', 'tags',
        'perspective', 'mediaType', 'format', 'official', 'active', 'lastCheckedAt', 'lastItemPublishedAt', 'healthScore', 'notes'
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
        feed.notes ?? ''
    ].map(escapeCsv).join(','));

    await writeFile(resolve(distPath, 'feeds.csv'), `${csvHeader}\n${csvRows.join('\n')}\n`, 'utf8');
    await writeJson('by-country.json', byCountry);
    await writeJson('by-category.json', byCategory);
    await writeJson('by-publisher.json', byPublisher);
    await writeJson('by-language.json', byLanguage);

    await writeOpml('all.opml', 'Giti RSS Registry — All Feeds', feeds);

    for (const [country, entries] of Object.entries(byCountry)) {
        await writeOpml(`countries/${toFileSafeSegment(country)}.opml`, `Giti RSS Registry — Country: ${country}`, entries);
    }

    for (const [category, entries] of Object.entries(byCategory)) {
        await writeOpml(`categories/${toFileSafeSegment(category)}.opml`, `Giti RSS Registry — Category: ${category}`, entries);
    }

    // Generate browsable HTML directory
    const html = generateIndexHtml(feeds);
    await writeFile(resolve(distPath, 'index.html'), html, 'utf8');

    process.stdout.write(
        `Generated registry artifacts in ${distPath} (feeds: ${feeds.length}, countries: ${Object.keys(byCountry).length}, categories: ${Object.keys(byCategory).length}).\n`
    );
}

main().catch((error: unknown) => {
    console.error(`[build-artifacts] Failed:`, error);
    process.exitCode = 1;
});
