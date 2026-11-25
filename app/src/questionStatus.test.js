import { describe, it, expect } from 'vitest';
import { describeStatus } from './questionStatus.js';
import en from './locales/en.json';

// Translate with the English catalog so the assertions don't depend on the
// test runner's locale.
const translate = (key) => en[key] ?? key;

describe('describeStatus (#448)', () => {
  it('labels reconciling questions as reconciling', () => {
    expect(describeStatus({ status: 'reconciling' }, translate)).toEqual({
      label: en['status.reconciling'],
      cls: 'badge-pending',
    });
  });

  it('labels awaiting_workers questions as awaiting workers', () => {
    expect(describeStatus({ status: 'awaiting_workers' }, translate)).toEqual({
      label: en['status.awaiting_workers'],
      cls: 'badge-pending',
    });
  });

  it('keeps the generic pending label for other non-settled statuses', () => {
    expect(describeStatus({ status: 'queued' }, translate)).toEqual({
      label: en['status.pending'],
      cls: 'badge-pending',
    });
  });

  it('labels settled questions by outcome', () => {
    expect(describeStatus({ status: 'settled', outcome: 'resolved' }, translate)).toEqual({
      label: en['status.resolved'],
      cls: 'badge-resolved',
    });
    expect(describeStatus({ status: 'settled', outcome: 'refunded' }, translate)).toEqual({
      label: en['status.refunded'],
      cls: 'badge-refunded',
    });
  });

  it('has a translation for every label it can return in every locale', async () => {
    for (const locale of ['en', 'es', 'ar']) {
      const catalog = (await import(`./locales/${locale}.json`)).default;
      for (const key of ['pending', 'awaiting_workers', 'reconciling', 'resolved', 'refunded']) {
        expect(catalog[`status.${key}`], `${locale} status.${key}`).toBeTypeOf('string');
      }
    }
  });
});
