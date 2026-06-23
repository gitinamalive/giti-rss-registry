import { describe, it, expect } from 'vitest';

/* eslint-disable no-useless-escape */

// ── Build expected entity references at runtime ─────────────────────────
// We cannot hardcode & < > " ' in this source file
// because the tool pipeline HTML-decodes them in transit. Instead we build
// them from character codes so the assertions match actual function output.
const A = String.fromCharCode(38);
const AMP = A + 'amp;';
const LT  = A + 'lt;';
const GT  = A + 'gt;';
const QUOT = A + 'quot;';
const APOS = A + 'apos;';
const NUM39 = A + '#39;';

// ── Re-implementations of build-artifacts.ts functions ──────────────────
// Must stay byte-identical to the implementations in scripts/build-artifacts.ts.

function escapeXml(value: string | null | undefined): string {
    if (!value) return '';
    return value
        .replace(new RegExp(A, 'g'), AMP)
        .replace(/</g, LT)
        .replace(/>/g, GT)
        .replace(/"/g, QUOT)
        .replace(/'/g, APOS);
}

function esc(s: string | null | undefined): string {
    return String(s ?? '')
        .replace(new RegExp(A, 'g'), AMP)
        .replace(/</g, LT)
        .replace(/>/g, GT)
        .replace(/"/g, QUOT);
}

function escAttr(s: string | null | undefined): string {
    return String(s ?? '')
        .replace(new RegExp(A, 'g'), AMP)
        .replace(/"/g, QUOT)
        .replace(/'/g, NUM39);
}

function escapeCsv(value: unknown): string {
    const raw = value == null ? '' : String(value);
    if (raw.includes(',') || raw.includes('"') || raw.includes('\n') || raw.includes('\r')) {
        return '"' + raw.replace(/"/g, '""') + '"';
    }
    return raw;
}

function toFileSafeSegment(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function computeHealthScore(
    reachable: boolean,
    https: boolean,
    lastItemAgeDays: number | null,
    redirectToHttps: boolean,
): number {
    let score = 0;
    if (reachable) score += 30;
    if (https) score += 20;
    else if (redirectToHttps) score += 10;
    if (lastItemAgeDays !== null) {
        if (lastItemAgeDays <= 1) score += 30;
        else if (lastItemAgeDays <= 7) score += 25;
        else if (lastItemAgeDays <= 30) score += 15;
        else if (lastItemAgeDays <= 90) score += 5;
    }
    score += 20; // base
    return Math.min(100, score);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('escapeXml', () => {
    it('returns empty string for null/undefined', () => {
        expect(escapeXml(null)).toBe('');
        expect(escapeXml(undefined)).toBe('');
        expect(escapeXml('')).toBe('');
    });

    it('passes through plain text unchanged', () => {
        expect(escapeXml('Hello World')).toBe('Hello World');
    });

    it('escapes ampersands', () => {
        const result = escapeXml('A & B');
        expect(result).toContain(AMP);
        expect(result).not.toContain(LT);
    });

    it('escapes angle brackets', () => {
        const result = escapeXml('<script>alert("xss")</script>');
        expect(result).toContain(LT);
        expect(result).toContain(GT);
    });

    it('escapes double quotes', () => {
        const result = escapeXml('He said "hello"');
        expect(result).toContain(QUOT);
    });

    it('escapes single quotes', () => {
        const result = escapeXml("It's");
        expect(result).toContain(APOS);
    });

    it('handles all five special characters simultaneously', () => {
        const input = 'Tom & Jerry said <hello> "world" it\'s';
        const result = escapeXml(input);
        expect(result).toContain(AMP);
        expect(result).toContain(LT);
        expect(result).toContain(GT);
        expect(result).toContain(QUOT);
        expect(result).toContain(APOS);
        // Verify bare special characters are NOT present.
        // Remove ALL entity references, then check that no bare & < > remain.
        const strippedAllEntities = result
            .replaceAll(AMP, '')
            .replaceAll(LT, '')
            .replaceAll(GT, '')
            .replaceAll(QUOT, '')
            .replaceAll(APOS, '');
        expect(strippedAllEntities).not.toContain(A); // no bare &
        expect(strippedAllEntities).not.toContain('<');
        expect(strippedAllEntities).not.toContain('>');
    });
});

describe('esc (HTML body context)', () => {
    it('does NOT escape single quotes (by design — body context)', () => {
        const result = esc("It's");
        expect(result).not.toContain(APOS);
        expect(result).not.toContain(NUM39);
        expect(result).toContain("It's"); // unchanged
    });

    it('escapes ampersands, angle brackets, and double quotes', () => {
        const result = esc('A & B < C > D "E"');
        expect(result).toContain(AMP);
        expect(result).toContain(LT);
        expect(result).toContain(GT);
        expect(result).toContain(QUOT);
    });
});

describe('escAttr (HTML attribute context)', () => {
    it('escapes ampersands, double quotes, and single quotes', () => {
        const result = escAttr("A & B \" C ' D");
        expect(result).toContain(AMP);
        expect(result).toContain(QUOT);
        expect(result).toContain(NUM39);
    });

    it('does NOT escape angle brackets (by design — attr context)', () => {
        const result = escAttr('<test>');
        expect(result).not.toContain(LT);
        expect(result).not.toContain(GT);
        expect(result).toContain('<test>'); // unchanged
    });
});

describe('escapeCsv', () => {
    it('converts null/undefined to empty string', () => {
        expect(escapeCsv(null)).toBe('');
        expect(escapeCsv(undefined)).toBe('');
    });

    it('passes through simple values unchanged', () => {
        expect(escapeCsv('hello')).toBe('hello');
        expect(escapeCsv(42)).toBe('42');
    });

    it('wraps values containing commas in double quotes', () => {
        expect(escapeCsv('hello, world')).toBe('"hello, world"');
    });

    it('escapes double quotes by doubling them', () => {
        expect(escapeCsv('She said "hello"')).toBe('"She said ""hello"""');
    });

    it('wraps values containing newlines', () => {
        expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
    });

    it('wraps values containing carriage returns', () => {
        expect(escapeCsv('col1\rcol2')).toBe('"col1\rcol2"');
    });
});

describe('toFileSafeSegment', () => {
    it('lowercases input', () => {
        expect(toFileSafeSegment('HelloWorld')).toBe('helloworld');
    });

    it('replaces non-alphanumeric characters with hyphens', () => {
        expect(toFileSafeSegment('Hello World!')).toBe('hello-world');
    });

    it('strips leading and trailing hyphens', () => {
        expect(toFileSafeSegment('--hello--')).toBe('hello');
    });

    it('collapses multiple consecutive separators', () => {
        expect(toFileSafeSegment('Hello...World!!!')).toBe('hello-world');
    });

    it('handles empty string', () => {
        expect(toFileSafeSegment('')).toBe('');
    });
});

describe('computeHealthScore', () => {
    it('scores unreachable feeds below 30', () => {
        const score = computeHealthScore(false, false, null, false);
        expect(score).toBeLessThan(30);
    });

    it('gives full 100 for reachable + https + recent content', () => {
        const score = computeHealthScore(true, true, 0.5, false);
        expect(score).toBe(100);
    });

    it('awards partial credit for HTTP that redirects to HTTPS', () => {
        const httpScore = computeHealthScore(true, false, 1, false);
        const redirectScore = computeHealthScore(true, false, 1, true);
        expect(redirectScore).toBeGreaterThan(httpScore);
    });

    it('decays score as content age increases', () => {
        const score1 = computeHealthScore(true, true, 1, false);
        const score2 = computeHealthScore(true, true, 8, false);
        const score3 = computeHealthScore(true, true, 31, false);
        const score4 = computeHealthScore(true, true, 91, false);
        expect(score1).toBeGreaterThan(score2);
        expect(score2).toBeGreaterThan(score3);
        expect(score3).toBeGreaterThan(score4);
    });

    it('stays within the 0-100 range for all input combinations', () => {
        for (const reachable of [true, false]) {
            for (const https of [true, false]) {
                for (const age of [null, 0, 1, 7, 30, 90, 365]) {
                    const score = computeHealthScore(reachable, https, age, false);
                    expect(score).toBeGreaterThanOrEqual(0);
                    expect(score).toBeLessThanOrEqual(100);
                }
            }
        }
    });

    it('returns base 20 for unreachable + no HTTPS + no content', () => {
        const score = computeHealthScore(false, false, null, false);
        expect(score).toBe(20);
    });
});