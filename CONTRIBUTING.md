# Contributing to giti-rss-registry

Thanks for helping improve the registry.

## What to submit

For each feed addition/update, include:

1. Publisher name
2. Publisher homepage URL
3. Feed URL
4. Language code
5. Country/countries (ISO alpha-2)
6. Category
7. Whether feed appears official/canonical
8. Evidence feed is active (recent item or validation output)
9. Optional contextual notes (regional, exile, aggregator, etc.)

## Editorial rules

- Prefer official/canonical feeds.
- Avoid comments/replies/tags feeds.
- Avoid duplicates unless meaningfully distinct.
- Prefer stable public endpoints over temporary ones.
- Apply perspective labels only when rationale is defensible and documented.

## Data quality expectations

Your change should pass validation checks:

- schema compliance
- unique IDs and URLs
- valid category/language/country fields

Health checks (reachability/staleness) may be warning-only depending on CI policy.

## Perspective labels policy

If you add or change `perspective`, include:

- short rationale
- at least one reference/source explaining the classification basis

Perspective labels should be used carefully and sparingly.

## Commit and PR guidance

- Keep PRs small and focused.
- Include before/after examples when changing mapping logic.
- If changing schema or categories, include migration notes.
