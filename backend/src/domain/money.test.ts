import { describe, expect, it } from 'vitest';
import { allocateEqual, majorToMinor } from './money';

describe('allocateEqual', () => {
  it('allocates a remainder deterministically in input order', () => {
    expect(allocateEqual(10_000n, ['member-a', 'member-b', 'member-c'])).toEqual([
      { memberId: 'member-a', amountMinor: 3_334n },
      { memberId: 'member-b', amountMinor: 3_333n },
      { memberId: 'member-c', amountMinor: 3_333n },
    ]);
  });

  it('preserves a remainder above Number.MAX_SAFE_INTEGER exactly', () => {
    expect(allocateEqual(9_007_199_254_740_995n, ['member-a', 'member-b'])).toEqual([
      { memberId: 'member-a', amountMinor: 4_503_599_627_370_498n },
      { memberId: 'member-b', amountMinor: 4_503_599_627_370_497n },
    ]);
  });

  it.each([
    [0n, ['member-a']],
    [-1n, ['member-a']],
  ])('rejects a nonpositive total of %s', (totalMinor, memberIds) => {
    expect(() => allocateEqual(totalMinor, memberIds)).toThrow();
  });

  it('rejects an empty member list', () => {
    expect(() => allocateEqual(100n, [])).toThrow();
  });

  it('rejects duplicate members', () => {
    expect(() => allocateEqual(100n, ['member-a', 'member-a'])).toThrow();
  });

  it('rejects totals that cannot give every member a positive split', () => {
    expect(() => allocateEqual(1n, ['member-a', 'member-b'])).toThrow();
  });
});

describe('majorToMinor', () => {
  it('rejects values that cannot fit the PostgreSQL bigint ledger', () => {
    expect(() => majorToMinor('92233720368547758.08')).toThrow(/ledger range/i);
  });
  it.each([
    ['1', 100n],
    ['0.1', 10n],
    ['12.3', 1_230n],
    ['12.34', 1_234n],
    ['90071992547409.93', 9_007_199_254_740_993n],
  ])('converts the exact decimal %s to minor units', (major, expected) => {
    expect(majorToMinor(major)).toBe(expected);
  });

  it.each(['0', '0.00', '-1', '1.234', '1e2'])
    ('rejects an invalid decimal %s', (major) => {
      expect(() => majorToMinor(major)).toThrow();
    });

  it('rejects number inputs because their binary representation can lose decimal precision', () => {
    expect(() => majorToMinor(0.1 as unknown as string)).toThrow();
  });
});
