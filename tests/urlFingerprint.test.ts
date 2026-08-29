import { describe, expect, it } from 'vitest';
import { findPossibleDuplicateUrls, urlFingerprint } from '../src/urlFingerprint.ts';
import type { FeedEntry } from '../src/types.ts';

function feed(id: string, url: string): FeedEntry {
    return {
        id,
        name: id,
        publisher: 'Publisher',
        url,
        language: 'en',
        countries: ['US'],
        category: 'world',
    };
}

describe('urlFingerprint', () => {
    it('normalizes host casing, www aliases, default ports, fragments, trailing slash, and tracking parameters', () => {
        expect(urlFingerprint('HTTPS://WWW.Example.com:443/feed/?utm_source=newsletter&b=2#top'))
            .toBe('https://example.com/feed?b=2');
        expect(urlFingerprint('https://example.com/feed?b=2')).toBe('https://example.com/feed?b=2');
    });

    it('keeps alternate editions distinct', () => {
        expect(urlFingerprint('https://example.com/en/feed')).not.toBe(urlFingerprint('https://example.com/ar/feed'));
    });

    it('reports likely duplicates as findings rather than validation errors', () => {
        const findings = findPossibleDuplicateUrls([
            feed('one', 'https://www.example.com/feed/?utm_medium=email'),
            feed('two', 'https://example.com/feed'),
            feed('alternate', 'https://example.com/ar/feed'),
        ]);
        expect(findings).toEqual([{
            fingerprint: 'https://example.com/feed',
            feedIds: ['one', 'two'],
            urls: ['https://example.com/feed', 'https://www.example.com/feed/?utm_medium=email'],
        }]);
    });
});
