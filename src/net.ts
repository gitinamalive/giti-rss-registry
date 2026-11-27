/**
 * Shared SSRF-safe URL and IP address validation helpers.
 *
 * Used by both static validation (`scripts/validate.ts`) and live network
 * fetchers (`scripts/health-check.ts`, `scripts/propose-feed.ts`) so there is
 * a single source of truth for public HTTP(S) host checks.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type HostResolver = (hostname: string) => Promise<string[]>;

function parseIpv6Groups(address: string): number[] | null {
    // Reject scoped/zone-qualified IPv6 literals (e.g. fe80::1%eth0) as non-public.
    if (address.includes('%')) return null;

    let normalized = address.toLowerCase();
    // Convert trailing dotted-quad IPv4 (e.g. ::ffff:127.0.0.1) to two hex groups.
    const lastColon = normalized.lastIndexOf(':');
    if (lastColon !== -1 && normalized.includes('.')) {
        const ipv4Part = normalized.slice(lastColon + 1);
        const octets = ipv4Part.split('.').map(Number);
        if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
            return null;
        }
        const hi = ((octets[0] << 8) | octets[1]).toString(16);
        const lo = ((octets[2] << 8) | octets[3]).toString(16);
        normalized = `${normalized.slice(0, lastColon + 1)}${hi}:${lo}`;
    }

    const doubleColonParts = normalized.split('::');
    if (doubleColonParts.length > 2) return null;

    const head = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
    const tail = doubleColonParts.length === 2 && doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
    const missing = doubleColonParts.length === 2 ? 8 - (head.length + tail.length) : 0;
    if (missing < 0 || (doubleColonParts.length === 1 && head.length !== 8)) return null;

    const rawGroups = [...head, ...Array<string>(missing).fill('0'), ...tail];
    if (rawGroups.length !== 8) return null;

    const groups: number[] = [];
    for (const part of rawGroups) {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
        groups.push(Number.parseInt(part, 16));
    }
    return groups;
}

function ipv4FromGroups(hi: number, lo: number): string {
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/** Return true iff an IPv4 or IPv6 literal is globally routable (non-reserved). */
export function isPublicIp(hostname: string, addressType: number): boolean {
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

    const groups = parseIpv6Groups(hostname);
    if (!groups) return false;
    const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

    // ::/96 (unspecified ::, loopback ::1, deprecated IPv4-compatible)
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
        return false;
    }

    // ::ffff:0:0/96 (IPv4-mapped IPv6 — both dotted and hex forms)
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
        return isPublicIp(ipv4FromGroups(g6, g7), 4);
    }

    // 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64)
    if (g0 === 0x0064 && g1 === 0xff9b) {
        return false;
    }

    // 100::/64 (discard-only)
    if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) {
        return false;
    }

    // 2001:db8::/32 (documentation)
    if (g0 === 0x2001 && g1 === 0x0db8) {
        return false;
    }

    // 2002::/16 (6to4 — check embedded IPv4 in g1..g2)
    if (g0 === 0x2002) {
        return isPublicIp(ipv4FromGroups(g1, g2), 4);
    }

    // fc00::/7 (unique-local), fe80::/10 (link-local), fec0::/10 (site-local), ff00::/8 (multicast)
    if (
        (g0 & 0xfe00) === 0xfc00 ||
        (g0 & 0xffc0) === 0xfe80 ||
        (g0 & 0xffc0) === 0xfec0 ||
        (g0 & 0xff00) === 0xff00
    ) {
        return false;
    }

    return true;
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

export const defaultHostResolver: HostResolver = async (hostname) => {
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
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    if (isIP(hostname) === 0) {
        const addresses = await resolveHost(hostname);
        if (!addresses.length || addresses.some((address) => {
            const addressType = isIP(address);
            return addressType === 0 || !isPublicIp(address, addressType);
        })) {
            throw new Error(`URL resolves to a non-public host: ${value}`);
        }
    }
    return parsed;
}
