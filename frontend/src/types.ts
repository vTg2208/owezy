export interface Trip {
  id: string;
  name: string;
  room_code: string;
  admin_id: string;
  is_locked: number;
  created_at: string;
}

export interface Participant {
  id: string;
  trip_id: string;
  name: string;
  user_id?: string;
  is_admin: number;
  created_at: string;
}

export interface Expense {
  id: string;
  trip_id: string;
  paid_by: string;
  paid_by_name: string;
  amount: number;
  description: string;
  split_type: 'equal' | 'custom' | 'percentage';
  created_at: string;
  splits?: ExpenseSplit[];
}

export interface ExpenseSplit {
  id: string;
  expense_id: string;
  member_id: string;
  amount: number;
}

export interface Balance {
  memberId: string;
  memberName: string;
  balance: number;
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
  fromName: string;
  toName: string;
}

export interface CustomSplit {
  participant_id: number;
  share_amount: number;
}

export interface PercentageSplit {
  participant_id: number;
  percentage: number;
}

export interface ChatMessage {
  id: string;
  trip_id: string;
  member_id: string;
  member_name: string;
  message: string;
  created_at: string;
}
