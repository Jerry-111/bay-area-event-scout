# Free Public Source Strategy

This project should not depend on paid Luma, Meetup, Eventbrite, or LinkedIn APIs for discovery. The durable path is to scan public source surfaces, public feeds, indexed web results, and the existing official X API path.

## Source Tiers

### Must scan

- Luma public discovery pages: SF, AI, San Francisco, Bay Area.
- Luma public calendars for highly relevant AI/founder communities: Founders Inc, Bond AI SF, Bay Area Founders Club, YC Startup School, StartX, Cerebral Valley, AI Tinkerers SF, AI Events SF, South Park Commons, Inception Studio, Founders Bay.
- Newsletter/RSS roundups: Founders Bay, Bay Area Founders Club, Kyosuke, Times of SF.
- Existing official X API searches for high-signal handles and posts mentioning Luma/Eventbrite/Meetup RSVP links.

These sources are good because they frequently expose the exact RSVP URL and tend to include small curated rooms. The list leans toward AI and founder communities because that is what the default profile looks for; use `sources.disable` and `sources.add` in your [profile](profiles.md) to reshape it.

### High value fallback

- More focused Luma calendars with strong AI, founder, VC, GTM, or networking density: ML SF, AWS Builder Loft SF, Frontier Tower, Frontier Syndicate, Pebblebed, AGI House, AICamp, Llama Lounge, OpenStages, Founder Social Club, Brderless, Rho Community, Step, Builders for San Francisco, Scalekit/Agents in Production.
- Public event digest pages such as FounderCal SF, TLDR EVENTS, LOOMUS, Startup School After Hours, Fog City Events, YC Startup School pages, Berkeley SkyDeck pages, Founders Bay Events, AWS Builder Loft official, Stanford HAI, Berkeley RDI.
- Exa indexed search constrained to source domains and high-signal terms.

These are useful for recall, but they should not dominate extraction budgets because they can include stale or generic results.

### Lower priority

- Broad Eventbrite and Meetup indexed search.
- Broad semantic web search.
- Ticketing/search APIs for large public events.
- Broad networking aggregators such as The San Francisco Tech Scene, broad pitch/demo collections, and global calendars that include only occasional Bay Area events.

These sources are mature technically, but less aligned with small founder/operator/AI dinners and salons.

## Networking-Focused Criteria

Networking-heavy events should be promoted when they have at least one of these signals:

1. Founder/operator/VC density: founder dinner, founder breakfast, GP/LP gathering, investor mixer, pitch night, demo day, co-founder matching.
2. Specific room quality: approval-required, curated, limited capacity, closed-door, cohort/alumni/community membership, named hosts or sponsors.
3. Useful business intent: GTM, early sales, fundraising, customer discovery, AI infrastructure buyers, enterprise operators.
4. Local actionability: SF, Palo Alto, Mountain View, Berkeley, Menlo Park, or Bay Area in-person venues.

Generic happy hours, paid mega-conferences, online webinars, and social-only events should stay eligible for discovery but lose during ranking unless the source has strong historical recommendation quality.

Formats listed under `exclude.formats` in the profile (hackathons, buildathons, code sprints, and hack nights in the default profile) are treated as low-networking time sinks: they are never used as positive search terms, they become search exclusions, and matching candidates are rejected before extraction.

## Current Free Source Expansion

The registry now intentionally has more sources than a single Exa budget can exhaust. That is acceptable because:

- Public source fetching scans direct calendar/digest URLs without paid event-platform APIs.
- Exa searches are a supplemental indexed layer and are capped by `MAX_EXA_SEARCHES_PER_RUN`.
- Candidate extraction/scoring remains separately capped by `MAX_LLM_EXTRACT_CANDIDATES_PER_RUN`.
- Extraction dedupes candidates by canonical URL before using Firecrawl/LLM budget, while still preserving all saved candidate/source records for attribution.
- `event_sources` attribution lets us measure which sources produce extracted/recommended events and later demote noisy sources.

## Daily Agenda And Anti-Repetition

Scheduled scans should not run the same source/query pack three times per day. The worker passes `scanTime` into discovery, and `buildDailyQueryPack` uses it to create a deterministic agenda:

1. `09:00` morning/full scan: broad source refresh, RSS/newsletters, X API, must-scan calendars, and general indexed discovery.
2. `14:00` midday/light scan: different source slice plus Palo Alto/Menlo Park/Mountain View, VC, GTM, operator, founder networking, and roundtable queries.
3. `22:00` evening/light scan: different source slice plus this-week/next-week planning, upcoming RSVP, dinner, salon, mixer, roundtable, breakfast, and updated roundup queries.

Source selection rotates by source id and date, so high/medium sources move across scan windows and adjacent days. Must-scan sources get morning coverage and one rotating light-scan refresh. RSS and X are morning-only by default. Manual calls to `buildDailyQueryPack()` without `scanTime` still return the broad legacy pack for debugging and backfill use.

## Implementation Notes

- `packages/discovery/src/source-registry.ts` is the source of truth for built-in free public sources; the profile can disable or add sources.
- `public_source` fetches public pages and extracts event links.
- `rss` reads RSS/Atom feeds and emits linked event URLs or roundup article URLs.
- `luma_seed` is retained for source graph context but marked rejected so calendar home pages are not treated as event pages.
- Worker candidate ranking now diversifies by platform/source query before LLM extraction.
- Worker search planning reserves a configurable slice of Exa budget for LLM-planned (or fallback) `agent_exploration` queries. The default is 50% of `MAX_EXA_SEARCHES_PER_RUN`, capped by `MAX_AGENT_GENERATED_EXA_QUERIES`, with recent query/event fingerprints used as avoid context.
- Event-source attribution now writes `event_sources`, so the admin dashboard can measure which sources actually create events and recommendations.

## Operating Rule

When adding sources, prefer:

1. Recurring calendar or feed over one-off event page.
2. Source-specific query over broad semantic query.
3. Public source page with direct RSVP links over pages that require login.
4. Small curated rooms that match the profile over large generic conferences.
