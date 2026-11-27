import type { PossibleDuplicateFinding } from '../urlFingerprint.ts';

export const GENERATOR_VERSION = '1.2.0';
export const SCHEMA_VERSION = '1.1.0';

export interface ArtifactHashEntry {
    sha256: string;
    bytes: number;
}

export interface RegistryManifest {
    schemaVersion: string;
    generatorVersion: string;
    sourceCommit: string;
    sourceChecksum: string;
    generatedAt: string;
    registryRevision?: string;
    healthRevision?: string;
    artifactCounts: Record<string, number>;
    artifacts?: Record<string, ArtifactHashEntry>;
}

export function createManifest(input: Omit<RegistryManifest, 'schemaVersion' | 'generatorVersion'>): RegistryManifest {
    return {
        schemaVersion: SCHEMA_VERSION,
        generatorVersion: GENERATOR_VERSION,
        ...input,
    };
}

export function createDuplicateReport(
    findings: PossibleDuplicateFinding[],
    generatedAt: string,
    sourceChecksum: string,
): { generatedAt: string; sourceChecksum: string; possibleDuplicates: PossibleDuplicateFinding[] } {
    return { generatedAt, sourceChecksum, possibleDuplicates: findings };
}
