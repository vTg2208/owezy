import { Expense } from '../types';

interface ExpenseListProps {
  expenses: Expense[];
}

export default function ExpenseList({ expenses }: ExpenseListProps) {
  if (expenses.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No expenses yet. Add your first expense above!
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {expenses.map((expense) => (
        <div key={expense.id} className="border border-gray-200 rounded-lg p-3 sm:p-4 hover:shadow-md transition">
          <div className="flex justify-between items-start mb-2 gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base sm:text-lg text-gray-800 truncate">{expense.description}</h3>
              <p className="text-xs sm:text-sm text-gray-600">
                Paid by <span className="font-medium">{expense.paid_by_name}</span>
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-lg sm:text-2xl font-bold text-indigo-600">₹{expense.amount.toFixed(2)}</div>
              <div className="text-xs text-gray-500 capitalize">{expense.split_type} split</div>
            </div>
          </div>

          {expense.receipt_url && (
            <div className="mt-2">
              <a 
                href={expense.receipt_url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs sm:text-sm text-indigo-600 hover:text-indigo-800 underline flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                View Receipt
              </a>
            </div>
          )}
          
          <div className="mt-2 text-xs text-gray-400">
            {new Date(expense.created_at).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}
