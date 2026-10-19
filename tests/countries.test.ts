import { describe, it, expect } from 'vitest';
import {
    ISO_3166_1_ALPHA2_COUNTRIES,
    isDomesticFeed,
    buildCountryCoverageMatrix,
} from '../src/countries.ts';
import type { FeedEntry } from '../src/types.ts';

function createMockFeed(overrides: Partial<FeedEntry> = {}): FeedEntry {
    return {
        id: 'mock-feed-1',
        name: 'Mock News',
        publisher: 'Mock Pub',
        url: 'https://example.com/rss',
        language: 'en',
        countries: ['US'],
        category: 'world',
        ...overrides,
    };
}

describe('ISO_3166_1_ALPHA2_COUNTRIES', () => {
    it('contains exactly 206 countries', () => {
        expect(Object.keys(ISO_3166_1_ALPHA2_COUNTRIES)).toHaveLength(206);
    });

    it('maps known ISO codes to English names correctly', () => {
        expect(ISO_3166_1_ALPHA2_COUNTRIES['US']).toBe('United States');
        expect(ISO_3166_1_ALPHA2_COUNTRIES['GB']).toBe('United Kingdom');
        expect(ISO_3166_1_ALPHA2_COUNTRIES['FR']).toBe('France');
        expect(ISO_3166_1_ALPHA2_COUNTRIES['JP']).toBe('Japan');
        expect(ISO_3166_1_ALPHA2_COUNTRIES['ZA']).toBe('South Africa');
    });
});

describe('isDomesticFeed', () => {
    it('returns true when a feed has a single target country matching the query', () => {
        const feed = createMockFeed({ countries: ['FR'] });
        expect(isDomesticFeed(feed, 'FR')).toBe(true);
        expect(isDomesticFeed(feed, 'DE')).toBe(false);
    });

    it('returns false for multi-country regional feeds without explicit publisherCountries', () => {
        const regionalFeed = createMockFeed({ countries: ['FR', 'DE', 'IT'] });
        expect(isDomesticFeed(regionalFeed, 'FR')).toBe(false);
        expect(isDomesticFeed(regionalFeed, 'DE')).toBe(false);
    });

    it('honors publisherCountries when specified', () => {
        const feed = createMockFeed({
            countries: ['FR', 'DE', 'IT', 'ES'],
            publisherCountries: ['FR'],
        });
        expect(isDomesticFeed(feed, 'FR')).toBe(true);
        expect(isDomesticFeed(feed, 'DE')).toBe(false);
    });
});

describe('buildCountryCoverageMatrix', () => {
    it('builds a 206-country matrix with correct tiers', () => {
        const feeds: FeedEntry[] = [
            createMockFeed({ id: 'f1', name: 'US News 1', countries: ['US'] }),
            createMockFeed({ id: 'f2', name: 'US News 2', countries: ['US'] }),
            createMockFeed({ id: 'f3', name: 'UK News', countries: ['GB'] }),
            createMockFeed({ id: 'f4', name: 'Regional Africa', countries: ['DZ', 'AO', 'BJ'] }),
        ];

        const matrix = buildCountryCoverageMatrix(feeds);
        expect(matrix).toHaveLength(206);

        const usEntry = matrix.find((e) => e.code === 'US');
        expect(usEntry?.tier).toBe('domestic-multi');
        expect(usEntry?.domesticFeeds).toHaveLength(2);
        expect(usEntry?.regionalFeeds).toHaveLength(0);

        const gbEntry = matrix.find((e) => e.code === 'GB');
        expect(gbEntry?.tier).toBe('domestic-single');
        expect(gbEntry?.domesticFeeds).toHaveLength(1);

        const dzEntry = matrix.find((e) => e.code === 'DZ');
        expect(dzEntry?.tier).toBe('regional-only');
        expect(dzEntry?.domesticFeeds).toHaveLength(0);
        expect(dzEntry?.regionalFeeds).toHaveLength(1);

        const uncovEntry = matrix.find((e) => e.code === 'CA');
        expect(uncovEntry?.tier).toBe('uncovered');
        expect(uncovEntry?.totalFeeds).toBe(0);
    });
});
