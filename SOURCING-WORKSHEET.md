# Sourcing Worksheet — giti-rss-registry

> Generated 2026-06-23. Current baseline: 217 feeds, 167 countries, 33 languages.

---

## Section 1: Category Targets

| Category | Current | Target | Gap | Priority |
|---|---|---|---|---|
| world | 143 | — | — | Maintain |
| europe | 41 | — | — | Maintain |
| us | 14 | — | — | Maintain |
| technology | 8 | 20 | +12 | 🔴 High |
| science | 7 | 15 | +8 | 🔴 High |
| finance | 3 | 15 | +12 | 🔴 High |
| investigative | 3 | 10 | +7 | 🟡 Medium |
| climate | 1 | 10 | +9 | 🔴 High |
| sports | 1 | 10 | +9 | 🟡 Medium |
| ai | 0 | 10 | +10 | 🔴 High |
| space | 0 | 8 | +8 | 🟡 Medium |
| politics | 0 | 12 | +12 | 🔴 High |
| health | 0 | 10 | +10 | 🔴 High |
| culture | 0 | 8 | +8 | 🟢 Low |
| entertainment | 0 | 8 | +8 | 🟢 Low |
| **Total** | **217** | **~340** | **+123** | |

---

## Section 2: Language Depth Targets

Priority languages needing 3-5 quality sources each (current counts approximate):

| Language | Current | Target | Gap | Candidate Countries |
|---|---|---|---|---|
| es (Spanish) | ~4 | 8 | +4 | ES, MX, AR, CO, CL |
| ar (Arabic) | ~4 | 8 | +4 | SA, AE, EG, JO, LB, QA |
| zh (Chinese) | ~3 | 8 | +5 | CN, TW, HK |
| hi (Hindi) | ~2 | 5 | +3 | IN |
| pt (Portuguese) | ~2 | 5 | +3 | BR, PT |
| fr (French) | ~5 | 8 | +3 | FR, BE, CH, CA, SN |
| ru (Russian) | ~4 | 6 | +2 | RU, UA, KZ |
| ja (Japanese) | ~2 | 5 | +3 | JP |
| de (German) | ~6 | 8 | +2 | DE, AT, CH |
| ko (Korean) | ~1 | 4 | +3 | KR |

---

## Section 3: Wire Services & Broadcasters — mediaType Corrections

These feeds need `mediaType` corrected from the default `digital`:

### Wire Services → `wire`

| Publisher | Existing in Registry? | Feed URL Status |
|---|---|---|
| Associated Press (AP) | ❌ | `https://www.ap.org/rss/` [VERIFY] |
| Reuters | ✅ (Reuters World) | Reclassify existing |
| Agence France-Presse (AFP) | ❌ | `https://www.afp.com/en/products/rss` [VERIFY] |
| EFE (Spain) | ❌ | `https://efe.com/en/rss/` [VERIFY] |
| dpa (Germany) | ❌ | `https://www.dpa.com/en/rss` [VERIFY] |
| Kyodo News (Japan) | ❌ | `https://english.kyodonews.net/rss` [VERIFY] |
| ANSA (Italy) | ✅ (ANSA English) | Reclassify existing |
| Xinhua (China) | ❌ (suggested below) | — |
| PA Media (UK) | ❌ | `https://pa.media/rss` [VERIFY] |

### Public Broadcasters → `broadcast`

| Publisher | Existing in Registry? | Feed URL Status |
|---|---|---|
| BBC | ✅ | Reclassify existing |
| NPR | ✅ | Reclassify existing |
| France 24 | ✅ | Reclassify existing |
| Deutsche Welle | ✅ | Reclassify existing |
| ABC (Australia) | ✅ | Reclassify existing |
| CBC (Canada) | ❌ | `https://www.cbc.ca/webfeed/rss/rss-topstories` [VERIFY] |
| PBS NewsHour (US) | ❌ | `https://www.pbs.org/newshour/feeds/rss/headlines` |
| NHK World (Japan) | ❌ | `https://www3.nhk.or.jp/nhkworld/en/news/feed/` [VERIFY] |
| KBS World (Korea) | ❌ | `https://world.kbs.co.kr/rss/rss_podcast.htm?lang=e` [VERIFY] |

---

## Section 4: Perspective Labeling — State-Affiliated Outlets

These feeds are currently in the registry without `perspective` labels. Label them for transparency:

| Feed | Countries | Current perspective | Recommended |
|---|---|---|---|
| RT | RU | _(unset)_ | `state-affiliated` |
| Xinhua (if added) | CN | _(unset)_ | `state-affiliated` |
| Press TV (IR sources) | IR | _(unset)_ | `state-affiliated` |
| Global Times (if added) | CN | _(unset)_ | `state-affiliated` |
| Al Jazeera | QA | _(unset)_ | `state-affiliated` (state-funded, editorial independence debated — add rationale per CONTRIBUTING) |
| TASS (RU sources, if added) | RU | _(unset)_ | `state-affiliated` |

---

## Section 5: Candidate Feed Starter List

### AI (target: 10)

| Name | Publisher | Country | Language | Homepage |
|---|---|---|---|---|
| MIT Technology Review — AI | MIT | US | en | `technologyreview.com` |
| VentureBeat AI | VentureBeat | US | en | `venturebeat.com` |
| Ars Technica AI | Ars Technica | US | en | `arstechnica.com` |
| The Verge AI | The Verge | US | en | `theverge.com` |
| Wired AI | Wired | US | en | `wired.com` |
| OpenAI Blog | OpenAI | US | en | `openai.com` |
| DeepMind Blog | Google DeepMind | GB | en | `deepmind.google` |
| AI News (artificialintelligence-news.com) | AI News | GB | en | `artificialintelligence-news.com` |
| MarkTechPost | MarkTechPost | IN | en | `marktechpost.com` |
| The Register — AI | The Register | GB | en | `theregister.com` |

### Space (target: 8)

| Name | Publisher | Country | Language | Homepage |
|---|---|---|---|---|
| NASA Breaking News | NASA | US | en | `nasa.gov` |
| NASA JPL News | NASA JPL | US | en | `jpl.nasa.gov` |
| NASA Image of the Day | NASA | US | en | `nasa.gov` |
| ESA Top News | ESA | EU | en | `esa.int` |
| SpaceNews | SpaceNews | US | en | `spacenews.com` |
| Spaceflight Now | Spaceflight Now | US | en | `spaceflightnow.com` |
| Universe Today | Universe Today | CA | en | `universetoday.com` |
| Space.com | Space.com | US | en | `space.com` |

### Politics (target: 12)

| Name | Publisher | Country | Language | Homepage |
|---|---|---|---|---|
| Politico | Politico | US | en | `politico.com` |
| The Hill | The Hill | US | en | `thehill.com` |
| France24 Politics | France 24 | FR | en | `france24.com` |
| Al Jazeera Politics | Al Jazeera | QA | en | `aljazeera.com` |
| FiveThirtyEight | FiveThirtyEight | US | en | `fivethirtyeight.com` |
| The Intercept | The Intercept | US | en | `theintercept.com` |
| ProPublica | ProPublica | US | en | `propublica.org` |
| Politico Europe | Politico | BE | en | `politico.eu` |
| El País — Política | El País | ES | es | `elpais.com` |
| Le Figaro — Politique | Le Figaro | FR | fr | `lefigaro.fr` |
| Der Spiegel — Politik | Der Spiegel | DE | de | `spiegel.de` |
| The Diplomat | The Diplomat | US | en | `thediplomat.com` |

### Health (target: 10)

| Name | Publisher | Country | Language | Homepage |
|---|---|---|---|---|
| STAT News | STAT | US | en | `statnews.com` |
| KFF Health News | KFF | US | en | `kffhealthnews.org` |
| WHO News | WHO | CH | en | `who.int` |
| BMJ Latest | BMJ | GB | en | `bmj.com` |
| Reuters Health | Reuters | GB | en | `reuters.com` |
| NIH News | NIH | US | en | `nih.gov` |
| CIDRAP | U of Minnesota | US | en | `cidrap.umn.edu` |
| Medical News Today | Healthline Media | US | en | `medicalnewstoday.com` |
| The Lancet | The Lancet | GB | en | `thelancet.com` |
| ScienceDaily Health | ScienceDaily | US | en | `sciencedaily.com` |

### Finance (target: 12 — have 3)

| Name | Publisher | Country | Language | Homepage |
|---|---|---|---|---|
| Bloomberg Markets | Bloomberg | US | en | `bloomberg.com` |
| Financial Times | FT | GB | en | `ft.com` |
| Reuters Business | Reuters | GB | en | `reuters.com` |
| CNBC Top News | CNBC | US | en | `cnbc.com` |
| MarketWatch | MarketWatch | US | en | `marketwatch.com` |
| The Economist | The Economist | GB | en | `economist.com` |
| Nikkei Asia | Nikkei | JP | en | `asia.nikkei.com` |
| WSJ Markets | WSJ | US | en | `wsj.com` |
| Investopedia | Investopedia | US | en | `investopedia.com` |

### Technology (target: 20 — have 8)

| Name | Publisher | Country | Language | Homepage |
|---|---|---|---|---|
| TechCrunch | TechCrunch | US | en | `techcrunch.com` |
| The Verge | The Verge | US | en | `theverge.com` |
| Wired | Wired | US | en | `wired.com` |
| Ars Technica | Ars Technica | US | en | `arstechnica.com` |
| Hacker News (via RSS bridge) | Y Combinator | US | en | `news.ycombinator.com` |
| Rest of World | Rest of World | US | en | `restofworld.org` |
| The Register | The Register | GB | en | `theregister.com` |
| ZDNet | ZDNet | US | en | `zdnet.com` |
| Gizmodo | Gizmodo | US | en | `gizmodo.com` |
| Engadget | Engadget | US | en | `engadget.com` |

### Climate (target: 10 — have 1)

| Name | Publisher | Country | Language | Homepage |
|---|---|---|---|---|
| Carbon Brief | Carbon Brief | GB | en | `carbonbrief.org` |
| Inside Climate News | Inside Climate News | US | en | `insideclimatenews.org` |
| Grist | Grist | US | en | `grist.org` |
| Yale Climate Connections | Yale | US | en | `yaleclimateconnections.org` |
| Climate Home News | Climate Home News | GB | en | `climatechangenews.com` |
| The Guardian — Climate | The Guardian | GB | en | `theguardian.com` |
| NASA Climate | NASA | US | en | `climate.nasa.gov` |
| NOAA Climate.gov | NOAA | US | en | `climate.gov` |

### Science (target: 15 — have 7)

| Name | Publisher | Country | Language | Homepage |
|---|---|---|---|---|
| Nature News | Nature | GB | en | `nature.com` |
| Science Magazine | AAAS | US | en | `science.org` |
| Scientific American | Scientific American | US | en | `scientificamerican.com` |
| Quanta Magazine | Simons Foundation | US | en | `quantamagazine.org` |
| EurekAlert! | AAAS | US | en | `eurekalert.org` |
| Live Science | Live Science | US | en | `livescience.com` |
| PNAS | PNAS | US | en | `pnas.org` |

### Investigative (target: 10 — have 3)

| Name | Publisher | Country | Language | Homepage |
|---|---|---|---|---|
| ICIJ | ICIJ | US | en | `icij.org` |
| ProPublica | ProPublica | US | en | `propublica.org` |
| Bellingcat | Bellingcat | NL | en | `bellingcat.com` |
| OCCRP | OCCRP | BA | en | `occrp.org` |
| The Bureau of Investigative Journalism | TBIJ | GB | en | `thebureauinvestigates.com` |

### Non-English Market Deepening

#### Arabic (+4)
| Name | Publisher | Country | Language |
|---|---|---|---|
| BBC Arabic | BBC | GB | ar |
| France 24 Arabic | France 24 | FR | ar |
| Sky News Arabia | Sky News Arabia | AE | ar |
| Asharq Al-Awsat | Asharq Al-Awsat | GB | ar |

#### Chinese (+5)
| Name | Publisher | Country | Language |
|---|---|---|---|
| BBC Chinese | BBC | GB | zh |
| NYT Chinese | New York Times | US | zh |
| FT Chinese | Financial Times | GB | zh |
| The Initium | The Initium | HK | zh |
| Caixin Global | Caixin | CN | zh |

#### Hindi (+3)
| Name | Publisher | Country | Language |
|---|---|---|---|
| BBC Hindi | BBC | GB | hi |
| Dainik Bhaskar | DB Corp | IN | hi |
| NDTV India | NDTV | IN | hi |

#### Portuguese (+3)
| Name | Publisher | Country | Language |
|---|---|---|---|
| BBC Brasil | BBC | GB | pt |
| Folha de S.Paulo | Folha | BR | pt |
| Público | Público | PT | pt |

#### Russian (+2)
| Name | Publisher | Country | Language |
|---|---|---|---|
| BBC Russian | BBC | GB | ru |
| Meduza | Meduza | LV | ru |

#### Japanese (+3)
| Name | Publisher | Country | Language |
|---|---|---|---|
| Asahi Shimbun | Asahi Shimbun | JP | ja |
| Mainichi Shimbun | Mainichi Shimbun | JP | ja |
| NHK News | NHK | JP | ja |

#### Korean (+3)
| Name | Publisher | Country | Language |
|---|---|---|---|
| Yonhap News | Yonhap | KR | en |
| Korea Herald | Korea Herald | KR | en |
| Chosun Ilbo | Chosun Ilbo | KR | ko |

---

## Section 6: Data Quality Quick Wins

### Publisher Normalization
Detected inconsistencies to fix in `data/feeds.json`:

| Current (variant 1) | Current (variant 2) | Canonical |
|---|---|---|
| "The New York Times" | "New York Times" | "The New York Times" |
| "Der Spiegel" | (appears in two entries) | "Der Spiegel" (already consistent, OK) |

Run: `grep '"publisher"' data/feeds.json | sort | uniq -c | sort -rn` to find all duplicates.

### http:// → https:// Upgrades
Run `npm run build` and check warnings for `http://` URLs, then run:
```bash
npx tsx scripts/apply-https-upgrades.ts
```
or hand-update each `http://` URL to `https://` where the TLS endpoint responds.

### Coverage Targets
Per-category minimum: 8 feeds (current: 6 categories with < 8)
Per-ISO-3166 country: at least 1 feed (current: 167/249 countries — excellent, maintain)

---

## Section 7: Usage

### Adding a feed from this worksheet

1. Pick an unclaimed row from the candidate tables above.
2. Verify the feed URL is canonical (check the publisher's website or `/robots.txt`).
3. Add to `data/feeds.json` with the required fields.
4. Run `npm run validate -- --fix` to update stats/warnings/generatedAt.
5. Run `npm test` to confirm zero errors.
6. Submit a PR referencing this worksheet and the row added.

### As GitHub Issues

Each category section can be opened as a tracking issue:
- **Issue template**: "Add feeds to category: {category} (target: {target})"
- **Body**: Checklist of candidate feeds from this worksheet
- **Label**: `sourcing`, `enhancement`

---

## Section 8: Post-Sourcing Checklist

- [ ] All 15 categories have ≥ 8 feeds
- [ ] All priority languages have ≥ 3 feeds
- [ ] `wire` and `broadcast` mediaTypes are correctly assigned
- [ ] At least 6 state-affiliated outlets have `perspective` labeled
- [ ] Publisher names are normalized (no duplicates)
- [ ] Zero `http://` URLs remain
- [ ] `npm run validate` passes with zero errors
- [ ] `npm run build` generates complete `dist/` output
- [ ] GitHub Pages deploy publishes updated registry