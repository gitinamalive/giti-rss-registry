/**
 * apply-https-upgrades.ts
 *
 * Reads dist/feeds-health.json, extracts HTTP to HTTPS upgrades,
 * and applies them to data/feeds.json.
 *
 * Usage: npx tsx scripts/apply-https-upgrades.ts
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function main() {
    const healthPath = resolve('dist/feeds-health.json');
    const feedsPath = resolve('data/feeds.json');

    const healthRaw = await readFile(healthPath, 'utf8');
    const healthPayload = JSON.parse(healthRaw);

    const feedsRaw = await readFile(feedsPath, 'utf8');
    const feeds = JSON.parse(feedsRaw);

    const upgradeMap = new Map<string, string>();
    for (const feed of healthPayload.feeds) {
        const original = feeds.feeds.find((f: any) => f.id === feed.id);
        if (original && original.url !== feed.url && original.url.startsWith('http://') && feed.url.startsWith('https://')) {
            upgradeMap.set(original.url, feed.url);
        }
    }

    let applied = 0;
    for (const feed of feeds.feeds) {
        if (upgradeMap.has(feed.url)) {
            feed.url = upgradeMap.get(feed.url)!;
            applied++;
        }
    }

    feeds.generatedAt = new Date().toISOString();
    await writeFile(feedsPath, JSON.stringify(feeds, null, 2) + '\n', 'utf8');

    console.log(`Applied ${applied} HTTP to HTTPS upgrades to ${feedsPath}`);
}

main().catch((error: unknown) => {
    console.error('[apply-https-upgrades] Failed:', error);
    process.exit(1);
});