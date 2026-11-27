import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    decodeBasicEntities,
    formatTriageComment,
    parseIssueFormBody,
    validateProposedFeed,
    type ProposedFeedInput,
} from '../scripts/propose-feed.ts';
import {
    allowedCategories,
    allowedMediaTypes,
    allowedPerspectives,
    type FeedEntry,
} from '../src/types.ts';

const existingFeed: FeedEntry = {
    id: 'guardian-world-12345678',
    name: 'The Guardian',
    publisher: 'The Guardian',
    url: 'https://theguardian.com/world/rss',
    language: 'en',
    countries: ['GB'],
    category: 'world',
};

const publicResolver = async () => ['93.184.216.34'];

describe('parseIssueFormBody', () => {
    it('extracts input fields from GitHub issue markdown form', () => {
        const body = `
### Feed URL

https://punchng.com/feed/

### Target Country Code (ISO-3166-1 alpha-2)

NG

### Publisher Name

The Punch

### Category

world

### Primary Language Code (ISO-639-1)

en
        `;
        const parsed = parseIssueFormBody(body);
        expect(parsed.url).toBe('https://punchng.com/feed/');
        expect(parsed.countries).toEqual(['NG']);
        expect(parsed.publisher).toBe('The Punch');
        expect(parsed.category).toBe('world');
        expect(parsed.language).toBe('en');
    });

    it('ignores invalid enum values and GitHub _No response_ placeholders', () => {
        const body = `
### Feed URL

https://example.com/feed.xml

### Category

not-a-category

### Media Type

_No response_

### Editorial Perspective

corporate
        `;
        const parsed = parseIssueFormBody(body);
        expect(parsed.category).toBeUndefined();
        expect(parsed.mediaType).toBeUndefined();
        expect(parsed.perspective).toBeUndefined();
    });
});

describe('issue template enum parity', () => {
    it('keeps feed-proposal.yml dropdown options aligned with src/types.ts enums', async () => {
        const rawYaml = await readFile(resolve('.github/ISSUE_TEMPLATE/feed-proposal.yml'), 'utf8');

        const extractOptions = (fieldId: string): string[] => {
            const sectionRegex = new RegExp(
                `id:\\s*${fieldId}\\b[\\s\\S]*?options:\\s*\\r?\\n((?:\\s+-\\s+[^\\r\\n]+\\r?\\n?)+)`
            );
            const match = rawYaml.match(sectionRegex);
            if (!match) return [];
            return match[1]
                .split(/\r?\n/)
                .map((line) => line.replace(/^\s*-\s*/, '').trim())
                .filter(Boolean);
        };

        const categoryOptions = extractOptions('category');
        const mediaTypeOptions = extractOptions('media_type');
        const perspectiveOptions = extractOptions('perspective');

        expect(categoryOptions.length).toBeGreaterThan(0);
        expect(mediaTypeOptions.length).toBeGreaterThan(0);
        expect(perspectiveOptions.length).toBeGreaterThan(0);

        for (const opt of categoryOptions) {
            expect(allowedCategories.has(opt as never), `Invalid category option: ${opt}`).toBe(true);
        }
        for (const opt of mediaTypeOptions) {
            expect(allowedMediaTypes.has(opt as never), `Invalid media_type option: ${opt}`).toBe(true);
        }
        for (const opt of perspectiveOptions) {
            expect(allowedPerspectives.has(opt as never), `Invalid perspective option: ${opt}`).toBe(true);
        }
    });
});

describe('validateProposedFeed', () => {
    it('rejects loopback/SSRF URLs safely', async () => {
        const input: ProposedFeedInput = { url: 'http://127.0.0.1/feed' };
        const result = await validateProposedFeed(input, { resolveHost: publicResolver });
        expect(result.valid).toBe(false);
        expect(result.confidenceScore).toBe(0);
        expect(result.reasons[0]).toContain('SSRF rejection');
    });

    it('rejects URLs already present in existing feeds', async () => {
        const input: ProposedFeedInput = { url: 'https://theguardian.com/world/rss/' };
        const result = await validateProposedFeed(input, {
            resolveHost: publicResolver,
            existingFeeds: [existingFeed],
        });
        expect(result.valid).toBe(false);
        expect(result.duplicateOf).toBe(existingFeed.id);
        expect(result.reasons[0]).toContain('Duplicate feed');
    });

    it('validates a fresh RSS feed with high confidence and generates suggested entry', async () => {
        const rssXml = `
            <rss version="2.0">
                <channel>
                    <title>Vanguard News</title>
                    <link>https://vanguardngr.com</link>
                    <description>Latest Nigerian News</description>
                    <language>en</language>
                    <item>
                        <title>Major Headline</title>
                        <pubDate>${new Date().toUTCString()}</pubDate>
                    </item>
                </channel>
            </rss>
        `;
        const fetcher = async () => new Response(rssXml, {
            status: 200,
            headers: { 'content-type': 'application/rss+xml' },
        });

        const input: ProposedFeedInput = {
            url: 'https://vanguardngr.com/feed',
            countries: ['NG'],
            category: 'world',
        };

        const result = await validateProposedFeed(input, {
            fetcher,
            resolveHost: publicResolver,
            existingFeeds: [existingFeed],
        });

        expect(result.valid).toBe(true);
        expect(result.confidenceScore).toBeGreaterThanOrEqual(80);
        expect(result.format).toBe('rss');
        expect(result.itemCount).toBe(1);
        expect(result.suggestedEntry).toMatchObject({
            name: 'Vanguard News',
            publisher: 'Vanguard News',
            url: 'https://vanguardngr.com/feed',
            homepage: 'https://vanguardngr.com',
            language: 'en',
            countries: ['NG'],
            category: 'world',
        });
    });

    it('rejects arbitrary HTML pages with low confidence', async () => {
        const fetcher = async () => new Response('<html><body>homepage</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        });

        const input: ProposedFeedInput = { url: 'https://example.com/not-a-feed' };
        const result = await validateProposedFeed(input, { fetcher, resolveHost: publicResolver });
        expect(result.valid).toBe(false);
        expect(result.format).toBeUndefined();
    });

    it('uses the real defaultHostResolver on redirect hops when resolveHost is omitted', async () => {
        let fetchedSecondHop = false;
        const fetcher = async (input: string | URL | Request) => {
            const url = String(input);
            if (url === 'https://93.184.216.34/feed.xml') {
                return new Response(null, {
                    status: 302,
                    headers: { location: 'https://nonexistent.invalid/private-feed.xml' },
                });
            }
            fetchedSecondHop = true;
            return new Response('<rss><channel><item><title>x</title></item></channel></rss>', { status: 200 });
        };

        // Omit resolveHost intentionally: real DNS must run on the redirect target
        // (RFC 2606 .invalid never resolves), proving no hardcoded stub IP is used.
        const result = await validateProposedFeed({ url: 'https://93.184.216.34/feed.xml' }, { fetcher });
        expect(result.valid).toBe(false);
        expect(fetchedSecondHop).toBe(false);
        expect(result.reasons[0]).toContain('Fetch failure');
    });

    it('rejects redirects to domains resolving to private or IPv4-mapped loopback addresses', async () => {
        let fetchedSecondHop = false;
        const fetcher = async (input: string | URL | Request) => {
            const url = String(input);
            if (url === 'https://public.example/feed') {
                return new Response(null, {
                    status: 302,
                    headers: { location: 'https://internal.example/feed' },
                });
            }
            fetchedSecondHop = true;
            return new Response('<rss><channel></channel></rss>', { status: 200 });
        };

        const resolveHost = async (hostname: string) =>
            hostname === 'public.example' ? ['93.184.216.34'] : ['::ffff:7f00:1'];

        const result = await validateProposedFeed({ url: 'https://public.example/feed' }, { fetcher, resolveHost });
        expect(result.valid).toBe(false);
        expect(fetchedSecondHop).toBe(false);
        expect(result.reasons[0]).toContain('non-public host');
    });

    it('decodes basic XML/HTML entities in detected titles without enabling XML entity expansion', () => {
        expect(decodeBasicEntities('News &amp; Views &#8217;26')).toBe("News & Views \u201926");
    });
});

describe('formatTriageComment', () => {
    it('formats a structured markdown comment with JSON entry', () => {
        const markdown = formatTriageComment({
            valid: true,
            confidenceScore: 90,
            reasons: ['Reachable', 'Valid RSS'],
            format: 'rss',
            itemCount: 5,
            latestItemDate: new Date().toISOString(),
            suggestedEntry: existingFeed,
            warnings: [],
        });

        expect(markdown).toContain('## 🟢 Feed Proposal Triage Report');
        expect(markdown).toContain('**Confidence Score:** 90 / 100');
        expect(markdown).toContain('guardian-world-12345678');
    });
});
