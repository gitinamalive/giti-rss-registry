/**
 * Health scoring and status derivation for feed entries.
 *
 * `computeHealthScore` is the canonical 0–100 score used by the health
 * checker; `deriveHealthStatus` maps a feed's latest check onto a
 * human-meaningful enum the public directory page filters on.
 */

export const FRESH_THRESHOLD_DAYS = 7;
export const STALE_THRESHOLD_DAYS = 30;

export type HealthStatus =
    | 'unchecked'
    | 'unknown'
    | 'fresh'
    | 'stale'
    | 'very-stale'
    | 'unreachable';

/** Per-feed health overlay entry (keyed by stable feed id). */
export interface FeedHealthEntry {
    id: string;
    healthStatus: HealthStatus;
    healthScore: number | null;
    lastCheckedAt: string | null;
    lastItemPublishedAt: string | null;
    active: boolean;
}

/**
 * Compute a 0–100 health score for a feed.
 *
 * - unreachable → 0
 * - reachable but no parseable items → 40
 * - items within 7 days → 100 (fresh)
 * - items 7–30 days old → 70 (stale)
 * - items older than 30 days → 40 (very stale)
 */
export function computeHealthScore(
    reachable: boolean,
    lastItemDate?: string,
    now: Date = new Date(),
): number {
    if (!reachable) return 0;
    if (!lastItemDate) return 40;

    const itemAge = now.getTime() - new Date(lastItemDate).getTime();
    const daysSince = itemAge / (1000 * 60 * 60 * 24);

    if (daysSince < FRESH_THRESHOLD_DAYS) return 100;
    if (daysSince < STALE_THRESHOLD_DAYS) return 70;
    return 40;
}

export interface DeriveHealthStatusInput {
    /** true when the last check succeeded (HEAD/GET), false when it failed. */
    active: boolean;
    /** Absent → the feed has never been checked → 'unchecked'. */
    lastCheckedAt?: string | null;
    /** Absent while reachable → checked but no parseable items → 'unknown'. */
    lastItemPublishedAt?: string | null;
    now?: Date;
}

/**
 * Map a feed's latest check onto a stable, filterable status:
 *
 * | status      | condition                                          |
 * |-------------|----------------------------------------------------|
 * | unchecked   | no check record yet (missing lastCheckedAt)        |
 * | unreachable | HEAD/GET failed                                    |
 * | unknown     | reachable but no parseable items                   |
 * | fresh       | < 7 days since last item                           |
 * | stale       | 7–30 days                                          |
 * | very-stale  | > 30 days                                          |
 */
export function deriveHealthStatus(input: DeriveHealthStatusInput): HealthStatus {
    if (!input.lastCheckedAt) return 'unchecked';
    if (!input.active) return 'unreachable';
    if (!input.lastItemPublishedAt) return 'unknown';

    const now = input.now ?? new Date();
    const daysSince = (now.getTime() - new Date(input.lastItemPublishedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < FRESH_THRESHOLD_DAYS) return 'fresh';
    if (daysSince < STALE_THRESHOLD_DAYS) return 'stale';
    return 'very-stale';
}
