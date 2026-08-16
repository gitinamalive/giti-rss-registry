/**
 * validate-schema.ts
 *
 * Validates data/feeds.json against schema/feeds.schema.json (JSON Schema
 * draft-07) and checks that the schema's enum arrays have not drifted from the
 * allowed sets declared in src/types.ts.
 *
 * Exit code 1 on any conformanace error or drift. Wired into `npm run validate`.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import {
    allowedCategories,
    allowedCoverageTypes,
    allowedFormats,
    allowedMediaTypes,
    allowedPerspectives,
} from '../src/types.ts';

const SCHEMA_PATH = resolve('schema/feeds.schema.json');
const FEEDS_PATH = resolve('data/feeds.json');

// src/types.ts enum names → schema $defs names.
const ENUM_CHECKS: Array<{ defName: string; allowed: ReadonlySet<string> }> = [
    { defName: 'FeedCategory', allowed: allowedCategories },
    { defName: 'Perspective', allowed: allowedPerspectives },
    { defName: 'MediaType', allowed: allowedMediaTypes },
    { defName: 'FeedFormat', allowed: allowedFormats },
    { defName: 'CoverageType', allowed: allowedCoverageTypes },
];

function driftProblems(schemaEnum: readonly string[], allowed: ReadonlySet<string>): string[] {
    const schemaValues = new Set(schemaEnum);
    const problems: string[] = [];
    for (const value of allowed) {
        if (!schemaValues.has(value)) problems.push(`value "${value}" is missing from the schema enum`);
    }
    for (const value of schemaValues) {
        if (!allowed.has(value)) problems.push(`value "${value}" is not in the src/types.ts allowed set`);
    }
    return problems;
}

async function main(): Promise<void> {
    const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8')) as {
        $defs?: Record<string, { enum?: string[] }>;
    };
    const payload = JSON.parse(await readFile(FEEDS_PATH, 'utf8')) as {
        feeds?: unknown[];
    };

    let failed = false;

    // 1. Enum drift guard: schema ↔ src/types.ts.
    const defs = schema.$defs ?? {};
    for (const { defName, allowed } of ENUM_CHECKS) {
        const problems = driftProblems(defs[defName]?.enum ?? [], allowed);
        if (problems.length > 0) {
            failed = true;
            console.error(`schema enum drift in $defs.${defName}:`);
            for (const problem of problems) console.error(`  - ${problem}`);
        }
    }

    // 2. Conformance: data/feeds.json ↔ schema.
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    if (!validate(payload)) {
        failed = true;
        console.error('data/feeds.json does not conform to schema/feeds.schema.json:');
        for (const err of (validate.errors ?? []).slice(0, 25)) {
            console.error(`  - ${err.instancePath || '(root)'} ${err.message}`);
        }
    }

    if (failed) {
        process.exitCode = 1;
        return;
    }

    console.log(
        `Schema OK — ${payload.feeds?.length ?? 0} feeds conform to feeds.schema.json and enums are in sync with src/types.ts.`
    );
}

main().catch((error: unknown) => {
    console.error('[validate-schema] Failed:', error);
    process.exitCode = 1;
});
