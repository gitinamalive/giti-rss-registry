import { describe, expect, it } from 'vitest';
import {
    extractFeedIdFromIssue,
    getIssueMarker,
    getStableTitle,
    reconcileHealthState,
    type GitHubIssueRecord,
} from '../scripts/reconcile-health-issues.ts';
import { planDuplicateCleanup } from '../scripts/cleanup-duplicate-issues.ts';
import type { FeedEntry } from '../src/types.ts';
import type { FeedHealthEntry } from '../src/health.ts';

const dummyFeed: FeedEntry = {
    id: 'antigua-newsroom-90c61b09',
    name: 'Antigua Newsroom',
    publisher: 'Antigua Newsroom',
    url: 'https://antiguanewsroom.com/feed/',
    language: 'en',
    countries: ['AG'],
    category: 'world',
};

const dummyHealth: FeedHealthEntry = {
    id: 'antigua-newsroom-90c61b09',
    healthStatus: 'unreachable',
    healthScore: 0,
    lastCheckedAt: '2026-10-19T12:00:00Z',
    lastItemPublishedAt: null,
    active: false,
    consecutiveFailures: 6,
    lastSuccessAt: null,
    lastFailureAt: '2026-10-19T12:00:00Z',
    defaultSuggestion: false,
};

describe('issue identity and ID extraction', () => {
    it('creates deterministic markers and titles', () => {
        expect(getIssueMarker('test-feed-1234')).toBe('<!-- feed-health:test-feed-1234 -->');
        expect(getStableTitle('Test News', 'test-feed-1234')).toBe('[Health Review] Test News (test-feed-1234)');
    });

    it('extracts feed ID from deterministic HTML comment marker', () => {
        const issue = {
            title: '[Health Review] Some Feed',
            body: '<!-- feed-health:antigua-newsroom-90c61b09 -->\nSome diagnostic text',
        };
        expect(extractFeedIdFromIssue(issue)).toBe('antigua-newsroom-90c61b09');
    });

    it('extracts feed ID from legacy workflow body with Stable ID', () => {
        const issue = {
            title: '[Health Review] Antigua Newsroom has failed 5 weekly checks',
            body: 'Feed: Antigua Newsroom\nStable ID: antigua-newsroom-90c61b09\nURL: https://antiguanewsroom.com/feed/',
        };
        expect(extractFeedIdFromIssue(issue)).toBe('antigua-newsroom-90c61b09');
    });

    it('extracts feed ID from legacy markdown body', () => {
        const issue = {
            title: '[Health Review] Antigua Newsroom',
            body: '**Feed ID:** `antigua-newsroom-90c61b09`',
        };
        expect(extractFeedIdFromIssue(issue)).toBe('antigua-newsroom-90c61b09');
    });

    it('extracts feed ID from title pattern as fallback', () => {
        const issue = {
            title: '[Health Review] Antigua Newsroom (antigua-newsroom-90c61b09)',
            body: null,
        };
        expect(extractFeedIdFromIssue(issue)).toBe('antigua-newsroom-90c61b09');
    });
});

describe('single-pass issue reconciliation', () => {
    const canonicalMap = new Map([[dummyFeed.id, dummyFeed]]);

    it('plans creation when failing feed has no open issue', () => {
        const plan = reconcileHealthState([], [dummyHealth], canonicalMap);
        expect(plan.toCreate).toHaveLength(1);
        expect(plan.toCreate[0].feed.id).toBe(dummyFeed.id);
        expect(plan.toUpdate).toHaveLength(0);
        expect(plan.toClose).toHaveLength(0);
    });

    it('updates existing issue and collapses duplicates when multiple open issues exist', () => {
        const openIssues: GitHubIssueRecord[] = [
            { number: 111, title: '[Health Review] Antigua Newsroom (antigua-newsroom-90c61b09)', body: '<!-- feed-health:antigua-newsroom-90c61b09 -->\nConsecutive Failures: 4' },
            { number: 222, title: '[Health Review] Antigua Newsroom has failed 5 weekly checks', body: 'Stable ID: antigua-newsroom-90c61b09' },
            { number: 333, title: '[Health Review] Antigua Newsroom has failed 6 weekly checks', body: 'Stable ID: antigua-newsroom-90c61b09' },
        ];

        const plan = reconcileHealthState(openIssues, [dummyHealth], canonicalMap);
        expect(plan.toCreate).toHaveLength(0);
        expect(plan.toUpdate).toHaveLength(1);
        expect(plan.toUpdate[0].issueNumber).toBe(111);
        expect(plan.duplicatesToClose).toHaveLength(2);
        expect(plan.duplicatesToClose.map((d) => d.duplicateIssueNumber)).toEqual([222, 333]);
    });

    it('auto-closes open issue when failing feed recovers', () => {
        const openIssues: GitHubIssueRecord[] = [
            { number: 111, title: '[Health Review] Antigua Newsroom (antigua-newsroom-90c61b09)', body: '<!-- feed-health:antigua-newsroom-90c61b09 -->' },
        ];

        const recoveredHealth: FeedHealthEntry = {
            ...dummyHealth,
            active: true,
            consecutiveFailures: 0,
            healthStatus: 'fresh',
            lastSuccessAt: '2026-10-19T13:00:00Z',
        };

        const plan = reconcileHealthState(openIssues, [recoveredHealth], canonicalMap);
        expect(plan.toCreate).toHaveLength(0);
        expect(plan.toClose).toHaveLength(1);
        expect(plan.toClose[0].issueNumber).toBe(111);
        expect(plan.toClose[0].reason).toBe('recovered');
    });
});

describe('two-phase duplicate cleanup planning', () => {
    it('accurately groups duplicate issues by feed ID', () => {
        // Simulate 6 issues across 2 feeds
        const issues: GitHubIssueRecord[] = [
            { number: 1, title: 'Feed A', body: 'Stable ID: feed-a-1111' },
            { number: 2, title: 'Feed A', body: 'Stable ID: feed-a-1111' },
            { number: 3, title: 'Feed A', body: 'Stable ID: feed-a-1111' },
            { number: 4, title: 'Feed B', body: 'Stable ID: feed-b-2222' },
            { number: 5, title: 'Feed B', body: 'Stable ID: feed-b-2222' },
            { number: 6, title: 'Feed B', body: 'Stable ID: feed-b-2222' },
        ];

        const canonical = new Map([
            ['feed-a-1111', { id: 'feed-a-1111', name: 'Feed A' }],
            ['feed-b-2222', { id: 'feed-b-2222', name: 'Feed B' }],
        ]);

        const plan = planDuplicateCleanup(issues, [], canonical);
        expect(plan.totalOpenIssues).toBe(6);
        expect(plan.distinctFeedsCount).toBe(2);
        expect(plan.retainedCount).toBe(2);
        expect(plan.duplicatesCount).toBe(4);

        const groupA = plan.groups.find((g) => g.feedId === 'feed-a-1111')!;
        expect(groupA.retainedIssueNumber).toBe(1);
        expect(groupA.duplicateIssueNumbers).toEqual([2, 3]);

        const groupB = plan.groups.find((g) => g.feedId === 'feed-b-2222')!;
        expect(groupB.retainedIssueNumber).toBe(4);
        expect(groupB.duplicateIssueNumbers).toEqual([5, 6]);
    });
});
