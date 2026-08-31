import { Balance } from '../types';

interface BalanceSheetProps {
  balances: Balance[];
  currentUserId: string;
}

export default function BalanceSheet({ balances, currentUserId }: BalanceSheetProps) {
  if (balances.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
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
          <div className="flex flex-col justify-between gap-2 border-y border-gray-300 px-1 py-5 sm:flex-row sm:items-center">
            <span className="font-bold text-gray-800 text-base sm:text-lg">{userBalance.memberName} (You)</span>
            <div className="text-left sm:text-right">
              <div
                className={`text-xl sm:text-2xl font-bold ${
                  userBalance.balance > 0
                    ? 'text-green-600'
                    : userBalance.balance < 0
                    ? 'text-red-600'
                    : 'text-gray-600'
                }`}
              >
                {userBalance.balance > 0 ? '+' : ''}₹{userBalance.balance.toFixed(2)}
              </div>
              <div className="text-xs sm:text-sm text-gray-600 font-semibold">
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
          <div className="border-t border-gray-300">
            {otherBalances.map((balance) => (
              <div key={balance.memberId} className="flex items-center justify-between border-b border-gray-300 px-1 py-4">
                <span className="font-semibold text-gray-800 text-sm sm:text-base">{balance.memberName}</span>
                <div className="text-right">
                  <div
                    className={`text-base sm:text-xl font-bold ${
                      balance.balance > 0
                        ? 'text-green-600'
                        : balance.balance < 0
                        ? 'text-red-600'
                        : 'text-gray-600'
                    }`}
                  >
                    {balance.balance > 0 ? '+' : ''}₹{balance.balance.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-600">
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
