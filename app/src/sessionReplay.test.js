import { describe, expect, it } from 'vitest';
import { assertBlockedSelectorsCoverSensitiveFields } from './sessionReplay.js';
import { SENSITIVE_FIELD_IDS } from './sensitiveFields.js';

describe('sessionReplay BLOCKED_SELECTORS', () => {
  it('covers every SENSITIVE_FIELD_IDS entry', () => {
    expect(assertBlockedSelectorsCoverSensitiveFields()).toEqual([]);
  });

  it('reports an uncovered id when one is missing from BLOCKED_SELECTORS', () => {
    // Sanity check that the drift assertion is meaningful: a sensitive id with
    // no matching blocked selector must surface as uncovered.
    const uncovered = assertBlockedSelectorsCoverSensitiveFields();
    const blocked = new Set(
      SENSITIVE_FIELD_IDS.map((id) => `#${id}`),
    );
    const missing = SENSITIVE_FIELD_IDS.filter((id) => !blocked.has(`#${id}`));
    expect(uncovered).toEqual(missing);
  });
});
