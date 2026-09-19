import assert from "node:assert/strict";
import test from "node:test";
import { eventExtractionSchema } from "./schemas.js";

const baseEvent = {
  id: "event-1",
  canonicalUrl: "https://example.com/event",
  sourceUrls: ["https://example.com/event"],
  title: "AI Founders Dinner",
  timezone: "America/Los_Angeles",
  hosts: ["Host"],
  organizers: ["Host"],
  platforms: ["luma"],
  visibilityFlags: ["approval_required"],
  registrationStatus: "approval",
  eventType: "networking",
  confidence: "86"
};

test("eventExtractionSchema normalizes common LLM enum aliases", () => {
  assert.equal(eventExtractionSchema.parse({ ...baseEvent, locationPrecision: "venue" }).locationPrecision, "exact");
  assert.equal(eventExtractionSchema.parse({ ...baseEvent, locationPrecision: "exact_location" }).locationPrecision, "exact");
  assert.equal(eventExtractionSchema.parse({ ...baseEvent, locationPrecision: "approximate" }).locationPrecision, "neighborhood");
  assert.equal(eventExtractionSchema.parse({ ...baseEvent, locationPrecision: "city" }).locationPrecision, "city_only");
});
