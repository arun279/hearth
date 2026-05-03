import { describe, expect, it } from "vitest";
import {
  audienceEnvelopeSchema,
  completionRuleEnvelopeSchema,
  flowEnvelopeSchema,
  partsEnvelopeSchema,
  postClosePolicyEnvelopeSchema,
  windowEnvelopeSchema,
} from "../../src/activity/envelope.ts";
import {
  AUDIENCE_FIXTURE_EVERYONE_V1,
  AUDIENCE_FIXTURE_SUBSET_V1,
  COMPLETION_RULE_FIXTURE_ALL_PARTS_V1,
  COMPLETION_RULE_FIXTURE_MANUAL_V1,
  FLOW_FIXTURE_V1,
  PARTS_FIXTURE_V1,
  POST_CLOSE_FIXTURE_V1,
  WINDOW_FIXTURE_V1,
} from "./fixtures-v1.ts";

const ENVELOPES = [
  ["partsJson", partsEnvelopeSchema, PARTS_FIXTURE_V1],
  ["flowJson", flowEnvelopeSchema, FLOW_FIXTURE_V1],
  ["audienceJson(everyone)", audienceEnvelopeSchema, AUDIENCE_FIXTURE_EVERYONE_V1],
  ["audienceJson(subset)", audienceEnvelopeSchema, AUDIENCE_FIXTURE_SUBSET_V1],
  ["windowJson", windowEnvelopeSchema, WINDOW_FIXTURE_V1],
  ["postClosePolicyJson", postClosePolicyEnvelopeSchema, POST_CLOSE_FIXTURE_V1],
  ["completionRuleJson(manual)", completionRuleEnvelopeSchema, COMPLETION_RULE_FIXTURE_MANUAL_V1],
  [
    "completionRuleJson(all_parts)",
    completionRuleEnvelopeSchema,
    COMPLETION_RULE_FIXTURE_ALL_PARTS_V1,
  ],
] as const;

describe("activity envelope round-trip (v:1 baseline)", () => {
  it.each(ENVELOPES)("%s: parses cleanly through Zod", (_name, schema, fixture) => {
    const parsed = schema.parse(fixture);
    expect(parsed).toEqual(fixture);
  });

  it.each(ENVELOPES)("%s: survives JSON.stringify → JSON.parse → Zod", (_name, schema, fixture) => {
    const serialized = JSON.stringify(fixture);
    const reparsed = JSON.parse(serialized);
    const parsed = schema.parse(reparsed);
    expect(parsed).toEqual(fixture);
  });
});

describe("activity envelopes reject unknown v", () => {
  it.each([
    ["partsJson", partsEnvelopeSchema, PARTS_FIXTURE_V1],
    ["flowJson", flowEnvelopeSchema, FLOW_FIXTURE_V1],
    ["audienceJson", audienceEnvelopeSchema, AUDIENCE_FIXTURE_EVERYONE_V1],
    ["windowJson", windowEnvelopeSchema, WINDOW_FIXTURE_V1],
    ["postClosePolicyJson", postClosePolicyEnvelopeSchema, POST_CLOSE_FIXTURE_V1],
    ["completionRuleJson", completionRuleEnvelopeSchema, COMPLETION_RULE_FIXTURE_MANUAL_V1],
  ] as const)("%s: rejects v:2 (no shim yet)", (_name, schema, fixture) => {
    const bumped = { ...fixture, v: 2 } as Record<string, unknown>;
    expect(() => schema.parse(bumped)).toThrow();
  });
});
