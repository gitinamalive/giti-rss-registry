/**
 * label-perspective.ts
 *
 * Applies perspective labels from a structured proposals file to feeds.json.
 * Each proposal must include a cited rationale per CONTRIBUTING.md's
 * perspective labeling policy.
 *
 * Usage:
 *   npx tsx scripts/label-perspective.ts [--file data/perspective-proposals.json]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BootstrapPayload, FeedEntry, Perspective } from '../src/types.ts';
import { allowedPerspectives } from '../src/types.ts';

interface PerspectiveProposal {
  id: string;
  perspective: Perspective;
  rationale: string;
  sources: string[];
}

const FEEDS_PATH = resolve('data/feeds.json');
const DEFAULT_PROPOSALS = resolve('data/perspective-proposals.json');

async function main() {
  const fileArg = process.argv.find(a => a.startsWith('--file='));
  const proposalsPath = fileArg ? resolve(fileArg.split('=')[1]) : DEFAULT_PROPOSALS;

  const proposalsRaw = await readFile(proposalsPath, 'utf8');
  const proposals: PerspectiveProposal[] = JSON.parse(proposalsRaw);

  const feedsRaw = await readFile(FEEDS_PATH, 'utf8');
  const payload: BootstrapPayload = JSON.parse(feedsRaw);

  const feedMap = new Map<string, FeedEntry>();
  for (const feed of payload.feeds) {
    feedMap.set(feed.id, feed);
  }

  let applied = 0;
  const skipped: string[] = [];
  const appliedFeeds: string[] = [];

  for (const proposal of proposals) {
    const feed = feedMap.get(proposal.id);
    if (!feed) {
      skipped.push(`ID not found: ${proposal.id}`);
      continue;
    }

    if (!allowedPerspectives.has(proposal.perspective)) {
      skipped.push(`Invalid perspective "${proposal.perspective}" for ${feed.name}`);
      continue;
    }

    if (!proposal.rationale || proposal.rationale.trim().length === 0) {
      skipped.push(`Missing rationale for ${feed.name}`);
      continue;
    }

    if (!proposal.sources || proposal.sources.length === 0) {
      skipped.push(`Missing sources for ${feed.name}`);
      continue;
    }

    feed.perspective = proposal.perspective;

    // Store rationale + sources in notes field (schema-compatible)
    const sourcesList = proposal.sources.map((s, i) => `  [${i + 1}] ${s}`).join('\n');
    feed.notes = `${proposal.rationale}\n\nSources:\n${sourcesList}`;

    applied++;
    appliedFeeds.push(`${feed.name} → ${proposal.perspective}`);
  }

  payload.generatedAt = new Date().toISOString();
  payload.stats.feeds = payload.feeds.length;

  await writeFile(FEEDS_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  console.log(`\n─── Perspective Labeling Summary ───`);
  console.log(`Applied: ${applied}`);
  console.log(`Skipped: ${skipped.length}`);

  if (appliedFeeds.length > 0) {
    console.log(`\nApplied labels:`);
    appliedFeeds.forEach(f => console.log(`  • ${f}`));
  }

  if (skipped.length > 0) {
    console.log(`\nSkipped:`);
    skipped.forEach(s => console.log(`  • ${s}`));
  }

  // Show current distribution
  const dist: Record<string, number> = {};
  for (const feed of payload.feeds) {
    if (feed.perspective) {
      dist[feed.perspective] = (dist[feed.perspective] || 0) + 1;
    }
  }
  console.log(`\nPerspective distribution:`);
  for (const [p, count] of Object.entries(dist).sort()) {
    console.log(`  ${p}: ${count}`);
  }
  const unlabeled = payload.feeds.length - Object.values(dist).reduce((a, b) => a + b, 0);
  console.log(`  (unlabeled): ${unlabeled}`);
}

main().catch((error: unknown) => {
  console.error('[label-perspective] Failed:', error);
  process.exit(1);
});