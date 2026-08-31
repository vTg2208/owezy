import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './navigation';

describe('safeReturnTo', () => {
  it('allows only same-origin application paths', () => {
    expect(safeReturnTo({ returnTo: '/home#invite=token' })).toBe('/home#invite=token');
    expect(safeReturnTo({ returnTo: '//attacker.example/path' })).toBe('/dashboard');
    expect(safeReturnTo({ returnTo: 'https://attacker.example/path' })).toBe('/dashboard');
    expect(safeReturnTo(null)).toBe('/dashboard');
  });
});
