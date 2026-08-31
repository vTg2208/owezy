import { describe, expect, it } from 'vitest';
import { buildEqualSplits, buildPercentageSplits, buildSplits, reconcileSplitEntries } from './splitBuilder';

describe('exact split builders', () => {
  it('allocates currency remainders deterministically', () => {
    expect(buildEqualSplits('10.00', ['a', 'b', 'c'])).toEqual([
      { participantId: 'a', amount: '3.34' },
      { participantId: 'b', amount: '3.33' },
      { participantId: 'c', amount: '3.33' },
    ]);
    expect(buildPercentageSplits(['a', 'b', 'c'])).toEqual([
      { participantId: 'a', amount: '33.34' },
      { participantId: 'b', amount: '33.33' },
      { participantId: 'c', amount: '33.33' },
    ]);
  });

  it('removes stale entries and rejects an inexact custom total', () => {
    expect(reconcileSplitEntries([
      { participantId: 'a', amount: '4.00' },
      { participantId: 'stale', amount: '6.00' },
    ], ['a', 'b'])).toEqual([
      { participantId: 'a', amount: '4.00' },
      { participantId: 'b', amount: '' },
    ]);
    expect(() => buildSplits('10.00', ['a', 'b'], 'custom', [
      { participantId: 'a', amount: '4.00' },
      { participantId: 'b', amount: '5.99' },
    ])).toThrow(/equal/i);
  });
});
