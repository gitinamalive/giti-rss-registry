/**
 * Validate the public reachability and content of every canonical feed.
 *
 * The generated feeds-health.json file is a stable-ID overlay. Canonical
 * data/feeds.json remains editorial source data and is never rewritten by this
 * script.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import type { BootstrapPayload, FeedEntry, FeedFormat } from '../src/types.ts';
import {
    computeHealthScore,
    deriveHealthStatus,
    type FeedHealthEntry,
    type HealthStatus,
} from '../src/health.ts';

export const HTTP_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 5;
export const MAX_BODY_BYTES = 5_000_000; // 5 MB
export const CONCURRENCY = 8;
export const DEFAULT_MAX_FEEDS = Infinity;

const USER_AGENT = 'giti-rss-registry-health-check/1.0 (+https://github.com/gitinamalive/giti)';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const JSON_FEED_VERSIONS = new Set([
    'https://jsonfeed.org/version/1',
    'https://jsonfeed.org/version/1.1',
]);

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
    isArray: (name) => ['item', 'entry'].includes(name),
});

export type Fetcher = typeof fetch;
export type HostResolver = (hostname: string) => Promise<string[]>;

export interface HealthResult {
    status: number | string;
    reachable: boolean;
    contentValid: boolean;
    failureStatus?: Extract<HealthStatus, 'unreachable' | 'invalid-content'>;
    lastItemDate?: string;
    format?: FeedFormat;
    finalUrl?: string;
}

export interface CheckFeedOptions {
    fetcher?: Fetcher;
    resolveHost?: HostResolver;
    timeoutMs?: number;
    maxBodyBytes?: number;
}

export interface FeedContent {
    format: FeedFormat;
    lastItemDate?: string;
}

export interface RedirectedResponse {
    response: Response;
    finalUrl: string;
    redirects: string[];
}

export interface FollowRedirectsOptions {
    fetcher: Fetcher;
    resolveHost: HostResolver;
    timeoutMs?: number;
    signal?: AbortSignal;
}

/** Reject non-HTTP(S), credential-bearing, local, and reserved IP URLs. */
export function isPublicHttpUrl(value: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return false;
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        return false;
    }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
        return false;
    }

    const addressType = isIP(hostname);
    return addressType === 0 || isPublicIp(hostname, addressType);
}

function isPublicIp(hostname: string, addressType: number): boolean {
    if (addressType === 4) {
        const octets = hostname.split('.').map(Number);
        const [a, b] = octets;
        if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
            return false;
        }
        return !(
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 0 || b === 168)) ||
            (a === 198 && b >= 18 && b <= 19) ||
            a >= 224
        );
    }

    const normalized = hostname.toLowerCase();
    if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('ff')) {
        return false;
    }

    const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return !mappedIpv4 || isPublicIp(mappedIpv4[1], 4);
}

const defaultHostResolver: HostResolver = async (hostname) => {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.map(({ address }) => address);
};

/** Validate the URL and every DNS address it resolves to before fetching. */
export async function assertPublicHttpUrl(
    value: string,
    resolveHost: HostResolver = defaultHostResolver,
): Promise<URL> {
    if (!isPublicHttpUrl(value)) throw new Error(`URL is not a public HTTP(S) host: ${value}`);
    const parsed = new URL(value);
    if (isIP(parsed.hostname) === 0) {
        const addresses = await resolveHost(parsed.hostname);
        if (!addresses.length || addresses.some((address) => {
            const addressType = isIP(address);
            return addressType === 0 || !isPublicIp(address, addressType);
        })) {
            throw new Error(`URL resolves to a non-public host: ${value}`);
        }
    }
    return parsed;
}

function requestHeaders(): HeadersInit {
    return {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/rdf+xml, application/feed+json, application/json, text/xml;q=0.9, */*;q=0.8',
    };
}

/** Follow redirects explicitly so each Location is validated before fetch. */
export async function followRedirects(
    url: string,
    init: RequestInit,
    options: FollowRedirectsOptions,
): Promise<RedirectedResponse> {
    let currentUrl = url;
    const redirects: string[] = [];

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        await assertPublicHttpUrl(currentUrl, options.resolveHost);
        const signal = options.signal ?? init.signal;
        const response = await options.fetcher(currentUrl, {
            ...init,
            redirect: 'manual',
            signal,
            headers: { ...requestHeaders(), ...(init.headers ?? {}) },
        });

        if (!REDIRECT_STATUSES.has(response.status)) {
            return { response, finalUrl: currentUrl, redirects };
        }
        if (redirectCount === MAX_REDIRECTS) {
            throw new Error(`Too many redirects for ${url}`);
        }
        const location = response.headers.get('location');
        if (!location) throw new Error(`Redirect without Location for ${currentUrl}`);
        const nextUrl = new URL(location, currentUrl).toString();
        redirects.push(nextUrl);
        await assertPublicHttpUrl(nextUrl, options.resolveHost);
        await response.body?.cancel();
        currentUrl = nextUrl;
    }

    throw new Error(`Too many redirects for ${url}`);
}

/** Consumes the stream up to maxBytes under the request deadline. */
export async function readBoundedBytes(
    response: Response,
    maxBytes: number,
    signal?: AbortSignal,
): Promise<Uint8Array> {
    if (!response.body) {
        const arrayBuf = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        if (bytes.byteLength > maxBytes) {
            throw new Error(`Feed response exceeds maximum size of ${maxBytes} bytes`);
        }
        return bytes;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    const onAbort = () => {
        reader.cancel().catch(() => {});
    };

    if (signal) {
        if (signal.aborted) {
            await reader.cancel();
            throw new Error('Request timed out or aborted');
        }
        signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new Error(`Feed response exceeds maximum size of ${maxBytes} bytes`);
            }
            chunks.push(value);
        }
    } finally {
        if (signal) {
            signal.removeEventListener('abort', onAbort);
        }
        reader.releaseLock();
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

/** Decodes raw payload respecting BOM, Content-Type header, and XML prolog. */
export function decodeFeedBytes(bytes: Uint8Array, contentTypeHeader?: string | null): string {
    // 1. Check BOM
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
        return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }

    // 2. HTTP Content-Type header charset parameter
    let charset: string | null = null;
    if (contentTypeHeader) {
        const match = contentTypeHeader.match(/charset=\s*["']?([a-zA-Z0-9_-]+)/i);
        if (match) {
            charset = match[1].trim();
        }
    }

    // 3. XML Prolog sniffing (first 512 bytes)
    if (!charset) {
        const sniff = new TextDecoder('latin1').decode(bytes.subarray(0, 512));
        const xmlMatch = sniff.match(/<\?xml\b[^>]*\bencoding\s*=\s*["']([a-zA-Z0-9_-]+)["']/i);
        if (xmlMatch) {
            charset = xmlMatch[1].trim();
        }
    }

    // 4. Safe decode with fallback to UTF-8
    try {
        return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(bytes);
    } catch {
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
}

function parseDate(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function latestDate(values: unknown[]): string | undefined {
    return values.map(parseDate).filter((value): value is string => Boolean(value)).sort().at(-1);
}

/** Validate feed shape structurally instead of treating arbitrary HTML as healthy. */
export function parseFeedContent(body: string): FeedContent | null {
    const trimmed = body.replace(/^\uFEFF/, '').trim();
    if (!trimmed) return null;

    // 1. JSON Feed
    if (trimmed.startsWith('{')) {
        try {
            const json = JSON.parse(trimmed) as { version?: unknown; items?: unknown };
            if (
                json &&
                typeof json === 'object' &&
                typeof json.version === 'string' &&
                (JSON_FEED_VERSIONS.has(json.version) || json.version.startsWith('https://jsonfeed.org/version/')) &&
                Array.isArray(json.items)
            ) {
                const itemDates = json.items.flatMap((item) => {
                    if (!item || typeof item !== 'object') return [];
                    const candidate = item as { date_published?: unknown; date_modified?: unknown };
                    return [candidate.date_published, candidate.date_modified];
                });
                return { format: 'jsonfeed', lastItemDate: latestDate(itemDates) };
            }
        } catch {
            return null;
        }
    }

    // 2. XML Formats (RSS 2.0 / 0.9x, Atom, RDF)
    try {
        const parsed = xmlParser.parse(trimmed);
        if (!parsed || typeof parsed !== 'object') return null;

        // RSS: root is <rss>
        if (parsed.rss && parsed.rss.channel) {
            const channel = parsed.rss.channel;
            const rawItems = channel.item ?? [];
            const items = Array.isArray(rawItems) ? rawItems : [rawItems];
            const itemDates: unknown[] = [];
            for (const item of items) {
                if (item && typeof item === 'object') {
                    if (item.pubDate) itemDates.push(item.pubDate);
                    if (item['dc:date']) itemDates.push(item['dc:date']);
                    if (item['dcterms:issued']) itemDates.push(item['dcterms:issued']);
                    if (item['dcterms:modified']) itemDates.push(item['dcterms:modified']);
                }
            }
            return {
                format: 'rss',
                lastItemDate: latestDate(itemDates),
            };
        }

        // Atom: root is <feed>
        if (parsed.feed) {
            const feed = parsed.feed;
            const rawEntries = feed.entry ?? [];
            const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
            const itemDates: unknown[] = [];
            for (const entry of entries) {
                if (entry && typeof entry === 'object') {
                    if (entry.published) itemDates.push(entry.published);
                    if (entry.updated) itemDates.push(entry.updated);
                    if (entry['dc:date']) itemDates.push(entry['dc:date']);
                }
            }
            return {
                format: 'atom',
                lastItemDate: latestDate(itemDates),
            };
        }

        // RDF (RSS 1.0): root is <rdf:RDF> or <RDF>
        const rdfRoot = parsed['rdf:RDF'] || parsed.RDF;
        if (rdfRoot) {
            const rawItems = rdfRoot.item ?? [];
            const items = Array.isArray(rawItems) ? rawItems : [rawItems];
            const itemDates: unknown[] = [];
            for (const item of items) {
                if (item && typeof item === 'object') {
                    if (item['dc:date']) itemDates.push(item['dc:date']);
                    if (item.pubDate) itemDates.push(item.pubDate);
                    if (item['dcterms:issued']) itemDates.push(item['dcterms:issued']);
                }
            }
            return {
                format: 'rdf',
                lastItemDate: latestDate(itemDates),
            };
        }

        return null;
    } catch {
        return null;
    }
}

export async function checkFeed(feed: FeedEntry, options: CheckFeedOptions = {}): Promise<HealthResult> {
    const fetcher = options.fetcher ?? fetch;
    const resolveHost = options.resolveHost ?? defaultHostResolver;
    const timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS;
    const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    const requestOptions: FollowRedirectsOptions = {
        fetcher,
        resolveHost,
        timeoutMs,
        signal: controller.signal,
    };

    try {
        // HEAD is advisory. If it fails or is rejected, a bounded GET decides health.
        try {
            const head = await followRedirects(feed.url, { method: 'HEAD' }, requestOptions);
            await head.response.body?.cancel();
        } catch {
            // Continue to GET; HEAD failures are expected for some publishers.
        }

        const get = await followRedirects(feed.url, { method: 'GET' }, requestOptions);
        if (!get.response.ok) {
            await get.response.body?.cancel();
            return {
                status: get.response.status,
                reachable: false,
                contentValid: false,
                failureStatus: 'unreachable',
                finalUrl: get.finalUrl,
            };
        }

        const bytes = await readBoundedBytes(get.response, maxBodyBytes, controller.signal);
        const body = decodeFeedBytes(bytes, get.response.headers.get('content-type'));
        const content = parseFeedContent(body);

        if (!content) {
            return {
                status: get.response.status,
                reachable: false,
                contentValid: false,
                failureStatus: 'invalid-content',
                finalUrl: get.finalUrl,
            };
        }

        return {
            status: get.response.status,
            reachable: true,
            contentValid: true,
            format: content.format,
            lastItemDate: content.lastItemDate,
            finalUrl: get.finalUrl,
        };
    } catch (error: unknown) {
        const isTimeout =
            (error instanceof Error && (error.name === 'AbortError' || error.message.includes('Timeout') || error.message.includes('aborted'))) ||
            (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError');
        return {
            status: isTimeout ? 'timeout' : 'error',
            reachable: false,
            contentValid: false,
            failureStatus: 'unreachable',
        };
    } finally {
        clearTimeout(timer);
    }
}

async function runConcurrently<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            await worker(items[index], index);
        }
    });
    await Promise.all(runners);
}

interface ExistingOverlay {
    feeds?: Array<FeedHealthEntry & { generatedAt?: string }>;
}

export function mergeHealthEntry(
    id: string,
    result: HealthResult,
    checkedAt: string,
    prior?: FeedHealthEntry,
): FeedHealthEntry {
    const active = result.reachable;
    const consecutiveFailures = active ? 0 : (prior?.consecutiveFailures ?? 0) + 1;
    const lastSuccessAt = active ? checkedAt : (prior?.lastSuccessAt ?? null);
    const lastFailureAt = active ? (prior?.lastFailureAt ?? null) : checkedAt;
    return {
        id,
        healthStatus: deriveHealthStatus({
            active,
            lastCheckedAt: checkedAt,
            lastItemPublishedAt: result.lastItemDate,
            failureStatus: result.failureStatus,
        }),
        healthScore: active ? computeHealthScore(true, result.lastItemDate) : 0,
        lastCheckedAt: checkedAt,
        lastItemPublishedAt: result.lastItemDate ?? prior?.lastItemPublishedAt ?? null,
        active,
        consecutiveFailures,
        lastSuccessAt,
        lastFailureAt,
        defaultSuggestion: consecutiveFailures < 4,
    };
}

export async function readExistingOverlay(path: string, allowEmptyPrior = false): Promise<Map<string, FeedHealthEntry>> {
    try {
        const raw = JSON.parse(await readFile(path, 'utf8')) as ExistingOverlay;
        if (!raw || !Array.isArray(raw.feeds)) {
            throw new Error(`Missing or invalid 'feeds' array in ${path}`);
        }
        return new Map(raw.feeds.map((entry) => [entry.id, entry]));
    } catch (error) {
        if (allowEmptyPrior) {
            process.stderr.write(`[warn] Initializing empty prior health overlay (${(error as Error).message})\n`);
            return new Map();
        }
        throw new Error(
            `Fail-closed abort: could not read prior health state from ${path}. ` +
            `Pass --allow-empty-prior-state to initialize fresh counters. Details: ${(error as Error).message}`
        );
    }
}

function parseMaxFeeds(args: string[]): number {
    const index = args.indexOf('--max-feeds');
    if (index === -1 || !args[index + 1]) return DEFAULT_MAX_FEEDS;
    const value = Number.parseInt(args[index + 1], 10);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_MAX_FEEDS;
}

function parseAllowEmptyPrior(args: string[]): boolean {
    return args.includes('--allow-empty-prior-state');
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const maxFeeds = parseMaxFeeds(args);
    const allowEmptyPrior = parseAllowEmptyPrior(args);
    const feedsPath = resolve('data/feeds.json');
    const distPath = resolve('dist');
    const outputPath = resolve(distPath, 'feeds-health.json');
    await mkdir(distPath, { recursive: true });

    const payload = JSON.parse(await readFile(feedsPath, 'utf8')) as BootstrapPayload;
    const previous = await readExistingOverlay(outputPath, allowEmptyPrior);
    const feedsToCheck = payload.feeds.slice(0, maxFeeds);
    const checkedAt = new Date().toISOString();
    const results: Array<HealthResult | null> = new Array(feedsToCheck.length).fill(null);
    let checkedCount = 0;

    process.stdout.write(`Health-checking ${feedsToCheck.length} feeds (concurrency ${Math.min(CONCURRENCY, Math.max(1, feedsToCheck.length))})...\n`);
    await runConcurrently(feedsToCheck, Math.min(CONCURRENCY, Math.max(1, feedsToCheck.length)), async (feed, index) => {
        const result = await checkFeed(feed);
        results[index] = result;
        checkedCount += 1;
        process.stdout.write(result.reachable
            ? `[${checkedCount}/${feedsToCheck.length}] ${feed.name}: OK (${result.format})\n`
            : `[${checkedCount}/${feedsToCheck.length}] ${feed.name}: ${result.failureStatus?.toUpperCase() ?? 'FAIL'} (${result.status})\n`);
    });

    const feeds = payload.feeds.map((feed, index): FeedHealthEntry => {
        const prior = previous.get(feed.id);
        const result = index < results.length ? results[index] : null;
        if (!result) {
            return prior ? { ...prior, defaultSuggestion: prior.defaultSuggestion ?? (prior.consecutiveFailures < 4) } : {
                id: feed.id,
                healthStatus: 'unchecked',
                healthScore: null,
                lastCheckedAt: null,
                lastItemPublishedAt: null,
                active: false,
                consecutiveFailures: 0,
                lastSuccessAt: null,
                lastFailureAt: null,
                defaultSuggestion: true,
            };
        }

        return mergeHealthEntry(feed.id, result, checkedAt, prior);
    });

    const stats = {
        checked: checkedCount,
        reachable: results.filter((result) => result?.reachable).length,
        unreachable: results.filter((result) => result?.failureStatus === 'unreachable').length,
        invalidContent: results.filter((result) => result?.failureStatus === 'invalid-content').length,
        reviewRequired: feeds.filter((entry) => entry.consecutiveFailures >= 4).length,
    };
    const overlay = { generatedAt: payload.generatedAt, checkedAt, type: 'health-overlay' as const, feeds, stats };
    await writeFile(outputPath, `${JSON.stringify(overlay, null, 2)}\n`, 'utf8');

    process.stdout.write(`\n─── Health Check Summary ───\nChecked: ${stats.checked}\nReachable: ${stats.reachable}\nUnreachable: ${stats.unreachable}\nInvalid content: ${stats.invalidContent}\nReview required (4+ consecutive failures): ${stats.reviewRequired}\nOutput (overlay): ${outputPath}\n`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch((error: unknown) => {
        console.error('[health-check] Failed:', error);
        process.exitCode = 1;
    });
}
