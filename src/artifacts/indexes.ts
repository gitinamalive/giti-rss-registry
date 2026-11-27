import type { FeedEntry } from '../types.ts';

export function buildIndex(feeds: FeedEntry[], selector: (entry: FeedEntry) => string[]): Record<string, FeedEntry[]> {
    const grouped: Record<string, FeedEntry[]> = {};

    feeds.forEach((feed) => {
        const keys = selector(feed).filter(Boolean);
        keys.forEach((key) => {
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(feed);
        });
    });

    const collator = new Intl.Collator('en', { sensitivity: 'base' });
    Object.keys(grouped).forEach((key) => {
        // The id tie-break keeps member order fully deterministic regardless of the
        // input feed order (some feeds legitimately share the same display name).
        grouped[key] = grouped[key].sort(
            (a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id)
        );
    });

    return Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => collator.compare(a, b)));
}
