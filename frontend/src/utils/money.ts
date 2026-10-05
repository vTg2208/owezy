// API responses use numbers while cents are safe in JavaScript, then exact strings.
export type MoneyAmount = number | string;

export function moneyDecimal(amount: MoneyAmount): string {
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * 100))) {
      throw new Error('Invalid money amount');
    }
    const minor = BigInt(Math.round(amount * 100));
    const absolute = minor < 0n ? -minor : minor;
    return `${minor < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
  }
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error('Invalid money amount');
  const negative = amount.startsWith('-');
  const [whole, fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  return `${negative ? '-' : ''}${whole}.${fraction.padEnd(2, '0')}`;
}

export function moneySign(amount: MoneyAmount): -1 | 0 | 1 {
  const minor = BigInt(moneyDecimal(amount).replace('.', ''));
  return minor < 0n ? -1 : minor > 0n ? 1 : 0;
}
