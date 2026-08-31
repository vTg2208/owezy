import { describe, expect, it } from 'vitest';
import { invitationFromLocation } from './Home';

describe('invitation link handling', () => {
  it('reads invitation secrets from the URL fragment and ignores query-string tokens', () => {
    expect(invitationFromLocation('?mode=accept', '#invite=private-token')).toBe('private-token');
    expect(invitationFromLocation('?invite=leaked-token', '')).toBe('');
  });
});
