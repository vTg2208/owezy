export interface MoneyAllocation {
  memberId: string;
  amountMinor: bigint;
}

export const MAX_LEDGER_MINOR = 9_223_372_036_854_775_807n;

export function allocateEqual(totalMinor: bigint, memberIds: readonly string[]): MoneyAllocation[] {
  if (typeof totalMinor !== 'bigint' || totalMinor <= 0n) {
    throw new Error('totalMinor must be a positive bigint');
  }

  if (memberIds.length === 0) {
    throw new Error('memberIds must not be empty');
  }

  if (totalMinor < BigInt(memberIds.length)) {
    throw new Error('totalMinor must allow a positive amount for every member');
  }

  if (new Set(memberIds).size !== memberIds.length) {
    throw new Error('memberIds must not contain duplicates');
  }

  const memberCount = BigInt(memberIds.length);
  const amountPerMember = totalMinor / memberCount;
  const remainder = totalMinor % memberCount;

  return memberIds.map((memberId, index) => ({
    memberId,
    amountMinor: amountPerMember + (BigInt(index) < remainder ? 1n : 0n),
  }));
}

export function majorToMinor(major: string): bigint {
  if (typeof major !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(major)) {
    throw new Error('major must be a positive decimal string with at most two fraction digits');
  }

  const [whole, fraction = ''] = major.split('.');
  const minor = BigInt(`${whole}${fraction.padEnd(2, '0')}`);

  if (minor <= 0n) {
    throw new Error('major must be a positive decimal');
  }
  if (minor > MAX_LEDGER_MINOR) {
    throw new Error('major exceeds the PostgreSQL bigint ledger range');
  }

  return minor;
}

export function minorToMajor(minor: bigint): string {
  const sign = minor < 0n ? '-' : '';
  const absolute = minor < 0n ? -minor : minor;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
