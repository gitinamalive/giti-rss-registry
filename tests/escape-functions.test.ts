import { describe, it, expect } from 'vitest';
import {
    escapeCsv,
    escapeHtmlAttr,
    escapeHtmlText,
    escapeJsonForScript,
    escapeXml,
    escapeXmlAttr,
    toFileSafeSegment,
} from '../src/escape.ts';
import { computeHealthScore } from '../src/health.ts';

// ── Build expected entity references at runtime ─────────────────────────
// Hardcoding & < > " ' in this source file is avoided because the tool
// pipeline HTML-decodes them in transit. Build them from character codes so
// assertions match the actual function output.
const A = String.fromCharCode(38);
const AMP = A + 'amp;';
const LT = A + 'lt;';
const GT = A + 'gt;';
const QUOT = A + 'quot;';
const APOS = A + 'apos;';
const NUM39 = A + '#39;';

describe('escapeXml', () => {
    it('returns empty string for null/undefined/empty', () => {
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
        const strippedAllEntities = result
            .replaceAll(AMP, '')
            .replaceAll(LT, '')
            .replaceAll(GT, '')
            .replaceAll(QUOT, '')
            .replaceAll(APOS, '');
        expect(strippedAllEntities).not.toContain(A);
        expect(strippedAllEntities).not.toContain('<');
        expect(strippedAllEntities).not.toContain('>');
    });
});

describe('escapeXmlAttr', () => {
    it('escapes the same entity set as escapeXml', () => {
        const input = 'a & b "c" <d> e\'f';
        expect(escapeXmlAttr(input)).toBe(escapeXml(input));
    });

    it('returns empty string for null/undefined', () => {
        expect(escapeXmlAttr(null)).toBe('');
        expect(escapeXmlAttr(undefined)).toBe('');
    });
});

describe('escapeHtmlText (HTML body context)', () => {
    it('does NOT escape single quotes (by design — body context)', () => {
        const result = escapeHtmlText("It's");
        expect(result).not.toContain(APOS);
        expect(result).not.toContain(NUM39);
        expect(result).toContain("It's"); // unchanged
    });

    it('escapes ampersands, angle brackets, and double quotes', () => {
        const result = escapeHtmlText('A & B < C > D "E"');
        expect(result).toContain(AMP);
        expect(result).toContain(LT);
        expect(result).toContain(GT);
        expect(result).toContain(QUOT);
    });
});

describe('escapeHtmlAttr (HTML attribute context)', () => {
    it('escapes ampersands, double quotes, and single quotes', () => {
        const result = escapeHtmlAttr('A & B " C \' D');
        expect(result).toContain(AMP);
        expect(result).toContain(QUOT);
        expect(result).toContain(NUM39);
    });

    it('does NOT escape angle brackets (by design — attr context)', () => {
        const result = escapeHtmlAttr('<test>');
        expect(result).not.toContain(LT);
        expect(result).not.toContain(GT);
        expect(result).toContain('<test>'); // unchanged
    });
});

describe('escapeJsonForScript', () => {
    it('produces output that round-trips through JSON.parse', () => {
        const value = { name: '</script><script>alert(1)</script>', n: 1, ok: true };
        expect(JSON.parse(escapeJsonForScript(value))).toEqual(value);
    });

    it('neutralizes </script and <script sequences (case-insensitive)', () => {
        const out = escapeJsonForScript({ name: '</ScRiPt><script>alert(1)</script>' });
        expect(out.toLowerCase()).not.toContain('</script');
        expect(out.toLowerCase()).not.toContain('<script');
        expect(out).toContain('\\u003c');
    });

    it('escapes ampersand and the Unicode line separators', () => {
        const out = escapeJsonForScript({ v: 'a & b \u2028 c \u2029 d' });
        expect(out).toContain('\\u0026');
        expect(out).toContain('\\u2028');
        expect(out).toContain('\\u2029');
    });

    it('serializes primitives like JSON.stringify', () => {
        expect(escapeJsonForScript(null)).toBe('null');
        expect(escapeJsonForScript(undefined)).toBe('null');
        expect(escapeJsonForScript([])).toBe('[]');
        expect(escapeJsonForScript(42)).toBe('42');
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

    it('does not apply formula safety by default', () => {
        expect(escapeCsv('=1+1')).toBe('=1+1');
        expect(escapeCsv('@SUM')).toBe('@SUM');
    });

    it('prefixes formula-triggering values when formulaSafe is enabled', () => {
        expect(escapeCsv('=1+1', { formulaSafe: true })).toBe("'=1+1");
        expect(escapeCsv('+cmd', { formulaSafe: true })).toBe("'+cmd");
        expect(escapeCsv('-42', { formulaSafe: true })).toBe("'-42");
        expect(escapeCsv('@SUM', { formulaSafe: true })).toBe("'@SUM");
        expect(escapeCsv('\tvalue', { formulaSafe: true })).toBe("'\tvalue");
        // CR is a formula trigger, but it also forces RFC-4180 quoting
        const cr = String.fromCharCode(13);
        expect(escapeCsv(cr + 'value', { formulaSafe: true })).toBe('"' + "'" + cr + 'value"');
    });

    it('leaves non-formula values untouched under formulaSafe', () => {
        expect(escapeCsv('hello', { formulaSafe: true })).toBe('hello');
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

    it('trims surrounding whitespace before slugging', () => {
        expect(toFileSafeSegment('  Hello World  ')).toBe('hello-world');
    });
});

describe('computeHealthScore', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    const iso = (daysAgo: number): string =>
        new Date(now.getTime() - daysAgo * 86400000).toISOString();

    it('scores unreachable feeds as 0', () => {
        expect(computeHealthScore(false, iso(1), now)).toBe(0);
        expect(computeHealthScore(false, undefined, now)).toBe(0);
    });

    it('scores reachable-but-unparseable feeds as 40', () => {
        expect(computeHealthScore(true, undefined, now)).toBe(40);
    });

    it('scores fresh content (<7 days) as 100', () => {
        expect(computeHealthScore(true, iso(1), now)).toBe(100);
    });

    it('scores stale content (7–30 days) as 70', () => {
        expect(computeHealthScore(true, iso(8), now)).toBe(70);
        expect(computeHealthScore(true, iso(29), now)).toBe(70);
    });

    it('scores very-stale content (>30 days) as 40', () => {
        expect(computeHealthScore(true, iso(31), now)).toBe(40);
        expect(computeHealthScore(true, iso(365), now)).toBe(40);
    });

    it('stays within the 0-100 range', () => {
        for (const reachable of [true, false]) {
            for (const daysAgo of [undefined, 0, 1, 7, 30, 90, 365]) {
                const score = computeHealthScore(
                    reachable,
                    daysAgo === undefined ? undefined : iso(daysAgo),
                    now,
                );
                expect(score).toBeGreaterThanOrEqual(0);
                expect(score).toBeLessThanOrEqual(100);
            }
        }
    });
});
