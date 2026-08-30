export interface MoneyAllocation {
  memberId: string;
  amountMinor: number;
}

export function allocateEqual(totalMinor: number, memberIds: readonly string[]): MoneyAllocation[] {
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
    throw new Error('totalMinor must be a positive safe integer');
  }

  if (memberIds.length === 0) {
    throw new Error('memberIds must not be empty');
  }

  if (totalMinor < memberIds.length) {
    throw new Error('totalMinor must allow a positive amount for every member');
  }

  if (new Set(memberIds).size !== memberIds.length) {
    throw new Error('memberIds must not contain duplicates');
  }

  const amountPerMember = Math.floor(totalMinor / memberIds.length);
  const remainder = totalMinor % memberIds.length;

  return memberIds.map((memberId, index) => ({
    memberId,
    amountMinor: amountPerMember + (index < remainder ? 1 : 0),
  }));
}

export function majorToMinor(major: string): number {
  if (typeof major !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(major)) {
    throw new Error('major must be a positive decimal string with at most two fraction digits');
  }

  const [whole, fraction = ''] = major.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (!Number.isSafeInteger(minor) || minor <= 0) {
    throw new Error('major must be a positive decimal within the safe integer range');
  }

  return minor;
}
