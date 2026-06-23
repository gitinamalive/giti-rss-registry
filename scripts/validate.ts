import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
    type BootstrapPayload,
    allowedCategories,
    allowedFormats,
    allowedMediaTypes,
    allowedPerspectives,
} from '../src/types.ts';

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
        const parsed = new URL(value);

        // Credentialed URLs should never appear in the registry
        if (parsed.username || parsed.password) return false;

        const host = parsed.hostname.toLowerCase();

        // IPv4 private / loopback / link-local / unspecified
        if (
            host === 'localhost' ||
            host === '0.0.0.0' ||
            host.startsWith('127.') ||
            host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            host.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
            host.startsWith('169.254.')
        )
            return false;

        // IPv6 loopback / ULA / link-local
        if (
            host === '::1' ||
            host === '[::1]' ||
            host.startsWith('fc') ||
            host.startsWith('fd') ||
            host.startsWith('fe80:')
        )
            return false;

        return true;
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
            if (feed.countries.length === 0) {
                warnings.push(`${prefix}.countries is empty — feed will be excluded from by-country.json and country OPML`);
            }
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

    // Integrity assertions on declared stats vs. computed reality
    if (payload.stats.feeds !== payload.feeds.length) {
        errors.push(
            `stats.feeds declares ${payload.stats.feeds} but feeds array has ${payload.feeds.length} entries`
        );
    }
    if (payload.stats.duplicateIds !== idDuplicates.length) {
        errors.push(
            `stats.duplicateIds declares ${payload.stats.duplicateIds} but found ${idDuplicates.length} (${idDuplicates.join(', ') || 'none'})`
        );
    }
    if (payload.stats.duplicateUrls !== urlDuplicates.length) {
        errors.push(
            `stats.duplicateUrls declares ${payload.stats.duplicateUrls} but found ${urlDuplicates.length} (${urlDuplicates.join(', ') || 'none'})`
        );
    }

    // Validate warnings arrays match recomputed duplicates
    const declaredIdWarnings = new Set(payload.warnings?.duplicateIds || []);
    const declaredUrlWarnings = new Set(payload.warnings?.duplicateUrls || []);
    const actualIdSet = new Set(idDuplicates);
    const actualUrlSet = new Set(urlDuplicates);

    const missingIdWarnings = idDuplicates.filter((id) => !declaredIdWarnings.has(id));
    const extraIdWarnings = (payload.warnings?.duplicateIds || []).filter(
        (id) => !actualIdSet.has(id)
    );
    const missingUrlWarnings = urlDuplicates.filter((url) => !declaredUrlWarnings.has(url));
    const extraUrlWarnings = (payload.warnings?.duplicateUrls || []).filter(
        (url) => !actualUrlSet.has(url)
    );

    if (missingIdWarnings.length > 0) {
        errors.push(
            `warnings.duplicateIds is missing ${missingIdWarnings.length} actual duplicate(s): ${missingIdWarnings.join(', ')}`
        );
    }
    if (extraIdWarnings.length > 0) {
        errors.push(
            `warnings.duplicateIds contains ${extraIdWarnings.length} non-duplicate(s): ${extraIdWarnings.join(', ')}`
        );
    }
    if (missingUrlWarnings.length > 0) {
        errors.push(
            `warnings.duplicateUrls is missing ${missingUrlWarnings.length} actual duplicate(s): ${missingUrlWarnings.join(', ')}`
        );
    }
    if (extraUrlWarnings.length > 0) {
        errors.push(
            `warnings.duplicateUrls contains ${extraUrlWarnings.length} non-duplicate(s): ${extraUrlWarnings.join(', ')}`
        );
    }

    // Validate generatedAt is a parseable ISO date and not stale
    if (payload.generatedAt) {
        const parsed = new Date(payload.generatedAt);
        if (isNaN(parsed.getTime())) {
            errors.push(`generatedAt is not a valid ISO-8601 date: ${payload.generatedAt}`);
        } else if (parsed.toISOString() !== payload.generatedAt) {
            errors.push(
                `generatedAt is not in canonical ISO-8601 format: ${payload.generatedAt} (expected ${parsed.toISOString()})`
            );
        } else {
            const ageDays = (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24);
            if (ageDays > 365) {
                errors.push(
                    `generatedAt is ${ageDays.toFixed(0)} days old — bootstrap is stale (>365 days)`
                );
            }
        }
    }

    // Warn on duplicate display names (may be legitimate distinct editions)
    const nameDuplicates = findDuplicates(payload.feeds.map((f) => f.name).filter(Boolean));
    if (nameDuplicates.length > 0) {
        nameDuplicates.forEach((name) => {
            warnings.push(
                `Duplicate display name "${name}" — if distinct editions, label variation in the name per CONTRIBUTING.md`
            );
        });
    }

    process.stdout.write(`Validated ${payload.feeds.length} feeds.\n`);
    process.stdout.write(`Errors: ${errors.length}\n`);
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
