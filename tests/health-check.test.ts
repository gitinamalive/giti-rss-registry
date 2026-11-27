import { describe, expect, it, vi } from 'vitest';
import {
    assertPublicHttpUrl,
    checkFeed,
    decodeFeedBytes,
    isPublicHttpUrl,
    isPublicIp,
    mergeHealthEntry,
    parseFeedContent,
    readBoundedBytes,
    readExistingOverlay,
    shouldTripCircuitBreaker,
    type Fetcher,
} from '../scripts/health-check.ts';
import { deriveDiagnosticCategory, deriveQuarantineStatus } from '../src/health.ts';
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

    it('fetches feeds with a single GET request without wasting a HEAD probe', async () => {
        const methods: string[] = [];
        const fetcher: Fetcher = async (_input, init) => {
            methods.push(init?.method ?? 'GET');
            return new Response('<rss><channel><item><pubDate>2026-08-26T00:00:00Z</pubDate></item></channel></rss>', { status: 200 });
        };
        const result = await checkFeed(feed, { fetcher, resolveHost: publicResolver });
        expect(methods).toEqual(['GET']);
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

    it('throws on mid-body abort instead of returning truncated bytes', async () => {
        const controller = new AbortController();
        const stream = new ReadableStream<Uint8Array>({
            start(c) {
                c.enqueue(new TextEncoder().encode('<rss><channel>'));
            },
            pull() {
                controller.abort(new Error('Timeout'));
                return new Promise(() => {});
            },
        });
        const response = new Response(stream);
        await expect(readBoundedBytes(response, 1024 * 1024, controller.signal)).rejects.toThrow('aborted');
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
        expect(requestedUrls).toEqual([feed.url]);
    });

    it('accepts bracketed public IPv6 literals without DNS lookup', async () => {
        const resolveHost = vi.fn(async () => {
            throw new Error('resolveHost should not be called for IP literals');
        });
        const parsed = await assertPublicHttpUrl('https://[2606:4700::1111]/feed.xml', resolveHost);
        expect(parsed.hostname).toBe('[2606:4700::1111]');
        expect(resolveHost).not.toHaveBeenCalled();
    });

    it.each([
        '::1',
        '::',
        '::ffff:127.0.0.1',
        '::ffff:7f00:1',
        '0:0:0:0:0:ffff:7f00:1',
        '::ffff:a9fe:a9fe',
        '::ffff:10.0.0.1',
        '::ffff:0a00:0001',
        '64:ff9b::127.0.0.1',
        '2002:7f00:0001::1',
        'fc00::1',
        'fe80::1',
        'fe80::1%eth0',
        'ff02::1',
    ])('rejects non-public IPv6 address %s', (addr) => {
        expect(isPublicIp(addr, 6)).toBe(false);
    });

    it.each([
        '2606:4700::1111',
        '2001:4860:4860::8888',
        '::ffff:93.184.216.34',
        '::ffff:5db8:d822',
    ])('accepts public IPv6 address %s', (addr) => {
        expect(isPublicIp(addr, 6)).toBe(true);
    });

    it('rejects DNS answers returning hex IPv4-mapped loopback (::ffff:7f00:1)', async () => {
        await expect(
            assertPublicHttpUrl('https://rebind.example/feed', async () => ['::ffff:7f00:1'])
        ).rejects.toThrow('non-public host');
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

    it('retries once on transient 5xx when retries is enabled, but does not retry 4xx', async () => {
        let attempts503 = 0;
        const flaky503: Fetcher = async () => {
            attempts503 += 1;
            return attempts503 === 1
                ? new Response('Unavailable', { status: 503 })
                : new Response('<rss><channel><item><pubDate>2026-08-26T00:00:00Z</pubDate></item></channel></rss>', { status: 200 });
        };
        const recovered = await checkFeed(feed, {
            fetcher: flaky503,
            resolveHost: publicResolver,
            retries: 1,
            retryDelayMs: 0,
        });
        expect(attempts503).toBe(2);
        expect(recovered.reachable).toBe(true);

        let attempts404 = 0;
        const steady404: Fetcher = async () => {
            attempts404 += 1;
            return new Response('Not Found', { status: 404 });
        };
        const failed = await checkFeed(feed, {
            fetcher: steady404,
            resolveHost: publicResolver,
            retries: 1,
            retryDelayMs: 0,
        });
        expect(attempts404).toBe(1);
        expect(failed.reachable).toBe(false);
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
            lastItemDate: new Date().toISOString(),
        }, new Date().toISOString(), quarantined);
        expect(recovered.quarantineStatus).toBe('active');
        expect(recovered.defaultSuggestion).toBe(true);
        expect(recovered.failureReason).toBeNull();
        expect(recovered.diagnosticCategory).toBe('HEALTHY');
    });

    it('classifies all discrete lifecycle diagnostic categories', () => {
        const now = new Date('2026-11-01T00:00:00Z');

        // 1. HEALTHY: reachable, valid content, recent item
        expect(deriveDiagnosticCategory({
            reachable: true,
            contentValid: true,
            status: 200,
            lastItemDate: '2026-10-25T00:00:00Z',
            now,
        })).toBe('HEALTHY');

        // 2. STALE: reachable, valid content, but older than 30 days
        expect(deriveDiagnosticCategory({
            reachable: true,
            contentValid: true,
            status: 200,
            lastItemDate: '2026-09-01T00:00:00Z',
            now,
        })).toBe('STALE');

        // 3. REDIRECT_PERMANENT: observed 301/308 target
        expect(deriveDiagnosticCategory({
            reachable: true,
            contentValid: true,
            status: 200,
            permanentRedirectUrl: 'https://example.com/new-url',
            now,
        })).toBe('REDIRECT_PERMANENT');

        // 4. MALFORMED_XML: 200 OK but invalid content structure
        expect(deriveDiagnosticCategory({
            reachable: false,
            contentValid: false,
            status: 200,
            failureStatus: 'invalid-content',
            now,
        })).toBe('MALFORMED_XML');

        // 5. BLOCKED_SCRAPER: 403 or 429 challenge
        expect(deriveDiagnosticCategory({
            reachable: false,
            contentValid: false,
            status: 403,
            now,
        })).toBe('BLOCKED_SCRAPER');
        expect(deriveDiagnosticCategory({
            reachable: false,
            contentValid: false,
            status: 429,
            now,
        })).toBe('BLOCKED_SCRAPER');

        // 6. DEAD_ENDPOINT: 404 or 410 dead link
        expect(deriveDiagnosticCategory({
            reachable: false,
            contentValid: false,
            status: 404,
            now,
        })).toBe('DEAD_ENDPOINT');
        expect(deriveDiagnosticCategory({
            reachable: false,
            contentValid: false,
            status: 410,
            now,
        })).toBe('DEAD_ENDPOINT');

        // 7. UNREACHABLE: 5xx, timeout, or network error
        expect(deriveDiagnosticCategory({
            reachable: false,
            contentValid: false,
            status: 500,
            now,
        })).toBe('UNREACHABLE');
        expect(deriveDiagnosticCategory({
            reachable: false,
            contentValid: false,
            status: 'timeout',
            now,
        })).toBe('UNREACHABLE');

        // 8. Precedence: 301->404 and 301->HTML must NOT be masked as REDIRECT_PERMANENT
        expect(deriveDiagnosticCategory({
            reachable: false,
            contentValid: false,
            status: 404,
            permanentRedirectUrl: 'https://example.com/gone',
            now,
        })).toBe('DEAD_ENDPOINT');
        expect(deriveDiagnosticCategory({
            reachable: false,
            contentValid: false,
            status: 200,
            failureStatus: 'invalid-content',
            permanentRedirectUrl: 'https://example.com/html-page',
            now,
        })).toBe('MALFORMED_XML');
    });

    it('exempts BLOCKED_SCRAPER (403/429) from quarantine and keeps defaultSuggestion true', () => {
        let prior: ReturnType<typeof mergeHealthEntry> | undefined;
        for (let week = 1; week <= 6; week += 1) {
            prior = mergeHealthEntry(feed.id, {
                status: 403,
                reachable: false,
                contentValid: false,
                failureStatus: 'unreachable',
                failureReason: 'http_4xx',
            }, `2026-11-0${week}T00:00:00.000Z`, prior);
        }
        expect(prior?.diagnosticCategory).toBe('BLOCKED_SCRAPER');
        expect(prior?.consecutiveFailures).toBe(3);
        expect(prior?.quarantineStatus).toBe('degraded');
        expect(prior?.defaultSuggestion).toBe(true);
    });

    it('trips the outage circuit breaker on >25pp reachability drops, not on small runs or minor dips', () => {
        const priorMap = new Map(
            Array.from({ length: 40 }, (_, i) => [
                `feed-${i}`,
                mergeHealthEntry(`feed-${i}`, {
                    status: 200,
                    reachable: i < 32, // 80% reachable
                    contentValid: i < 32,
                }, '2026-11-01T00:00:00.000Z'),
            ]),
        );

        const outageResults = Array.from({ length: 40 }, (_, i) => ({
            status: i < 10 ? 200 : 'timeout',
            reachable: i < 10, // 25% reachable (-55pp)
            contentValid: i < 10,
        }));
        expect(shouldTripCircuitBreaker(priorMap, outageResults)).toBe(true);

        const normalResults = Array.from({ length: 40 }, (_, i) => ({
            status: i < 30 ? 200 : 503,
            reachable: i < 30, // 75% reachable (-5pp)
            contentValid: i < 30,
        }));
        expect(shouldTripCircuitBreaker(priorMap, normalResults)).toBe(false);

        // Partial --max-feeds run (<20) must not trip
        expect(shouldTripCircuitBreaker(priorMap, outageResults.slice(0, 5))).toBe(false);
    });
});
