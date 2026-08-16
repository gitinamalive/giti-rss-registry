import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildIndex, generateIndexHtml } from '../scripts/build-artifacts.ts';
import { escapeJsonForScript } from '../src/escape.ts';
import { generateFeedId, normalizeUrl } from '../src/id.ts';
import { validateFeedEntry } from '../scripts/validate.ts';
import type { BootstrapPayload } from '../src/types.ts';

const GENERATED_AT = '2026-07-31T05:16:00.000Z';
const ID_PATTERN = /^[a-z0-9-]+-[0-9a-f]{8}$/;
const FEEDS_PATH = fileURLToPath(new URL('../data/feeds.json', import.meta.url));

async function loadPayload(): Promise<BootstrapPayload> {
    return JSON.parse(await readFile(FEEDS_PATH, 'utf8')) as BootstrapPayload;
}

async function fileHash(): Promise<string> {
    return createHash('sha256').update(await readFile(FEEDS_PATH, 'utf8')).digest('hex');
}

describe('source data integrity', () => {
    it('matches the current registry contract (391 feeds / 15 categories / 204 countries / 153 descriptions / 8 official / 34 perspectives)', async () => {
        const { feeds } = await loadPayload();
        expect(feeds.length).toBe(391);
        expect(new Set(feeds.map((f) => f.category)).size).toBe(15);
        expect(new Set(feeds.flatMap((f) => f.countries)).size).toBe(204);
        expect(feeds.filter((f) => f.description).length).toBe(153);
        expect(feeds.filter((f) => f.official).length).toBe(8);
        expect(feeds.filter((f) => f.perspective).length).toBe(34);
    });

    it('declares stats/warnings that match the actual feeds array', async () => {
        const payload = await loadPayload();
        expect(payload.stats.feeds).toBe(payload.feeds.length);
        expect(new Set(payload.feeds.map((f) => f.id)).size).toBe(payload.feeds.length);
        expect(new Set(payload.feeds.map((f) => f.url)).size).toBe(payload.feeds.length);
        expect(payload.stats.duplicateIds).toBe(0);
        expect(payload.stats.duplicateUrls).toBe(0);
        expect(payload.warnings.duplicateIds).toEqual([]);
        expect(payload.warnings.duplicateUrls).toEqual([]);
    });

    it('uses opaque immutable IDs in the canonical format', async () => {
        const { feeds } = await loadPayload();
        for (const feed of feeds) {
            expect(feed.id, feed.id).toMatch(ID_PATTERN);
        }
    });

    it('has no normalized-URL duplicates', async () => {
        const { feeds } = await loadPayload();
        const normalized = feeds.map((f) => normalizeUrl(f.url));
        expect(new Set(normalized).size).toBe(normalized.length);
    });

    it('every feed passes the shared validator with zero errors', async () => {
        const { feeds } = await loadPayload();
        feeds.forEach((feed, i) => {
            const result = validateFeedEntry(feed, i);
            expect(result.errors, `feeds[${i}] ${feed.id}`).toEqual([]);
        });
    });
});

describe('lossless, deterministic build', () => {
    it('serializes the real dataset so it round-trips and cannot break the script tag', async () => {
        const payload = await loadPayload();
        const serialized = escapeJsonForScript(payload.feeds);
        expect(JSON.parse(serialized)).toEqual(payload.feeds);
        expect(serialized.toLowerCase()).not.toContain('</script');
    });

    it('generates exactly one script block from the real dataset', async () => {
        const { feeds } = await loadPayload();
        const html = generateIndexHtml(feeds, GENERATED_AT);
        expect(html.toLowerCase().split('<script').length - 1).toBe(1);
        expect(html.toLowerCase().split('</script').length - 1).toBe(1);
    });

    it('buildIndex output is identical regardless of input feed order', async () => {
        const { feeds } = await loadPayload();
        const shuffled = [...feeds].reverse();
        const a = buildIndex(feeds, (f) => [f.category]);
        const b = buildIndex(shuffled, (f) => [f.category]);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
});

describe('new-ID algorithm (src/id.ts)', () => {
    it('mints IDs in the historical format', () => {
        const id = generateFeedId('St. Lucia Times', 'https://example.com/rss.xml');
        expect(id).toMatch(ID_PATTERN);
        expect(id.startsWith('st-lucia-times-')).toBe(true);
    });

    it('is deterministic for equivalent normalized URLs', () => {
        expect(
            generateFeedId('Pub', 'https://Example.com/feed/')
        ).toBe(generateFeedId('Pub', 'https://example.com/feed#frag'));
    });

    it('normalizeUrl strips trailing slashes and fragments and lowercases the host', () => {
        expect(normalizeUrl('https://EXAMPLE.com/feed/')).toBe('https://example.com/feed');
        expect(normalizeUrl('https://example.com/feed#x')).toBe('https://example.com/feed');
    });
});

describe('importer failure contract', () => {
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

    const runImporter = (input: string) =>
        spawnSync(`${npx} tsx scripts/add-feeds-batch.ts`, {
            input,
            encoding: 'utf8',
            shell: true,
        });

    it('exits non-zero on malformed input and leaves feeds.json untouched', async () => {
        const before = await fileHash();
        const result = runImporter('{ definitely not json');
        expect(result.status).toBe(1);
        expect(await fileHash()).toBe(before);
    });

    it('a no-op import exits zero without rewriting feeds.json', async () => {
        const before = await fileHash();
        const result = runImporter('[]');
        expect(result.status).toBe(0);
        expect(await fileHash()).toBe(before);
    });
});
