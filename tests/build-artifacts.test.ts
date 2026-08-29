import { describe, it, expect } from 'vitest';
import { buildIndex, createDuplicateReport, createManifest, generateIndexHtml, generateOpml } from '../scripts/build-artifacts.ts';
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

const feedFields = ['name', 'publisher', 'description', 'notes', 'homepage', 'url', 'tags'] as const;

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

describe('generateIndexHtml', () => {
    it('emits exactly one script block for a benign feed', () => {
        const html = generateIndexHtml([makeFeed()]);
        expect(html.toLowerCase().split('<script').length - 1).toBe(1);
        expect(html.toLowerCase().split('</script').length - 1).toBe(1);
    });

    it('neutralizes every fixture across every feed field', () => {
        for (const field of feedFields) {
            for (const fixture of fixtures) {
                const value: string | string[] = field === 'tags' ? [fixture] : fixture;
                const feed = makeFeed({ [field]: value } as Partial<FeedEntry>);
                const html = generateIndexHtml([feed]);

                // Invariant: no contributor-controlled <script> or </script>
                // (any case) beyond the single legitimate block.
                expect(html.toLowerCase().split('<script').length - 1).toBe(1);
                expect(html.toLowerCase().split('</script').length - 1).toBe(1);
            }
        }
    });

    it('neutralizes attribute breakout via homepage and url', () => {
        const payload = '" onmouseover="alert(1)';
        for (const field of ['homepage', 'url'] as const) {
            const feed = makeFeed({ [field]: payload } as Partial<FeedEntry>);
            const html = generateIndexHtml([feed]);
            expect(html).not.toContain('" onmouseover="');
            expect(html).not.toContain("' onmouseover='");
        }
    });

    it('embeds the homepage value losslessly in page data', () => {
        const feed = makeFeed({ homepage: 'https://example.com' });
        const html = generateIndexHtml([feed]);
        const match = html.match(/const INITIAL_FEEDS = (\[.*\]);/);
        expect(JSON.parse(match![1])[0].homepage).toBe('https://example.com');
    });

    it('embeds JSON that parses back to the original feed', () => {
        const feed = makeFeed({
            name: '</script><script>alert(1)</script>',
            description: 'a & b \u2028 c',
        });
        const html = generateIndexHtml([feed]);
        const match = html.match(/const INITIAL_FEEDS = (\[.*\]);/);
        expect(match).not.toBeNull();
        const parsed = JSON.parse(match![1]);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].name).toBe('</script><script>alert(1)</script>');
        expect(parsed[0].description).toBe('a & b \u2028 c');
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
            schemaVersion: '1.0.0',
            generatorVersion: '1.1.0',
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
