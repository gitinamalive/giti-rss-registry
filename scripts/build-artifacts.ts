import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface FeedEntry {
    id: string;
    name: string;
    publisher: string;
    url: string;
    language: string;
    countries: string[];
    category: string;
    perspective?: string;
    mediaType?: string;
    format?: string;
    official?: boolean;
    active?: boolean;
    healthScore?: number;
    notes?: string;
}

interface RegistryPayload {
    generatedAt: string;
    source: string;
    feeds: FeedEntry[];
}

const dataPath = resolve('data/feeds.json');
const distPath = resolve('dist');
const opmlPath = resolve(distPath, 'opml');

function escapeCsv(value: unknown): string {
    const raw = value == null ? '' : String(value);
    if (/[",\n]/.test(raw)) {
        return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
}

function escapeXml(value: string): string {
    return value.replace(/[&<>'"]/g, (char) => {
        switch (char) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case "'": return '&apos;';
            case '"': return '&quot;';
            default: return char;
        }
    });
}

function toFileSafeSegment(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
}

function buildIndex(feeds: FeedEntry[], selector: (entry: FeedEntry) => string[]): Record<string, FeedEntry[]> {
    const grouped: Record<string, FeedEntry[]> = {};

    feeds.forEach((feed) => {
        const keys = selector(feed).filter(Boolean);
        keys.forEach((key) => {
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(feed);
        });
    });

    Object.keys(grouped).forEach((key) => {
        grouped[key] = grouped[key].sort((a, b) => a.name.localeCompare(b.name));
    });

    return Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)));
}

function generateOpml(title: string, feeds: FeedEntry[]): string {
    const timestamp = new Date().toUTCString();
    const lines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<opml version="2.0">',
        '  <head>',
        `    <title>${escapeXml(title)}</title>`,
        `    <dateCreated>${escapeXml(timestamp)}</dateCreated>`,
        '  </head>',
        '  <body>'
    ];

    feeds
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((feed) => {
            lines.push(
                `    <outline type="rss" text="${escapeXml(feed.name)}" title="${escapeXml(feed.name)}" xmlUrl="${escapeXml(feed.url)}" />`
            );
        });

    lines.push('  </body>', '</opml>');
    return `${lines.join('\n')}\n`;
}

async function writeJson(relativePath: string, value: unknown): Promise<void> {
    const fullPath = resolve(distPath, relativePath);
    await mkdir(resolve(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeOpml(relativePath: string, title: string, feeds: FeedEntry[]): Promise<void> {
    const fullPath = resolve(opmlPath, relativePath);
    await mkdir(resolve(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, generateOpml(title, feeds), 'utf8');
}

async function main(): Promise<void> {
    const raw = await readFile(dataPath, 'utf8');
    const payload = JSON.parse(raw) as RegistryPayload;
    const feeds = payload.feeds;

    await mkdir(distPath, { recursive: true });
    await mkdir(opmlPath, { recursive: true });

    const byCountry = buildIndex(feeds, (f) => f.countries);
    const byCategory = buildIndex(feeds, (f) => [f.category]);
    const byPublisher = buildIndex(feeds, (f) => [f.publisher]);
    const byLanguage = buildIndex(feeds, (f) => [f.language]);

    await writeJson('feeds.json', feeds);

    const csvHeader = [
        'id', 'name', 'publisher', 'url', 'language', 'countries', 'category',
        'perspective', 'mediaType', 'format', 'official', 'active', 'healthScore', 'notes'
    ].join(',');
    const csvRows = feeds.map((feed) => [
        feed.id,
        feed.name,
        feed.publisher,
        feed.url,
        feed.language,
        feed.countries.join('|'),
        feed.category,
        feed.perspective ?? '',
        feed.mediaType ?? '',
        feed.format ?? '',
        feed.official ?? '',
        feed.active ?? '',
        feed.healthScore ?? '',
        feed.notes ?? ''
    ].map(escapeCsv).join(','));

    await writeFile(resolve(distPath, 'feeds.csv'), `${csvHeader}\n${csvRows.join('\n')}\n`, 'utf8');
    await writeJson('by-country.json', byCountry);
    await writeJson('by-category.json', byCategory);
    await writeJson('by-publisher.json', byPublisher);
    await writeJson('by-language.json', byLanguage);

    await writeOpml('all.opml', 'Giti RSS Registry — All Feeds', feeds);

    await Promise.all(Object.entries(byCountry).map(([country, entries]) =>
        writeOpml(`countries/${toFileSafeSegment(country)}.opml`, `Giti RSS Registry — Country: ${country}`, entries)
    ));

    await Promise.all(Object.entries(byCategory).map(([category, entries]) =>
        writeOpml(`categories/${toFileSafeSegment(category)}.opml`, `Giti RSS Registry — Category: ${category}`, entries)
    ));

    process.stdout.write(
        `Generated registry artifacts in ${distPath} (feeds: ${feeds.length}, countries: ${Object.keys(byCountry).length}, categories: ${Object.keys(byCategory).length}).\n`
    );
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[build-artifacts] Failed: ${message}`);
    process.exit(1);
});
