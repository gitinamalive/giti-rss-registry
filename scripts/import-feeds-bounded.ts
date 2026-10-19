/**
 * Bounded Batch Importer with Provenance & License Tracking.
 *
 * Enforces:
 * 1. Bounded batch limit (--max=25, default 20) to prevent registry flooding.
 * 2. Country targeting & prioritization (--target-countries=CC,...) for underserved countries.
 * 3. Mandatory source provenance (sourceAttribution) and license tracking (license).
 * 4. Live SSRF-guarded probe with structural format validation and freshness requirements.
 * 5. Deduplication by ID, URL, and normalized URL.
 * 6. Atomic feeds.json updates.
 */

import { execFile } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { BootstrapPayload, FeedEntry } from '../src/types.ts';
import { generateFeedId, normalizeUrl } from '../src/id.ts';
import { validateFeedEntry } from './validate.ts';
import {
    checkFeed,
    type CheckFeedOptions,
    type HealthResult,
} from './health-check.ts';
import { STALE_THRESHOLD_DAYS } from '../src/health.ts';

const execFileAsync = promisify(execFile);

export const DEFAULT_MAX_BATCH = 20;
export const MAX_BATCH_LIMIT = 25;

export interface ProposedFeedCandidate extends Partial<FeedEntry> {
    sourceAttribution?: string;
    license?: string;
}

export interface ImportCandidateEvaluation {
    candidate: ProposedFeedCandidate;
    feed?: FeedEntry;
    accepted: boolean;
    reason?: string;
    probeResult?: HealthResult;
}

export interface BoundedImportOptions {
    maxBatch?: number;
    targetCountries?: string[];
    maxFreshnessDays?: number;
    probeOptions?: CheckFeedOptions;
    now?: Date;
}

export async function evaluateCandidate(
    candidate: ProposedFeedCandidate,
    existingFeeds: FeedEntry[],
    options: BoundedImportOptions = {},
): Promise<ImportCandidateEvaluation> {
    const name = candidate.name?.trim() ?? '';
    const publisher = candidate.publisher?.trim() ?? '';
    const url = candidate.url?.trim() ?? '';

    // 1. Mandatory provenance and license tracking
    if (!candidate.sourceAttribution || !candidate.sourceAttribution.trim()) {
        return { candidate, accepted: false, reason: 'Missing mandatory sourceAttribution (provenance tracking)' };
    }
    if (!candidate.license || !candidate.license.trim()) {
        return { candidate, accepted: false, reason: 'Missing mandatory license tracking' };
    }

    // 2. Country filter / validation
    const targetCountries = options.targetCountries?.map((c) => c.toUpperCase());
    if (targetCountries && targetCountries.length > 0) {
        const candidateCountries = (candidate.countries ?? []).map((c) => c.toUpperCase());
        const matches = candidateCountries.some((c) => targetCountries.includes(c));
        if (!matches) {
            return { candidate, accepted: false, reason: `Does not match target countries: ${targetCountries.join(', ')}` };
        }
    }

    // 3. Build prospective feed entry
    const feed: FeedEntry = {
        id: candidate.id || generateFeedId(publisher || name, url),
        name,
        publisher,
        url,
        language: candidate.language || 'en',
        countries: candidate.countries || [],
        category: candidate.category || 'world',
        mediaType: candidate.mediaType || 'digital',
        format: candidate.format || 'rss',
        sourceAttribution: candidate.sourceAttribution.trim(),
        license: candidate.license.trim(),
    };

    if (candidate.homepage) feed.homepage = candidate.homepage;
    if (candidate.description) feed.description = candidate.description;
    if (candidate.region) feed.region = candidate.region;
    if (candidate.coverageType) feed.coverageType = candidate.coverageType;
    if (candidate.tags && candidate.tags.length > 0) feed.tags = candidate.tags;
    if (candidate.perspective) feed.perspective = candidate.perspective;
    if (candidate.notes) feed.notes = candidate.notes;
    if (candidate.publisherCountries) feed.publisherCountries = candidate.publisherCountries;

    // 4. Schema validation
    const validation = validateFeedEntry(feed, 0);
    if (validation.errors.length > 0) {
        return { candidate, accepted: false, reason: `Schema validation failed: ${validation.errors.join('; ')}` };
    }

    // 5. Deduplication check against existing feeds
    const normUrl = normalizeUrl(url);
    for (const existing of existingFeeds) {
        if (existing.id === feed.id) {
            return { candidate, accepted: false, reason: `Feed ID collision: ${feed.id}` };
        }
        if (existing.url.toLowerCase() === url.toLowerCase()) {
            return { candidate, accepted: false, reason: `Exact URL duplicate: ${url}` };
        }
        if (normalizeUrl(existing.url) === normUrl) {
            return { candidate, accepted: false, reason: `Normalized URL collision: ${url}` };
        }
    }

    // 6. Live SSRF-guarded reachability & structural freshness probe
    const probe = await checkFeed(feed, options.probeOptions);
    if (!probe.reachable || !probe.contentValid) {
        return {
            candidate,
            accepted: false,
            reason: `Feed probe failed: ${probe.failureStatus ?? 'unreachable'} (${probe.status})`,
            probeResult: probe,
        };
    }

    // Update format if detected format differs
    if (probe.format) {
        feed.format = probe.format;
    }

    // 7. Freshness requirement
    const maxFreshnessDays = options.maxFreshnessDays ?? STALE_THRESHOLD_DAYS;
    if (!probe.lastItemDate) {
        return {
            candidate,
            accepted: false,
            reason: 'Feed has no parseable item publication dates (stale or empty content)',
            probeResult: probe,
        };
    }

    const now = options.now ?? new Date();
    const itemDate = new Date(probe.lastItemDate);
    const ageDays = (now.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > maxFreshnessDays) {
        return {
            candidate,
            accepted: false,
            reason: `Feed content is too stale: latest item is ${Math.round(ageDays)} days old (max allowed: ${maxFreshnessDays} days)`,
            probeResult: probe,
        };
    }

    feed.lastCheckedAt = now.toISOString();
    feed.lastItemPublishedAt = probe.lastItemDate;
    feed.active = true;

    return { candidate, feed, accepted: true, probeResult: probe };
}

export async function processBoundedBatch(
    candidates: ProposedFeedCandidate[],
    existingFeeds: FeedEntry[],
    options: BoundedImportOptions = {},
): Promise<{
    acceptedFeeds: FeedEntry[];
    evaluations: ImportCandidateEvaluation[];
}> {
    const rawMax = options.maxBatch ?? DEFAULT_MAX_BATCH;
    const maxBatch = Math.min(Math.max(1, rawMax), MAX_BATCH_LIMIT);

    const currentFeeds = [...existingFeeds];
    const acceptedFeeds: FeedEntry[] = [];
    const evaluations: ImportCandidateEvaluation[] = [];

    // Optional prioritization: if targetCountries provided, put matching candidates first
    let candidateList = [...candidates];
    if (options.targetCountries && options.targetCountries.length > 0) {
        const targets = new Set(options.targetCountries.map((c) => c.toUpperCase()));
        candidateList = candidateList.sort((a, b) => {
            const aMatch = (a.countries ?? []).some((c) => targets.has(c.toUpperCase())) ? 1 : 0;
            const bMatch = (b.countries ?? []).some((c) => targets.has(c.toUpperCase())) ? 1 : 0;
            return bMatch - aMatch;
        });
    }

    for (const candidate of candidateList) {
        if (acceptedFeeds.length >= maxBatch) {
            evaluations.push({
                candidate,
                accepted: false,
                reason: `Batch limit reached (${maxBatch} feeds accepted)`,
            });
            continue;
        }

        const evaluation = await evaluateCandidate(candidate, currentFeeds, options);
        evaluations.push(evaluation);

        if (evaluation.accepted && evaluation.feed) {
            acceptedFeeds.push(evaluation.feed);
            currentFeeds.push(evaluation.feed);
        }
    }

    return { acceptedFeeds, evaluations };
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');

    const fileArg = args.find((a) => a.startsWith('--file='));
    const feedsArg = args.find((a) => a.startsWith('--feeds='));
    const maxArg = args.find((a) => a.startsWith('--max='));
    const targetArg = args.find((a) => a.startsWith('--target-countries='));

    const feedsPath = resolve(feedsArg ? feedsArg.split('=')[1] : 'data/feeds.json');
    const maxBatch = maxArg ? Number.parseInt(maxArg.split('=')[1], 10) : DEFAULT_MAX_BATCH;
    const targetCountries = targetArg ? targetArg.split('=')[1].split(',').map((c) => c.trim().toUpperCase()).filter(Boolean) : undefined;

    let proposedJson: string;
    if (fileArg) {
        proposedJson = await readFile(resolve(fileArg.split('=')[1]), 'utf8');
    } else {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
            chunks.push(chunk as Buffer);
        }
        proposedJson = Buffer.concat(chunks).toString('utf8');
    }

    let candidates: ProposedFeedCandidate[];
    try {
        candidates = JSON.parse(proposedJson);
        if (!Array.isArray(candidates)) throw new Error('Input must be a JSON array of feed candidates');
    } catch (e) {
        console.error(`Failed to parse candidate JSON: ${(e as Error).message}`);
        process.exit(1);
    }

    const payload = JSON.parse(await readFile(feedsPath, 'utf8')) as BootstrapPayload;
    process.stdout.write(`Evaluating ${candidates.length} candidates (bounded limit: ${Math.min(maxBatch, MAX_BATCH_LIMIT)})...\n`);

    const { acceptedFeeds, evaluations } = await processBoundedBatch(candidates, payload.feeds, {
        maxBatch,
        targetCountries,
    });

    process.stdout.write(`\n─── Import Evaluation Summary ───\n`);
    process.stdout.write(`Total evaluated: ${evaluations.length}\n`);
    process.stdout.write(`Accepted: ${acceptedFeeds.length}\n`);
    process.stdout.write(`Rejected/Skipped: ${evaluations.length - acceptedFeeds.length}\n`);

    for (const ev of evaluations) {
        const name = ev.candidate.name ?? '(unnamed)';
        if (ev.accepted) {
            process.stdout.write(`  ✓ ${name} [${ev.feed?.countries.join(',')}] (${ev.feed?.format}) ← ${ev.feed?.url}\n`);
        } else {
            process.stdout.write(`  ✗ ${name}: ${ev.reason}\n`);
        }
    }

    if (acceptedFeeds.length > 0 && !dryRun) {
        payload.feeds.push(...acceptedFeeds);
        payload.stats.feeds = payload.feeds.length;
        payload.generatedAt = new Date().toISOString();

        const tempPath = `${feedsPath}.tmp`;
        await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        await rename(tempPath, feedsPath);
        process.stdout.write(`\nSuccessfully added ${acceptedFeeds.length} feeds to ${feedsPath}.\n`);

        process.stdout.write(`Rebuilding registry artifacts...\n`);
        const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        await execFileAsync(npxCmd, ['tsx', 'scripts/build-artifacts.ts']);
        process.stdout.write(`Artifacts compiled and hashes updated.\n`);
    } else if (dryRun) {
        process.stdout.write(`\n[dry-run] feeds.json was not modified.\n`);
    } else {
        process.stdout.write(`\nNo feeds were accepted — feeds.json was not modified.\n`);
    }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch((error: unknown) => {
        console.error('[import-feeds-bounded] Failed:', error);
        process.exitCode = 1;
    });
}
