import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type FeedFormat = 'rss' | 'atom' | 'jsonfeed' | 'rdf';
type MediaType = 'print' | 'tv' | 'radio' | 'digital' | 'wire' | 'aggregator';
type Perspective =
    | 'independent'
    | 'state-affiliated'
    | 'independent-exile'
    | 'regional'
    | 'state-monitor'
    | 'aggregator';
type FeedCategory =
    | 'world'
    | 'us'
    | 'europe'
    | 'technology'
    | 'ai'
    | 'space'
    | 'finance'
    | 'science'
    | 'climate'
    | 'politics'
    | 'investigative';

interface FeedEntry {
    id: string;
    name: string;
    publisher: string;
    url: string;
    language: string;
    countries: string[];
    category: FeedCategory;
    perspective?: Perspective;
    mediaType?: MediaType;
    format?: FeedFormat;
}

const allowedCategories = new Set<FeedCategory>([
    'world', 'us', 'europe', 'technology', 'ai', 'space', 'finance', 'science', 'climate', 'politics', 'investigative'
]);

const allowedFormats = new Set<FeedFormat>(['rss', 'atom', 'jsonfeed', 'rdf']);
const allowedMediaTypes = new Set<MediaType>(['print', 'tv', 'radio', 'digital', 'wire', 'aggregator']);
const allowedPerspectives = new Set<Perspective>([
    'independent', 'state-affiliated', 'independent-exile', 'regional', 'state-monitor', 'aggregator'
]);

function findDuplicates(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    values.forEach((value) => {
        if (seen.has(value)) duplicates.add(value);
        seen.add(value);
    });
    return [...duplicates];
}

function isValidUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

async function main(): Promise<void> {
    const path = resolve('data/feeds.json');
    const raw = await readFile(path, 'utf8');
    const payload = JSON.parse(raw);
    
    if (!payload.feeds || !Array.isArray(payload.feeds)) {
        console.error('Validation failed: Missing or invalid feeds array in data/feeds.json');
        process.exit(1);
    }
    
    const feeds: FeedEntry[] = payload.feeds;
    const errors: string[] = [];
    const warnings: string[] = [];

    const idDuplicates = findDuplicates(feeds.map((f) => f.id));
    const urlDuplicates = findDuplicates(feeds.map((f) => f.url));

    if (idDuplicates.length > 0) errors.push(`Duplicate ids: ${idDuplicates.join(', ')}`);
    if (urlDuplicates.length > 0) errors.push(`Duplicate urls: ${urlDuplicates.join(', ')}`);

    feeds.forEach((feed, index) => {
        const prefix = `feeds[${index}] (${feed.name || 'unnamed'})`;
        
        if (!feed.id) errors.push(`${prefix}: Missing id`);
        if (!feed.name) errors.push(`${prefix}: Missing name`);
        if (!feed.publisher) errors.push(`${prefix}: Missing publisher`);
        if (!feed.url || !isValidUrl(feed.url)) errors.push(`${prefix}: Invalid or missing URL`);
        if (!feed.language) errors.push(`${prefix}: Missing language`);
        if (!feed.category) {
            errors.push(`${prefix}: Missing category`);
        } else if (!allowedCategories.has(feed.category)) {
            errors.push(`${prefix}: Invalid category "${feed.category}"`);
        }

        if (feed.format && !allowedFormats.has(feed.format)) {
            errors.push(`${prefix}: Invalid format "${feed.format}"`);
        }
        if (feed.mediaType && !allowedMediaTypes.has(feed.mediaType)) {
            errors.push(`${prefix}: Invalid mediaType "${feed.mediaType}"`);
        }
        if (feed.perspective && !allowedPerspectives.has(feed.perspective)) {
            errors.push(`${prefix}: Invalid perspective "${feed.perspective}"`);
        }

        if (feed.url?.startsWith('http://')) {
            warnings.push(`${prefix}: Uses insecure HTTP`);
        }
    });

    if (warnings.length > 0) {
        console.warn(`Validation warnings (${warnings.length}):`);
        warnings.slice(0, 5).forEach(w => console.warn(` - ${w}`));
        if (warnings.length > 5) console.warn(`   ... and ${warnings.length - 5} more`);
    }

    if (errors.length > 0) {
        console.error(`Validation failed with ${errors.length} error(s):`);
        errors.slice(0, 10).forEach(e => console.error(` - ${e}`));
        if (errors.length > 10) console.error(`   ... and ${errors.length - 10} more`);
        process.exit(1);
    }

    console.log(`Validation passed: ${feeds.length} feeds verified.`);
}

main().catch(console.error);
