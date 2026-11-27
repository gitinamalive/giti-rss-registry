import { describe, expect, it } from 'vitest';
import { diffAddedOrChangedFeeds, probeChangedFeeds } from '../scripts/probe-pr-feeds.ts';
import type { FeedEntry } from '../src/types.ts';
import type { Fetcher } from '../scripts/health-check.ts';

const baseFeed: FeedEntry = {
    id: 'existing-news-11111111',
    name: 'Existing News',
    publisher: 'Existing News',
    url: 'https://existing.example/rss.xml',
    language: 'en',
    countries: ['US'],
    category: 'world',
};

const publicResolver = async (): Promise<string[]> => ['93.184.216.34'];

describe('diffAddedOrChangedFeeds', () => {
    it('returns newly added feeds and feeds whose URL changed, ignoring unchanged or metadata-only edits', () => {
        const added: FeedEntry = { ...baseFeed, id: 'new-feed-22222222', name: 'New Feed', url: 'https://new.example/rss.xml' };
        const urlChanged: FeedEntry = { ...baseFeed, id: 'changed-33333333', url: 'https://changed.example/v2.xml' };
        const baseChanged: FeedEntry = { ...urlChanged, url: 'https://changed.example/v1.xml' };
        const metadataOnly: FeedEntry = { ...baseFeed, description: 'Updated description only' };

        const diff = diffAddedOrChangedFeeds([baseFeed, baseChanged], [metadataOnly, added, urlChanged]);
        expect(diff.map((f) => f.id)).toEqual(['new-feed-22222222', 'changed-33333333']);
    });
});

describe('probeChangedFeeds', () => {
    it('classifies valid RSS as pass, 403 as warn_blocked, and HTML/404 as fail', async () => {
        const validFeed: FeedEntry = { ...baseFeed, id: 'ok-1', url: 'https://ok.example/feed' };
        const blockedFeed: FeedEntry = { ...baseFeed, id: 'cf-2', url: 'https://cf.example/feed' };
        const htmlFeed: FeedEntry = { ...baseFeed, id: 'html-3', url: 'https://html.example/feed' };

        const fetcher: Fetcher = async (input) => {
            const url = String(input);
            if (url.includes('ok.example')) {
                return new Response('<rss><channel><item><pubDate>2026-11-25T00:00:00Z</pubDate></item></channel></rss>', { status: 200 });
            }
            if (url.includes('cf.example')) {
                return new Response('Forbidden', { status: 403 });
            }
            return new Response('<html><body>not a feed</body></html>', { status: 200 });
        };

        const report = await probeChangedFeeds([validFeed, blockedFeed, htmlFeed], {
            fetcher,
            resolveHost: publicResolver,
            retries: 0,
        });

        expect(report.map((r) => r.outcome)).toEqual(['pass', 'warn_blocked', 'fail']);
    });
});
