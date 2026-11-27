import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Script } from 'node:vm';
import { describe, it, expect } from 'vitest';
import {
    CSV_COLUMNS,
    DIRECTORY_CSP,
    buildIndex,
    createDuplicateReport,
    createManifest,
    generateCsv,
    generateIndexHtml,
    generateOpml,
} from '../scripts/build-artifacts.ts';
import type { FeedEntry } from '../src/types.ts';

// Malicious / hostile input fixtures. Each must be neutralized when it flows
// through any feed field into a generated public artifact.
const fixtures = [
    '</script><script>alert(1)</script>',
    '</ScRiPt><script>alert(1)</script>',
    '" onmouseover="alert(1)',
    '&',
    "'",
    '<',
    '=1+1',
    '+cmd',
    '@SUM',
    '</a>',
    '\u2028\u2029',
];

const feedFields = ['name', 'publisher', 'description', 'notes', 'homepage', 'url', 'tags', 'category', 'language'] as const;

function makeFeed(overrides: Partial<FeedEntry> = {}): FeedEntry {
    return {
        id: 'test-feed-00000000',
        name: 'Test Feed',
        publisher: 'Test Publisher',
        url: 'https://example.com/feed.xml',
        language: 'en',
        countries: ['US'],
        category: 'world',
        ...overrides,
    };
}

describe('generateIndexHtml and static directory assets', () => {
    it('emits exactly one external script tag, links styles.css, and sets a strict CSP with no inline handlers', () => {
        const html = generateIndexHtml([makeFeed()]);
        expect(html.toLowerCase().split('<script').length - 1).toBe(1);
        expect(html.toLowerCase().split('</script').length - 1).toBe(1);
        expect(html).toContain('<script src="app.js" defer></script>');
        expect(html).toContain('<link rel="stylesheet" href="styles.css">');
        expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${DIRECTORY_CSP}">`);
        expect(html).not.toContain('<style>');
        expect(html).not.toMatch(/\sonclick=/i);
    });

    it('neutralizes every fixture across every feed field', () => {
        for (const field of feedFields) {
            for (const fixture of fixtures) {
                const value: string | string[] = field === 'tags' ? [fixture] : fixture;
                const feed = makeFeed({ [field]: value } as Partial<FeedEntry>);
                const html = generateIndexHtml([feed]);

                // Invariant: no contributor-controlled <script> or </script>
                // (any case) beyond the single external app.js script tag.
                expect(html.toLowerCase().split('<script').length - 1).toBe(1);
                expect(html.toLowerCase().split('</script').length - 1).toBe(1);
                expect(html).not.toContain('" onmouseover="');
            }
        }
    });

    it('includes filtered Export OPML action next to Export CSV in the filter bar', () => {
        const html = generateIndexHtml([makeFeed()]);
        expect(html).toContain('id="export-csv"');
        expect(html).toContain('id="export-opml"');
    });

    it('ships valid external styles.css with sticky thead and non-truncating country cell rules', async () => {
        const css = await readFile(resolve('src/artifacts/static/styles.css'), 'utf8');
        expect(css).toContain('thead{background:#e9ecef;position:sticky;top:0;inset-block-start:0;z-index:5;box-shadow:0 2px 4px rgba(0,0,0,.08)}');
        expect(css).toContain('td.countries-cell{min-width:110px;max-width:230px;white-space:normal}');
        expect(css).not.toContain('top:125px');
    });

    it('ships syntactically valid external app.js that fetches feeds.json without inline onclick handlers', async () => {
        const appJs = await readFile(resolve('src/artifacts/static/app.js'), 'utf8');
        expect(() => new Script(appJs, { filename: 'src/artifacts/static/app.js' })).not.toThrow();
        expect(appJs).toContain("fetch('feeds.json')");
        expect(appJs).toContain('copy-rss-btn');
        expect(appJs).toContain('function exportOPML()');
        expect(appJs).toContain('giti-rss-registry-filtered.opml');
        expect(appJs).toContain('class="country-more"');
        expect(appJs).not.toMatch(/\sonclick=/i);
    });
});

describe('generateOpml', () => {
    it('escapes feed name and url', () => {
        const feed = makeFeed({ name: 'A & B <C>', url: 'https://example.com/feed?a=1&b=2' });
        const opml = generateOpml('Test', [feed]);
        expect(opml).toContain('&amp;');
        expect(opml).toContain('&lt;');
        expect(opml).not.toContain('<C>');
    });

    it('never emits a raw script-terminating sequence', () => {
        const feed = makeFeed({ name: '</script>' });
        const opml = generateOpml('Test', [feed]);
        expect(opml.toLowerCase()).not.toContain('</script');
    });
});

describe('buildIndex', () => {
    it('groups by selector and sorts keys/entries deterministically', () => {
        const a = makeFeed({ id: 'a', name: 'Alpha', category: 'world' });
        const b = makeFeed({ id: 'b', name: 'Beta', category: 'world' });
        const c = makeFeed({ id: 'c', name: 'Gamma', category: 'us' });
        const byCategory = buildIndex([b, c, a], (f) => [f.category]);
        expect(Object.keys(byCategory)).toEqual(['us', 'world']);
        expect(byCategory.world.map((f) => f.name)).toEqual(['Alpha', 'Beta']);
    });
});

describe('generated metadata artifacts', () => {
    it('creates a versioned manifest with source provenance and counts', () => {
        expect(createManifest({
            sourceCommit: 'abc123',
            sourceChecksum: 'deadbeef',
            generatedAt: '2026-08-26T00:00:00.000Z',
            artifactCounts: { feeds: 1, opml: 1 },
        })).toEqual({
            schemaVersion: '1.1.0',
            generatorVersion: '1.2.0',
            sourceCommit: 'abc123',
            sourceChecksum: 'deadbeef',
            generatedAt: '2026-08-26T00:00:00.000Z',
            artifactCounts: { feeds: 1, opml: 1 },
        });
    });

    it('serializes possible duplicate findings as a report artifact', () => {
        const finding = { fingerprint: 'https://example.com/feed', feedIds: ['a', 'b'], urls: ['https://example.com/feed', 'https://www.example.com/feed'] };
        expect(createDuplicateReport([finding], '2026-08-26T00:00:00.000Z', 'checksum')).toEqual({
            generatedAt: '2026-08-26T00:00:00.000Z',
            sourceChecksum: 'checksum',
            possibleDuplicates: [finding],
        });
    });
});

describe('generateCsv', () => {
    it('includes a column for every FeedEntry property declared in schema/feeds.schema.json', async () => {
        const schema = JSON.parse(await readFile(resolve('schema/feeds.schema.json'), 'utf8')) as {
            $defs: { FeedEntry: { properties: Record<string, unknown> } };
        };
        const schemaKeys = Object.keys(schema.$defs.FeedEntry.properties);
        const csvColumnSet = new Set<string>(CSV_COLUMNS);
        for (const key of schemaKeys) {
            expect(csvColumnSet.has(key), `Missing FeedEntry key in CSV_COLUMNS: ${key}`).toBe(true);
        }
    });

    it('serializes governance, provenance, and coverage fields properly', () => {
        const feed = makeFeed({
            coverageType: 'national',
            publisherCountries: ['GB', 'US'],
            governance: 'public-service',
            operatingCircumstance: 'domestic',
            sourceRole: 'reporting',
            publisherDomain: 'bbc.co.uk',
            sourceAttribution: 'manual',
            license: 'CC0-1.0',
        });
        const csv = generateCsv([feed]);
        const [header, row] = csv.trim().split('\n');
        const cols = header.split(',');
        const values = row.split(',');
        const record = Object.fromEntries(cols.map((col, idx) => [col, values[idx]]));

        expect(record.coverageType).toBe('national');
        expect(record.publisherCountries).toBe('GB|US');
        expect(record.governance).toBe('public-service');
        expect(record.operatingCircumstance).toBe('domestic');
        expect(record.sourceRole).toBe('reporting');
        expect(record.publisherDomain).toBe('bbc.co.uk');
        expect(record.sourceAttribution).toBe('manual');
        expect(record.license).toBe('CC0-1.0');
    });
});
