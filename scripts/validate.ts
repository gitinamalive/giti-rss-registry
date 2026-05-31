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
    homepage?: string;
    language: string;
    countries: string[];
    region?: string;
    category: FeedCategory;
    tags?: string[];
    perspective?: Perspective;
    mediaType?: MediaType;
    format?: FeedFormat;
    official?: boolean;
    active?: boolean;
    lastCheckedAt?: string;
    lastItemPublishedAt?: string;
    healthScore?: number;
    notes?: string;
}

interface BootstrapPayload {
    generatedAt: string;
    source: string;
    stats: {
        feeds: number;
        duplicateIds: number;
        duplicateUrls: number;
    };
    warnings: {
        duplicateIds: string[];
        duplicateUrls: string[];
    };
    feeds: FeedEntry[];
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

function isPublicHostname(value: string): boolean {
    try {
        const host = new URL(value).hostname.toLowerCase();
        return !(
            host === 'localhost' ||
            host.startsWith('127.') ||
            host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            host.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
            host.startsWith('169.254.')
        );
    } catch {
        return false;
    }
}

function isLanguageCode(value: string): boolean {
    return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value);
}

function isIsoCountryCode(value: string): boolean {
    return /^[A-Z]{2}$/.test(value);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const fileArg = args.findIndex(arg => arg === '--file');
    const filePath = fileArg !== -1 && args[fileArg + 1] ? args[fileArg + 1] : 'data/feeds.json';
    const path = resolve(filePath);
    const raw = await readFile(path, 'utf8');
    const payload = JSON.parse(raw) as BootstrapPayload;

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!Array.isArray(payload.feeds)) {
        throw new Error('Invalid payload: feeds is not an array.');
    }

    const idDuplicates = findDuplicates(payload.feeds.map((f) => f.id).filter(Boolean));
    const urlDuplicates = findDuplicates(payload.feeds.map((f) => f.url).filter(Boolean));

    if (idDuplicates.length > 0) {
        errors.push(`Duplicate ids detected: ${idDuplicates.slice(0, 10).join(', ')}`);
    }

    if (urlDuplicates.length > 0) {
        errors.push(`Duplicate urls detected: ${urlDuplicates.slice(0, 10).join(', ')}`);
    }

    payload.feeds.forEach((feed, index) => {
        const prefix = `feeds[${index}]`;

        if (!feed.id?.trim()) errors.push(`${prefix}.id is required`);
        if (!feed.name?.trim()) errors.push(`${prefix}.name is required`);
        if (!feed.publisher?.trim()) errors.push(`${prefix}.publisher is required`);
        if (!feed.url?.trim()) errors.push(`${prefix}.url is required`);
        if (!feed.language?.trim()) errors.push(`${prefix}.language is required`);
        if (!Array.isArray(feed.countries)) errors.push(`${prefix}.countries must be an array`);
        if (!feed.category?.trim()) errors.push(`${prefix}.category is required`);

        if (feed.url && !isValidUrl(feed.url)) {
            errors.push(`${prefix}.url is not valid http/https URL`);
        } else if (feed.url && !isPublicHostname(feed.url)) {
            errors.push(`${prefix}.url host is not a public interface (potential SSRF)`);
        }
        if (feed.url?.startsWith('http://')) warnings.push(`${prefix}.url uses http (consider https)`);

        if (feed.language && !isLanguageCode(feed.language)) {
            errors.push(`${prefix}.language is not a valid language code`);
        }

        if (Array.isArray(feed.countries)) {
            feed.countries.forEach((country) => {
                if (!isIsoCountryCode(country)) {
                    errors.push(`${prefix}.countries has invalid ISO code: ${country}`);
                }
            });
        }

        if (feed.category && !allowedCategories.has(feed.category)) {
            errors.push(`${prefix}.category not in approved set: ${feed.category}`);
        }

        if (feed.format && !allowedFormats.has(feed.format)) {
            errors.push(`${prefix}.format not allowed: ${feed.format}`);
        }

        if (feed.mediaType && !allowedMediaTypes.has(feed.mediaType)) {
            errors.push(`${prefix}.mediaType not allowed: ${feed.mediaType}`);
        }

        if (feed.perspective && !allowedPerspectives.has(feed.perspective)) {
            errors.push(`${prefix}.perspective not allowed: ${feed.perspective}`);
        }
    });

    process.stdout.write(`Validated ${payload.feeds.length} feeds.\n`);
    process.stdout.write(`Warnings: ${warnings.length}\n`);
    if (warnings.length > 0) {
        process.stdout.write(`- Sample warnings: ${warnings.slice(0, 10).join(' | ')}\n`);
    }

    if (errors.length > 0) {
        process.stderr.write(`Validation failed with ${errors.length} error(s).\n`);
        process.stderr.write(`${errors.slice(0, 20).join('\n')}\n`);
        process.exitCode = 1;
        return;
    }

    process.stdout.write('Validation passed with no errors.\n');
}

main().catch((error: unknown) => {
    console.error(`[validate] Failed:`, error);
    process.exitCode = 1;
});
