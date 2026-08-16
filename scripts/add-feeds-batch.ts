/**
 * Batch feed addition script for the giti-rss-registry.
 *
 * Reads a JSON array of proposed new feeds from stdin or a file,
 * validates each against the schema, checks for URL/ID duplicates
 * against the existing registry, and merges them into feeds.json.
 *
 * Usage:
 *   npx tsx scripts/add-feeds-batch.ts < new-feeds.json
 *   npx tsx scripts/add-feeds-batch.ts --file new-feeds.json
 */

import { readFile, rename, writeFile } from 'fs/promises';
import { generateFeedId, normalizeUrl } from '../src/id.ts';
import { validateFeedEntry } from './validate.ts';
import type { FeedEntry, BootstrapPayload } from '../src/types.ts';

const FEEDS_PATH = new URL('../data/feeds.json', import.meta.url).pathname.replace(/^\/([A-Z]):/, '$1:');

async function main() {
  // Read existing registry
  const raw = await readFile(FEEDS_PATH, 'utf8');
  const payload: BootstrapPayload = JSON.parse(raw);
  const existing = payload.feeds;
  const existingUrls = new Set(existing.map(f => f.url.toLowerCase()));
  const existingNormUrls = new Set(existing.map(f => normalizeUrl(f.url)));
  const existingIds = new Set(existing.map(f => f.id));
  const existingNames = new Set(existing.map(f => f.name.toLowerCase()));

  // Read proposed feeds
  const fileArg = process.argv.find(a => a.startsWith('--file='));
  let proposedJson: string;
  if (fileArg) {
    const filePath = fileArg.split('=')[1];
    proposedJson = await readFile(filePath, 'utf8');
  } else {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    proposedJson = Buffer.concat(chunks).toString('utf8');
  }

  let proposed: Partial<FeedEntry>[];
  try {
    proposed = JSON.parse(proposedJson);
    if (!Array.isArray(proposed)) throw new Error('Input must be a JSON array');
  } catch (e: any) {
    console.error(`Failed to parse input JSON: ${e.message}`);
    process.exit(1);
  }

  const added: FeedEntry[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const raw of proposed) {
    const name = raw.name ?? '';
    const url = raw.url ?? '';
    const publisher = raw.publisher ?? '';

    // Build the prospective feed entry first (defaults + canonical ID).
    const feed: FeedEntry = {
      id: raw.id || generateFeedId(publisher, url),
      name,
      publisher,
      url,
      language: raw.language || 'en',
      countries: raw.countries || [],
      category: raw.category || 'world',
      mediaType: raw.mediaType || 'digital',
      format: raw.format || 'rss',
    };

    // Optional fields
    if (raw.homepage) feed.homepage = raw.homepage;
    if (raw.description) feed.description = raw.description;
    if (raw.tags && raw.tags.length > 0) feed.tags = raw.tags;
    if (raw.perspective) feed.perspective = raw.perspective;
    if (raw.active !== undefined) feed.active = raw.active;
    if (raw.healthScore !== undefined) feed.healthScore = raw.healthScore;
    if (raw.lastCheckedAt) feed.lastCheckedAt = raw.lastCheckedAt;
    if (raw.lastItemPublishedAt) feed.lastItemPublishedAt = raw.lastItemPublishedAt;

    // Validate the complete entry against the shared rules.
    const validation = validateFeedEntry(feed, proposed.indexOf(raw));
    if (validation.errors.length > 0) {
      skipped.push({ name: name || '(unnamed)', reason: `Validation: ${validation.errors.join('; ')}` });
      continue;
    }

    // Check duplicates (exact and normalized URL) and ID collisions
    if (existingUrls.has(url.toLowerCase())) {
      skipped.push({ name, reason: `URL already exists: ${url}` });
      continue;
    }
    if (existingNormUrls.has(normalizeUrl(url))) {
      skipped.push({ name, reason: `URL already exists (normalized): ${url}` });
      continue;
    }
    if (existingIds.has(feed.id)) {
      skipped.push({ name, reason: `ID collision: ${feed.id}` });
      continue;
    }

    // Check name similarity (warn but don't block)
    if (existingNames.has(name.toLowerCase())) {
      skipped.push({ name, reason: `Name already exists (case-insensitive): ${name}` });
      continue;
    }

    existing.push(feed);
    existingUrls.add(url.toLowerCase());
    existingNormUrls.add(normalizeUrl(url));
    existingIds.add(feed.id);
    existingNames.add(name.toLowerCase());
    added.push(feed);
  }

  // Update stats
  payload.stats.feeds = existing.length;
  payload.stats.duplicateIds = 0;
  payload.stats.duplicateUrls = 0;
  payload.warnings = { duplicateIds: [], duplicateUrls: [] };
  payload.generatedAt = new Date().toISOString();

  // Write atomically so a mid-batch failure never leaves feeds.json partial.
  // A no-op import must not rewrite the file (avoids churning generatedAt).
  if (added.length > 0) {
    const tempPath = `${FEEDS_PATH}.tmp`;
    await writeFile(tempPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    await rename(tempPath, FEEDS_PATH);
  } else {
    console.log('No feeds were added — feeds.json was not modified.');
  }

  // Report
  console.log(`\n─── Batch Add Summary ───`);
  console.log(`Added: ${added.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Total feeds now: ${existing.length}`);

  if (added.length > 0) {
    console.log(`\nAdded feeds:`);
    added.forEach(f => console.log(`  + ${f.name} (${f.category}) ← ${f.url}`));
  }

  if (skipped.length > 0) {
    console.log(`\nSkipped:`);
    skipped.forEach(s => console.log(`  - ${s.name}: ${s.reason}`));
  }
}

main().catch((error: unknown) => {
  console.error('[add-feeds-batch] Failed:', error);
  process.exitCode = 1;
});