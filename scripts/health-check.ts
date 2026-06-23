/**
 * health-check.ts
 *
 * Automated feed health-checker. Performs HEAD requests (with GET fallback) on
 * URL in data/feeds.json, records reachability, last-item date, and
 * computes a 0–100 healthScore. Warning-only — never blocks CI.
 *
 * Also attempts HTTP→HTTPS upgrade for any http:// URL where the https://
 * equivalent responds successfully.
 *
 * Output: dist/feeds-health.json (enriched feeds, does NOT overwrite source)
 * Exit code: 0 always (warnings only)
 *
 * Usage: npx tsx scripts/health-check.ts [--max-feeds N]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BootstrapPayload, FeedEntry } from '../src/types.ts';

const HTTP_TIMEOUT_MS = 10_000;
const INTER_REQUEST_DELAY_MS = 1_000;
const DEFAULT_MAX_FEEDS = Infinity;

interface HealthResult {
    status: number | string;
    redirectToHttps?: string;
    lastItemDate?: string;
    reachable: boolean;
    error?: string;
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

// ── Health Scoring ────────────────────────────────────────────────

function computeHealthScore(
    reachable: boolean,
    lastItemDate?: string,
    now: Date = new Date()
): number {
    if (!reachable) return 0;

    if (!lastItemDate) return 40; // reachable but no parseable items

    const itemAge = now.getTime() - new Date(lastItemDate).getTime();
    const daysSince = itemAge / (1000 * 60 * 60 * 24);

    if (daysSince < 7) return 100;  // active: items within 7 days
    if (daysSince < 30) return 70;  // stale: 7–30 days
    return 40;                        // very stale: >30 days
}

// ── HTTP→HTTPS Upgrade ────────────────────────────────────────────

function tryHttpsUpgrade(url: string): string | null {
    if (!url.startsWith('http://')) return null;
    return url.replace(/^http:\/\//, 'https://');
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
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

    const results: HealthResult[] = [];
    const httpUpgrades: Array<{ from: string; to: string }> = [];
    let checkedCount = 0;

    process.stdout.write(`Health-checking ${feedsToCheck.length} feeds...\n`);
    process.stdout.write(`(Rate-limited: ${INTER_REQUEST_DELAY_MS}ms between requests)\n\n`);

    for (const feed of feedsToCheck) {
        checkedCount++;
        const result: HealthResult = { status: 0, reachable: false };

        // Try HTTPS upgrade first for http:// URLs
        let urlToCheck = feed.url;
        const upgrade = tryHttpsUpgrade(feed.url);
        if (upgrade) {
            try {
                const upgradeResp = await fetchHead(upgrade);
                if (upgradeResp.status < 400) {
                    urlToCheck = upgrade;
                    httpUpgrades.push({ from: feed.url, to: upgrade });
                }
            } catch {
                // Keep http:// URL
            }
        }

        // Health check — try HEAD first, fall back to GET on 405/403
        try {
            let headResp = await fetchHead(urlToCheck);
            result.status = headResp.status;

            // Some servers reject HEAD — fall back to GET
            if (headResp.status === 405 || headResp.status === 403) {
                const body = await fetchFeedBody(urlToCheck);
                if (body) {
                    result.reachable = true;
                    result.status = 200; // GET succeeded
                }
            } else if (headResp.status >= 200 && headResp.status < 400) {
                result.reachable = true;
            }

            if (result.reachable) {
                // Record any redirect the HEAD followed
                if (headResp.url !== urlToCheck && headResp.url !== feed.url) {
                    result.redirectToHttps = headResp.url;
                }

                // Fetch body to extract last item date (if not already fetched via GET fallback)
                const body = await fetchFeedBody(urlToCheck);
                if (body) {
                    result.lastItemDate = extractLastItemDate(body);
                }
            }
        } catch (err: any) {
            result.status = err.name === 'AbortError' ? 'timeout' : 'error';
            result.error = err.message || String(err);
        }

        results.push(result);

        const progress = `[${checkedCount}/${feedsToCheck.length}]`;
        if (result.reachable) {
            process.stdout.write(
                `${progress} ${feed.name}: OK (${result.status}, score=${computeHealthScore(true, result.lastItemDate)})\n`
            );
        } else {
            process.stdout.write(
                `${progress} ${feed.name}: FAIL (${result.status})\n`
            );
        }

        // Rate limiting
        if (checkedCount < feedsToCheck.length) {
            await new Promise((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));
        }
    }

    // Enrich feeds
    const now = new Date();
    const enriched = payload.feeds.map((feed, i) => {
        const result = results[i];
        if (!result) return feed;

        const enrichedFeed: FeedEntry = { ...feed };

        if (result.reachable) {
            enrichedFeed.active = true;
            enrichedFeed.lastCheckedAt = checkedAt;
            enrichedFeed.healthScore = computeHealthScore(true, result.lastItemDate, now);
            if (result.lastItemDate && !feed.lastItemPublishedAt) {
                enrichedFeed.lastItemPublishedAt = result.lastItemDate;
            }

            // Apply HTTPS upgrade
            if (result.redirectToHttps) {
                enrichedFeed.url = result.redirectToHttps;
            }
        } else {
            enrichedFeed.active = false;
            enrichedFeed.lastCheckedAt = checkedAt;
            enrichedFeed.healthScore = 0;
        }

        return enrichedFeed;
    });

    // Apply HTTP→HTTPS upgrades from pre-check attempts
    for (const upgrade of httpUpgrades) {
        const feed = enriched.find((f) => f.url === upgrade.from);
        if (feed) feed.url = upgrade.to;
    }

    const healthPayload = {
        ...payload,
        generatedAt: checkedAt,
        stats: {
            feeds: enriched.length,
            duplicateIds: payload.stats.duplicateIds,
            duplicateUrls: payload.stats.duplicateUrls,
        },
        feeds: enriched,
        _healthCheck: {
            checkedAt,
            totalChecked: checkedCount,
            reachable: results.filter((r) => r.reachable).length,
            unreachable: results.filter((r) => !r.reachable).length,
            httpUpgrades: httpUpgrades.length,
        },
    };

    const outPath = resolve(distPath, 'feeds-health.json');
    await writeFile(outPath, JSON.stringify(healthPayload, null, 2) + '\n', 'utf8');

    // Summary
    const reachable = results.filter((r) => r.reachable).length;
    const unreachable = results.filter((r) => !r.reachable).length;
    const withLastItem = results.filter((r) => r.lastItemDate).length;

    process.stdout.write(`\n─── Health Check Summary ───\n`);
    process.stdout.write(`Checked: ${checkedCount}\n`);
    process.stdout.write(`Reachable: ${reachable}\n`);
    process.stdout.write(`Unreachable: ${unreachable}\n`);
    process.stdout.write(`With last-item date: ${withLastItem}\n`);
    process.stdout.write(`HTTP→HTTPS upgrades: ${httpUpgrades.length}\n`);
    process.stdout.write(`Output: ${outPath}\n`);

    if (httpUpgrades.length > 0) {
        process.stdout.write(`\nUpgraded URLs:\n`);
        for (const upgrade of httpUpgrades) {
            process.stdout.write(`  ${upgrade.from} → ${upgrade.to}\n`);
        }
    }
}

main().catch((error: unknown) => {
    console.error('[health-check] Failed:', error);
    process.exit(0); // Never block CI
});