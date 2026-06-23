import { describe, it, expect } from 'vitest';

// Import actual functions from the validate script
import {
    findDuplicates,
    isValidUrl,
    isPublicHostname,
    isLanguageCode,
    isIsoCountryCode,
    isValidIsoCountryCode,
    isValidIsoTimestamp,
    urlNormalizationIssues,
    ISO_3166_ALPHA2,
} from '../scripts/validate.ts';

// ── findDuplicates ──────────────────────────────────────────────────────

describe('findDuplicates', () => {
    it('returns empty array when no duplicates exist', () => {
        expect(findDuplicates(['a', 'b', 'c'])).toEqual([]);
    });

    it('returns duplicate values exactly once each', () => {
        expect(findDuplicates(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b']);
    });

    it('returns empty for empty input', () => {
        expect(findDuplicates([])).toEqual([]);
    });

    it('returns empty for single-element array', () => {
        expect(findDuplicates(['only'])).toEqual([]);
    });

    it('handles numeric strings', () => {
        expect(findDuplicates(['1', '2', '2', '3', '3', '3'])).toEqual(['2', '3']);
    });
});

// ── isValidUrl ──────────────────────────────────────────────────────────

describe('isValidUrl', () => {
    it('accepts http URLs', () => {
        expect(isValidUrl('http://example.com/feed.xml')).toBe(true);
    });

    it('accepts https URLs', () => {
        expect(isValidUrl('https://example.com/feed.xml')).toBe(true);
    });

    it('rejects non-http protocols', () => {
        expect(isValidUrl('ftp://example.com/feed.xml')).toBe(false);
        expect(isValidUrl('file:///etc/passwd')).toBe(false);
        expect(isValidUrl('javascript:alert(1)')).toBe(false);
    });

    it('rejects invalid URL strings', () => {
        expect(isValidUrl('not a url')).toBe(false);
        expect(isValidUrl('')).toBe(false);
    });
});

// ── isPublicHostname ────────────────────────────────────────────────────

describe('isPublicHostname', () => {
    it('accepts public domains', () => {
        expect(isPublicHostname('https://feeds.npr.org/rss.xml')).toBe(true);
        expect(isPublicHostname('https://www.bbc.com/feed.rss')).toBe(true);
    });

    it('rejects localhost', () => {
        expect(isPublicHostname('http://localhost:3000/feed')).toBe(false);
    });

    it('rejects private IPv4 addresses', () => {
        expect(isPublicHostname('http://127.0.0.1/feed')).toBe(false);
        expect(isPublicHostname('http://10.0.0.1/feed')).toBe(false);
        expect(isPublicHostname('http://192.168.1.1/feed')).toBe(false);
        expect(isPublicHostname('http://172.16.0.1/feed')).toBe(false);
        expect(isPublicHostname('http://169.254.1.1/feed')).toBe(false);
    });

    it('rejects URLs with credentials', () => {
        expect(isPublicHostname('https://user:pass@example.com/feed')).toBe(false);
    });

    it('rejects IPv6 loopback', () => {
        expect(isPublicHostname('http://[::1]/feed')).toBe(false);
        expect(isPublicHostname('http://::1/feed')).toBe(false);
    });

    it('rejects invalid URLs gracefully', () => {
        expect(isPublicHostname('not a url')).toBe(false);
    });
});

// ── isLanguageCode ──────────────────────────────────────────────────────

describe('isLanguageCode', () => {
    it('accepts two-letter codes', () => {
        expect(isLanguageCode('en')).toBe(true);
        expect(isLanguageCode('ar')).toBe(true);
        expect(isLanguageCode('zh')).toBe(true);
    });

    it('accepts three-letter codes', () => {
        expect(isLanguageCode('eng')).toBe(true);
        expect(isLanguageCode('zho')).toBe(true);
    });

    it('accepts codes with region subtags', () => {
        expect(isLanguageCode('zh-Hans')).toBe(true);
        expect(isLanguageCode('en-GB')).toBe(true);
        expect(isLanguageCode('pt-BR')).toBe(true);
    });

    it('rejects invalid codes', () => {
        expect(isLanguageCode('')).toBe(false);
        expect(isLanguageCode('e')).toBe(false);
        expect(isLanguageCode('ENGLISH')).toBe(false); // too long
    });
});

// ── isIsoCountryCode (format check only) ────────────────────────────────

describe('isIsoCountryCode', () => {
    it('accepts two uppercase letters', () => {
        expect(isIsoCountryCode('US')).toBe(true);
        expect(isIsoCountryCode('GB')).toBe(true);
        expect(isIsoCountryCode('JP')).toBe(true);
    });

    it('rejects lowercase', () => {
        expect(isIsoCountryCode('us')).toBe(false);
    });

    it('rejects wrong length', () => {
        expect(isIsoCountryCode('USA')).toBe(false);
        expect(isIsoCountryCode('U')).toBe(false);
    });

    it('rejects empty string', () => {
        expect(isIsoCountryCode('')).toBe(false);
    });

    it('rejects non-alpha', () => {
        expect(isIsoCountryCode('12')).toBe(false);
        expect(isIsoCountryCode('U$')).toBe(false);
    });
});

// ── isValidIsoCountryCode (set membership check) ────────────────────────

describe('isValidIsoCountryCode', () => {
    it('accepts all real ISO 3166-1 alpha-2 codes', () => {
        expect(isValidIsoCountryCode('US')).toBe(true);
        expect(isValidIsoCountryCode('GB')).toBe(true);
        expect(isValidIsoCountryCode('DE')).toBe(true);
        expect(isValidIsoCountryCode('FR')).toBe(true);
        expect(isValidIsoCountryCode('CN')).toBe(true);
        expect(isValidIsoCountryCode('JP')).toBe(true);
        expect(isValidIsoCountryCode('BR')).toBe(true);
        expect(isValidIsoCountryCode('ZA')).toBe(true);
    });

    it('accepts Kosovo (XK) — widely used user-assigned code', () => {
        expect(isValidIsoCountryCode('XK')).toBe(true);
    });

    it('rejects fake codes', () => {
        expect(isValidIsoCountryCode('XX')).toBe(false);
        expect(isValidIsoCountryCode('ZZ')).toBe(false);
        expect(isValidIsoCountryCode('??')).toBe(false);
    });

    it('ISO set contains exactly 249 official codes', () => {
        expect(ISO_3166_ALPHA2.size).toBe(249);
    });

    it('ISO set contains well-known codes', () => {
        expect(ISO_3166_ALPHA2.has('US')).toBe(true);
        expect(ISO_3166_ALPHA2.has('GB')).toBe(true);
        expect(ISO_3166_ALPHA2.has('RU')).toBe(true);
        expect(ISO_3166_ALPHA2.has('IN')).toBe(true);
    });
});

// ── isValidIsoTimestamp ─────────────────────────────────────────────────

describe('isValidIsoTimestamp', () => {
    it('accepts canonical ISO-8601 timestamps', () => {
        expect(isValidIsoTimestamp('2024-01-15T08:30:00.000Z')).toBe(true);
        expect(isValidIsoTimestamp('2026-06-23T00:00:00.000Z')).toBe(true);
    });

    it('rejects non-canonical format', () => {
        expect(isValidIsoTimestamp('2024-01-15')).toBe(false); // date only
        expect(isValidIsoTimestamp('2024-01-15T08:30:00Z')).toBe(false); // no ms
        expect(isValidIsoTimestamp('2024-01-15T08:30:00.000+00:00')).toBe(false); // offset, not Z
    });

    it('rejects invalid dates', () => {
        expect(isValidIsoTimestamp('2024-13-01T00:00:00.000Z')).toBe(false); // month 13
        expect(isValidIsoTimestamp('2024-02-30T00:00:00.000Z')).toBe(false); // Feb 30
    });

    it('rejects empty string', () => {
        expect(isValidIsoTimestamp('')).toBe(false);
    });

    it('rejects non-date strings', () => {
        expect(isValidIsoTimestamp('not a date')).toBe(false);
        expect(isValidIsoTimestamp('yesterday')).toBe(false);
    });
});

// ── urlNormalizationIssues ──────────────────────────────────────────────

describe('urlNormalizationIssues', () => {
    it('flags trailing slash on non-root paths', () => {
        const issues = urlNormalizationIssues('https://example.com/rss/');
        expect(issues.length).toBeGreaterThan(0);
        expect(issues.some(i => i.includes('trailing slash'))).toBe(true);
    });

    it('does not flag trailing slash on root path', () => {
        const issues = urlNormalizationIssues('https://example.com/');
        expect(issues.filter(i => i.includes('trailing slash')).length).toBe(0);
    });

    it('flags URL fragments', () => {
        const issues = urlNormalizationIssues('https://example.com/rss#section');
        expect(issues.some(i => i.includes('fragment'))).toBe(true);
    });

    it('returns empty for clean URLs', () => {
        expect(urlNormalizationIssues('https://example.com/rss')).toEqual([]);
    });

    it('returns empty for invalid URLs', () => {
        expect(urlNormalizationIssues('not a url')).toEqual([]);
    });

    it('flags both trailing slash and fragment when both present', () => {
        const issues = urlNormalizationIssues('https://example.com/rss/#top');
        expect(issues.length).toBe(2);
    });
});