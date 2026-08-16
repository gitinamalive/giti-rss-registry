/**
 * health-check.ts
 *
 * Automated feed health-checker. Performs HEAD requests (with GET fallback) on
 * URLs in data/feeds.json, records reachability and last-item date, computes a
 * 0–100 healthScore, and derives a `healthStatus` per feed.
 *
 * Output: dist/feeds-health.json — an EPHEMERAL OVERLAY keyed by stable feed id
 * ({ id, healthStatus, healthScore, lastCheckedAt, lastItemPublishedAt, active }).
 * It never replaces the source data and never copies full feed entries.
 *
 * Exit code:
 *   - infrastructure/parser/write errors → 1
 *   - individual unreachable feeds → warnings only (exit 0)
 *
 * Usage: npx tsx scripts/health-check.ts [--max-feeds N]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BootstrapPayload, FeedEntry } from '../src/types.ts';
import { computeHealthScore, deriveHealthStatus } from '../src/health.ts';

const HTTP_TIMEOUT_MS = 10_000;
const CONCURRENCY = 8;
const DEFAULT_MAX_FEEDS = Infinity;

interface HealthResult {
    status: number | string;
    reachable: boolean;
    lastItemDate?: string;
}

// ── HTTP Helpers ─────────────────────────────────────────────────

async function fetchHead(
    url: string,
    timeoutMs: number = HTTP_TIMEOUT_MS
): Promise<{ status: number; url: string; headers: Headers }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'manual',
            headers: {
                'User-Agent': 'giti-rss-registry-health-check/1.0 (+https://github.com/gitinamalive/giti)',
            },
        });
        return { status: response.status, url: response.url, headers: response.headers };
    } finally {
        clearTimeout(timer);
    }
}

async function fetchFeedBody(
    url: string,
    timeoutMs: number = HTTP_TIMEOUT_MS
): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': 'giti-rss-registry-health-check/1.0 (+https://github.com/gitinamalive/giti)',
            },
        });
        if (!response.ok) return null;
        return await response.text();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// ── Feed Parsing ─────────────────────────────────────────────────

function extractLastItemDate(xmlText: string): string | undefined {
    // Try RSS <pubDate>
    const pubDateMatch = xmlText.match(/<pubDate>([^<]*)<\/pubDate>/i);
    if (pubDateMatch) {
        const parsed = new Date(pubDateMatch[1]);
        if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }

    // Try Atom <updated>
    const updatedMatch = xmlText.match(/<updated>([^<]*)<\/updated>/i);
    if (updatedMatch) {
        const parsed = new Date(updatedMatch[1]);
        if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }

    // Try lastBuildDate
    const lastBuildMatch = xmlText.match(/<lastBuildDate>([^<]*)<\/lastBuildDate>/i);
    if (lastBuildMatch) {
        const parsed = new Date(lastBuildMatch[1]);
        if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }

    return undefined;
}

// ── HTTP→HTTPS Upgrade ────────────────────────────────────────────

function tryHttpsUpgrade(url: string): string | null {
    if (!url.startsWith('http://')) return null;
    return url.replace(/^http:\/\//, 'https://');
}

// ── Bounded Concurrency ────────────────────────────────────────────

async function runConcurrently<T>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            await worker(items[index], index);
        }
    });
    await Promise.all(runners);
}

async function checkFeed(feed: FeedEntry): Promise<{ result: HealthResult; upgrade: string | null }> {
    const result: HealthResult = { status: 0, reachable: false };
    let urlToCheck = feed.url;
    let upgrade: string | null = null;

    const httpsCandidate = tryHttpsUpgrade(feed.url);
    if (httpsCandidate) {
        try {
            const upgradeResp = await fetchHead(httpsCandidate);
            if (upgradeResp.status < 400) {
                urlToCheck = httpsCandidate;
                upgrade = httpsCandidate;
            }
        } catch {
            // Keep the original http:// URL.
        }
    }

    try {
        const headResp = await fetchHead(urlToCheck);
        result.status = headResp.status;

        // Some servers reject HEAD — fall back to GET.
        if (headResp.status === 405 || headResp.status === 403) {
            const body = await fetchFeedBody(urlToCheck);
            if (body) {
                result.reachable = true;
                result.status = 200;
                result.lastItemDate = extractLastItemDate(body);
            }
        } else if (headResp.status >= 200 && headResp.status < 400) {
            result.reachable = true;
        }

        if (result.reachable && result.lastItemDate === undefined) {
            const body = await fetchFeedBody(urlToCheck);
            if (body) {
                result.lastItemDate = extractLastItemDate(body);
            }
        }
    } catch (err: unknown) {
        result.status = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'error';
    }

    return { result, upgrade };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const maxFeedsIdx = args.indexOf('--max-feeds');
    const maxFeeds = maxFeedsIdx !== -1 && args[maxFeedsIdx + 1]
        ? parseInt(args[maxFeedsIdx + 1], 10)
        : DEFAULT_MAX_FEEDS;

    const feedsPath = resolve('data/feeds.json');
    const distPath = resolve('dist');
    await mkdir(distPath, { recursive: true });

    const raw = await readFile(feedsPath, 'utf8');
    const payload = JSON.parse(raw) as BootstrapPayload;
    const feedsToCheck = payload.feeds.slice(0, maxFeeds);
    const checkedAt = new Date().toISOString();

    const results: (HealthResult | null)[] = new Array(feedsToCheck.length).fill(null);
    const httpUpgrades: Array<{ from: string; to: string }> = [];
    let checkedCount = 0;

    const workerCount = Math.min(CONCURRENCY, Math.max(1, feedsToCheck.length));
    process.stdout.write(`Health-checking ${feedsToCheck.length} feeds (concurrency ${workerCount})...\n`);

    await runConcurrently(feedsToCheck, workerCount, async (feed, index) => {
        const { result, upgrade } = await checkFeed(feed);
        results[index] = result;
        if (upgrade) httpUpgrades.push({ from: feed.url, to: upgrade });
        checkedCount++;
        const progress = `[${checkedCount}/${feedsToCheck.length}]`;
        process.stdout.write(
            result.reachable
                ? `${progress} ${feed.name}: OK (${result.status}, score=${computeHealthScore(true, result.lastItemDate)})\n`
                : `${progress} ${feed.name}: FAIL (${result.status})\n`
        );
    });

    const stats = {
        checked: checkedCount,
        reachable: results.filter((r) => r?.reachable).length,
        unreachable: results.filter((r) => r && !r.reachable).length,
        httpUpgrades: httpUpgrades.length,
    };

    // Ephemeral overlay keyed by stable feed id — never a full feed copy.
    const feeds = payload.feeds.map((feed, index) => {
        const result = index < results.length ? results[index] : null;
        if (!result) {
            return {
                id: feed.id,
                healthStatus: 'unchecked',
                healthScore: null,
                lastCheckedAt: null,
                lastItemPublishedAt: null,
                active: false,
            };
        }
        const reachable = result.reachable;
        const lastCheckedAt = checkedAt;
        const lastItemPublishedAt = result.lastItemDate ?? null;
        return {
            id: feed.id,
            healthStatus: deriveHealthStatus({
                active: reachable,
                lastCheckedAt,
                lastItemPublishedAt: lastItemPublishedAt ?? undefined,
            }),
            healthScore: reachable ? computeHealthScore(true, result.lastItemDate) : 0,
            lastCheckedAt,
            lastItemPublishedAt,
            active: reachable,
        };
    });

    const overlay = {
        generatedAt: payload.generatedAt,
        checkedAt,
        type: 'health-overlay' as const,
        feeds,
        stats,
    };

    const outPath = resolve(distPath, 'feeds-health.json');
    await writeFile(outPath, JSON.stringify(overlay, null, 2) + '\n', 'utf8');

    process.stdout.write(`\n─── Health Check Summary ───\n`);
    process.stdout.write(`Checked: ${stats.checked}\n`);
    process.stdout.write(`Reachable: ${stats.reachable}\n`);
    process.stdout.write(`Unreachable: ${stats.unreachable}\n`);
    process.stdout.write(`HTTP→HTTPS upgrades: ${stats.httpUpgrades}\n`);
    process.stdout.write(`Output (overlay): ${outPath}\n`);

    if (httpUpgrades.length > 0) {
        process.stdout.write(`\nUpgraded URLs:\n`);
        for (const upgrade of httpUpgrades) {
            process.stdout.write(`  ${upgrade.from} → ${upgrade.to}\n`);
        }
    }
    // Individual unreachable feeds are warnings only — exit stays 0.
}

main().catch((error: unknown) => {
    console.error('[health-check] Failed:', error);
    process.exitCode = 1;
});
