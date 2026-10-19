/**
 * Reconcile feed health issues using deterministic identity markers.
 *
 * Replaces title-based issue checks with stable HTML comment markers:
 *   <!-- feed-health:<feed-id> -->
 *
 * Prevents duplicate issues when consecutive failure counts increment,
 * suppresses redundant comment spam on identical errors, and auto-closes
 * issues when a failing feed recovers.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BootstrapPayload, FeedEntry } from '../src/types.ts';
import { deriveQuarantineStatus, type FeedHealthEntry } from '../src/health.ts';

export const HEALTH_LABEL = 'health-review';
export const AUTOMATED_LABEL = 'automated';

export interface GitHubIssueRecord {
    number: number;
    title: string;
    body?: string | null;
    labels?: Array<string | { name: string }>;
    comments?: number;
    state?: 'open' | 'closed';
    created_at?: string;
}

export interface IssueReconciliationPlan {
    toCreate: Array<{ feed: FeedEntry; health: FeedHealthEntry }>;
    toUpdate: Array<{
        issueNumber: number;
        feed: FeedEntry;
        health: FeedHealthEntry;
        updatedBody: string;
        transitionComment?: string;
    }>;
    toClose: Array<{
        issueNumber: number;
        feed: FeedEntry;
        health: FeedHealthEntry;
        reason: 'recovered';
        comment: string;
    }>;
    duplicatesToClose: Array<{
        duplicateIssueNumber: number;
        retainedIssueNumber: number;
        feedId: string;
        comment: string;
    }>;
}

export function getIssueMarker(feedId: string): string {
    return `<!-- feed-health:${feedId} -->`;
}

export function getStableTitle(feedName: string, feedId: string): string {
    return `[Health Review] ${feedName} (${feedId})`;
}

export function extractFeedIdFromIssue(issue: { body?: string | null; title: string }): string | null {
    if (issue.body) {
        // 1. Primary deterministic marker
        const markerMatch = issue.body.match(/<!--\s*feed-health:([a-z0-9-]+)\s*-->/i);
        if (markerMatch) return markerMatch[1];

        // 2. Fallback to legacy structured body emitted by health-check.yml
        const legacyMatch = issue.body.match(/(?:Stable ID:\s*|\*\*Feed ID:\*\*\s*`?)([a-z0-9-]+)`?/i);
        if (legacyMatch) return legacyMatch[1];
    }

    // 3. Fallback to title pattern: ... (<id>)
    const titleMatch = issue.title.match(/\(([a-z0-9-]+)\)$/);
    if (titleMatch) return titleMatch[1];

    return null;
}

export function buildIssueBody(feed: FeedEntry, health: FeedHealthEntry): string {
    const quarantine = health.quarantineStatus ?? deriveQuarantineStatus(health.consecutiveFailures);
    const lines = [
        getIssueMarker(feed.id),
        `## Health Review for ${feed.name}`,
        '',
        `- **Feed Name:** ${feed.name}`,
        `- **Stable ID:** \`${feed.id}\``,
        `- **URL:** ${feed.url}`,
        `- **Publisher:** ${feed.publisher}`,
        `- **Countries:** ${(feed.countries || []).join(', ') || 'N/A'}`,
        `- **Health Status:** \`${health.healthStatus}\``,
        `- **Quarantine Status:** \`${quarantine}\``,
    ];
    if (health.failureReason) {
        lines.push(`- **Failure Reason:** \`${health.failureReason}\``);
    }
    lines.push(
        `- **Consecutive Failures:** ${health.consecutiveFailures}`,
        `- **Last Success:** ${health.lastSuccessAt ?? 'never'}`,
        `- **Last Failure:** ${health.lastFailureAt ?? 'unknown'}`,
        `- **Last Checked:** ${health.lastCheckedAt ?? 'unknown'}`,
        '',
        '> [!NOTE]',
        '> This feed remains in the canonical registry source data and is not auto-deleted.',
        '> It is excluded from default client suggestions until verified healthy.',
    );
    return lines.join('\n');
}

export function reconcileHealthState(
    openIssues: GitHubIssueRecord[],
    overlayFeeds: FeedHealthEntry[],
    canonicalFeeds: Map<string, FeedEntry>,
): IssueReconciliationPlan {
    const plan: IssueReconciliationPlan = {
        toCreate: [],
        toUpdate: [],
        toClose: [],
        duplicatesToClose: [],
    };

    // Group open issues by stable feed ID
    const issuesByFeedId = new Map<string, GitHubIssueRecord[]>();
    for (const issue of openIssues) {
        const feedId = extractFeedIdFromIssue(issue);
        if (!feedId) continue;
        const list = issuesByFeedId.get(feedId) ?? [];
        list.push(issue);
        issuesByFeedId.set(feedId, list);
    }

    const healthById = new Map(overlayFeeds.map((entry) => [entry.id, entry]));

    // 1. Process candidate failing feeds (consecutiveFailures >= 4)
    const failingCandidates = overlayFeeds.filter((entry) => entry.consecutiveFailures >= 4);

    for (const health of failingCandidates) {
        const feed = canonicalFeeds.get(health.id);
        if (!feed) continue;

        const existing = issuesByFeedId.get(health.id);

        if (!existing || existing.length === 0) {
            // No existing issue -> Create new canonical issue
            plan.toCreate.push({ feed, health });
        } else {
            // Existing issue(s) found -> Pick the oldest as retained canonical
            const sorted = [...existing].sort((a, b) => a.number - b.number);
            const retained = sorted[0];

            const updatedBody = buildIssueBody(feed, health);

            // Check if status, quarantine, or error transition warrants a comment
            let transitionComment: string | undefined;
            const currentQuarantine = health.quarantineStatus ?? deriveQuarantineStatus(health.consecutiveFailures);
            if (retained.body && !retained.body.includes(health.healthStatus)) {
                transitionComment = `Health status transition: Feed status changed to **${health.healthStatus}** (consecutive failures: ${health.consecutiveFailures}, quarantine: ${currentQuarantine}).`;
            } else if (retained.body && currentQuarantine === 'quarantined' && !retained.body.includes('`quarantined`')) {
                transitionComment = `Quarantine threshold reached: Feed has failed ${health.consecutiveFailures} consecutive checks and is now **quarantined**.`;
            }

            plan.toUpdate.push({
                issueNumber: retained.number,
                feed,
                health,
                updatedBody,
                transitionComment,
            });

            // Mark any additional duplicate open issues for closure
            for (let i = 1; i < sorted.length; i += 1) {
                plan.duplicatesToClose.push({
                    duplicateIssueNumber: sorted[i].number,
                    retainedIssueNumber: retained.number,
                    feedId: health.id,
                    comment: `Closing as duplicate of #${retained.number} (consolidated by stable feed ID \`${health.id}\`).`,
                });
            }
        }
    }

    // 2. Process recovered feeds (open issue exists, but feed is now active / 0 failures)
    for (const [feedId, issues] of issuesByFeedId.entries()) {
        const health = healthById.get(feedId);
        const feed = canonicalFeeds.get(feedId);
        if (!feed || !health) continue;

        if (health.active && health.consecutiveFailures === 0) {
            for (const issue of issues) {
                plan.toClose.push({
                    issueNumber: issue.number,
                    feed,
                    health,
                    reason: 'recovered',
                    comment: `Feed **${feed.name}** has passed health validation and is verified active (${health.healthStatus}). Auto-closing issue.`,
                });
            }
        }
    }

    return plan;
}

// ── GitHub API Client Helpers ──────────────────────────────────────────────

interface OctokitLike {
    request: (route: string, options?: Record<string, unknown>) => Promise<{ data: unknown; headers: Headers }>;
}

async function createGitHubClient(token: string): Promise<OctokitLike> {
    return {
        async request(route: string, options: Record<string, unknown> = {}) {
            const [method, pathTemplate] = route.split(' ');
            let path = pathTemplate;
            const queryParams: string[] = [];
            const bodyPayload: Record<string, unknown> = {};

            for (const [key, val] of Object.entries(options)) {
                if (path.includes(`{${key}}`)) {
                    path = path.replace(`{${key}}`, encodeURIComponent(String(val)));
                } else if (method === 'GET') {
                    queryParams.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
                } else {
                    bodyPayload[key] = val;
                }
            }

            const url = `https://api.github.com${path}${queryParams.length ? `?${queryParams.join('&')}` : ''}`;
            const res = await fetch(url, {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'giti-rss-registry-reconciler/1.0',
                    ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
                },
                body: method !== 'GET' ? JSON.stringify(bodyPayload) : undefined,
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(`GitHub API ${res.status} ${res.statusText} on ${route}: ${text}`);
            }

            const data = (await res.json()) as unknown;
            return { data, headers: res.headers };
        },
    };
}

async function paginateOpenIssues(client: OctokitLike, owner: string, repo: string, label: string): Promise<GitHubIssueRecord[]> {
    const issues: GitHubIssueRecord[] = [];
    let page = 1;

    while (true) {
        const { data } = await client.request('GET /repos/{owner}/{repo}/issues', {
            owner,
            repo,
            state: 'open',
            labels: label,
            per_page: 100,
            page,
        });

        const batch = data as GitHubIssueRecord[];
        if (!Array.isArray(batch) || batch.length === 0) break;

        // GitHub issues API includes pull requests; filter them out
        for (const item of batch) {
            if (!('pull_request' in item)) {
                issues.push(item);
            }
        }

        if (batch.length < 100) break;
        page += 1;
    }

    return issues;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function main(): Promise<void> {
    const token = process.env.GITHUB_TOKEN;
    const repoSlug = process.env.GITHUB_REPOSITORY;

    const overlayPath = resolve('dist/feeds-health.json');
    const canonicalPath = resolve('data/feeds.json');

    const overlay = JSON.parse(await readFile(overlayPath, 'utf8')) as { feeds: FeedHealthEntry[] };
    const canonical = JSON.parse(await readFile(canonicalPath, 'utf8')) as BootstrapPayload;
    const canonicalMap = new Map(canonical.feeds.map((feed) => [feed.id, feed]));

    if (!token || !repoSlug) {
        process.stdout.write('[reconcile-health-issues] Running in dry-run mode (GITHUB_TOKEN or GITHUB_REPOSITORY not set).\n');
        const plan = reconcileHealthState([], overlay.feeds, canonicalMap);
        process.stdout.write(`Planned creations: ${plan.toCreate.length}\n`);
        return;
    }

    const [owner, repo] = repoSlug.split('/');
    const client = await createGitHubClient(token);

    process.stdout.write(`Fetching open '${HEALTH_LABEL}' issues from ${repoSlug}...\n`);
    const openIssues = await paginateOpenIssues(client, owner, repo, HEALTH_LABEL);
    process.stdout.write(`Found ${openIssues.length} open health review issues.\n`);

    const plan = reconcileHealthState(openIssues, overlay.feeds, canonicalMap);

    process.stdout.write(
        `Reconciliation Plan:\n` +
        `  - New issues to open: ${plan.toCreate.length}\n` +
        `  - Existing issues to update: ${plan.toUpdate.length}\n` +
        `  - Recovered issues to close: ${plan.toClose.length}\n` +
        `  - Duplicate issues to collapse: ${plan.duplicatesToClose.length}\n`
    );

    // 1. Create new issues
    for (const item of plan.toCreate) {
        process.stdout.write(`Creating issue for ${item.feed.name} (${item.feed.id})...\n`);
        await client.request('POST /repos/{owner}/{repo}/issues', {
            owner,
            repo,
            title: getStableTitle(item.feed.name, item.feed.id),
            labels: [HEALTH_LABEL, AUTOMATED_LABEL],
            body: buildIssueBody(item.feed, item.health),
        });
        await sleep(350);
    }

    // 2. Update existing issues in place
    for (const item of plan.toUpdate) {
        process.stdout.write(`Updating issue #${item.issueNumber} for ${item.feed.name}...\n`);
        await client.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
            owner,
            repo,
            issue_number: item.issueNumber,
            title: getStableTitle(item.feed.name, item.feed.id),
            body: item.updatedBody,
        });

        if (item.transitionComment) {
            await client.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
                owner,
                repo,
                issue_number: item.issueNumber,
                body: item.transitionComment,
            });
        }
        await sleep(350);
    }

    // 3. Close duplicate issues
    for (const dup of plan.duplicatesToClose) {
        process.stdout.write(`Closing duplicate issue #${dup.duplicateIssueNumber} (retained #${dup.retainedIssueNumber})...\n`);
        await client.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
            owner,
            repo,
            issue_number: dup.duplicateIssueNumber,
            body: dup.comment,
        });
        await client.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
            owner,
            repo,
            issue_number: dup.duplicateIssueNumber,
            state: 'closed',
            state_reason: 'not_planned',
        });
        await sleep(350);
    }

    // 4. Close recovered issues
    for (const item of plan.toClose) {
        process.stdout.write(`Closing recovered issue #${item.issueNumber} for ${item.feed.name}...\n`);
        await client.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
            owner,
            repo,
            issue_number: item.issueNumber,
            body: item.comment,
        });
        await client.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
            owner,
            repo,
            issue_number: item.issueNumber,
            state: 'closed',
            state_reason: 'completed',
        });
        await sleep(350);
    }

    process.stdout.write('Reconciliation complete.\n');
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch((error: unknown) => {
        console.error('[reconcile-health-issues] Failed:', error);
        process.exitCode = 1;
    });
}
