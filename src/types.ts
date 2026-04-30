export type FeedFormat = 'rss' | 'atom' | 'jsonfeed' | 'rdf';

export type MediaType = 'print' | 'tv' | 'radio' | 'digital' | 'wire' | 'aggregator';

export type Perspective =
    | 'independent'
    | 'state-affiliated'
    | 'independent-exile'
    | 'regional'
    | 'state-monitor'
    | 'aggregator';

export type FeedCategory =
    | 'world'
    | 'us'
    | 'europe'
    | 'technology'
    | 'ai'
    | 'space'
    | 'finance'
    | 'science'
    | 'climate'
    | 'politics'
    | 'investigative';

export interface FeedEntry {
    id: string;
    name: string;
    publisher: string;
    url: string;
    language: string;
    countries: string[];
    category: FeedCategory;
    perspective?: Perspective;
    mediaType?: MediaType;
    format?: FeedFormat;
    official?: boolean;
    active?: boolean;
    healthScore?: number;
    notes?: string;
}

export interface RegistryPayload {
    generatedAt: string;
    source: string;
    feeds: FeedEntry[];
}
