export interface Trip {
  id: string;
  name: string;
  room_code: string;
  admin_id: string;
  is_locked: number;
  created_at: string;
  member_id?: string; // Added for user's member ID in this trip
  currency?: string;
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
  receipt_url?: string;
  created_at: string;
  splits?: ExpenseSplit[];
  expense_key?: string;
  version?: number;
  status?: 'active' | 'voided';
  currency?: string;
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

export interface Payment {
  id: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled';
  payer_membership_id?: string;
  payee_membership_id?: string;
  amount?: string;
  currency?: string;
  note?: string;
}

export interface AuditEvent {
  id: string;
  actor_membership_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TripSnapshot {
  trip: Trip;
  participants: Participant[];
  expenses: Expense[];
  expense_next_cursor?: string;
  current_member_id: string;
  balances: Balance[];
  settlements: Settlement[];
}
