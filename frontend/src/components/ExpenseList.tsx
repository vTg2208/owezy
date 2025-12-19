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
    <div className="space-y-4">
      {expenses.map((expense) => (
        <div key={expense.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h3 className="font-semibold text-lg text-gray-800">{expense.description}</h3>
              <p className="text-sm text-gray-600">
                Paid by <span className="font-medium">{expense.paid_by_name}</span>
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-indigo-600">₹{expense.amount.toFixed(2)}</div>
              <div className="text-xs text-gray-500 capitalize">{expense.split_type} split</div>
            </div>
          </div>
          
          <div className="mt-2 text-xs text-gray-400">
            {new Date(expense.created_at).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}
