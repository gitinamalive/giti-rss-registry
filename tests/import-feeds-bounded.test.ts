import { describe, expect, it } from 'vitest';
import {
    evaluateCandidate,
    processBoundedBatch,
    type ProposedFeedCandidate,
} from '../scripts/import-feeds-bounded.ts';
import type { FeedEntry } from '../src/types.ts';
import type { Fetcher } from '../scripts/health-check.ts';

const existingFeed: FeedEntry = {
    id: 'existing-press-12345678',
    name: 'Existing Press',
    publisher: 'Existing Press',
    url: 'https://example.com/existing-feed.xml',
    language: 'en',
    countries: ['US'],
    category: 'world',
};

const validCandidate: ProposedFeedCandidate = {
    name: 'Tuvalu News',
    publisher: 'Tuvalu Broadcasting',
    url: 'https://tuvalu.example/feed.xml',
    language: 'en',
    countries: ['TV'],
    category: 'world',
    sourceAttribution: 'Curated by Tuvalu Media Project',
    license: 'CC-BY-4.0',
};

const publicResolver = async (): Promise<string[]> => ['93.184.216.34'];

describe('evaluateCandidate', () => {
    const fixedNow = new Date('2026-08-26T12:00:00.000Z');

    it('rejects candidate missing mandatory sourceAttribution', async () => {
        const candidate = { ...validCandidate, sourceAttribution: undefined };
        const result = await evaluateCandidate(candidate, [existingFeed]);
        expect(result.accepted).toBe(false);
        expect(result.reason).toContain('Missing mandatory sourceAttribution');
    });

    it('rejects candidate missing mandatory license', async () => {
        const candidate = { ...validCandidate, license: '' };
        const result = await evaluateCandidate(candidate, [existingFeed]);
        expect(result.accepted).toBe(false);
        expect(result.reason).toContain('Missing mandatory license tracking');
    });

    it('rejects candidate when target-countries filter is specified and does not match', async () => {
        const result = await evaluateCandidate(validCandidate, [existingFeed], {
            targetCountries: ['NR', 'KI'], // Nauru, Kiribati (not Tuvalu TV)
        });
        expect(result.accepted).toBe(false);
        expect(result.reason).toContain('Does not match target countries');
    });

    it('rejects candidate colliding with existing URL', async () => {
        const candidate = {
            ...validCandidate,
            url: existingFeed.url,
        };
        const result = await evaluateCandidate(candidate, [existingFeed]);
        expect(result.accepted).toBe(false);
        expect(result.reason).toContain('Exact URL duplicate');
    });

    it('rejects candidate when live probe fails reachability', async () => {
        const fetcher: Fetcher = async () => new Response('Server Error', { status: 500 });
        const result = await evaluateCandidate(validCandidate, [existingFeed], {
            probeOptions: { fetcher, resolveHost: publicResolver },
        });
        expect(result.accepted).toBe(false);
        expect(result.reason).toContain('Feed probe failed');
    });

    it('rejects candidate when content is too stale', async () => {
        // Latest item is 60 days old (cutoff is 30 days)
        const fetcher: Fetcher = async () => new Response('<rss><channel><item><pubDate>2026-06-01T00:00:00Z</pubDate></item></channel></rss>', {
            status: 200,
            headers: { 'content-type': 'application/rss+xml' },
        });
        const result = await evaluateCandidate(validCandidate, [existingFeed], {
            probeOptions: { fetcher, resolveHost: publicResolver },
            now: fixedNow,
        });
        expect(result.accepted).toBe(false);
        expect(result.reason).toContain('Feed content is too stale');
    });

    it('accepts compliant candidate with valid items, provenance, and license', async () => {
        const fetcher: Fetcher = async () => new Response('<rss><channel><item><pubDate>2026-08-25T00:00:00Z</pubDate></item></channel></rss>', {
            status: 200,
            headers: { 'content-type': 'application/rss+xml' },
        });
        const result = await evaluateCandidate(validCandidate, [existingFeed], {
            probeOptions: { fetcher, resolveHost: publicResolver },
            now: fixedNow,
        });
        expect(result.accepted).toBe(true);
        expect(result.feed).toMatchObject({
            name: 'Tuvalu News',
            countries: ['TV'],
            sourceAttribution: 'Curated by Tuvalu Media Project',
            license: 'CC-BY-4.0',
            active: true,
            format: 'rss',
        });
    });
});

describe('processBoundedBatch', () => {
    const fixedNow = new Date('2026-08-26T12:00:00.000Z');
    const validXml = '<rss><channel><item><pubDate>2026-08-25T00:00:00Z</pubDate></item></channel></rss>';

    it('enforces batch limit and stops adding feeds when cap is reached', async () => {
        const fetcher: Fetcher = async () => new Response(validXml, { status: 200 });

        const candidates: ProposedFeedCandidate[] = [
            { ...validCandidate, name: 'Candidate 1', url: 'https://c1.example/feed.xml' },
            { ...validCandidate, name: 'Candidate 2', url: 'https://c2.example/feed.xml' },
            { ...validCandidate, name: 'Candidate 3', url: 'https://c3.example/feed.xml' },
        ];

        const { acceptedFeeds, evaluations } = await processBoundedBatch(candidates, [existingFeed], {
            maxBatch: 2,
            probeOptions: { fetcher, resolveHost: publicResolver },
            now: fixedNow,
        });

        expect(acceptedFeeds).toHaveLength(2);
        expect(evaluations).toHaveLength(3);
        expect(evaluations[2].accepted).toBe(false);
        expect(evaluations[2].reason).toContain('Batch limit reached');
    });

    it('deduplicates intra-batch candidates targeting the same URL', async () => {
        const fetcher: Fetcher = async () => new Response(validXml, { status: 200 });

        const candidates: ProposedFeedCandidate[] = [
            { ...validCandidate, name: 'Candidate 1', url: 'https://same.example/feed.xml' },
            { ...validCandidate, name: 'Candidate 2 Duplicate', publisher: 'Different Publisher', url: 'https://same.example/feed.xml/' }, // Trailing slash duplicate
        ];

        const { acceptedFeeds, evaluations } = await processBoundedBatch(candidates, [existingFeed], {
            maxBatch: 10,
            probeOptions: { fetcher, resolveHost: publicResolver },
            now: fixedNow,
        });

        expect(acceptedFeeds).toHaveLength(1);
        expect(evaluations[1].accepted).toBe(false);
        expect(evaluations[1].reason).toContain('Normalized URL collision');
    });

    it('prioritizes target countries when specified', async () => {
        const fetcher: Fetcher = async () => new Response(validXml, { status: 200 });

        const nonTargetCandidate: ProposedFeedCandidate = {
            ...validCandidate,
            name: 'Non Target US Outlet',
            countries: ['US'],
            url: 'https://us.example/feed.xml',
        };
        const targetCandidate: ProposedFeedCandidate = {
            ...validCandidate,
            name: 'Target Nauru Outlet',
            countries: ['NR'],
            url: 'https://nr.example/feed.xml',
        };

        // Pass non-target first in input, but target-countries='NR'
        const { acceptedFeeds } = await processBoundedBatch([nonTargetCandidate, targetCandidate], [existingFeed], {
            maxBatch: 1, // Only 1 can be accepted
            targetCountries: ['NR'],
            probeOptions: { fetcher, resolveHost: publicResolver },
            now: fixedNow,
        });

        expect(acceptedFeeds).toHaveLength(1);
        expect(acceptedFeeds[0].name).toBe('Target Nauru Outlet');
    });
});
