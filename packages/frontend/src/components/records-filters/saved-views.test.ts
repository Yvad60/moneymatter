import { DEFAULT_SORTING } from '@/components/transactions-table/columns';
import { describe, expect, it } from 'vitest';

import { DEFAULT_FILTERS } from './const';
import { buildViewConfig, detectDatePreset, holdsPresetRange, resolveDatePreset, resolveView } from './saved-views';

const savedOn = new Date(2026, 0, 15, 10);
const appliedOn = new Date(2026, 2, 20, 10);

describe('saved transaction views', () => {
  it('detects a preset range and ignores a custom one', () => {
    const { from, to } = resolveDatePreset({ preset: 'last3Months', now: savedOn });

    expect(detectDatePreset({ start: from, end: to, now: savedOn })).toBe('last3Months');
    expect(detectDatePreset({ start: new Date(2025, 5, 1), end: to, now: savedOn })).toBeUndefined();
    expect(detectDatePreset({ start: undefined, end: undefined, now: savedOn })).toBeUndefined();
  });

  it('keeps a preset range rolling and a custom range fixed', () => {
    const filters = { ...DEFAULT_FILTERS, accountIds: ['a1'], start: new Date(2025, 5, 1), end: new Date(2025, 5, 30) };
    const fixed = { id: '1', name: 'Fixed', ...buildViewConfig({ filters, sorting: DEFAULT_SORTING }) };

    expect(resolveView({ view: fixed, now: appliedOn })).toStrictEqual({ filters, sorting: DEFAULT_SORTING });

    const rolling = { ...fixed, datePreset: 'thisMonth' as const };
    const resolved = resolveView({ view: rolling, now: appliedOn }).filters;

    expect(resolved.start).toStrictEqual(new Date(2026, 2, 1));
    expect(resolved.accountIds).toStrictEqual(['a1']);
  });

  it('recognises the rolling range applied on an earlier day, but not a hand-picked preset-shaped one', () => {
    const { from, to } = resolveDatePreset({ preset: 'thisMonth', now: savedOn });
    const filters = { ...DEFAULT_FILTERS, start: from, end: to, batchId: 'b1' };
    const view = { id: '1', name: 'Rolling', filters: {}, datePreset: 'thisMonth' as const };

    expect(holdsPresetRange({ view, filters, appliedOn: savedOn })).toBe(true);
    // December 1–31 is "this month" as of its own end, yet not the range applied in January.
    const december = { ...filters, start: new Date(2025, 11, 1), end: new Date(2025, 11, 31, 23, 59, 59, 999) };
    expect(holdsPresetRange({ view, filters: december, appliedOn: savedOn })).toBe(false);
    expect(buildViewConfig({ filters, sorting: DEFAULT_SORTING }).filters.batchId).toBeNull();
  });
});
