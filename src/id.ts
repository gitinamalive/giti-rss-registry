/**
 * Feed identity: URL normalization and the single new-ID algorithm.
 *
 * Existing feeds are opaque and immutable — never regenerate them. This module
 * mints IDs for NEW feeds and supports deduplication by normalized URL.
 */

import { createHash } from 'node:crypto';
import { toFileSafeSegment } from './escape.ts';

/**
 * Normalize a URL for identity purposes: trim whitespace, lowercase the host
 * (the URL parser does this), strip the fragment, and strip a trailing slash
 * from a non-root path. Equivalent normalized URLs must not produce two feeds.
 */
export function normalizeUrl(url: string): string {
    const trimmed = url.trim();
    try {
        const parsed = new URL(trimmed);
        parsed.hash = '';
        let normalized = parsed.origin + parsed.pathname;
        if (normalized.length > parsed.origin.length + 1 && normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }
        return normalized + parsed.search;
    } catch {
        // Not a parseable URL — collapse a trailing slash only.
        return trimmed.replace(/\/+$/, '');
    }
}

/**
 * The one and only new-ID algorithm:
 *
 *   toFileSafeSegment(publisher) + '-' + sha1(normalizedUrl).slice(0, 8)
 *
 * The shape matches the historical format (e.g. `st-lucia-times-3b1160bb`), so
 * new IDs are indistinguishable from existing ones. Never use a different
 * algorithm for new entries.
 */
export function generateFeedId(publisher: string, url: string): string {
    const base = toFileSafeSegment(publisher || 'feed');
    const hash = createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 8);
    return `${base}-${hash}`;
}