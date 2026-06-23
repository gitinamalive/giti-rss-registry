/**
 * enrich-categories.ts
 *
 * One-time script that proposes FeedCategory values for feeds in
 * data/feeds.json using deterministic heuristic rules (no LLM dependency).
 *
 * Reads data/feeds.json → applies rules → writes data/feeds.proposed.json
 * with a summary of changes for human review.
 *
 * Usage: npx tsx scripts/enrich-categories.ts
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BootstrapPayload, FeedCategory } from '../src/types.ts';
import { allowedCategories } from '../src/types.ts';

// ── Heuristic Rules ──────────────────────────────────────────────

const nameToCategory: Record<string, FeedCategory> = {
    'wired': 'technology',
    'ars technica': 'technology',
    'mit technology review': 'technology',
    'the verge': 'technology',
    'techcrunch': 'technology',
    'android developers': 'technology',
    'github trending': 'technology',
    'mkbhd': 'technology',
    'bloomberg markets': 'finance',
    'wall street journal': 'finance',
    'propublica': 'investigative',
    'the intercept': 'investigative',
    'bellingcat': 'investigative',
    'vnexpress business': 'finance',
    'donga sports': undefined as any, // not in approved set — keep world
    'economist': 'finance',
};

const urlCategoryPatterns: Array<{ pattern: RegExp; category: FeedCategory }> = [
    { pattern: /\/technology\//i, category: 'technology' },
    { pattern: /\/tech\//i, category: 'technology' },
    { pattern: /\/science\//i, category: 'science' },
    { pattern: /\/climate\//i, category: 'climate' },
    { pattern: /\/environment\//i, category: 'climate' },
    { pattern: /\/business\//i, category: 'finance' },
    { pattern: /\/markets\//i, category: 'finance' },
    { pattern: /\/economy\//i, category: 'finance' },
    { pattern: /\/politics\//i, category: 'politics' },
    { pattern: /\/investigations?\//i, category: 'investigative' },
];

const europeCountries = new Set([
    'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE', 'PT', 'GR', 'AT',
    'HU', 'CZ', 'RO', 'BG', 'SE', 'DK', 'FI', 'IE', 'HR', 'SK',
    'SI', 'LT', 'LV', 'EE', 'CY', 'MT', 'LU', 'NO', 'CH', 'PL',
]);

// ── Classification Logic ─────────────────────────────────────────

function proposeCategory(feed: { name: string; url: string; countries: string[]; publisher: string }): FeedCategory | null {
    // 1. Name-based exact/lowercase match
    const nameLower = feed.name.toLowerCase();
    if (nameToCategory[nameLower] && allowedCategories.has(nameToCategory[nameLower])) {
        return nameToCategory[nameLower];
    }

    // 2. URL path-based patterns
    for (const { pattern, category } of urlCategoryPatterns) {
        if (pattern.test(feed.url)) {
            return category;
        }
    }

    // 3. Country-scoped world feeds → regional categories
    if (feed.countries.length === 1) {
        const country = feed.countries[0];
        if (country === 'US') return 'us';
        if (europeCountries.has(country)) return 'europe';
    }

    // 4. All countries in Europe → europe
    if (feed.countries.length > 0 && feed.countries.every((c) => europeCountries.has(c))) {
        return 'europe';
    }

    // 5. Finance keyword in name
    if (/markets?|finance|business|economy|stock/i.test(feed.name)) {
        return 'finance';
    }

    // 6. Technology keyword in name
    if (/tech|digital|software|app|code/i.test(feed.name)) {
        return 'technology';
    }

    // 7. Science keyword in name
    if (/science|research|journal/i.test(feed.name)) {
        return 'science';
    }

    // 8. Climate/environment in name
    if (/climate|environment|weather/i.test(feed.name)) {
        return 'climate';
    }

    // Fallback: leave as world (no proposal)
    return null;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
    const feedsPath = resolve('data/feeds.json');
    const raw = await readFile(feedsPath, 'utf8');
    const payload = JSON.parse(raw) as BootstrapPayload;

    const changes: Array<{ name: string; publisher: string; before: string; after: string }> = [];
    let changedCount = 0;

    const enriched = payload.feeds.map((feed) => {
        const proposed = proposeCategory(feed);
        if (proposed && proposed !== feed.category) {
            changes.push({
                name: feed.name,
                publisher: feed.publisher,
                before: feed.category,
                after: proposed,
            });
            changedCount++;
            return { ...feed, category: proposed };
        }
        return feed;
    });

    const categoryCounts: Record<string, number> = {};
    enriched.forEach((f) => {
        categoryCounts[f.category] = (categoryCounts[f.category] || 0) + 1;
    });

    const proposedPayload = {
        ...payload,
        generatedAt: new Date().toISOString(),
        stats: {
            feeds: enriched.length,
            duplicateIds: payload.stats.duplicateIds,
            duplicateUrls: payload.stats.duplicateUrls,
        },
        feeds: enriched,
        _proposed_changes: {
            totalChanges: changedCount,
            summary: categoryCounts,
            changes,
        },
    };

    const outPath = resolve('data/feeds.proposed.json');
    await writeFile(outPath, JSON.stringify(proposedPayload, null, 2) + '\n', 'utf8');

    process.stdout.write(`\n─── Category Enrichment Proposal ───\n`);
    process.stdout.write(`Total feeds: ${enriched.length}\n`);
    process.stdout.write(`Proposed changes: ${changedCount}\n\n`);

    process.stdout.write(`Category distribution after proposal:\n`);
    for (const [cat, count] of Object.entries(categoryCounts).sort()) {
        process.stdout.write(`  ${cat}: ${count}\n`);
    }

    process.stdout.write(`\nChanges:\n`);
    for (const change of changes) {
        process.stdout.write(`  "${change.name}" (${change.publisher}): ${change.before} → ${change.after}\n`);
    }

    process.stdout.write(`\nProposal written to: ${outPath}\n`);
    process.stdout.write(`Review the file, then rename to data/feeds.json and run npm run validate.\n`);
}

main().catch((error: unknown) => {
    console.error('[enrich-categories] Failed:', error);
    process.exit(1);
});