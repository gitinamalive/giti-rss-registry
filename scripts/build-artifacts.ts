import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Script } from 'node:vm';
import type { FeedEntry, BootstrapPayload } from '../src/types.ts';
import { toFileSafeSegment } from '../src/escape.ts';
import { findPossibleDuplicateUrls } from '../src/urlFingerprint.ts';
import {
    ISO_3166_1_ALPHA2_COUNTRIES,
    buildCountryCoverageMatrix,
} from '../src/countries.ts';
import { buildIndex } from '../src/artifacts/indexes.ts';
import { CSV_COLUMNS, generateCsv } from '../src/artifacts/csv.ts';
import { generateOpml } from '../src/artifacts/opml.ts';
import {
    GENERATOR_VERSION,
    SCHEMA_VERSION,
    createDuplicateReport,
    createManifest,
    type ArtifactHashEntry,
    type RegistryManifest,
} from '../src/artifacts/manifest.ts';
import { DIRECTORY_CSP, generateIndexHtml } from '../src/artifacts/html.ts';

export {
    CSV_COLUMNS,
    DIRECTORY_CSP,
    GENERATOR_VERSION,
    SCHEMA_VERSION,
    buildIndex,
    createDuplicateReport,
    createManifest,
    generateCsv,
    generateIndexHtml,
    generateOpml,
    type ArtifactHashEntry,
    type RegistryManifest,
};

const execFileAsync = promisify(execFile);
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = resolve(THIS_DIR, '../src/artifacts/static');

const args = process.argv.slice(2);
const fileArg = args.findIndex((arg) => arg === '--file');
const outArg = args.findIndex((arg) => arg === '--out');

const filePath = fileArg !== -1 && args[fileArg + 1] ? args[fileArg + 1] : 'data/feeds.json';
const outPath = outArg !== -1 && args[outArg + 1] ? args[outArg + 1] : 'dist';

const bootstrapPath = resolve(filePath);
const distPath = resolve(outPath);
const opmlPath = resolve(distPath, 'opml');

async function writeJson(relativePath: string, value: unknown): Promise<void> {
    const fullPath = resolve(distPath, relativePath);
    await mkdir(resolve(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function getSourceCommit(): Promise<string> {
    try {
        const result = await execFileAsync('git', ['rev-parse', 'HEAD']);
        return result.stdout.trim();
    } catch {
        return 'unknown';
    }
}

async function writeOpml(relativePath: string, title: string, feeds: FeedEntry[], generatedAt?: string): Promise<void> {
    const fullPath = resolve(opmlPath, relativePath);
    await mkdir(resolve(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, generateOpml(title, feeds, generatedAt), 'utf8');
}

async function main(): Promise<void> {
    const raw = await readFile(bootstrapPath, 'utf8');
    const payload = JSON.parse(raw) as BootstrapPayload;
    const feeds = payload.feeds;
    const generatedAt = payload.generatedAt;
    const sourceChecksum = createHash('sha256').update(raw.replace(/\r\n/g, '\n')).digest('hex');
    const sourceCommit = await getSourceCommit();

    await mkdir(distPath, { recursive: true });
    await mkdir(opmlPath, { recursive: true });

    const byCountry = buildIndex(feeds, (f) => f.countries);
    const byCategory = buildIndex(feeds, (f) => [f.category]);
    const byPublisher = buildIndex(feeds, (f) => [f.publisher]);
    const byLanguage = buildIndex(feeds, (f) => [f.language]);

    await writeJson('feeds.json', feeds);
    await writeJson('countries.json', ISO_3166_1_ALPHA2_COUNTRIES);
    await writeFile(resolve(distPath, 'feeds.csv'), generateCsv(feeds), 'utf8');
    await writeJson('by-country.json', byCountry);
    await writeJson('by-category.json', byCategory);
    await writeJson('by-publisher.json', byPublisher);
    await writeJson('by-language.json', byLanguage);

    const coverageMatrix = buildCountryCoverageMatrix(feeds);
    await writeJson('coverage-matrix.json', coverageMatrix);

    await writeOpml('all.opml', 'Giti RSS Registry \u2014 All Feeds', feeds, generatedAt);

    for (const [country, entries] of Object.entries(byCountry)) {
        await writeOpml(`countries/${toFileSafeSegment(country)}.opml`, `Giti RSS Registry \u2014 Country: ${country}`, entries, generatedAt);
    }

    for (const [category, entries] of Object.entries(byCategory)) {
        await writeOpml(`categories/${toFileSafeSegment(category)}.opml`, `Giti RSS Registry \u2014 Category: ${category}`, entries, generatedAt);
    }

    const possibleDuplicates = findPossibleDuplicateUrls(feeds);
    await writeJson('duplicate-report.json', createDuplicateReport(possibleDuplicates, generatedAt, sourceChecksum));

    // Write static directory assets and verify client JS syntax with node:vm
    const [stylesCss, appJs] = await Promise.all([
        readFile(resolve(STATIC_DIR, 'styles.css'), 'utf8'),
        readFile(resolve(STATIC_DIR, 'app.js'), 'utf8'),
    ]);
    new Script(appJs, { filename: 'dist/app.js' });

    const html = generateIndexHtml(feeds, generatedAt);
    await Promise.all([
        writeFile(resolve(distPath, 'styles.css'), stylesCss, 'utf8'),
        writeFile(resolve(distPath, 'app.js'), appJs, 'utf8'),
        writeFile(resolve(distPath, 'index.html'), html, 'utf8'),
    ]);

    const artifactsMap: Record<string, ArtifactHashEntry> = {};
    const trackedArtifactFiles = [
        'feeds.json',
        'feeds.csv',
        'countries.json',
        'by-country.json',
        'by-category.json',
        'by-publisher.json',
        'by-language.json',
        'coverage-matrix.json',
        'feeds-health.json',
        'duplicate-report.json',
        'opml/all.opml',
        'index.html',
        'styles.css',
        'app.js',
    ];

    for (const relFile of trackedArtifactFiles) {
        try {
            const fileBytes = await readFile(resolve(distPath, relFile));
            const sha256 = createHash('sha256').update(fileBytes).digest('hex');
            artifactsMap[relFile] = { sha256, bytes: fileBytes.byteLength };
        } catch {
            // File may not exist yet (e.g. feeds-health.json before health-check runs)
        }
    }

    const healthRevision = artifactsMap['feeds-health.json']?.sha256;

    await writeJson('manifest.json', createManifest({
        sourceCommit,
        sourceChecksum,
        generatedAt,
        registryRevision: sourceChecksum,
        ...(healthRevision ? { healthRevision } : {}),
        artifactCounts: {
            feeds: feeds.length,
            countries: Object.keys(byCountry).length,
            categories: Object.keys(byCategory).length,
            publishers: Object.keys(byPublisher).length,
            languages: Object.keys(byLanguage).length,
            opml: 1 + Object.keys(byCountry).length + Object.keys(byCategory).length,
            possibleDuplicates: possibleDuplicates.length,
        },
        artifacts: artifactsMap,
    }));

    process.stdout.write(
        `Generated registry artifacts in ${distPath} (feeds: ${feeds.length}, countries: ${Object.keys(byCountry).length}, categories: ${Object.keys(byCategory).length}, possible duplicates: ${possibleDuplicates.length}).\n`
    );
}

// Only run the build when executed directly (not when imported by tests or the
// parity checker, which need the pure exported functions without side effects).
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch((error: unknown) => {
        console.error(`[build-artifacts] Failed:`, error);
        process.exitCode = 1;
    });
}
