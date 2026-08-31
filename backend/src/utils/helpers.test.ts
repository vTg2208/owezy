import { randomInt } from 'crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('crypto', async (importOriginal) => ({
  ...await importOriginal<typeof import('crypto')>(),
  randomInt: vi.fn()
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(1)
    .mockReturnValueOnce(2)
    .mockReturnValueOnce(3)
    .mockReturnValueOnce(4)
    .mockReturnValueOnce(5),
}));

describe('room-code generation', () => {
  it('derives every character from the cryptographic random source', async () => {
    const { generateRoomCode } = await import('./helpers');

    expect(generateRoomCode()).toBe('ABCDEF');
    expect(randomInt).toHaveBeenCalledTimes(6);
  });
});
