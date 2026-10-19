import { describe, expect, it } from 'vitest';
import {
    applyRedirectProposals,
    findRedirectProposals,
    validateRedirectTarget,
    type RedirectProposal,
} from '../scripts/propose-redirect-updates.ts';
import type { FeedEntry } from '../src/types.ts';
import type { FeedHealthEntry } from '../src/health.ts';
import type { Fetcher } from '../scripts/health-check.ts';

const dummyFeed1: FeedEntry = {
    id: 'sample-news-11111111',
    name: 'Sample News',
    publisher: 'Sample Publisher',
    url: 'http://example.com/old-feed.xml',
    language: 'en',
    countries: ['US'],
    category: 'world',
};

const dummyFeed2: FeedEntry = {
    id: 'existing-outlet-22222222',
    name: 'Existing Outlet',
    publisher: 'Existing Outlet',
    url: 'https://example.com/existing.xml',
    language: 'en',
    countries: ['GB'],
    category: 'world',
};

const publicResolver = async (): Promise<string[]> => ['93.184.216.34'];

describe('validateRedirectTarget', () => {
    it('approves a valid reachable feed target', async () => {
        const fetcher: Fetcher = async () => new Response('<rss><channel><item><pubDate>2026-08-26T00:00:00Z</pubDate></item></channel></rss>', {
            status: 200,
            headers: { 'content-type': 'application/rss+xml' },
        });

        const result = await validateRedirectTarget('https://example.com/new-feed.xml', new Set(), {
            fetcher,
            resolveHost: publicResolver,
        });

        expect(result.valid).toBe(true);
        expect(result.status).toBe('valid');
        expect(result.format).toBe('rss');
        expect(result.lastItemDate).toBe('2026-08-26T00:00:00.000Z');
    });

    it('rejects target when it collides with an existing registry URL', async () => {
        const existing = new Set(['https://example.com/existing.xml']);
        const result = await validateRedirectTarget('https://example.com/existing.xml', existing, {
            resolveHost: publicResolver,
        });

        expect(result.valid).toBe(false);
        expect(result.status).toBe('duplicate_url');
        expect(result.reason).toContain('collides with an existing registry feed URL');
    });

    it('rejects target when URL violates SSRF boundaries', async () => {
        const result = await validateRedirectTarget('http://127.0.0.1/private-feed.xml', new Set(), {
            resolveHost: publicResolver,
        });

        expect(result.valid).toBe(false);
        expect(result.status).toBe('ssrf_blocked');
        expect(result.reason).toContain('failed SSRF check');
    });

    it('rejects target when HTTP status is not ok', async () => {
        const fetcher: Fetcher = async () => new Response('Not Found', { status: 404 });
        const result = await validateRedirectTarget('https://example.com/not-found.xml', new Set(), {
            fetcher,
            resolveHost: publicResolver,
        });

        expect(result.valid).toBe(false);
        expect(result.status).toBe('unreachable');
        expect(result.reason).toContain('returned HTTP 404');
    });

    it('rejects target when content is not valid feed format', async () => {
        const fetcher: Fetcher = async () => new Response('<html><body>Invalid HTML</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        });

        const result = await validateRedirectTarget('https://example.com/not-a-feed', new Set(), {
            fetcher,
            resolveHost: publicResolver,
        });

        expect(result.valid).toBe(false);
        expect(result.status).toBe('invalid_content');
    });
});

describe('findRedirectProposals', () => {
    it('discovers feeds with permanent redirect capabilities and validates them', async () => {
        const fetcher: Fetcher = async () => new Response('<rss><channel><item><pubDate>2026-08-26T00:00:00Z</pubDate></item></channel></rss>', {
            status: 200,
        });

        const overlay: FeedHealthEntry[] = [
            {
                id: dummyFeed1.id,
                healthStatus: 'fresh',
                healthScore: 100,
                lastCheckedAt: '2026-10-19T12:00:00Z',
                lastItemPublishedAt: '2026-08-26T00:00:00Z',
                active: true,
                consecutiveFailures: 0,
                lastSuccessAt: '2026-10-19T12:00:00Z',
                lastFailureAt: null,
                defaultSuggestion: true,
                capabilities: {
                    supportsHttps: true,
                    permanentRedirectUrl: 'https://example.com/new-feed.xml',
                },
            },
            {
                id: dummyFeed2.id,
                healthStatus: 'fresh',
                healthScore: 100,
                lastCheckedAt: '2026-10-19T12:00:00Z',
                lastItemPublishedAt: '2026-08-26T00:00:00Z',
                active: true,
                consecutiveFailures: 0,
                lastSuccessAt: '2026-10-19T12:00:00Z',
                lastFailureAt: null,
                defaultSuggestion: true,
                capabilities: {
                    supportsHttps: true,
                    permanentRedirectUrl: null, // No permanent redirect
                },
            },
        ];

        const proposals = await findRedirectProposals([dummyFeed1, dummyFeed2], overlay, {
            fetcher,
            resolveHost: publicResolver,
        });

        expect(proposals).toHaveLength(1);
        expect(proposals[0]).toMatchObject({
            feedId: dummyFeed1.id,
            feedName: dummyFeed1.name,
            currentUrl: dummyFeed1.url,
            proposedUrl: 'https://example.com/new-feed.xml',
            status: 'valid',
        });
    });

    it('skips proposals when permanentRedirectUrl is identical to current feed URL', async () => {
        const overlay: FeedHealthEntry[] = [
            {
                id: dummyFeed1.id,
                healthStatus: 'fresh',
                healthScore: 100,
                lastCheckedAt: '2026-10-19T12:00:00Z',
                lastItemPublishedAt: null,
                active: true,
                consecutiveFailures: 0,
                lastSuccessAt: null,
                lastFailureAt: null,
                defaultSuggestion: true,
                capabilities: {
                    supportsHttps: true,
                    permanentRedirectUrl: dummyFeed1.url, // Same as feed.url
                },
            },
        ];

        const proposals = await findRedirectProposals([dummyFeed1], overlay, {
            resolveHost: publicResolver,
        });

        expect(proposals).toHaveLength(0);
    });
});

describe('applyRedirectProposals', () => {
    it('applies valid proposals to feeds and ignores invalid ones', () => {
        const proposals: RedirectProposal[] = [
            {
                feedId: dummyFeed1.id,
                feedName: dummyFeed1.name,
                currentUrl: dummyFeed1.url,
                proposedUrl: 'https://example.com/new-feed.xml',
                status: 'valid',
            },
            {
                feedId: dummyFeed2.id,
                feedName: dummyFeed2.name,
                currentUrl: dummyFeed2.url,
                proposedUrl: 'https://example.com/blocked.xml',
                status: 'ssrf_blocked',
            },
        ];

        const { updatedFeeds, appliedCount } = applyRedirectProposals([dummyFeed1, dummyFeed2], proposals);

        expect(appliedCount).toBe(1);
        expect(updatedFeeds[0].url).toBe('https://example.com/new-feed.xml');
        expect(updatedFeeds[1].url).toBe(dummyFeed2.url); // Unchanged
    });
});
