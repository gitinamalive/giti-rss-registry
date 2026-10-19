/**
 * Two-phase duplicate issue cleanup script (--dry-run -> --apply).
 *
 * Collapses existing duplicate health review issues into one canonical issue
 * per stable feed ID, preserving any human discussion comments before closing
 * duplicate issues.
 *
 * Usage:
 *   npx tsx scripts/cleanup-duplicate-issues.ts [--dry-run]
 *   npx tsx scripts/cleanup-duplicate-issues.ts --apply
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    extractFeedIdFromIssue,
    getIssueMarker,
    getStableTitle,
    HEALTH_LABEL,
    type GitHubIssueRecord,
} from './reconcile-health-issues.ts';
import type { BootstrapPayload } from '../src/types.ts';
import type { FeedHealthEntry } from '../src/health.ts';

export interface IssueCommentRecord {
    id: number;
    user?: { login?: string; type?: string } | null;
    body?: string;
    created_at?: string;
}

export interface CleanupGroup {
    feedId: string;
    feedName: string;
    retainedIssueNumber: number;
    duplicateIssueNumbers: number[];
    preservedCommentsCount: number;
    latestFailureCount?: number;
}

export interface CleanupPlan {
    totalOpenIssues: number;
    distinctFeedsCount: number;
    retainedCount: number;
    duplicatesCount: number;
    groups: CleanupGroup[];
}

export function planDuplicateCleanup(
    openIssues: GitHubIssueRecord[],
    overlayFeeds: FeedHealthEntry[],
    canonicalFeeds: Map<string, { id: string; name: string }>,
): CleanupPlan {
    const healthById = new Map(overlayFeeds.map((entry) => [entry.id, entry]));
    const groupsByFeedId = new Map<string, GitHubIssueRecord[]>();

    for (const issue of openIssues) {
        const feedId = extractFeedIdFromIssue(issue);
        if (!feedId) continue;
        const list = groupsByFeedId.get(feedId) ?? [];
        list.push(issue);
        groupsByFeedId.set(feedId, list);
    }

    const groups: CleanupGroup[] = [];
    let duplicatesCount = 0;

    for (const [feedId, issues] of groupsByFeedId.entries()) {
        const canonical = canonicalFeeds.get(feedId);
        const health = healthById.get(feedId);
        const feedName = canonical?.name ?? issues[0].title;

        // Sort by issue number ascending: retain the oldest issue
        const sorted = [...issues].sort((a, b) => a.number - b.number);
        const retained = sorted[0];
        const duplicates = sorted.slice(1);

        duplicatesCount += duplicates.length;

        groups.push({
            feedId,
            feedName,
            retainedIssueNumber: retained.number,
            duplicateIssueNumbers: duplicates.map((d) => d.number),
            preservedCommentsCount: duplicates.reduce((acc, d) => acc + (d.comments ?? 0), 0),
            latestFailureCount: health?.consecutiveFailures,
        });
    }

    return {
        totalOpenIssues: openIssues.length,
        distinctFeedsCount: groupsByFeedId.size,
        retainedCount: groups.length,
        duplicatesCount,
        groups,
    };
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function main(): Promise<void> {
    const isApply = process.argv.includes('--apply');
    const token = process.env.GITHUB_TOKEN;
    const repoSlug = process.env.GITHUB_REPOSITORY;

    const overlay = JSON.parse(await readFile(resolve('dist/feeds-health.json'), 'utf8')) as { feeds: FeedHealthEntry[] };
    const canonical = JSON.parse(await readFile(resolve('data/feeds.json'), 'utf8')) as BootstrapPayload;
    const canonicalMap = new Map(canonical.feeds.map((feed) => [feed.id, feed]));

    if (!token || !repoSlug) {
        process.stdout.write('[cleanup-duplicate-issues] No GITHUB_TOKEN or GITHUB_REPOSITORY set. Running in local dry-run validation.\n');
        return;
    }

    const [owner, repo] = repoSlug.split('/');
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'giti-rss-registry-cleanup/1.0',
    };

    // Paginate all open health review issues
    process.stdout.write(`Fetching open '${HEALTH_LABEL}' issues from ${repoSlug}...\n`);
    const openIssues: GitHubIssueRecord[] = [];
    let page = 1;

    while (true) {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&labels=${HEALTH_LABEL}&per_page=100&page=${page}`, { headers });
        if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status} ${res.statusText}`);
        const batch = (await res.json()) as GitHubIssueRecord[];
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const item of batch) {
            if (!('pull_request' in item)) openIssues.push(item);
        }
        if (batch.length < 100) break;
        page += 1;
    }

    process.stdout.write(`Loaded ${openIssues.length} open issues.\n`);
    const plan = planDuplicateCleanup(openIssues, overlay.feeds, canonicalMap);

    await mkdir(resolve('artifacts'), { recursive: true });
    const planOutputPath = resolve('artifacts/issue-cleanup-plan.json');
    await writeFile(planOutputPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

    process.stdout.write(`Cleanup Plan Summary:\n`);
    process.stdout.write(`  Total Open Issues: ${plan.totalOpenIssues}\n`);
    process.stdout.write(`  Distinct Feed IDs: ${plan.distinctFeedsCount}\n`);
    process.stdout.write(`  Retained Issues:   ${plan.retainedCount}\n`);
    process.stdout.write(`  Duplicate Issues:  ${plan.duplicatesCount}\n`);
    process.stdout.write(`  Plan written to:   ${planOutputPath}\n`);

    if (!isApply) {
        process.stdout.write(`\nDry run complete. To apply changes, pass --apply.\n`);
        return;
    }

    process.stdout.write(`\nApplying duplicate issue cleanup (closing ${plan.duplicatesCount} issues)...\n`);

    for (const group of plan.groups) {
        if (group.duplicateIssueNumbers.length === 0) continue;

        // 1. Ensure retained issue has deterministic marker and title
        const feed = canonicalMap.get(group.feedId);
        if (feed) {
            const stableTitle = getStableTitle(feed.name, feed.id);
            const marker = getIssueMarker(feed.id);
            // Fetch retained issue body
            const getIssueRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${group.retainedIssueNumber}`, { headers });
            if (getIssueRes.ok) {
                const retainedIssue = (await getIssueRes.json()) as GitHubIssueRecord;
                const currentBody = retainedIssue.body ?? '';
                const updatedBody = currentBody.includes(marker) ? currentBody : `${marker}\n\n${currentBody}`;
                await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${group.retainedIssueNumber}`, {
                    method: 'PATCH',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: stableTitle, body: updatedBody }),
                });
            }
        }

        // 2. Process each duplicate issue
        for (const dupNumber of group.duplicateIssueNumbers) {
            // Check for non-bot comments to preserve
            const commentsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${dupNumber}/comments`, { headers });
            if (commentsRes.ok) {
                const comments = (await commentsRes.json()) as IssueCommentRecord[];
                const humanComments = comments.filter((c) => {
                    const login = c.user?.login ?? '';
                    return !login.includes('[bot]') && !login.includes('github-actions');
                });

                for (const hc of humanComments) {
                    const copiedComment = `> [Preserved from duplicate #${dupNumber} by @${hc.user?.login ?? 'unknown'} at ${hc.created_at ?? ''}]:\n\n${hc.body ?? ''}`;
                    await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${group.retainedIssueNumber}/comments`, {
                        method: 'POST',
                        headers: { ...headers, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ body: copiedComment }),
                    });
                    await sleep(350);
                }
            }

            // Post duplicate closure comment
            const closeComment = `Closing as duplicate of #${group.retainedIssueNumber} (consolidated by stable feed ID \`${group.feedId}\`).`;
            await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${dupNumber}/comments`, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ body: closeComment }),
            });
            await sleep(350);

            // Close duplicate issue
            await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${dupNumber}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }),
            });
            await sleep(350);

            process.stdout.write(`Closed duplicate #${dupNumber} -> retained #${group.retainedIssueNumber}\n`);
        }
    }

    process.stdout.write('\nCleanup completed successfully.\n');
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch((error: unknown) => {
        console.error('[cleanup-duplicate-issues] Failed:', error);
        process.exitCode = 1;
    });
}
