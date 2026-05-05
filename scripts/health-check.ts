import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type FeedEntry, type RegistryPayload } from '../src/types.js';

interface HealthResult {
    id: string;
    url: string;
    status: number | string;
    ok: boolean;
    latency: number;
    error?: string;
    lastChecked: string;
}

const FEEDS_PATH = resolve('data/feeds.json');
const REPORT_PATH = resolve('dist/health-report.json');

async function checkFeed(feed: FeedEntry): Promise<HealthResult> {
    const start = Date.now();
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(feed.url, {
            method: 'GET', // Some servers don't support HEAD or return 405
            headers: {
                'User-Agent': 'Giti-RSS-Registry-HealthCheck/1.0',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*'
            },
            signal: controller.signal
        });

        clearTimeout(timeout);
        const latency = Date.now() - start;

        return {
            id: feed.id,
            url: feed.url,
            status: response.status,
            ok: response.ok,
            latency,
            lastChecked: new Date().toISOString()
        };
    } catch (error: any) {
        return {
            id: feed.id,
            url: feed.url,
            status: 'ERROR',
            ok: false,
            latency: Date.now() - start,
            error: error.message,
            lastChecked: new Date().toISOString()
        };
    }
}

async function main(): Promise<void> {
    const raw = await readFile(FEEDS_PATH, 'utf8');
    const payload = JSON.parse(raw) as RegistryPayload;
    const feeds = payload.feeds;

    console.log(`Starting health check for ${feeds.length} feeds...`);

    // Use a small concurrency limit to avoid overwhelming servers or local network
    const CONCURRENCY = 5;
    const results: HealthResult[] = [];
    
    for (let i = 0; i < feeds.length; i += CONCURRENCY) {
        const chunk = feeds.slice(i, i + CONCURRENCY);
        console.log(`Checking batch ${i / CONCURRENCY + 1}/${Math.ceil(feeds.length / CONCURRENCY)}...`);
        const chunkResults = await Promise.all(chunk.map(checkFeed));
        results.push(...chunkResults);
    }

    const summary = {
        checkedAt: new Date().toISOString(),
        total: results.length,
        ok: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        avgLatency: Math.round(results.reduce((acc, r) => acc + r.latency, 0) / results.length),
        results
    };

    await mkdir(resolve(REPORT_PATH, '..'), { recursive: true });
    await writeFile(REPORT_PATH, JSON.stringify(summary, null, 2), 'utf8');

    console.log('\nHealth Check Summary:');
    console.log(`- Total: ${summary.total}`);
    console.log(`- OK: ${summary.ok}`);
    console.log(`- Failed: ${summary.failed}`);
    console.log(`- Avg Latency: ${summary.avgLatency}ms`);
    console.log(`\nReport saved to ${REPORT_PATH}`);

    if (summary.failed > 0) {
        console.log('\nTop Failures:');
        summary.results
            .filter(r => !r.ok)
            .slice(0, 10)
            .forEach(r => console.log(`- ${r.id}: ${r.status} (${r.error || 'Unknown error'})`));
    }
}

main().catch(console.error);
