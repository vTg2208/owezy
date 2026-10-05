import { describe, expect, it } from 'vitest';
import { moneyDecimal, moneySign } from './money';

describe('exact response money', () => {
  it('preserves large positive and negative decimal strings without a Number conversion', () => {
    expect(moneyDecimal('92233720368547758.07')).toBe('92233720368547758.07');
    expect(moneySign('92233720368547758.07')).toBe(1);
    expect(moneyDecimal('-180143985094819.82')).toBe('-180143985094819.82');
    expect(moneySign('-180143985094819.82')).toBe(-1);
  });

  it('formats safe numeric responses to cents', () => {
    expect(moneyDecimal(12.3)).toBe('12.30');
    expect(moneySign(0)).toBe(0);
  });
});
