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

import { readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { FeedEntry, BootstrapPayload, allowedCategories, allowedFormats, allowedMediaTypes, allowedPerspectives } from '../src/types.js';

const FEEDS_PATH = new URL('../data/feeds.json', import.meta.url).pathname.replace(/^\/([A-Z]):/, '$1:');

function generateId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const hash = createHash('sha256').update(name).digest('hex').substring(0, 8);
  return `${slug}-${hash}`;
}

function validateNewFeed(feed: Partial<FeedEntry>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!feed.name || typeof feed.name !== 'string') errors.push('name is required and must be a string');
  if (!feed.url || typeof feed.url !== 'string') errors.push('url is required and must be a string');
  if (feed.url && !/^https?:\/\/.+/.test(feed.url)) errors.push('url must start with http:// or https://');
  if (!feed.publisher || typeof feed.publisher !== 'string') errors.push('publisher is required and must be a string');

  if (feed.language && typeof feed.language !== 'string') errors.push('language must be a string (BCP-47)');

  if (feed.countries) {
    if (!Array.isArray(feed.countries)) {
      errors.push('countries must be an array of ISO 3166-1 alpha-2 codes');
    } else if (!feed.countries.every((c: string) => /^[A-Z]{2}$/.test(c))) {
      errors.push('each country must be a 2-letter ISO 3166-1 alpha-2 code');
    }
  }

  if (feed.category) {
    if (typeof feed.category !== 'string') {
      errors.push('category must be a string');
    } else if (!allowedCategories.has(feed.category)) {
      errors.push(`category "${feed.category}" is not in allowed set: ${[...allowedCategories].join(', ')}`);
    }
  }

  if (feed.format && !allowedFormats.has(feed.format)) {
    errors.push(`format "${feed.format}" is not in allowed set: ${[...allowedFormats].join(', ')}`);
  }

  if (feed.mediaType && !allowedMediaTypes.has(feed.mediaType)) {
    errors.push(`mediaType "${feed.mediaType}" is not in allowed set: ${[...allowedMediaTypes].join(', ')}`);
  }

  if (feed.perspective && !allowedPerspectives.has(feed.perspective)) {
    errors.push(`perspective "${feed.perspective}" is not in allowed set: ${[...allowedPerspectives].join(', ')}`);
  }

  if (feed.homepage && typeof feed.homepage !== 'string') errors.push('homepage must be a string if provided');
  if (feed.description && typeof feed.description !== 'string') errors.push('description must be a string if provided');

  if (feed.tags) {
    if (!Array.isArray(feed.tags)) {
      errors.push('tags must be an array of strings');
    } else if (!feed.tags.every((t: string) => typeof t === 'string')) {
      errors.push('each tag must be a string');
    }
  }

  return { valid: errors.length === 0, errors };
}

async function main() {
  // Read existing registry
  const raw = await readFile(FEEDS_PATH, 'utf8');
  const payload: BootstrapPayload = JSON.parse(raw);
  const existing = payload.feeds;
  const existingUrls = new Set(existing.map(f => f.url.toLowerCase()));
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
    // Validate
    const validation = validateNewFeed(raw);
    if (!validation.valid) {
      skipped.push({ name: raw.name || '(unnamed)', reason: `Validation: ${validation.errors.join('; ')}` });
      continue;
    }

    const name = raw.name!;
    const url = raw.url!;

    // Check duplicates
    if (existingUrls.has(url.toLowerCase())) {
      skipped.push({ name, reason: `URL already exists: ${url}` });
      continue;
    }

    // Check name similarity (warn but don't block)
    if (existingNames.has(name.toLowerCase())) {
      skipped.push({ name, reason: `Name already exists (case-insensitive): ${name}` });
      continue;
    }

    // Generate ID
    const id = raw.id || generateId(name);
    if (existingIds.has(id)) {
      skipped.push({ name, reason: `ID collision: ${id}` });
      continue;
    }

    // Build the feed entry
    const feed: FeedEntry = {
      id,
      name,
      publisher: raw.publisher!,
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

    existing.push(feed);
    existingUrls.add(url.toLowerCase());
    existingIds.add(id);
    existingNames.add(name.toLowerCase());
    added.push(feed);
  }

  // Update stats
  payload.stats.feeds = existing.length;
  payload.generatedAt = new Date().toISOString();

  // Write back
  await writeFile(FEEDS_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');

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

main().catch(console.error);