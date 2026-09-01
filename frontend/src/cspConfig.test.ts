import { describe, expect, it } from 'vitest';
import vercelConfig from '../vercel.json';

function contentSecurityPolicy(): string {
  const policy = vercelConfig.headers
    .flatMap(({ headers }) => headers)
    .find(({ key }) => key === 'Content-Security-Policy');

  if (!policy) throw new Error('Content-Security-Policy header is missing');
  return policy.value;
}

function directive(name: string): string[] {
  const policyDirective = contentSecurityPolicy()
    .split(';')
    .map((value) => value.trim().split(/\s+/))
    .find(([directiveName]) => directiveName === name);

  return policyDirective?.slice(1) ?? [];
}

describe('production Content Security Policy', () => {
  it('allows the Firebase Google Auth helper without weakening general script execution', () => {
    expect(directive('script-src')).toEqual(["'self'"]);
    expect(directive('script-src-elem')).toEqual([
      "'self'",
      'https://apis.google.com',
    ]);
  });
});
