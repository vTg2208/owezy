export interface ReturnLocationState {
  returnTo?: unknown;
}

export function safeReturnTo(state: unknown): string {
  const returnTo = state && typeof state === 'object'
    ? (state as ReturnLocationState).returnTo
    : undefined;
  return typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
    ? returnTo
    : '/dashboard';
}
