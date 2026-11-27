import { escapeXml } from '../escape.ts';
import type { FeedEntry } from '../types.ts';

export function generateOpml(
    title: string,
    feeds: FeedEntry[],
    generatedAt: string = new Date().toISOString(),
): string {
    const timestamp = new Date(generatedAt).toUTCString();
    const collator = new Intl.Collator('en', { sensitivity: 'base' });
    const lines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<opml version="2.0">',
        '  <head>',
        `    <title>${escapeXml(title)}</title>`,
        `    <dateCreated>${escapeXml(timestamp)}</dateCreated>`,
        '  </head>',
        '  <body>',
    ];

    feeds
        .slice()
        .sort((a, b) => collator.compare(a.name, b.name))
        .forEach((feed) => {
            lines.push(
                `    <outline type="rss" text="${escapeXml(feed.name)}" title="${escapeXml(feed.name)}" xmlUrl="${escapeXml(feed.url)}" />`
            );
        });

    lines.push('  </body>', '</opml>');
    return `${lines.join('\n')}\n`;
}
