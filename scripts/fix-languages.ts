/**
 * fix-languages.ts
 *
 * Applies language code corrections from data/language-fixes.json
 * to data/feeds.json. Handles BCP-47 language code corrections for
 * feeds miscoded as "en" when they publish in their native language.
 *
 * Usage: npx tsx scripts/fix-languages.ts
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BootstrapPayload } from '../src/types.ts';

const FEEDS_PATH = resolve('data/feeds.json');
const FIXES_PATH = resolve('data/language-fixes.json');

// Country → native BCP-47 language code
const countryToLanguage: Record<string, string> = {
  DE: 'de', AT: 'de', CH: 'de', LU: 'lb', // German-speaking (LU: Luxembourgish)
  FR: 'fr', BE: 'fr', // French-speaking
  ES: 'es', // Spanish
  IT: 'it', // Italian
  NL: 'nl', // Dutch
  SE: 'sv', // Swedish
  NO: 'no', // Norwegian
  DK: 'da', // Danish
  FI: 'fi', // Finnish
  IS: 'is', // Icelandic
  EE: 'et', // Estonian
  LV: 'lv', // Latvian
  LT: 'lt', // Lithuanian
  PL: 'pl', // Polish
  CZ: 'cs', // Czech
  SK: 'sk', // Slovak
  HU: 'hu', // Hungarian
  RO: 'ro', // Romanian
  BG: 'bg', // Bulgarian
  HR: 'hr', // Croatian
  SI: 'sl', // Slovenian
  GR: 'el', CY: 'el', // Greek
  PT: 'pt', // Portuguese
};

// Feeds with English-language editions that should REMAIN "en"
const englishEditions = new Set([
  'france-24-e1f73e0e',       // France 24 — English edition
  'deutsche-welle-en-ab508af0', // Deutsche Welle (EN)
  'der-spiegel-2bcc7bc8',    // Der Spiegel — International (English)
  'ansa-english-48611228',   // ANSA English
  'bellingcat-98c3c305',     // International platform in English
  'the-moscow-times-349ba18f', // Russian exile media in English
]);

async function main() {
  // Read existing feeds
  const feedsRaw = await readFile(FEEDS_PATH, 'utf8');
  const payload: BootstrapPayload = JSON.parse(feedsRaw);

  // Read explicit overrides (may be empty or partial)
  let explicitFixes: Record<string, string> = {};
  try {
    const fixesRaw = await readFile(FIXES_PATH, 'utf8');
    explicitFixes = JSON.parse(fixesRaw);
  } catch {
    console.log('No explicit fixes file found, using country-based derivation only.');
  }

  let applied = 0;
  const changes: string[] = [];

  for (const feed of payload.feeds) {
    // Skip feeds explicitly marked as English editions
    if (englishEditions.has(feed.id)) continue;

    // Derive language from country for feeds in non-English-speaking countries
    if (feed.language === 'en' && feed.countries.length > 0) {
      const derived = countryToLanguage[feed.countries[0]];
      if (derived && derived !== 'en') {
        const oldLang = feed.language;
        feed.language = derived;
        applied++;
        changes.push(`${feed.name} (${feed.countries[0]}): ${oldLang} → ${derived}`);
        continue;
      }
    }
  }

  // Apply any explicit overrides from the fixes file
  for (const [id, lang] of Object.entries(explicitFixes)) {
    const feed = payload.feeds.find(f => f.id === id);
    if (!feed) {
      console.log(`ID not found: ${id}`);
      continue;
    }
    if (feed.language !== lang) {
      const oldLang = feed.language;
      feed.language = lang;
      applied++;
      changes.push(`${feed.name}: ${oldLang} → ${lang} (explicit)`);
    }
  }

  payload.generatedAt = new Date().toISOString();
  payload.stats.feeds = payload.feeds.length;

  await writeFile(FEEDS_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  console.log(`\n─── Language Fix Summary ───`);
  console.log(`Applied: ${applied}`);
  if (changes.length > 0) {
    changes.forEach(c => console.log(`  • ${c}`));
  }

  // Show updated distribution
  const dist: Record<string, number> = {};
  for (const feed of payload.feeds) {
    dist[feed.language] = (dist[feed.language] || 0) + 1;
  }
  console.log(`\nLanguage distribution after fixes:`);
  Object.entries(dist)
    .sort(([, a], [, b]) => b - a)
    .forEach(([lang, count]) => console.log(`  ${lang}: ${count}`));
}

main().catch((error: unknown) => {
  console.error('[fix-languages] Failed:', error);
  process.exit(1);
});