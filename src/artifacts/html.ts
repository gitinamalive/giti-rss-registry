import { ISO_3166_1_ALPHA2_COUNTRIES, buildCountryCoverageMatrix } from '../countries.ts';
import { escapeXml } from '../escape.ts';
import type { FeedEntry } from '../types.ts';

export const DIRECTORY_CSP =
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none';";

export function generateIndexHtml(feeds: FeedEntry[], generatedAt: string = new Date().toISOString()): string {
    const matrix = buildCountryCoverageMatrix(feeds);
    const matrixMulti = matrix.filter((e) => e.tier === 'domestic-multi').length;
    const matrixSingle = matrix.filter((e) => e.tier === 'domestic-single').length;
    const matrixRegional = matrix.filter((e) => e.tier === 'regional-only').length;
    const matrixUncovered = matrix.filter((e) => e.tier === 'uncovered').length;
    const countryCount = Object.keys(ISO_3166_1_ALPHA2_COUNTRIES).length;

    const categories = [...new Set(feeds.map((f) => f.category))].sort();
    const countries = [...new Set(feeds.flatMap((f) => f.countries))].filter(Boolean).sort();
    const languages = [...new Set(feeds.map((f) => f.language))].filter(Boolean).sort();
    const catOpts = categories.map((c) => `<option value="${escapeXml(c)}">${escapeXml(c)}</option>`).join('');
    const countryOpts = countries
        .map((c) => `<option value="${escapeXml(c)}">${escapeXml(c)} \u2014 ${escapeXml(ISO_3166_1_ALPHA2_COUNTRIES[c] || c)}</option>`)
        .join('');
    const langOpts = languages.map((l) => `<option value="${escapeXml(l)}">${escapeXml(l)}</option>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${DIRECTORY_CSP}">
<title>Giti RSS Registry \u2014 ${feeds.length} Feeds across ${countryCount} Countries</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header>
<h1>\u{1F4E1} Giti RSS Registry <span class="badge">${feeds.length} feeds</span> <span class="badge badge-green">${countryCount} countries</span></h1>
<div class="sub">Curated global news feed directory \u2014 filterable, sortable, open data</div>
<a class="btn btn-primary header-cta" href="https://github.com/gitinamalive/giti-rss-registry/issues/new?template=feed-proposal.yml" target="_blank" rel="noopener noreferrer">+ Propose Feed</a>
</header>
<nav class="tab-bar" aria-label="Views">
  <button type="button" class="tab-btn active" id="tab-btn-directory" data-tab="directory" aria-selected="true">\u{1F4F0} Feed Directory (${feeds.length})</button>
  <button type="button" class="tab-btn" id="tab-btn-matrix" data-tab="matrix" aria-selected="false">\u{1F30D} ${countryCount}-Country Coverage Matrix</button>
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
<button type="button" class="btn btn-primary" id="export-csv" aria-label="Export filtered results as CSV">\u2B07 CSV</button>
<button type="button" class="btn btn-primary" id="export-opml" aria-label="Export filtered results as OPML">\u2B07 Export OPML</button>
<button type="button" class="btn" id="reset-filters" aria-label="Reset all filters">\u21BA Reset</button>
</div>
<div class="stats" id="stats"></div>
<div id="copy-status" class="sr-only" role="status"></div>
<div class="table-shell">
<div class="table-wrap" tabindex="0" role="region" aria-label="Feed registry">
<table id="feed-table" aria-label="Feed registry">
<thead>
<tr>
<th scope="col" data-sort="name" aria-sort="ascending"><button type="button" class="sort-btn">Name <span class="sort-arrow" aria-hidden="true"></span></button></th>
<th scope="col" data-sort="publisher"><button type="button" class="sort-btn">Publisher <span class="sort-arrow" aria-hidden="true"></span></button></th>
<th scope="col" data-sort="category"><button type="button" class="sort-btn">Category <span class="sort-arrow" aria-hidden="true"></span></button></th>
<th scope="col" data-sort="countries"><button type="button" class="sort-btn">Country <span class="sort-arrow" aria-hidden="true"></span></button></th>
<th scope="col" data-sort="language"><button type="button" class="sort-btn">Lang <span class="sort-arrow" aria-hidden="true"></span></button></th>
<th scope="col" data-sort="healthScore"><button type="button" class="sort-btn">Health status <span class="sort-arrow" aria-hidden="true"></span></button></th>
<th scope="col" data-sort="lastCheckedAt"><button type="button" class="sort-btn">Last checked <span class="sort-arrow" aria-hidden="true"></span></button></th>
</tr>
</thead>
<tbody id="table-body"><tr><td colspan="7" class="empty">Loading feeds\u2026</td></tr></tbody>
</table>
</div>
</div>
</section>

<section id="section-matrix" class="hidden">
<div class="summary-cards">
  <div class="card"><div class="num">${countryCount}</div><div class="label">Countries Tracked</div></div>
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
<button type="button" class="btn btn-primary" id="export-matrix-csv" aria-label="Export matrix as CSV">\u2B07 CSV</button>
<button type="button" class="btn" id="reset-matrix-filters" aria-label="Reset matrix filters">\u21BA Reset</button>
</div>
<div class="stats" id="matrix-stats"></div>
<div class="table-shell">
<div class="table-wrap" tabindex="0" role="region" aria-label="Country coverage matrix">
<table id="matrix-table" aria-label="Country coverage matrix">
<thead>
<tr>
<th scope="col" data-msort="name" aria-sort="ascending"><button type="button" class="sort-btn">Country <span class="msort-arrow" aria-hidden="true"></span></button></th>
<th scope="col" data-msort="tier"><button type="button" class="sort-btn">Coverage Tier <span class="msort-arrow" aria-hidden="true"></span></button></th>
<th scope="col" data-msort="total"><button type="button" class="sort-btn">Total Feeds <span class="msort-arrow" aria-hidden="true"></span></button></th>
<th scope="col">Domestic Publishers</th>
<th scope="col">Regional Fallbacks</th>
<th scope="col">Health Status</th>
<th scope="col">Action</th>
</tr>
</thead>
<tbody id="matrix-table-body"></tbody>
</table>
</div>
</div>
</section>

<footer>
Generated ${escapeXml(generatedAt.split('T')[0])} \u00B7
<a href="https://github.com/gitinamalive/giti-rss-registry">giti-rss-registry</a> \u00B7
CC0 Data / MIT Code \u00B7 <a href="feeds.json">Raw JSON</a> \u00B7 <a href="coverage-matrix.json">Coverage Matrix JSON</a> \u00B7 <a href="feeds.csv">CSV</a> \u00B7 <a href="opml/all.opml">OPML</a>
</footer>
<script src="app.js" defer></script>
</body>
</html>`;
}
