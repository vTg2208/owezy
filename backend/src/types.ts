export interface User {
  id: string;
  email: string;
  password: string;
  name: string;
  created_at: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
  };
  token: string;
}

export interface Trip {
  id: string;
  name: string;
  room_code: string;
  admin_id: string;
  user_id?: string;
  is_locked: number; // SQLite uses 0/1
  created_at: string;
}

export interface Member {
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
  description: string;
  amount: number;
  split_type: string;
  created_at: string;
}

export interface ExpenseSplit {
  id: string;
  expense_id: string;
  member_id: string;
  amount: number;
}

export interface ChatMessage {
  id: string;
  trip_id: string;
  member_id: string;
  message: string;
  created_at: string;
}
