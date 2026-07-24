// Unit tests for AI research pure logic (no D1/Worker needed).
import { describe, expect, it } from "vitest";
import {
  validateIntake, normalizeTag, consolidateTags, buildAliasMap,
  scoreLink, dedupeLinks, decideLinkStatus, cardContentHash,
} from "../src/lib/aiResearch/intake";

describe("validateIntake", () => {
  it("accepts a well-formed intake", () => {
    const r = validateIntake({ primary_topic: "Auth", intent: "decision", entities: ["oauth"] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.intent).toBe("decision");
      expect(r.data.entities).toEqual(["oauth"]);
      expect(r.data.confidence).toBeGreaterThanOrEqual(0);
    }
  });
  it("coerces a wrong intent enum to 'other' and clips arrays", () => {
    const r = validateIntake({ intent: "nonsense", initial_tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.intent).toBe("other");
      expect(r.data.initial_tags.length).toBeLessThanOrEqual(40);
    }
  });
  it("fails safely (does not throw) on non-object input", () => {
    const r = validateIntake("not an object");
    expect(r.ok).toBe(false);
  });
  it("coerces object tag entries to strings", () => {
    const r = validateIntake({ initial_tags: [{ name: "x" }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.initial_tags[0]).toBe('{"name":"x"}');
  });
});

describe("normalizeTag + consolidateTags", () => {
  it("lowercases, trims, and dashes", () => {
    expect(normalizeTag("  Auth & Login! ")).toBe("auth-login");
  });
  it("resolves aliases to canonical names", () => {
    const aliases = buildAliasMap([
      { alias: "auth", canonical: "authentication" },
      { alias: "login", canonical: "authentication" },
    ]);
    const { canonical } = consolidateTags(["Auth", "login", "Authentication", "the", ""], aliases);
    expect(canonical).toEqual(["authentication"]); // alias-folded, stopword dropped, empty dropped
  });
  it("drops stopwords and empties", () => {
    const { canonical, rejected } = consolidateTags(["the", "a", "   ", "billing"], {});
    expect(canonical).toEqual(["billing"]);
    expect(rejected.length).toBeGreaterThan(0);
  });
});

describe("scoreLink + dedupeLinks", () => {
  it("scores higher with more shared tags / similarity", () => {
    const low = scoreLink({ sharedTags: 1, sharedEntities: 0 });
    const high = scoreLink({ sharedTags: 3, sharedEntities: 0, similarity: 0.9 });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(1);
  });
  it("drops self-links and merged reversed duplicates for symmetric types", () => {
    const out = dedupeLinks([
      { source_card_id: "a", target_card_id: "a", relationship_type: "related_to", confidence: 0.8, explanation: "", evidence: [] },
      { source_card_id: "a", target_card_id: "b", relationship_type: "related_to", confidence: 0.5, explanation: "", evidence: [] },
      { source_card_id: "b", target_card_id: "a", relationship_type: "related_to", confidence: 0.7, explanation: "", evidence: [] },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].source_card_id).toBe("a");
    expect(out[0].target_card_id).toBe("b");
    expect(out[0].confidence).toBe(0.7); // kept the higher-confidence one
  });
  it("keeps both directions for non-symmetric types", () => {
    const out = dedupeLinks([
      { source_card_id: "a", target_card_id: "b", relationship_type: "blocks", confidence: 0.6, explanation: "", evidence: [] },
      { source_card_id: "b", target_card_id: "a", relationship_type: "blocks", confidence: 0.6, explanation: "", evidence: [] },
    ]);
    expect(out.length).toBe(2);
  });
});

describe("decideLinkStatus", () => {
  it("approves above threshold, else proposes", () => {
    expect(decideLinkStatus(0.9, 0.6, new Set())).toBe("approved");
    expect(decideLinkStatus(0.4, 0.6, new Set())).toBe("proposed");
  });
});

describe("cardContentHash", () => {
  it("is stable for identical meaningful content", () => {
    const a = cardContentHash({ title: "T", description: "D", tags_json: '["x"]' });
    const b = cardContentHash({ title: "T", description: "D", tags_json: '["x"]' });
    expect(a).toBe(b);
  });
  it("changes when title changes", () => {
    const a = cardContentHash({ title: "T1", description: "D", tags_json: "[]" });
    const b = cardContentHash({ title: "T2", description: "D", tags_json: "[]" });
    expect(a).not.toBe(b);
  });
});
