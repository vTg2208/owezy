import { IMember, IExpense } from '../models';

export interface Balance {
  memberId: string;
  memberName: string;
  balance: number; // positive = owed, negative = owes
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
  fromName: string;
  toName: string;
}

export function calculateBalances(
  members: IMember[],
  expenses: IExpense[]
): Balance[] {
  const balanceMap = new Map<string, number>();
  
  // Initialize all members with 0 balance
  members.forEach(member => {
    balanceMap.set(member._id, 0);
  });

  // Add amounts paid by each member
  expenses.forEach(expense => {
    const current = balanceMap.get(expense.paid_by) || 0;
    balanceMap.set(expense.paid_by, current + expense.amount);
  });

  // Subtract amounts owed by each member
  expenses.forEach(expense => {
    expense.splits.forEach(split => {
      const current = balanceMap.get(split.member_id) || 0;
      balanceMap.set(split.member_id, current - split.amount);
    });
  });

  // Convert to Balance array
  return members.map(member => ({
    memberId: member._id,
    memberName: member.name,
    balance: Number((balanceMap.get(member._id) || 0).toFixed(2))
  }));
}

export function calculateSettlements(balances: Balance[]): Settlement[] {
  const settlements: Settlement[] = [];
  
  // Separate creditors (positive balance) and debtors (negative balance)
  const creditors = balances.filter(b => b.balance > 0.01).map(b => ({ ...b }));
  const debtors = balances.filter(b => b.balance < -0.01).map(b => ({ ...b }));

  // Sort for optimal matching
  creditors.sort((a, b) => b.balance - a.balance);
  debtors.sort((a, b) => a.balance - b.balance);

  let i = 0, j = 0;

  while (i < creditors.length && j < debtors.length) {
    const creditor = creditors[i];
    const debtor = debtors[j];
    
    const amount = Math.min(creditor.balance, -debtor.balance);

    if (amount > 0.01) {
      settlements.push({
        from: debtor.memberId,
        to: creditor.memberId,
        amount: Number(amount.toFixed(2)),
        fromName: debtor.memberName,
        toName: creditor.memberName
      });

      creditor.balance -= amount;
      debtor.balance += amount;
    }

    if (Math.abs(creditor.balance) < 0.01) i++;
    if (Math.abs(debtor.balance) < 0.01) j++;
  }

  return settlements;
}
