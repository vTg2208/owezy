import { describe, expect, it } from 'vitest';
import { allocateEqual, majorToMinor } from './money';

describe('allocateEqual', () => {
  it('allocates a remainder deterministically in input order', () => {
    expect(allocateEqual(10_000, ['member-a', 'member-b', 'member-c'])).toEqual([
      { memberId: 'member-a', amountMinor: 3_334 },
      { memberId: 'member-b', amountMinor: 3_333 },
      { memberId: 'member-c', amountMinor: 3_333 },
    ]);
  });

  it.each([
    [0, ['member-a']],
    [-1, ['member-a']],
  ])('rejects a nonpositive total of %i', (totalMinor, memberIds) => {
    expect(() => allocateEqual(totalMinor, memberIds)).toThrow();
  });

  it('rejects an empty member list', () => {
    expect(() => allocateEqual(100, [])).toThrow();
  });

  it('rejects duplicate members', () => {
    expect(() => allocateEqual(100, ['member-a', 'member-a'])).toThrow();
  });
});

describe('majorToMinor', () => {
  it.each([
    ['1', 100],
    ['0.1', 10],
    ['12.3', 1_230],
    ['12.34', 1_234],
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
