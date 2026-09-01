import { Balance } from '../types';

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
                  userBalance.balance > 0
                    ? 'balance-positive'
                    : userBalance.balance < 0
                    ? 'text-red-600'
                    : 'text-muted'
                }`}
              >
                {userBalance.balance > 0 ? '+' : ''}₹{userBalance.balance.toFixed(2)}
              </div>
              <div className="text-muted text-xs font-semibold sm:text-sm">
                {userBalance.balance > 0
                  ? 'You will get back'
                  : userBalance.balance < 0
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
                      balance.balance > 0
                        ? 'balance-positive'
                        : balance.balance < 0
                        ? 'text-red-600'
                        : 'text-muted'
                    }`}
                  >
                    {balance.balance > 0 ? '+' : ''}₹{balance.balance.toFixed(2)}
                  </div>
                  <div className="text-muted text-xs">
                    {balance.balance > 0
                      ? 'Gets back'
                      : balance.balance < 0
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
