import { describe, expect, it, vi } from 'vitest';
import {
    checkFeed,
    isPublicHttpUrl,
    mergeHealthEntry,
    parseFeedContent,
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

describe('health history overlay', () => {
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
