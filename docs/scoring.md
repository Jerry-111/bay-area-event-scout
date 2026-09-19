# Scoring

Every extracted event gets a 0-100 score with a component breakdown and a short rationale, so both
recommended and rejected events are explainable. What counts as a good event comes from the active
[scout profile](profiles.md); this page describes the mechanics.

## Pipeline

1. **Pre-LLM filter** (`packages/discovery/src/normalize.ts`): candidates with an explicit past date,
   or that mention one of the profile's `exclude` formats, topics, or eligibility gates, are stored as
   rejected with a reason such as `excluded_format:hackathon` or `eligibility_gate:series a+`. No LLM
   budget is spent on them.
2. **Extraction** (`packages/intelligence/src/llm.ts`): the extract model turns the page into
   structured fields. Events are deduped by URL and by fuzzy title/date/city/host matching, then
   limited to the next month.
3. **LLM score**: the score model gets a rubric prompt generated from the profile (persona, topics,
   formats, audience, region, hubs, exclusions, and `notes`) and returns the components below.
   In mock mode, a keyword scorer applies the same rubric using the same profile.
4. **Topic adjustment** (`packages/intelligence/src/score-event.ts`): every profile topic that
   matches adds its `weight` (boosts capped at +15, penalties at -25; boosts halved for `formats.avoid`).
5. **Thresholds**: events scoring at least `thresholds.recommend` (default 80) are recommended,
   unless they were already recommended in an earlier run. Events between `thresholds.review`
   (default 65) and the recommend bar are shown for review.

## Components

| Component | Max | What good looks like |
| --- | ---: | --- |
| User fit | 25 | The event is about the profile's topics and aimed at the profile's audience. |
| Room quality | 20 | Small curated formats (dinners, breakfasts, salons, roundtables), approval-required or invite-only, credible hosts, or a hub venue from the profile. |
| Networking value | 15 | Attendees are likely to include the people the profile wants to meet. |
| Timeliness | 10 | Upcoming soon enough to act on, with a clear date and time. |
| Location/actionability | 10 | In one of the profile's cities or region terms, with enough detail to decide. |
| Novelty/under-the-radar | 10 | Not a generic conference or obvious large public meetup; niche or high-signal source evidence. |
| Evidence confidence | 10 | Clear source text, title, date, host, registration status, and location. |

## Penalties

- Anything in the profile's `exclude` lists, or a topic with a negative weight.
- Formats in `formats.avoid` (conferences, expos, and courses in the presets).
- Online-only events, sold-out or closed registration, events that already happened.
- Weak or conflicting date/location evidence, or events outside the profile's region.

## Suggested actions

- `apply`: curated event with an approval, application, or invite signal.
- `rsvp`: open event with enough quality and actionability.
- `ask_intro`: high-quality event where access likely needs a host or member intro.
- `monitor`: promising but incomplete, closed, sold out, or just under the bar.
- `skip`: below the review band or excluded by the profile.

The admin UI shows each event's component bars, the rationale (including which profile topics
moved the score), and the penalties that applied.
