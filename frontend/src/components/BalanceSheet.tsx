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
    <div className="space-y-4">
      {userBalance && (
        <div>
          <h3 className="text-sm font-semibold text-gray-600 mb-2">Your Balance:</h3>
          <div
            className={`flex justify-between items-center p-5 rounded-lg border-2 ${
              userBalance.balance > 0
                ? 'bg-green-50 border-green-300'
                : userBalance.balance < 0
                ? 'bg-red-50 border-red-300'
                : 'bg-gray-50 border-gray-300'
            }`}
          >
            <span className="font-bold text-gray-800 text-lg">{userBalance.memberName} (You)</span>
            <div className="text-right">
              <div
                className={`text-2xl font-bold ${
                  userBalance.balance > 0
                    ? 'text-green-600'
                    : userBalance.balance < 0
                    ? 'text-red-600'
                    : 'text-gray-600'
                }`}
              >
                {userBalance.balance > 0 ? '+' : ''}₹{userBalance.balance.toFixed(2)}
              </div>
              <div className="text-sm text-gray-600 font-semibold">
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
          <h3 className="text-sm font-semibold text-gray-600 mb-2">Other Members:</h3>
          <div className="space-y-2">
            {otherBalances.map((balance) => (
              <div
                key={balance.memberId}
                className={`flex justify-between items-center p-4 rounded-lg ${
                  balance.balance > 0
                    ? 'bg-green-50 border border-green-200'
                    : balance.balance < 0
                    ? 'bg-red-50 border border-red-200'
                    : 'bg-gray-50 border border-gray-200'
                }`}
              >
                <span className="font-semibold text-gray-800">{balance.memberName}</span>
                <div className="text-right">
                  <div
                    className={`text-xl font-bold ${
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
