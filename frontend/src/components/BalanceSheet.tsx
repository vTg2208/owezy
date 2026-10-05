import { Balance } from '../types';
import { moneyDecimal, moneySign } from '../utils/money';

interface BalanceSheetProps {
  balances: Balance[];
  currentUserId: string;
}

export default function BalanceSheet({ balances, currentUserId }: BalanceSheetProps) {
  if (balances.length === 0) {
    return (
      <div className="empty-state text-muted">
        No balance data available.
      </div>
    );
  }

  // Find current user's balance and move to top
  const userBalance = balances.find(b => b.memberId === currentUserId);
  const otherBalances = balances.filter(b => b.memberId !== currentUserId);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {userBalance && (
        <div>
          <p className="eyebrow mb-2">Your balance</p>
          <div className="balance-highlight">
            <span className="text-base font-bold sm:text-lg">{userBalance.memberName} (You)</span>
            <div className="text-left sm:text-right">
              <div
                className={`text-xl sm:text-2xl font-bold ${
                  moneySign(userBalance.balance) > 0
                    ? 'balance-positive'
                    : moneySign(userBalance.balance) < 0
                    ? 'text-red-600'
                    : 'text-muted'
                }`}
              >
                {moneySign(userBalance.balance) > 0 ? '+' : ''}₹{moneyDecimal(userBalance.balance)}
              </div>
              <div className="text-muted text-xs font-semibold sm:text-sm">
                {moneySign(userBalance.balance) > 0
                  ? 'You will get back'
                  : moneySign(userBalance.balance) < 0
                  ? 'You owe'
                  : 'You are settled'}
              </div>
            </div>
          </div>
        </div>
      )}

      {otherBalances.length > 0 && (
        <div>
          <h3 className="mb-2 text-xl">Everyone else</h3>
          <div className="ledger-list">
            {otherBalances.map((balance) => (
              <div key={balance.memberId} className="ledger-row">
                <span className="text-sm font-semibold sm:text-base">{balance.memberName}</span>
                <div className="text-right">
                  <div
                    className={`text-base sm:text-xl font-bold ${
                      moneySign(balance.balance) > 0
                        ? 'balance-positive'
                        : moneySign(balance.balance) < 0
                        ? 'text-red-600'
                        : 'text-muted'
                    }`}
                  >
                    {moneySign(balance.balance) > 0 ? '+' : ''}₹{moneyDecimal(balance.balance)}
                  </div>
                  <div className="text-muted text-xs">
                    {moneySign(balance.balance) > 0
                      ? 'Gets back'
                      : moneySign(balance.balance) < 0
                      ? 'Owes'
                      : 'Settled'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
