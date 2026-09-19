# Scout profiles

A profile is one YAML file that says who the scout works for and which events are worth their
time. Everything that used to be hardcoded preference now comes from it:

| Pipeline step | What the profile controls |
| --- | --- |
| Search queries | `search.phrases`, `search.rooms`, `region`, `exclude.formats` (as `-hackathon` style operators) |
| Agentic search planner | the planner prompt and its fallback query axes |
| Pre-LLM filter | `exclude.formats`, `exclude.topics`, `exclude.eligibility` drop candidates before any LLM spend |
| Candidate ranking | topics, audience, formats, hubs, and region terms decide which candidates get extracted first |
| LLM scoring prompt | `persona`, topics, formats, audience, region, hubs, exclusions, and `notes` |
| Score adjustment | topic `weight`s nudge the final score after the LLM (or keyword) scorer |
| Recommendations | `thresholds.recommend` for the digest and "Act now", `thresholds.review` for "Worth a look" |
| Sources | `sources.disable` and `sources.add` edit the built-in source list |

## Choosing a profile

The scout looks for a profile in this order:

1. `SCOUT_PROFILE` — a preset name from `profiles/` (`SCOUT_PROFILE=fintech`) or a path to a YAML file.
2. `scout.profile.yaml` in the working directory or any parent directory.
3. The built-in default, identical to `profiles/consumer-ai-founder.yaml`.

Presets:

| Preset | For |
| --- | --- |
| `consumer-ai-founder` | Early-stage consumer AI founder. Prefers B2C/consumer AI, penalizes B2B sales rooms, skips hackathons and research-heavy rooms. The default. |
| `b2b-saas-founder` | B2B SaaS / enterprise AI founder. Prefers enterprise and go-to-market rooms, lower priority for consumer apps. |
| `fintech` | Fintech founder or operator. Prefers payments, lending, banking infrastructure; penalizes crypto speculation. |
| `climate-tech` | Climate tech founder, operator, or partner. Prefers energy, carbon, and sustainability rooms with climate investors and corporate buyers; penalizes crypto speculation. |

## Changing it in plain words

You don't have to edit YAML. These commands use your configured LLM:

```sh
pnpm profile:show                                   # what the scout is looking for now
pnpm profile:edit "add climate tech, and never show crypto events"
pnpm profile:new "a seed-stage climate tech founder looking for rooms with climate investors"
pnpm profile:undo                                   # back to the previous version (run again to redo)
```

- `profile:edit` sends the current profile and your request to the LLM, checks the result against
  the schema (retrying once with the errors if it fails), and lists exactly what would change
  (added topics, changed weights, new exclusions) before asking to save. Requests can be in any
  language; the profile itself stays in English, because event pages and keyword matching are.
- `profile:new` writes a whole new profile from a description.
- Your `sources` section is never sent to the LLM or changed by it.
- Presets are never modified. Editing a preset (or the built-in default) saves your version as
  `scout.profile.yaml` and switches off `SCOUT_PROFILE` in `.env.local`, so your version is used.
- The previous version is kept as `scout.profile.yaml.bak`, which is what `profile:undo` restores.
- `--yes` skips the confirmation, for scripts. With GitHub Actions, the **Preferences** workflow
  does the same from the browser ([guide](github-actions.md#7-your-preferences)).

`pnpm onboard` offers presets, "describe yourself", and "change the current preferences" as part of
the guided setup. To edit by hand instead, copy a preset and change it:

```sh
cp profiles/consumer-ai-founder.yaml scout.profile.yaml
pnpm scout:doctor   # validates the file and shows what the scout will use
```

A profile is not a secret. Commit `scout.profile.yaml` to your fork so every deployment
(Trigger.dev tasks and the admin UI) uses the same preferences.

## Fields

Only `persona` and `search.phrases` are required. Everything else has a neutral default
(empty lists, SF Bay Area region, thresholds 80/65).

```yaml
name: my-profile                 # shown in logs and the admin UI; defaults to the file name
persona: >-                      # third person; goes straight into the LLM prompts
  a seed-stage climate tech founder looking for rooms with other climate founders and investors

region:
  name: SF Bay Area              # used in prompts and search queries
  cities: [San Francisco, Oakland, Berkeley]   # local and convenient, most convenient first
  aliases: [SF, Bay Area, East Bay]            # other words that mark an event as local

topics:                          # what events are about
  - name: Climate tech
    weight: 8                    # > 0 boosts, < 0 penalizes, 0 = relevant with no automatic adjustment
    keywords: [climate, clean energy, carbon removal, grid, battery]
  - name: Crypto
    weight: -10
    keywords: [crypto, web3, token]

audience: [founder, investor, operator]     # people you want in the room

formats:
  prefer: [dinner, breakfast, roundtable]   # small-room formats; count as a curated-room signal
  avoid: [conference, expo, online]         # penalized, and they halve topic boosts

hubs: [Elemental Impact, Greentown Labs]    # venues/communities whose events usually have a strong room

exclude:                         # hard filters: dropped before any LLM call, and scored as skip
  formats: [hackathon, webinar]
  topics: [oil and gas]
  eligibility: [accredited investors only]  # rooms you can't get into

search:
  phrases: [climate founders, climate tech founders, clean energy startups]   # how events describe themselves
  rooms: [founder dinner, investor mixer, operator roundtable]

notes:                           # extra guidance for the LLM scorer, passed through word for word
  - Events with climate investors are worth recommending even when the topic is broader.

thresholds:
  recommend: 80                  # digest and "Act now"
  review: 65                     # "Worth a look"; must be lower than recommend

sources:                         # optional edits to the built-in source list
  disable: [luma-ai-tinkerers-sf, research]   # source ids or tags from packages/discovery/src/source-registry.ts
  add:
    - name: Climate calendar
      kind: luma_calendar        # luma_calendar | rss_feed | event_digest | organizer_site | indexed_source | x_account
      url: https://luma.com/some-climate-calendar
    - name: Climate newsletter
      kind: rss_feed
      feed: https://example.substack.com/feed
    - name: A climate organizer on X
      kind: x_account
      handle: someorganizer      # or `query:` for a full X search query
```

Unknown keys are rejected, so a typo like `topic:` instead of `topics:` fails loudly instead of
being ignored.

## Keyword rules

- Matching is case-insensitive, ignores punctuation, and works on whole words:
  `ai` does not match "said", and `sales` does not match "tickets on sale".
- A keyword whose last word does not end in `s` also matches its plural, so write keywords in
  singular form: `founder` matches "founders".
- Hyphens and spaces are interchangeable: `consumer-facing` matches "consumer facing".

## How topic weights move a score

After the LLM (or the keyword scorer in mock mode) scores an event, every matching topic adds its
weight to the 0-100 total. Boosts are capped at +15 and penalties at -25, and boosts are halved when
the event also matches a `formats.avoid` term. The adjustment is spread across the user-fit,
networking, and novelty components, and each matching topic is named in the event's rationale
(`Preferred topic: Consumer AI / B2C (+8)`), so you can see why a score moved.

Events at or above `thresholds.recommend` are recommended. Events between `thresholds.review`
and the recommend bar show up under "Worth a look" in the admin UI and as "Possible" in the digest.

## Region

The region fields make queries and prompts local, but the built-in source registry
(`packages/discovery/src/source-registry.ts`) is a list of SF Bay Area calendars, newsletters, and
X accounts. To scout another city, change `region`, disable the Bay Area sources you don't want, and
add your own with `sources.add`.

## Deploying a profile

- Trigger.dev: `trigger.config.ts` bundles `profiles/*.yaml` and `scout.profile.yaml` with the
  worker. Set `SCOUT_PROFILE` in the Trigger.dev environment, or deploy with a `scout.profile.yaml`.
- Admin UI: set the same `SCOUT_PROFILE` (or commit `scout.profile.yaml`) so the dashboard uses the
  same score bands. The Tuning tab shows which profile it loaded.
