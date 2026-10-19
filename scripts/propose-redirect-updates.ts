/**
 * Propose and apply URL updates for permanent redirects (HTTP 301 and 308).
 *
 * Scans health overlay capabilities for feeds where permanentRedirectUrl
 * was observed, validates the target endpoint (SSRF, HTTP 200, structural feed parse),
 * checks for duplicates, and outputs an artifacts/proposed-redirects.json report.
 *
 * When invoked with `--apply`, applies validated permanent redirect updates to
 * data/feeds.json atomically.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BootstrapPayload, FeedEntry, FeedFormat } from '../src/types.ts';
import type { FeedHealthEntry } from '../src/health.ts';
import { normalizeUrl } from '../src/id.ts';
import {
    assertPublicHttpUrl,
    decodeFeedBytes,
    parseFeedContent,
    readBoundedBytes,
    type Fetcher,
    type HostResolver,
} from './health-check.ts';

export interface RedirectProposal {
    feedId: string;
    feedName: string;
    currentUrl: string;
    proposedUrl: string;
    format?: FeedFormat;
    lastItemDate?: string;
    status: 'valid' | 'duplicate_url' | 'invalid_content' | 'unreachable' | 'ssrf_blocked';
    reason?: string;
}

export interface ProposedRedirectsReport {
    generatedAt: string;
    count: number;
    proposals: RedirectProposal[];
}

export interface ValidateTargetOptions {
    fetcher?: Fetcher;
    resolveHost?: HostResolver;
    timeoutMs?: number;
    maxBytes?: number;
}

export async function validateRedirectTarget(
    targetUrl: string,
    existingUrls: Set<string>,
    options: ValidateTargetOptions = {},
): Promise<{
    valid: boolean;
    status: RedirectProposal['status'];
    format?: FeedFormat;
    lastItemDate?: string;
    reason?: string;
}> {
    const norm = normalizeUrl(targetUrl);
    if (existingUrls.has(norm)) {
        return {
            valid: false,
            status: 'duplicate_url',
            reason: `Target URL ${targetUrl} collides with an existing registry feed URL`,
        };
    }

    try {
        await assertPublicHttpUrl(targetUrl, options.resolveHost);
    } catch (error) {
        return {
            valid: false,
            status: 'ssrf_blocked',
            reason: `Target URL failed SSRF check: ${(error as Error).message}`,
        };
    }

    const fetcher = options.fetcher ?? fetch;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);

    try {
        const response = await fetcher(targetUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'giti-rss-registry-redirect-checker/1.0 (+https://github.com/gitinamalive/giti)',
                Accept: 'application/rss+xml, application/atom+xml, application/rdf+xml, application/feed+json, application/json, text/xml;q=0.9, */*;q=0.8',
            },
            redirect: 'follow',
        });

        if (!response.ok) {
            await response.body?.cancel();
            return {
                valid: false,
                status: 'unreachable',
                reason: `Target URL returned HTTP ${response.status}`,
            };
        }

        const maxBytes = options.maxBytes ?? 5_000_000;
        const bytes = await readBoundedBytes(response, maxBytes, controller.signal);
        const body = decodeFeedBytes(bytes, response.headers.get('content-type'));
        const content = parseFeedContent(body);

        if (!content) {
            return {
                valid: false,
                status: 'invalid_content',
                reason: 'Target URL response does not contain parseable RSS, Atom, RDF, or JSON Feed structure',
            };
        }

        return {
            valid: true,
            status: 'valid',
            format: content.format,
            lastItemDate: content.lastItemDate,
        };
    } catch (error) {
        return {
            valid: false,
            status: 'unreachable',
            reason: `Target probe error: ${(error as Error).message}`,
        };
    } finally {
        clearTimeout(timer);
    }
}

export async function findRedirectProposals(
    canonicalFeeds: FeedEntry[],
    overlayFeeds: FeedHealthEntry[],
    options: ValidateTargetOptions = {},
): Promise<RedirectProposal[]> {
    const feedsById = new Map(canonicalFeeds.map((f) => [f.id, f]));
    const existingNormUrls = new Set(canonicalFeeds.map((f) => normalizeUrl(f.url)));

    const proposals: RedirectProposal[] = [];

    for (const health of overlayFeeds) {
        const redirectUrl = health.capabilities?.permanentRedirectUrl;
        if (!redirectUrl) continue;

        const feed = feedsById.get(health.id);
        if (!feed) continue;

        // Skip if feed is already using this URL
        if (feed.url === redirectUrl || normalizeUrl(feed.url) === normalizeUrl(redirectUrl)) {
            continue;
        }

        // Allow targetUrl to match current feed's URL in collision check, but not other feeds
        const urlsExcludingSelf = new Set(existingNormUrls);
        urlsExcludingSelf.delete(normalizeUrl(feed.url));

        const validation = await validateRedirectTarget(redirectUrl, urlsExcludingSelf, options);

        proposals.push({
            feedId: feed.id,
            feedName: feed.name,
            currentUrl: feed.url,
            proposedUrl: redirectUrl,
            status: validation.status,
            format: validation.format,
            lastItemDate: validation.lastItemDate,
            reason: validation.reason,
        });
    }

    return proposals;
}

export function applyRedirectProposals(
    canonicalFeeds: FeedEntry[],
    validProposals: RedirectProposal[],
): { updatedFeeds: FeedEntry[]; appliedCount: number } {
    const proposalMap = new Map(
        validProposals
            .filter((p) => p.status === 'valid')
            .map((p) => [p.feedId, p.proposedUrl]),
    );

    let appliedCount = 0;
    const updatedFeeds = canonicalFeeds.map((feed) => {
        const proposed = proposalMap.get(feed.id);
        if (proposed && proposed !== feed.url) {
            appliedCount += 1;
            return {
                ...feed,
                url: proposed,
            };
        }
        return feed;
    });

    return { updatedFeeds, appliedCount };
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const shouldApply = args.includes('--apply');

    const fileArg = args.find((a) => a.startsWith('--file='));
    const overlayArg = args.find((a) => a.startsWith('--overlay='));
    const outArg = args.find((a) => a.startsWith('--out='));

    const feedsPath = resolve(fileArg ? fileArg.split('=')[1] : 'data/feeds.json');
    const overlayPath = resolve(overlayArg ? overlayArg.split('=')[1] : 'dist/feeds-health.json');
    const artifactsDir = resolve('artifacts');
    const reportPath = resolve(outArg ? outArg.split('=')[1] : resolve(artifactsDir, 'proposed-redirects.json'));

    const payload = JSON.parse(await readFile(feedsPath, 'utf8')) as BootstrapPayload;
    let overlayFeeds: FeedHealthEntry[] = [];
    try {
        const overlay = JSON.parse(await readFile(overlayPath, 'utf8')) as { feeds: FeedHealthEntry[] };
        overlayFeeds = overlay.feeds ?? [];
    } catch (e) {
        process.stderr.write(`[warn] Could not read overlay from ${overlayPath}: ${(e as Error).message}\n`);
    }

    process.stdout.write(`Analyzing ${overlayFeeds.length} feeds in health overlay for permanent redirects (301/308)...\n`);
    const proposals = await findRedirectProposals(payload.feeds, overlayFeeds);

    const validProposals = proposals.filter((p) => p.status === 'valid');
    process.stdout.write(`Found ${proposals.length} redirect proposals (${validProposals.length} valid, ${proposals.length - validProposals.length} invalid/duplicate/blocked).\n`);

    await mkdir(artifactsDir, { recursive: true });
    const report: ProposedRedirectsReport = {
        generatedAt: new Date().toISOString(),
        count: proposals.length,
        proposals,
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`Wrote redirect proposals report to ${reportPath}\n`);

    if (shouldApply) {
        if (validProposals.length === 0) {
            process.stdout.write(`No valid proposals to apply. feeds.json untouched.\n`);
            return;
        }

        const { updatedFeeds, appliedCount } = applyRedirectProposals(payload.feeds, validProposals);
        payload.feeds = updatedFeeds;
        payload.generatedAt = new Date().toISOString();

        const tempPath = `${feedsPath}.tmp`;
        await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        await rename(tempPath, feedsPath);

        process.stdout.write(`Successfully applied ${appliedCount} redirect updates to ${feedsPath}.\n`);
        process.stdout.write(`Next: Run 'npm run build:artifacts' to compile distribution manifests.\n`);
    }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch((error: unknown) => {
        console.error('[propose-redirect-updates] Failed:', error);
        process.exitCode = 1;
    });
}
