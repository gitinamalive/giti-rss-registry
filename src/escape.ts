/**
 * Shared escaping and formatting helpers for generated public artifacts.
 *
 * This module is the single source of truth for every string-encoding
 * concern in the build pipeline:
 *   - OPML/XML text and attributes (`escapeXml`, `escapeXmlAttr`)
 *   - HTML text and attributes (`escapeHtmlText`, `escapeHtmlAttr`)
 *   - JSON embedded inside a <script> tag (`escapeJsonForScript`)
 *   - CSV fields (`escapeCsv`, including optional formula-injection defence)
 *   - filesystem-safe slugs (`toFileSafeSegment`)
 *
 * Nothing in scripts/ or tests/ should re-implement these — import them.
 */

/** Escape `& < > " '` to XML entities. Safe for OPML text nodes. */
export function escapeXml(value: string | null | undefined): string {
    if (!value) return '';
    return value.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&apos;';
            default: return char;
        }
    });
}

/**
 * Escape a value destined for a quoted XML/HTML attribute.
 * Same entity set as `escapeXml` — quoted attributes must neutralise the
 * quote characters so a feed field cannot break out of the attribute.
 */
export function escapeXmlAttr(value: string | null | undefined): string {
    return escapeXml(value);
}

/**
 * Escape HTML text content (`& < > "`).
 * Mirrors the client-side `esc` embedded in the generated index.html.
 */
export function escapeHtmlText(value: string | null | undefined): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Escape a quoted HTML attribute (`& " '` with `&#39;`).
 * Mirrors the client-side `escAttr` embedded in the generated index.html.
 */
export function escapeHtmlAttr(value: string | null | undefined): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Serialize a value as JSON that is safe to embed inside a <script> tag.
 *
 * `JSON.stringify` output can still contain the literal sequences `<`,
 * `>`, `&` (all of which a browser may interpret within script data) and
 * the line separators U+2028/U+2029. Replacing them with the equivalent
 * JSON escape sequences keeps the output valid JSON while guaranteeing the
 * script element can never be terminated early (no `</script` breakout).
 */
export function escapeJsonForScript(value: unknown): string {
    const json = JSON.stringify(value);
    // JSON.stringify returns undefined only for `undefined`/functions/symbols,
    // none of which can appear in a feeds payload. Coerce defensively so the
    // emitted script always contains valid JSON.
    const serialized = json === undefined ? 'null' : json;
    return serialized
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

export interface EscapeCsvOptions {
    /**
     * When true, prefix a single quote to any value beginning with
     * `=`, `+`, `-`, `@`, tab, or carriage return to defeat spreadsheet
     * formula injection (also known as CSV injection).
     */
    formulaSafe?: boolean;
}

/** Escape a single CSV field (RFC 4180 quoting + optional formula safety). */
export function escapeCsv(value: unknown, options: EscapeCsvOptions = {}): string {
    let raw = value == null ? '' : String(value);
    if (options.formulaSafe && /^[=+\-@\t\r]/.test(raw)) {
        raw = `'${raw}`;
    }
    if (/[",\n\r]/.test(raw)) {
        return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
}

/** Convert a display string to a filesystem-safe path segment. */
export function toFileSafeSegment(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
}
