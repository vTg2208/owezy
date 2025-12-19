import { Settlement } from '../types';

interface SettlementPlanProps {
  settlement: Settlement[];
  currentUserId: string;
}

export default function SettlementPlan({ settlement, currentUserId }: SettlementPlanProps) {
  // Filter settlements to show only those involving the current user
  const userSettlements = settlement.filter(
    txn => txn.from === currentUserId || txn.to === currentUserId
  );

  if (userSettlements.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-6xl mb-4 text-green-600">✓</div>
        <div className="text-xl font-semibold text-green-600">You're all settled!</div>
        <div className="text-gray-600 mt-2">No pending transactions for you.</div>
      </div>
    );
  }

  // Separate into what user owes and what user receives
  const userOwes = userSettlements.filter(txn => txn.from === currentUserId);
  const userReceives = userSettlements.filter(txn => txn.to === currentUserId);

  return (
    <div className="space-y-6">
      {userOwes.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-red-600 mb-3">You Need to Pay:</h3>
          <div className="space-y-3">
            {userOwes.map((txn, index) => (
              <div
                key={index}
                className="flex items-center gap-4 p-4 bg-gradient-to-r from-red-50 to-orange-50 rounded-lg border border-red-200"
              >
                <div className="flex-1">
                  <div className="font-semibold text-gray-800">You pay</div>
                </div>
                
                <div className="text-center px-4 py-2 bg-white rounded-lg shadow">
                  <div className="text-2xl font-bold text-red-600">₹{txn.amount.toFixed(2)}</div>
                </div>
                
                <div className="flex-1 text-right">
                  <div className="text-sm text-gray-600">to</div>
                  <div className="font-semibold text-gray-800">{txn.toName}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {userReceives.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-green-600 mb-3">You Will Receive:</h3>
          <div className="space-y-3">
            {userReceives.map((txn, index) => (
              <div
                key={index}
                className="flex items-center gap-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200"
              >
                <div className="flex-1">
                  <div className="font-semibold text-gray-800">{txn.fromName}</div>
                  <div className="text-sm text-gray-600">pays you</div>
                </div>
                
                <div className="text-center px-4 py-2 bg-white rounded-lg shadow">
                  <div className="text-2xl font-bold text-green-600">₹{txn.amount.toFixed(2)}</div>
                </div>
                
                <div className="flex-1 text-right">
                  <div className="text-sm text-gray-600">receive</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="text-sm text-blue-800">
          <strong>Tip:</strong> Complete these transactions to settle all trip expenses efficiently!
        </div>
      </div>
    </div>
  );
}
