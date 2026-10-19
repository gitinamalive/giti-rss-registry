/**
 * ISO 3166-1 alpha-2 country definitions and coverage matrix helpers.
 */
import type { FeedEntry } from './types.ts';

export const ISO_3166_1_ALPHA2_COUNTRIES: Record<string, string> = {
  "AD": "Andorra",
  "AE": "United Arab Emirates",
  "AF": "Afghanistan",
  "AG": "Antigua and Barbuda",
  "AL": "Albania",
  "AM": "Armenia",
  "AO": "Angola",
  "AR": "Argentina",
  "AT": "Austria",
  "AU": "Australia",
  "AZ": "Azerbaijan",
  "BA": "Bosnia and Herzegovina",
  "BB": "Barbados",
  "BD": "Bangladesh",
  "BE": "Belgium",
  "BF": "Burkina Faso",
  "BG": "Bulgaria",
  "BH": "Bahrain",
  "BI": "Burundi",
  "BJ": "Benin",
  "BM": "Bermuda",
  "BN": "Brunei",
  "BO": "Bolivia",
  "BR": "Brazil",
  "BS": "Bahamas",
  "BT": "Bhutan",
  "BW": "Botswana",
  "BY": "Belarus",
  "BZ": "Belize",
  "CA": "Canada",
  "CD": "Democratic Republic of the Congo",
  "CF": "Central African Republic",
  "CG": "Republic of the Congo",
  "CH": "Switzerland",
  "CI": "Ivory Coast",
  "CK": "Cook Islands",
  "CL": "Chile",
  "CM": "Cameroon",
  "CN": "China",
  "CO": "Colombia",
  "CR": "Costa Rica",
  "CU": "Cuba",
  "CV": "Cape Verde",
  "CY": "Cyprus",
  "CZ": "Czech Republic",
  "DE": "Germany",
  "DJ": "Djibouti",
  "DK": "Denmark",
  "DM": "Dominica",
  "DO": "Dominican Republic",
  "DZ": "Algeria",
  "EC": "Ecuador",
  "EE": "Estonia",
  "EG": "Egypt",
  "ER": "Eritrea",
  "ES": "Spain",
  "ET": "Ethiopia",
  "FI": "Finland",
  "FJ": "Fiji",
  "FM": "Micronesia",
  "FO": "Faroe Islands",
  "FR": "France",
  "GA": "Gabon",
  "GB": "United Kingdom",
  "GD": "Grenada",
  "GE": "Georgia",
  "GH": "Ghana",
  "GI": "Gibraltar",
  "GM": "Gambia",
  "GN": "Guinea",
  "GQ": "Equatorial Guinea",
  "GR": "Greece",
  "GT": "Guatemala",
  "GW": "Guinea-Bissau",
  "GY": "Guyana",
  "HK": "Hong Kong",
  "HN": "Honduras",
  "HR": "Croatia",
  "HT": "Haiti",
  "HU": "Hungary",
  "ID": "Indonesia",
  "IE": "Ireland",
  "IL": "Israel",
  "IM": "Isle of Man",
  "IN": "India",
  "IQ": "Iraq",
  "IR": "Iran",
  "IS": "Iceland",
  "IT": "Italy",
  "JM": "Jamaica",
  "JO": "Jordan",
  "JP": "Japan",
  "KE": "Kenya",
  "KG": "Kyrgyzstan",
  "KH": "Cambodia",
  "KI": "Kiribati",
  "KM": "Comoros",
  "KN": "Saint Kitts and Nevis",
  "KP": "North Korea",
  "KR": "South Korea",
  "KW": "Kuwait",
  "KY": "Cayman Islands",
  "KZ": "Kazakhstan",
  "LA": "Laos",
  "LB": "Lebanon",
  "LC": "Saint Lucia",
  "LK": "Sri Lanka",
  "LR": "Liberia",
  "LS": "Lesotho",
  "LT": "Lithuania",
  "LU": "Luxembourg",
  "LV": "Latvia",
  "LY": "Libya",
  "MA": "Morocco",
  "MC": "Monaco",
  "MD": "Moldova",
  "ME": "Montenegro",
  "MG": "Madagascar",
  "MH": "Marshall Islands",
  "MK": "North Macedonia",
  "ML": "Mali",
  "MM": "Myanmar",
  "MN": "Mongolia",
  "MQ": "Martinique",
  "MR": "Mauritania",
  "MT": "Malta",
  "MU": "Mauritius",
  "MV": "Maldives",
  "MW": "Malawi",
  "MX": "Mexico",
  "MY": "Malaysia",
  "MZ": "Mozambique",
  "NA": "Namibia",
  "NE": "Niger",
  "NG": "Nigeria",
  "NI": "Nicaragua",
  "NL": "Netherlands",
  "NO": "Norway",
  "NP": "Nepal",
  "NR": "Nauru",
  "NU": "Niue",
  "NZ": "New Zealand",
  "OM": "Oman",
  "PA": "Panama",
  "PE": "Peru",
  "PF": "French Polynesia",
  "PG": "Papua New Guinea",
  "PH": "Philippines",
  "PK": "Pakistan",
  "PL": "Poland",
  "PR": "Puerto Rico",
  "PS": "Palestine",
  "PT": "Portugal",
  "PW": "Palau",
  "PY": "Paraguay",
  "QA": "Qatar",
  "RO": "Romania",
  "RS": "Serbia",
  "RU": "Russia",
  "RW": "Rwanda",
  "SA": "Saudi Arabia",
  "SB": "Solomon Islands",
  "SC": "Seychelles",
  "SD": "Sudan",
  "SE": "Sweden",
  "SG": "Singapore",
  "SI": "Slovenia",
  "SK": "Slovakia",
  "SL": "Sierra Leone",
  "SM": "San Marino",
  "SN": "Senegal",
  "SO": "Somalia",
  "SR": "Suriname",
  "SS": "South Sudan",
  "ST": "Sao Tome and Principe",
  "SV": "El Salvador",
  "SY": "Syria",
  "SZ": "Eswatini",
  "TD": "Chad",
  "TG": "Togo",
  "TH": "Thailand",
  "TJ": "Tajikistan",
  "TL": "Timor-Leste",
  "TM": "Turkmenistan",
  "TN": "Tunisia",
  "TO": "Tonga",
  "TR": "Turkey",
  "TT": "Trinidad and Tobago",
  "TV": "Tuvalu",
  "TZ": "Tanzania",
  "UA": "Ukraine",
  "UG": "Uganda",
  "US": "United States",
  "UY": "Uruguay",
  "UZ": "Uzbekistan",
  "VA": "Vatican City",
  "VC": "Saint Vincent and the Grenadines",
  "VE": "Venezuela",
  "VN": "Vietnam",
  "VU": "Vanuatu",
  "WS": "Samoa",
  "XK": "Kosovo",
  "YE": "Yemen",
  "ZA": "South Africa",
  "ZM": "Zambia",
  "ZW": "Zimbabwe"
};

/**
 * Determines whether a feed is a verified domestic/national publisher for a given country code.
 *
 * Rules:
 * 1. If explicit `publisherCountries` is declared, it is domestic if and only if it contains the country code.
 * 2. Otherwise, if the feed targets exactly one country, it is domestic to that country.
 * 3. Feeds mapped to multiple countries without explicit domestic tags are treated as regional aggregators/fallbacks.
 */
export function isDomesticFeed(feed: FeedEntry, countryCode: string): boolean {
    if (feed.publisherCountries && feed.publisherCountries.length > 0) {
        return feed.publisherCountries.includes(countryCode);
    }
    return (feed.countries || []).length === 1 && feed.countries[0] === countryCode;
}

export type CoverageTier = 'domestic-multi' | 'domestic-single' | 'regional-only' | 'uncovered';

export interface CountryCoverageEntry {
    code: string;
    name: string;
    domesticFeeds: FeedEntry[];
    regionalFeeds: FeedEntry[];
    totalFeeds: number;
    tier: CoverageTier;
}

/**
 * Builds the canonical 206-country coverage matrix from the active feed list.
 */
export function buildCountryCoverageMatrix(
    feeds: FeedEntry[],
    countriesMap: Record<string, string> = ISO_3166_1_ALPHA2_COUNTRIES,
): CountryCoverageEntry[] {
    const entries: Record<string, { code: string; name: string; domestic: FeedEntry[]; regional: FeedEntry[] }> = {};

    for (const [code, name] of Object.entries(countriesMap)) {
        entries[code] = { code, name, domestic: [], regional: [] };
    }

    for (const feed of feeds) {
        for (const country of feed.countries || []) {
            if (!entries[country]) {
                entries[country] = { code: country, name: country, domestic: [], regional: [] };
            }
            if (isDomesticFeed(feed, country)) {
                entries[country].domestic.push(feed);
            } else {
                entries[country].regional.push(feed);
            }
        }
    }

    const collator = new Intl.Collator('en', { sensitivity: 'base' });
    return Object.values(entries)
        .map((e) => {
            let tier: CoverageTier = 'uncovered';
            if (e.domestic.length >= 2) tier = 'domestic-multi';
            else if (e.domestic.length === 1) tier = 'domestic-single';
            else if (e.regional.length > 0) tier = 'regional-only';

            return {
                code: e.code,
                name: e.name,
                domesticFeeds: e.domestic,
                regionalFeeds: e.regional,
                totalFeeds: e.domestic.length + e.regional.length,
                tier,
            };
        })
        .sort((a, b) => collator.compare(a.name, b.name));
}
