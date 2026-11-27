import { describe, expect, it } from "vitest";
import { SENSITIVE_FIELD_IDS } from "./sensitiveFields.js";
import { assertBlockedSelectorsCoverSensitiveFields } from "./sessionReplay.js";

describe("SENSITIVE_FIELD_IDS (#457)", () => {
  it("covers the customer API key and the webhook signing secret", () => {
    expect(SENSITIVE_FIELD_IDS).toContain("customer-key-input");
    expect(SENSITIVE_FIELD_IDS).toContain("webhook-status");
  });

  it("is fully covered by the session-replay block list", () => {
    expect(assertBlockedSelectorsCoverSensitiveFields()).toEqual([]);
  });
});
