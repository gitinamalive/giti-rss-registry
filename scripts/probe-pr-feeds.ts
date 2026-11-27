/**
 * PR-time live probe for added or modified feeds in data/feeds.json.
 *
 * Compares the current data/feeds.json against a git base ref (default: origin/main)
 * and runs checkFeed() on every new or URL-modified entry so broken feeds (like 404s
 * or HTML landing pages) are caught before merge.
 *
 * Usage:
 *   tsx scripts/probe-pr-feeds.ts [--base=origin/main] [--file=data/feeds.json]
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { BootstrapPayload, FeedEntry } from '../src/types.ts';
import { deriveDiagnosticCategory } from '../src/health.ts';
import { checkFeed, type CheckFeedOptions, type HealthResult } from './health-check.ts';

const execFileAsync = promisify(execFile);

export function diffAddedOrChangedFeeds(baseFeeds: FeedEntry[], headFeeds: FeedEntry[]): FeedEntry[] {
    const baseUrlById = new Map(baseFeeds.map((f) => [f.id, f.url]));
    return headFeeds.filter((feed) => {
        const priorUrl = baseUrlById.get(feed.id);
        return priorUrl === undefined || priorUrl !== feed.url;
    });
}

export interface PrProbeReportItem {
    feed: FeedEntry;
    result: HealthResult;
    outcome: 'pass' | 'warn_blocked' | 'fail';
}

export async function probeChangedFeeds(
    changedFeeds: FeedEntry[],
    options: CheckFeedOptions = {},
): Promise<PrProbeReportItem[]> {
    const items: PrProbeReportItem[] = [];
    for (const feed of changedFeeds) {
        const result = await checkFeed(feed, { retries: 1, ...options });
        if (result.reachable && result.contentValid) {
            items.push({ feed, result, outcome: 'pass' });
            continue;
        }
        const category = deriveDiagnosticCategory({
            reachable: result.reachable,
            contentValid: result.contentValid,
            status: result.status,
            lastItemDate: result.lastItemDate,
            permanentRedirectUrl: result.capabilities?.permanentRedirectUrl,
            failureStatus: result.failureStatus,
        });
        items.push({
            feed,
            result,
            outcome: category === 'BLOCKED_SCRAPER' ? 'warn_blocked' : 'fail',
        });
    }
    return items;
}

async function readBaseFeeds(baseRef: string, relFile: string): Promise<FeedEntry[]> {
    try {
        const { stdout } = await execFileAsync('git', ['show', `${baseRef}:${relFile}`], {
            maxBuffer: 20 * 1024 * 1024,
        });
        const payload = JSON.parse(stdout) as BootstrapPayload;
        return payload.feeds ?? [];
    } catch {
        return [];
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const baseArg = args.find((a) => a.startsWith('--base='));
    const fileArg = args.find((a) => a.startsWith('--file='));
    const baseRef = baseArg ? baseArg.slice('--base='.length) : 'origin/main';
    const relFile = fileArg ? fileArg.slice('--file='.length) : 'data/feeds.json';

    const [baseFeeds, headPayload] = await Promise.all([
        readBaseFeeds(baseRef, relFile),
        readFile(resolve(relFile), 'utf8').then((raw) => JSON.parse(raw) as BootstrapPayload),
    ]);

    const changed = diffAddedOrChangedFeeds(baseFeeds, headPayload.feeds);
    if (changed.length === 0) {
        process.stdout.write(`No added or URL-modified feeds compared to ${baseRef}.\n`);
        return;
    }

    process.stdout.write(`Probing ${changed.length} added/modified feed(s) against ${baseRef}...\n`);
    const report = await probeChangedFeeds(changed);

    let failures = 0;
    for (const item of report) {
        if (item.outcome === 'pass') {
            process.stdout.write(`  PASS  ${item.feed.name} (${item.feed.id}) -> ${item.result.format}\n`);
        } else if (item.outcome === 'warn_blocked') {
            process.stdout.write(`  WARN  ${item.feed.name} (${item.feed.id}) -> HTTP ${item.result.status} (bot challenge, verify manually)\n`);
        } else {
            failures += 1;
            process.stderr.write(
                `  FAIL  ${item.feed.name} (${item.feed.id}) -> ${item.result.failureStatus ?? 'unreachable'} (${item.result.status})\n`
            );
        }
    }

    if (failures > 0) {
        process.stderr.write(`\nPR feed probe failed: ${failures} added/modified feed(s) did not pass reachability & format validation.\n`);
        process.exitCode = 1;
    }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch((error: unknown) => {
        console.error('[probe-pr-feeds] Failed:', error);
        process.exitCode = 1;
    });
}
