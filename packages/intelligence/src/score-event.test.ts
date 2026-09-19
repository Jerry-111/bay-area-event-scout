import assert from "node:assert/strict";
import test from "node:test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, loadProfile, type AppEnv, type ScoutProfile } from "@event-scout/shared";
import { scoreExtractedEvent, topicAdjustment } from "./score-event.js";
import type { ExtractedEvent } from "./schemas.js";

test("scoreExtractedEvent recommends high-signal curated AI events in mock mode", async () => {
  const score = await scoreExtractedEvent(
    {
      id: "event-1",
      canonicalUrl: "https://lu.ma/event-1",
      sourceUrls: ["https://lu.ma/event-1"],
      title: "AI Agent Founders Dinner",
      description: "Approval required dinner for founders building AI agents and consumer AI.",
      startAt: "2026-08-25T02:00:00.000Z",
      timezone: "America/Los_Angeles",
      city: "San Francisco",
      locationPrecision: "city_only",
      hosts: ["Credible Founder"],
      organizers: ["Credible Founder"],
      platforms: ["luma"],
      visibilityFlags: ["approval_required"],
      registrationStatus: "approval_required",
      eventType: "dinner",
      confidence: 0.9
    } satisfies ExtractedEvent,
    mockEnv()
  );

  assert.equal(score.shouldRecommend, true);
  assert.equal(score.nextAction, "apply");
  assert.ok(score.totalScore >= 75);
});

test("scoreExtractedEvent prefers B2C consumer-facing AI events in mock mode", async () => {
  const score = await scoreExtractedEvent(
    {
      id: "event-b2c",
      canonicalUrl: "https://lu.ma/b2c-consumer-ai-founders",
      sourceUrls: ["https://lu.ma/b2c-consumer-ai-founders"],
      title: "B2C Consumer-Facing AI Founders Dinner",
      description: "Approval required dinner for founders building B2C AI, prosumer tools, creator products, social products, and personal AI apps.",
      startAt: "2026-08-25T02:00:00.000Z",
      timezone: "America/Los_Angeles",
      city: "San Francisco",
      locationPrecision: "city_only",
      hosts: ["Consumer AI Founder"],
      organizers: ["Consumer AI Founder"],
      platforms: ["luma"],
      visibilityFlags: ["approval_required"],
      registrationStatus: "approval_required",
      eventType: "dinner",
      confidence: 0.9
    } satisfies ExtractedEvent,
    mockEnv()
  );

  assert.equal(score.shouldRecommend, true);
  assert.equal(score.nextAction, "apply");
  assert.ok(score.totalScore >= 90);
  assert.match(score.rationale, /Preferred topic: Consumer AI \/ B2C \(\+8\)/);
});

test("scoreExtractedEvent skips hackathon-style time sinks in mock mode", async () => {
  const score = await scoreExtractedEvent(
    {
      id: "event-hackathon",
      canonicalUrl: "https://lu.ma/ai-agent-hackathon",
      sourceUrls: ["https://lu.ma/ai-agent-hackathon"],
      title: "AI Agent Hackathon",
      description: "Two-day buildathon for founders and developers in San Francisco.",
      startAt: "2026-08-25T16:00:00.000Z",
      timezone: "America/Los_Angeles",
      city: "San Francisco",
      locationPrecision: "city_only",
      hosts: ["Credible Founder"],
      organizers: ["Credible Founder"],
      platforms: ["luma"],
      visibilityFlags: ["public"],
      registrationStatus: "open",
      eventType: "workshop",
      confidence: 0.9
    } satisfies ExtractedEvent,
    mockEnv()
  );

  assert.equal(score.shouldRecommend, false);
  assert.equal(score.nextAction, "skip");
  assert.ok(score.penalties.includes("excluded_format:hackathon"));
  assert.ok(score.networkingValue <= 3);
});

test("scoreExtractedEvent skips physical AI and frontier research rooms in mock mode", async () => {
  const score = await scoreExtractedEvent(
    {
      id: "event-research",
      canonicalUrl: "https://lu.ma/research-club",
      sourceUrls: ["https://lu.ma/research-club"],
      title: "Physical AI Research Club",
      description: "Frontier lab research discussion for robotics researchers, PhDs, postdocs, and research scientists.",
      startAt: "2026-08-25T02:00:00.000Z",
      timezone: "America/Los_Angeles",
      city: "San Francisco",
      locationPrecision: "city_only",
      hosts: ["Frontier Lab"],
      organizers: ["Frontier Lab"],
      platforms: ["luma"],
      visibilityFlags: ["approval_required"],
      registrationStatus: "approval_required",
      eventType: "salon",
      confidence: 0.9
    } satisfies ExtractedEvent,
    mockEnv()
  );

  assert.equal(score.shouldRecommend, false);
  assert.equal(score.nextAction, "skip");
  assert.ok(score.penalties.includes("excluded_topic:physical ai"));
  assert.ok(score.totalScore < 75);
});

test("scoreExtractedEvent skips explicit Series A founder eligibility gates in mock mode", async () => {
  const score = await scoreExtractedEvent(
    {
      id: "event-series-a",
      canonicalUrl: "https://lu.ma/series-a-founder-dinner",
      sourceUrls: ["https://lu.ma/series-a-founder-dinner"],
      title: "AI Founder Dinner for Series A Founders",
      description: "Private dinner for Series A+ founders only.",
      startAt: "2026-08-25T02:00:00.000Z",
      timezone: "America/Los_Angeles",
      city: "San Francisco",
      locationPrecision: "city_only",
      hosts: ["Credible Founder"],
      organizers: ["Credible Founder"],
      platforms: ["luma"],
      visibilityFlags: ["approval_required"],
      registrationStatus: "approval_required",
      eventType: "dinner",
      confidence: 0.9
    } satisfies ExtractedEvent,
    mockEnv()
  );

  assert.equal(score.shouldRecommend, false);
  assert.equal(score.nextAction, "skip");
  assert.ok(score.penalties.includes("eligibility_gate:series a+"));
  assert.ok(score.totalScore < 75);
});

test("scoreExtractedEvent downranks B2B enterprise-heavy events in mock mode", async () => {
  const score = await scoreExtractedEvent(
    {
      id: "event-b2b",
      canonicalUrl: "https://lu.ma/b2b-ai-gtm-dinner",
      sourceUrls: ["https://lu.ma/b2b-ai-gtm-dinner"],
      title: "B2B AI Enterprise GTM Dinner",
      description: "Approval required roundtable for enterprise SaaS sales, RevOps, pipeline, CIO buyers, and B2B GTM leaders.",
      startAt: "2026-08-25T02:00:00.000Z",
      timezone: "America/Los_Angeles",
      city: "San Francisco",
      locationPrecision: "city_only",
      hosts: ["Enterprise SaaS Community"],
      organizers: ["Enterprise SaaS Community"],
      platforms: ["luma"],
      visibilityFlags: ["approval_required"],
      registrationStatus: "approval_required",
      eventType: "dinner",
      confidence: 0.9
    } satisfies ExtractedEvent,
    mockEnv()
  );

  assert.equal(score.shouldRecommend, false);
  assert.equal(score.nextAction, "monitor");
  assert.ok(score.penalties.includes("lower_priority_topic:b2b_enterprise_saas"));
  assert.ok(score.penalties.includes("lower_priority_topic:sales_and_revenue_operations"));
  assert.ok(score.totalScore < 75);
});

test("scoreExtractedEvent promotes SF founder hub mixers in mock mode", async () => {
  const score = await scoreExtractedEvent(
    {
      id: "event-startuphq-mixer",
      canonicalUrl: "https://lu.ma/startuphq-ai-founders",
      sourceUrls: ["https://lu.ma/startuphq-ai-founders"],
      title: "AI Founders Mixer at StartupHQ",
      description:
        "Open networking mixer for founders, engineers, builders, and investors building AI agents and scaling startups.",
      startAt: "2026-08-25T02:00:00.000Z",
      timezone: "America/Los_Angeles",
      city: "San Francisco",
      venueText: "StartupHQ, 156 2nd St",
      locationPrecision: "exact",
      hosts: ["Novita AI"],
      organizers: ["Novita AI"],
      platforms: ["luma"],
      visibilityFlags: ["public"],
      registrationStatus: "open",
      eventType: "happy_hour",
      confidence: 0.9
    } satisfies ExtractedEvent,
    mockEnv()
  );

  assert.equal(score.shouldRecommend, true);
  assert.equal(score.nextAction, "rsvp");
  assert.ok(score.totalScore >= 75);
  assert.match(score.rationale, /ecosystem hub/i);
});

test("a B2B profile flips the consumer-over-B2B preference", async () => {
  const b2bProfile = presetProfile("b2b-saas-founder");
  const b2bEvent = b2bEnterpriseDinner();
  const consumerEvent = consumerFounderDinner();

  const b2bUnderDefault = await scoreExtractedEvent(b2bEvent, mockEnv());
  const b2bUnderB2bProfile = await scoreExtractedEvent(b2bEvent, mockEnv(b2bProfile));
  const consumerUnderB2bProfile = await scoreExtractedEvent(consumerEvent, mockEnv(b2bProfile));

  assert.equal(b2bUnderDefault.shouldRecommend, false);
  assert.equal(b2bUnderB2bProfile.shouldRecommend, true);
  assert.ok(b2bUnderB2bProfile.totalScore >= 90);
  assert.match(b2bUnderB2bProfile.rationale, /Preferred topic: B2B \/ enterprise SaaS/);
  assert.ok(consumerUnderB2bProfile.totalScore < b2bUnderB2bProfile.totalScore);
  assert.ok(consumerUnderB2bProfile.penalties.includes("lower_priority_topic:consumer_apps"));
});

test("a fintech profile recommends fintech rooms the default profile ignores", async () => {
  const fintech = presetProfile("fintech");
  const event: ExtractedEvent = {
    ...consumerFounderDinner(),
    id: "event-fintech",
    canonicalUrl: "https://lu.ma/payments-founders-dinner",
    sourceUrls: ["https://lu.ma/payments-founders-dinner"],
    title: "Payments and Embedded Finance Founders Dinner",
    description: "Approval required dinner for fintech founders building payments, lending, and banking infrastructure.",
    hosts: ["Fintech Operators Club"],
    organizers: ["Fintech Operators Club"]
  };

  const underFintech = await scoreExtractedEvent(event, mockEnv(fintech));
  const underDefault = await scoreExtractedEvent(event, mockEnv());

  assert.equal(underFintech.shouldRecommend, true);
  assert.match(underFintech.rationale, /Preferred topic: Fintech \(\+8\)/);
  assert.ok(underFintech.totalScore > underDefault.totalScore);
});

test("fintech profile does not hard-exclude robotics the way the default profile does", async () => {
  const event: ExtractedEvent = {
    ...consumerFounderDinner(),
    id: "event-robotics",
    title: "Robotics Founders Dinner",
    description: "Approval required dinner for founders building robotics companies."
  };

  const underDefault = await scoreExtractedEvent(event, mockEnv());
  const underFintech = await scoreExtractedEvent(event, mockEnv(presetProfile("fintech")));

  assert.ok(underDefault.penalties.includes("excluded_topic:robotics"));
  assert.equal(underFintech.penalties.some((penalty) => penalty.startsWith("excluded_topic:")), false);
});

test("topicAdjustment adds every matching topic weight and caps the total", () => {
  const profile = presetProfile("consumer-ai-founder");
  const adjustment = topicAdjustment(b2bEnterpriseDinner(), profile);

  assert.equal(adjustment.boost, 0);
  assert.equal(adjustment.penalty, 20);
  assert.deepEqual(adjustment.penalizedTopics.map((topic) => topic.name), ["B2B / enterprise SaaS", "Sales and revenue operations"]);

  const stacked = topicAdjustment(b2bEnterpriseDinner(), {
    ...profile,
    topics: profile.topics.map((topic) => (topic.weight < 0 ? { ...topic, weight: -20 } : topic))
  });
  assert.equal(stacked.penalty, 25);
});

test("topic boosts are halved for formats the profile avoids", () => {
  const profile = presetProfile("consumer-ai-founder");
  const conference: ExtractedEvent = {
    ...consumerFounderDinner(),
    title: "Consumer AI Conference",
    description: "Annual conference for consumer AI builders.",
    eventType: "conference"
  };

  assert.equal(topicAdjustment(consumerFounderDinner(), profile).boost, 8);
  assert.equal(topicAdjustment(conference, profile).boost, 4);
});

function b2bEnterpriseDinner(): ExtractedEvent {
  return {
    id: "event-b2b",
    canonicalUrl: "https://lu.ma/b2b-ai-gtm-dinner",
    sourceUrls: ["https://lu.ma/b2b-ai-gtm-dinner"],
    title: "B2B AI Enterprise GTM Dinner",
    description: "Approval required roundtable for enterprise SaaS sales, RevOps, pipeline, CIO buyers, and B2B GTM leaders.",
    startAt: "2026-08-25T02:00:00.000Z",
    timezone: "America/Los_Angeles",
    city: "San Francisco",
    locationPrecision: "city_only",
    hosts: ["Enterprise SaaS Community"],
    organizers: ["Enterprise SaaS Community"],
    platforms: ["luma"],
    visibilityFlags: ["approval_required"],
    registrationStatus: "approval_required",
    eventType: "dinner",
    confidence: 0.9
  };
}

function consumerFounderDinner(): ExtractedEvent {
  return {
    id: "event-consumer",
    canonicalUrl: "https://lu.ma/consumer-ai-founders",
    sourceUrls: ["https://lu.ma/consumer-ai-founders"],
    title: "Consumer AI Founders Dinner",
    description: "Approval required dinner for founders building consumer AI and creator apps.",
    startAt: "2026-08-25T02:00:00.000Z",
    timezone: "America/Los_Angeles",
    city: "San Francisco",
    locationPrecision: "city_only",
    hosts: ["Credible Founder"],
    organizers: ["Credible Founder"],
    platforms: ["luma"],
    visibilityFlags: ["approval_required"],
    registrationStatus: "approval_required",
    eventType: "dinner",
    confidence: 0.9
  };
}

function presetProfile(name: string): ScoutProfile {
  return loadProfile({ cwd: dirname(fileURLToPath(import.meta.url)), env: { SCOUT_PROFILE: name } }).profile;
}

function mockEnv(profile?: ScoutProfile): AppEnv {
  return loadEnv({ MOCK_MODE: "true" }, profile ? { profile } : {});
}
