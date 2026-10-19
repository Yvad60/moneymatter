import { describe, expect, it } from 'vitest';

import { clampColumnWidth, fitColumnWidths } from './columns';

describe('clampColumnWidth', () => {
  it('keeps widths within the bounds the settings schema accepts', () => {
    expect(clampColumnWidth({ widthPx: 10 })).toBe(60);
    expect(clampColumnWidth({ widthPx: 150.6 })).toBe(151);
    expect(clampColumnWidth({ widthPx: 9000 })).toBe(5000);
  });
});

describe('fitColumnWidths', () => {
  it('gives spare space to non-resized columns in proportion to their width', () => {
    const result = fitColumnWidths({
      columns: [{ widthPx: 100 }, { widthPx: 300 }, { widthPx: 50, isResized: true }],
      availablePx: 850,
    });
    expect(result).toEqual({ widths: [200, 600, 50], leftoverPx: 0 });
  });

  it('keeps base widths when the container is narrower than the columns', () => {
    const result = fitColumnWidths({
      columns: [{ widthPx: 100 }, { widthPx: 200, isResized: true }],
      availablePx: 150,
    });
    expect(result).toEqual({ widths: [100, 200], leftoverPx: 0 });
  });

  it('returns the spare as leftover when every column is resized', () => {
    const result = fitColumnWidths({
      columns: [
        { widthPx: 100, isResized: true },
        { widthPx: 200, isResized: true },
      ],
      availablePx: 500,
    });
    expect(result).toEqual({ widths: [100, 200], leftoverPx: 200 });
  });
});
