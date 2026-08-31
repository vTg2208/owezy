export type SplitMode = 'equal' | 'custom' | 'percentage';
export interface SplitEntry { participantId: string; amount: string }

function parseHundredths(value: string, label: string): bigint {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error(`${label} must have at most two decimal places`);
  }
  const [whole, fraction = ''] = value.split('.');
  const parsed = BigInt(`${whole}${fraction.padEnd(2, '0')}`);
  if (parsed <= 0n) throw new Error(`${label} must be greater than zero`);
  return parsed;
}

function formatHundredths(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

function uniqueMembers(memberIds: readonly string[]) {
  if (memberIds.length === 0) throw new Error('Select at least one participant');
  if (new Set(memberIds).size !== memberIds.length || memberIds.some((id) => !id)) {
    throw new Error('Participants must be unique');
  }
}

export function buildEqualSplits(totalText: string, memberIds: readonly string[]): SplitEntry[] {
  uniqueMembers(memberIds);
  const total = parseHundredths(totalText, 'Amount');
  if (total < BigInt(memberIds.length)) throw new Error('Amount is too small for every participant');
  const count = BigInt(memberIds.length);
  const base = total / count;
  const remainder = total % count;
  return memberIds.map((participantId, index) => ({
    participantId,
    amount: formatHundredths(base + (BigInt(index) < remainder ? 1n : 0n)),
  }));
}

export function buildPercentageSplits(memberIds: readonly string[]): SplitEntry[] {
  uniqueMembers(memberIds);
  const count = BigInt(memberIds.length);
  const base = 10_000n / count;
  const remainder = 10_000n % count;
  return memberIds.map((participantId, index) => ({
    participantId,
    amount: formatHundredths(base + (BigInt(index) < remainder ? 1n : 0n)),
  }));
}

export function reconcileSplitEntries(
  entries: readonly SplitEntry[],
  memberIds: readonly string[],
): SplitEntry[] {
  const current = new Map(entries.map((entry) => [entry.participantId, entry.amount]));
  return memberIds.map((participantId) => ({ participantId, amount: current.get(participantId) ?? '' }));
}

export function buildSplits(
  totalText: string,
  memberIds: readonly string[],
  mode: SplitMode,
  entries: readonly SplitEntry[] = [],
): SplitEntry[] {
  if (mode === 'equal') return buildEqualSplits(totalText, memberIds);
  uniqueMembers(memberIds);
  const reconciled = reconcileSplitEntries(entries, memberIds);
  if (reconciled.some((entry) => !entry.amount)) throw new Error('Enter every split value');
  const values = reconciled.map((entry) => parseHundredths(entry.amount, mode === 'custom' ? 'Split' : 'Percentage'));
  const expected = mode === 'custom' ? parseHundredths(totalText, 'Amount') : 10_000n;
  if (values.reduce((sum, value) => sum + value, 0n) !== expected) {
    throw new Error(mode === 'custom' ? 'Custom splits must equal the expense total' : 'Percentages must equal 100.00');
  }
  return reconciled.map((entry, index) => ({
    participantId: entry.participantId,
    amount: formatHundredths(values[index]),
  }));
}
