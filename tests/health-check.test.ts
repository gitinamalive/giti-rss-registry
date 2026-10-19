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
import { deriveQuarantineStatus } from '../src/health.ts';
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
        expect(result.failureReason).toBe('stale_content');
    });
});

describe('quarantine policy and capability telemetry', () => {
    it('derives correct quarantine status across failure counts', () => {
        expect(deriveQuarantineStatus(0)).toBe('active');
        expect(deriveQuarantineStatus(1)).toBe('degraded');
        expect(deriveQuarantineStatus(2)).toBe('degraded');
        expect(deriveQuarantineStatus(3)).toBe('degraded');
        expect(deriveQuarantineStatus(4)).toBe('quarantined');
        expect(deriveQuarantineStatus(10)).toBe('quarantined');
    });

    it('categorizes HTTP 4xx and 5xx failure reasons', async () => {
        const fetch404: Fetcher = async () => new Response('Not Found', { status: 404 });
        const res404 = await checkFeed(feed, { fetcher: fetch404, resolveHost: publicResolver });
        expect(res404.reachable).toBe(false);
        expect(res404.failureReason).toBe('http_4xx');

        const fetch503: Fetcher = async () => new Response('Unavailable', { status: 503 });
        const res503 = await checkFeed(feed, { fetcher: fetch503, resolveHost: publicResolver });
        expect(res503.reachable).toBe(false);
        expect(res503.failureReason).toBe('http_5xx');
    });

    it('categorizes timeout failure reasons', async () => {
        const timeoutFetcher: Fetcher = async () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
        };
        const resTimeout = await checkFeed(feed, { fetcher: timeoutFetcher, resolveHost: publicResolver });
        expect(resTimeout.reachable).toBe(false);
        expect(resTimeout.failureReason).toBe('timeout');
    });

    it('categorizes SSRF block as ssrf_blocked', async () => {
        const localFeed = { ...feed, url: 'http://127.0.0.1/feed.xml' };
        const res = await checkFeed(localFeed, { resolveHost: publicResolver });
        expect(res.reachable).toBe(false);
        expect(res.failureReason).toBe('ssrf_blocked');
    });

    it('detects permanent redirect URL on 301/308 and distinguishes from 302', async () => {
        // Permanent 301 redirect
        const fetcher301: Fetcher = async (input, init) => {
            if (init?.method === 'HEAD') return new Response(null, { status: 405 });
            if (String(input) === feed.url) {
                return new Response(null, { status: 301, headers: { location: 'https://example.com/new-feed.xml' } });
            }
            return new Response('<rss><channel><item><pubDate>2026-08-26T00:00:00Z</pubDate></item></channel></rss>', {
                status: 200,
            });
        };

        const result301 = await checkFeed(feed, { fetcher: fetcher301, resolveHost: publicResolver });
        expect(result301.reachable).toBe(true);
        expect(result301.capabilities?.permanentRedirectUrl).toBe('https://example.com/new-feed.xml');
        expect(result301.capabilities?.supportsHttps).toBe(true);

        // Temporary 302 redirect
        const fetcher302: Fetcher = async (input, init) => {
            if (init?.method === 'HEAD') return new Response(null, { status: 405 });
            if (String(input) === feed.url) {
                return new Response(null, { status: 302, headers: { location: 'https://example.com/temp-feed.xml' } });
            }
            return new Response('<rss><channel><item><pubDate>2026-08-26T00:00:00Z</pubDate></item></channel></rss>', {
                status: 200,
            });
        };

        const result302 = await checkFeed(feed, { fetcher: fetcher302, resolveHost: publicResolver });
        expect(result302.reachable).toBe(true);
        expect(result302.capabilities?.permanentRedirectUrl).toBeNull();
    });

    it('merges entry with quarantineStatus and capabilities', () => {
        const degraded = mergeHealthEntry(feed.id, {
            status: 500,
            reachable: false,
            contentValid: false,
            failureReason: 'http_5xx',
        }, '2026-08-01T00:00:00Z');
        expect(degraded.quarantineStatus).toBe('degraded');
        expect(degraded.consecutiveFailures).toBe(1);
        expect(degraded.failureReason).toBe('http_5xx');

        const quarantined = mergeHealthEntry(feed.id, {
            status: 500,
            reachable: false,
            contentValid: false,
            failureReason: 'http_5xx',
        }, '2026-08-04T00:00:00Z', {
            ...degraded,
            consecutiveFailures: 3,
        });
        expect(quarantined.quarantineStatus).toBe('quarantined');
        expect(quarantined.defaultSuggestion).toBe(false);

        const recovered = mergeHealthEntry(feed.id, {
            status: 200,
            reachable: true,
            contentValid: true,
            lastItemDate: '2026-08-20T00:00:00Z',
        }, '2026-08-05T00:00:00Z', quarantined);
        expect(recovered.quarantineStatus).toBe('active');
        expect(recovered.defaultSuggestion).toBe(true);
        expect(recovered.failureReason).toBeNull();
    });
});
