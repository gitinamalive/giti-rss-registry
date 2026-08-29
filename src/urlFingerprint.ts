import type { FeedEntry } from './types.ts';

const TRACKING_PARAMETERS = new Set([
    'fbclid',
    'gclid',
    'mc_cid',
    'mc_eid',
    'msclkid',
    'ref',
    'referrer',
    'utm_campaign',
    'utm_content',
    'utm_id',
    'utm_medium',
    'utm_source',
    'utm_term',
]);

/**
 * Normalize only URL variations that are conventionally non-semantic for a
 * feed endpoint. Paths, meaningful query parameters, and alternate editions
 * remain distinct.
 */
export function urlFingerprint(value: string): string {
    const parsed = new URL(value.trim());
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const protocol = parsed.protocol.toLowerCase();
    const port = parsed.port && !((protocol === 'http:' && parsed.port === '80') || (protocol === 'https:' && parsed.port === '443'))
        ? `:${parsed.port}`
        : '';
    const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname;
    const parameters = [...parsed.searchParams.entries()]
        .filter(([key]) => !TRACKING_PARAMETERS.has(key.toLowerCase()))
        .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
    const query = new URLSearchParams(parameters).toString();
    return `${protocol}//${hostname}${port}${pathname}${query ? `?${query}` : ''}`;
}

export interface PossibleDuplicateFinding {
    fingerprint: string;
    feedIds: string[];
    urls: string[];
}

/** Find likely URL duplicates without rejecting legitimate alternate editions. */
export function findPossibleDuplicateUrls(feeds: FeedEntry[]): PossibleDuplicateFinding[] {
    const grouped = new Map<string, FeedEntry[]>();
    for (const feed of feeds) {
        try {
            const fingerprint = urlFingerprint(feed.url);
            const entries = grouped.get(fingerprint) ?? [];
            entries.push(feed);
            grouped.set(fingerprint, entries);
        } catch {
            // URL validity is reported by the canonical validator.
        }
    }

    return [...grouped.entries()]
        .filter(([, entries]) => new Set(entries.map((entry) => entry.url)).size > 1)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([fingerprint, entries]) => ({
            fingerprint,
            feedIds: entries.map((entry) => entry.id).sort(),
            urls: entries.map((entry) => entry.url).sort(),
        }));
}

export { TRACKING_PARAMETERS };
