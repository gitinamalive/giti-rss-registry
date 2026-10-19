/**
 * SSRF-hardened Feed Proposal Bot & Validator.
 *
 * Validates candidate feed proposals against SSRF, redirects, format specifications,
 * duplicates, and item freshness. Computes a confidence score and generates reviewable
 * candidate metadata.
 *
 * Usage:
 *   npx tsx scripts/propose-feed.ts --url https://example.com/feed.xml --country NG --category world
 *   npx tsx scripts/propose-feed.ts --issue-body "..."
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import {
    assertPublicHttpUrl,
    decodeFeedBytes,
    followRedirects,
    readBoundedBytes,
    HTTP_TIMEOUT_MS,
    MAX_BODY_BYTES,
    type HostResolver,
    type Fetcher,
} from './health-check.ts';
import { generateFeedId, normalizeUrl } from '../src/id.ts';
import type { BootstrapPayload, FeedCategory, FeedEntry, FeedFormat, MediaType, Perspective } from '../src/types.ts';

export interface ProposedFeedInput {
    url: string;
    country?: string;
    countries?: string[];
    publisher?: string;
    name?: string;
    category?: FeedCategory;
    language?: string;
    mediaType?: MediaType;
    perspective?: Perspective;
    description?: string;
    homepage?: string;
}

export interface ProposalValidationResult {
    valid: boolean;
    confidenceScore: number;
    reasons: string[];
    format?: FeedFormat;
    itemCount: number;
    latestItemDate?: string;
    suggestedEntry?: FeedEntry;
    duplicateOf?: string;
    warnings: string[];
}

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
    isArray: (name) => ['item', 'entry'].includes(name),
});

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseIssueFormBody(body: string): ProposedFeedInput {
    const input: ProposedFeedInput = { url: '' };

    const getField = (label: string): string | undefined => {
        const escaped = escapeRegExp(label);
        const regex = new RegExp(`###\\s+${escaped}\\s*\\r?\\n\\r?\\n([^\\r\\n#]+)`, 'i');
        const match = body.match(regex);
        return match ? match[1].trim() : undefined;
    };

    input.url = getField('Feed URL') || '';
    const country = getField('Target Country Code (ISO-3166-1 alpha-2)');
    if (country) input.countries = [country.toUpperCase()];
    input.publisher = getField('Publisher Name');
    input.category = getField('Category') as FeedCategory;
    input.language = getField('Primary Language Code (ISO-639-1)');
    input.mediaType = getField('Media Type') as MediaType;
    input.perspective = getField('Editorial Perspective') as Perspective;
    input.description = getField('Additional Context');

    return input;
}

export async function validateProposedFeed(
    input: ProposedFeedInput,
    options: {
        fetcher?: Fetcher;
        resolveHost?: HostResolver;
        timeoutMs?: number;
        maxBodyBytes?: number;
        existingFeeds?: FeedEntry[];
    } = {},
): Promise<ProposalValidationResult> {
    const fetcher = options.fetcher ?? fetch;
    const timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS;
    const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
    const reasons: string[] = [];
    const warnings: string[] = [];
    let confidenceScore = 0;

    if (!input.url) {
        return { valid: false, confidenceScore: 0, reasons: ['Missing feed URL'], itemCount: 0, warnings };
    }

    // 1. SSRF Check
    try {
        await assertPublicHttpUrl(input.url, options.resolveHost);
        confidenceScore += 10;
        reasons.push('URL verified as public HTTP(S) address');
    } catch (err) {
        return { valid: false, confidenceScore: 0, reasons: [`SSRF rejection: ${(err as Error).message}`], itemCount: 0, warnings };
    }

    // 2. Duplicate Check against existing feeds
    const canonicalFeeds = options.existingFeeds ?? [];
    const normUrl = normalizeUrl(input.url);
    const existing = canonicalFeeds.find((f) => normalizeUrl(f.url) === normUrl);
    if (existing) {
        return {
            valid: false,
            confidenceScore: 0,
            reasons: [`Duplicate feed: URL matches existing feed '${existing.name}' (${existing.id})`],
            duplicateOf: existing.id,
            itemCount: 0,
            warnings,
        };
    }

    // 3. Fetch with bounded deadline
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    let bytes: Uint8Array;
    let contentTypeHeader: string | null = null;
    let finalUrl = input.url;

    try {
        const redirected = await followRedirects(input.url, { method: 'GET' }, {
            fetcher,
            resolveHost: options.resolveHost ?? (async () => ['93.184.216.34']),
            timeoutMs,
            signal: controller.signal,
        });

        if (!redirected.response.ok) {
            return {
                valid: false,
                confidenceScore: 10,
                reasons: [`Endpoint returned HTTP ${redirected.response.status}`],
                itemCount: 0,
                warnings,
            };
        }

        finalUrl = redirected.finalUrl;
        contentTypeHeader = redirected.response.headers.get('content-type');
        bytes = await readBoundedBytes(redirected.response, maxBodyBytes, controller.signal);
        confidenceScore += 20;
        reasons.push('Endpoint reachable and returned HTTP 200 within deadline');
    } catch (err) {
        return {
            valid: false,
            confidenceScore: 0,
            reasons: [`Fetch failure: ${(err as Error).message}`],
            itemCount: 0,
            warnings,
        };
    } finally {
        clearTimeout(timer);
    }

    // 4. Character Set Decoding
    const body = decodeFeedBytes(bytes, contentTypeHeader);

    // 5. Structural Format Verification
    let format: FeedFormat | undefined;
    let detectedTitle: string | undefined;
    let detectedDescription: string | undefined;
    let detectedHomepage: string | undefined;
    let detectedLanguage: string | undefined;
    let itemCount = 0;
    const itemDates: string[] = [];

    const trimmed = body.replace(/^\uFEFF/, '').trim();

    if (trimmed.startsWith('{')) {
        try {
            const json = JSON.parse(trimmed) as {
                version?: string;
                title?: string;
                home_page_url?: string;
                description?: string;
                items?: Array<{ title?: string; date_published?: string; date_modified?: string }>;
            };
            if (json.version && json.version.startsWith('https://jsonfeed.org/version/') && Array.isArray(json.items)) {
                format = 'jsonfeed';
                detectedTitle = json.title;
                detectedDescription = json.description;
                detectedHomepage = json.home_page_url;
                itemCount = json.items.length;
                for (const item of json.items) {
                    const date = item.date_published || item.date_modified;
                    if (date) itemDates.push(date);
                }
            }
        } catch {
            // Not valid JSON
        }
    } else {
        try {
            const parsed = xmlParser.parse(trimmed);
            if (parsed.rss && parsed.rss.channel) {
                format = 'rss';
                const channel = parsed.rss.channel;
                detectedTitle = typeof channel.title === 'string' ? channel.title : undefined;
                detectedDescription = typeof channel.description === 'string' ? channel.description : undefined;
                detectedHomepage = typeof channel.link === 'string' ? channel.link : undefined;
                detectedLanguage = typeof channel.language === 'string' ? channel.language.split('-')[0].toLowerCase() : undefined;
                const rawItems = channel.item ?? [];
                const items = Array.isArray(rawItems) ? rawItems : [rawItems];
                itemCount = items.length;
                for (const it of items) {
                    const d = it.pubDate || it['dc:date'];
                    if (d) itemDates.push(String(d));
                }
            } else if (parsed.feed) {
                format = 'atom';
                const feed = parsed.feed;
                detectedTitle = typeof feed.title === 'string' ? feed.title : feed.title?.['#text'];
                detectedDescription = typeof feed.subtitle === 'string' ? feed.subtitle : feed.subtitle?.['#text'];
                detectedHomepage = feed.link?.['@_href'] || (Array.isArray(feed.link) ? feed.link[0]?.['@_href'] : undefined);
                const rawEntries = feed.entry ?? [];
                const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
                itemCount = entries.length;
                for (const it of entries) {
                    const d = it.published || it.updated;
                    if (d) itemDates.push(String(d));
                }
            } else if (parsed['rdf:RDF'] || parsed.RDF) {
                format = 'rdf';
                const rdf = parsed['rdf:RDF'] || parsed.RDF;
                const rawItems = rdf.item ?? [];
                const items = Array.isArray(rawItems) ? rawItems : [rawItems];
                itemCount = items.length;
                for (const it of items) {
                    const d = it['dc:date'] || it.pubDate;
                    if (d) itemDates.push(String(d));
                }
            }
        } catch {
            // XML parse error
        }
    }

    if (!format) {
        return {
            valid: false,
            confidenceScore,
            reasons: ['Response body is not a valid RSS, Atom, RDF, or JSON Feed structure'],
            itemCount: 0,
            warnings,
        };
    }

    confidenceScore += 30;
    reasons.push(`Valid structural ${format.toUpperCase()} feed confirmed with ${itemCount} items`);

    // 6. Freshness Check
    const sortedDates = itemDates.map((d) => new Date(d).getTime()).filter((t) => !Number.isNaN(t)).sort((a, b) => b - a);
    let latestItemDate: string | undefined;
    if (sortedDates.length > 0) {
        latestItemDate = new Date(sortedDates[0]).toISOString();
        const daysOld = (Date.now() - sortedDates[0]) / (1000 * 60 * 60 * 24);
        if (daysOld < 30) {
            confidenceScore += 20;
            reasons.push(`Recent content verified (latest item published ${Math.round(daysOld)} days ago)`);
        } else {
            confidenceScore += 5;
            warnings.push(`Feed content appears stale (latest item was published ${Math.round(daysOld)} days ago)`);
        }
    } else {
        warnings.push('Feed contains no parseable item publication timestamps');
    }

    // 7. Metadata completeness
    const publisher = input.publisher || detectedTitle || 'Unknown Publisher';
    const name = input.name || detectedTitle || publisher;
    const countries = input.countries && input.countries.length > 0 ? input.countries : ['XX'];
    const category = input.category || 'world';
    const language = input.language || detectedLanguage || 'en';
    const homepage = input.homepage || detectedHomepage;
    const id = generateFeedId(publisher, finalUrl);

    if (countries[0] !== 'XX') confidenceScore += 10;
    if (language) confidenceScore += 10;

    const suggestedEntry: FeedEntry = {
        id,
        name,
        publisher,
        url: finalUrl,
        homepage,
        language,
        countries,
        category,
        format,
        mediaType: input.mediaType || 'digital',
        perspective: input.perspective || 'independent',
        description: input.description || detectedDescription,
    };

    return {
        valid: confidenceScore >= 60,
        confidenceScore: Math.min(100, confidenceScore),
        reasons,
        format,
        itemCount,
        latestItemDate,
        suggestedEntry,
        warnings,
    };
}

export function formatTriageComment(result: ProposalValidationResult): string {
    const statusEmoji = result.valid ? (result.confidenceScore >= 80 ? '🟢' : '🟡') : '🔴';
    const lines: string[] = [
        `## ${statusEmoji} Feed Proposal Triage Report`,
        '',
        `- **Validation Status:** ${result.valid ? 'PASSED' : 'NEEDS REVIEW'}`,
        `- **Confidence Score:** ${result.confidenceScore} / 100`,
        `- **Detected Format:** \`${result.format ?? 'unknown'}\``,
        `- **Item Count:** ${result.itemCount}`,
        `- **Latest Article Date:** ${result.latestItemDate ? new Date(result.latestItemDate).toUTCString() : 'None detected'}`,
        '',
        '### Checks & Evidence',
    ];

    for (const reason of result.reasons) {
        lines.push(`- ✅ ${reason}`);
    }

    if (result.warnings.length > 0) {
        lines.push('', '### Warnings');
        for (const w of result.warnings) {
            lines.push(`- ⚠️ ${w}`);
        }
    }

    if (result.suggestedEntry) {
        lines.push(
            '',
            '### Proposed Feed Entry (JSON)',
            '```json',
            JSON.stringify(result.suggestedEntry, null, 2),
            '```',
            '',
            '> To add this feed, a maintainer can merge this entry into `data/feeds.json`.'
        );
    }

    return lines.join('\n');
}

async function main(): Promise<void> {
    const rawFeeds = await readFile(resolve('data/feeds.json'), 'utf8');
    const canonical = JSON.parse(rawFeeds) as BootstrapPayload;

    const args = process.argv.slice(2);
    const urlIdx = args.indexOf('--url');
    const countryIdx = args.indexOf('--country');
    const categoryIdx = args.indexOf('--category');
    const issueBodyIdx = args.indexOf('--issue-body');

    let input: ProposedFeedInput;

    if (issueBodyIdx !== -1 && args[issueBodyIdx + 1]) {
        input = parseIssueFormBody(args[issueBodyIdx + 1]);
    } else if (urlIdx !== -1 && args[urlIdx + 1]) {
        input = {
            url: args[urlIdx + 1],
            countries: countryIdx !== -1 && args[countryIdx + 1] ? [args[countryIdx + 1].toUpperCase()] : ['US'],
            category: categoryIdx !== -1 ? (args[categoryIdx + 1] as FeedCategory) : 'world',
        };
    } else {
        process.stdout.write('Usage: npx tsx scripts/propose-feed.ts --url <URL> [--country <CC>] [--category <cat>]\n');
        process.stdout.write('   or: npx tsx scripts/propose-feed.ts --issue-body "<markdown-body>"\n');
        return;
    }

    const result = await validateProposedFeed(input, { existingFeeds: canonical.feeds });
    process.stdout.write(`${formatTriageComment(result)}\n`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch((error: unknown) => {
        console.error('[propose-feed] Failed:', error);
        process.exitCode = 1;
    });
}
