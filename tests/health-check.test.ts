import { describe, expect, it, vi } from 'vitest';
import {
    checkFeed,
    decodeFeedBytes,
    isPublicHttpUrl,
    mergeHealthEntry,
    parseFeedContent,
    readBoundedBytes,
    readExistingOverlay,
    type Fetcher,
} from '../scripts/health-check.ts';
import type { FeedEntry } from '../src/types.ts';

const feed: FeedEntry = {
    id: 'fixture-feed-00000000',
    name: 'Fixture Feed',
    publisher: 'Fixture Publisher',
    url: 'https://example.com/feed',
    language: 'en',
    countries: ['US'],
    category: 'world',
};

const publicResolver = async (): Promise<string[]> => ['93.184.216.34'];

describe('feed content validation', () => {
    it.each([
        ['rss', '<rss version="2.0"><channel><item><pubDate>Wed, 26 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>'],
        ['atom', '<feed xmlns="http://www.w3.org/2005/Atom"><updated>2026-08-26T00:00:00Z</updated></feed>'],
        ['rdf', '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF>'],
        ['jsonfeed', JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'Fixture', items: [] })],
    ])('accepts valid %s fixtures', (format, body) => {
        expect(parseFeedContent(body)?.format).toBe(format);
    });

    it('rejects a successful HTML page as invalid content', async () => {
        const fetcher: Fetcher = async (_input, init) => new Response('<html><body>homepage</body></html>', {
            status: init?.method === 'HEAD' ? 200 : 200,
            headers: { 'content-type': 'text/html' },
        });
        const result = await checkFeed(feed, { fetcher, resolveHost: publicResolver });
        expect(result).toMatchObject({ reachable: false, contentValid: false, failureStatus: 'invalid-content', status: 200 });
    });

    it('uses GET validation even when HEAD is rejected', async () => {
        const methods: string[] = [];
        const fetcher: Fetcher = async (_input, init) => {
            methods.push(init?.method ?? 'GET');
            return init?.method === 'HEAD'
                ? new Response(null, { status: 405 })
                : new Response('<rss><channel><item><pubDate>2026-08-26T00:00:00Z</pubDate></item></channel></rss>', { status: 200 });
        };
        const result = await checkFeed(feed, { fetcher, resolveHost: publicResolver });
        expect(methods).toEqual(['HEAD', 'GET']);
        expect(result).toMatchObject({ reachable: true, contentValid: true, format: 'rss' });
    });

    it('isolates item pubDate from channel lastBuildDate in RSS feeds', () => {
        const xml = `
            <rss version="2.0">
                <channel>
                    <title>Test Outlet</title>
                    <lastBuildDate>2026-10-19T12:00:00Z</lastBuildDate>
                    <item>
                        <title>Article 1</title>
                        <pubDate>2026-08-01T00:00:00Z</pubDate>
                    </item>
                </channel>
            </rss>
        `;
        const content = parseFeedContent(xml);
        expect(content?.format).toBe('rss');
        expect(content?.lastItemDate).toBe('2026-08-01T00:00:00.000Z');
    });

    it('isolates entry published date from feed-level updated date in Atom feeds', () => {
        const xml = `
            <feed xmlns="http://www.w3.org/2005/Atom">
                <title>Test Feed</title>
                <updated>2026-10-19T12:00:00Z</updated>
                <entry>
                    <title>Story</title>
                    <published>2026-09-01T10:00:00Z</published>
                </entry>
            </feed>
        `;
        const content = parseFeedContent(xml);
        expect(content?.format).toBe('atom');
        expect(content?.lastItemDate).toBe('2026-09-01T10:00:00.000Z');
    });
});

describe('charset detection and decoding', () => {
    it('strips UTF-8 BOM correctly', () => {
        const utf8Bytes = new Uint8Array([0xEF, 0xBB, 0xBF, 0x48, 0x65, 0x6C, 0x6C, 0x6F]); // BOM + 'Hello'
        expect(decodeFeedBytes(utf8Bytes)).toBe('Hello');
    });

    it('decodes ISO-8859-1 correctly via Content-Type header', () => {
        // 'café' in ISO-8859-1: 0x63, 0x61, 0x66, 0xE9
        const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xE9]);
        const decoded = decodeFeedBytes(bytes, 'application/xml; charset=ISO-8859-1');
        expect(decoded).toBe('café');
    });

    it('sniffs encoding from XML prolog when header charset is absent', () => {
        // Replace 'é' UTF-8 (2 bytes) with single byte 0xE9 in buffer
        const isoBytes = new Uint8Array([
            ...new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?><channel><item>caf'),
            0xE9,
            ...new TextEncoder().encode('</item></channel>'),
        ]);
        const decoded = decodeFeedBytes(isoBytes, 'text/xml');
        expect(decoded).toContain('café');
    });

    it('falls back to UTF-8 on unrecognized charset label', () => {
        const bytes = new TextEncoder().encode('<rss><channel>hello</channel></rss>');
        const decoded = decodeFeedBytes(bytes, 'application/xml; charset=non-existent-charset-12345');
        expect(decoded).toContain('hello');
    });
});

describe('bounded stream reader', () => {
    it('aborts when payload exceeds maxBytes', async () => {
        const largeStream = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(1024 * 1024)); // 1MB
                controller.enqueue(new Uint8Array(1024 * 1024)); // +1MB
                controller.close();
            },
        });
        const response = new Response(largeStream);
        await expect(readBoundedBytes(response, 1024 * 512)).rejects.toThrow('Feed response exceeds maximum size');
    });

    it('reads bounded byte payload successfully', async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('feed data chunk 1 '));
                controller.enqueue(new TextEncoder().encode('feed data chunk 2'));
                controller.close();
            },
        });
        const response = new Response(stream);
        const bytes = await readBoundedBytes(response, 1024 * 1024);
        expect(new TextDecoder().decode(bytes)).toBe('feed data chunk 1 feed data chunk 2');
    });
});

describe('public redirect safety', () => {
    it.each(['http://127.0.0.1/feed', 'http://localhost/feed', 'http://10.0.0.1/feed', 'file:///tmp/feed'])('rejects %s', (url) => {
        expect(isPublicHttpUrl(url)).toBe(false);
    });

    it('fails safely when a redirect targets loopback without fetching it', async () => {
        const requestedUrls: string[] = [];
        const fetcher: Fetcher = async (input) => {
            requestedUrls.push(String(input));
            return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
        };
        const result = await checkFeed(feed, { fetcher, resolveHost: publicResolver });
        expect(result.failureStatus).toBe('unreachable');
        expect(requestedUrls).toEqual([feed.url, feed.url]);
    });
});

describe('fail-closed health history overlay', () => {
    it('fails closed when prior overlay file cannot be read and allowEmptyPrior is false', async () => {
        await expect(readExistingOverlay('non-existent-overlay-path.json', false)).rejects.toThrow('Fail-closed abort');
    });

    it('permits empty prior initialization when allowEmptyPrior is true', async () => {
        const overlay = await readExistingOverlay('non-existent-overlay-path.json', true);
        expect(overlay.size).toBe(0);
    });

    it('preserves failure history across weekly checks and resets on success', () => {
        vi.useFakeTimers({ now: new Date('2026-08-26T12:00:00.000Z') });
        try {
            let prior = undefined;
            for (let week = 1; week <= 4; week += 1) {
                prior = mergeHealthEntry(feed.id, {
                    status: 503,
                    reachable: false,
                    contentValid: false,
                    failureStatus: 'unreachable',
                }, `2026-08-${String(week).padStart(2, '0')}T00:00:00.000Z`, prior);
            }
            expect(prior).toMatchObject({
                consecutiveFailures: 4,
                lastSuccessAt: null,
                lastFailureAt: '2026-08-04T00:00:00.000Z',
                healthStatus: 'unreachable',
                defaultSuggestion: false,
            });

            const recovered = mergeHealthEntry(feed.id, {
                status: 200,
                reachable: true,
                contentValid: true,
                format: 'rss',
                lastItemDate: '2026-08-26T00:00:00.000Z',
            }, '2026-08-05T00:00:00.000Z', prior);
            expect(recovered).toMatchObject({
                consecutiveFailures: 0,
                lastSuccessAt: '2026-08-05T00:00:00.000Z',
                lastFailureAt: '2026-08-04T00:00:00.000Z',
                healthStatus: 'fresh',
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps stale content separate from dead links', () => {
        const result = mergeHealthEntry(feed.id, {
            status: 200,
            reachable: true,
            contentValid: true,
            format: 'rss',
        }, '2026-08-26T00:00:00.000Z');
        expect(result.healthStatus).toBe('stale-content');
        expect(result.active).toBe(true);
    });
});
