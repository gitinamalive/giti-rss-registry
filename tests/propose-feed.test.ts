import { describe, expect, it } from 'vitest';
import {
    formatTriageComment,
    parseIssueFormBody,
    validateProposedFeed,
    type ProposedFeedInput,
} from '../scripts/propose-feed.ts';
import type { FeedEntry } from '../src/types.ts';

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
