import mongoose, { Schema, Document } from 'mongoose';

// User Model
export interface IUser extends Document {
  _id: string;
  email: string;
  password: string;
  name: string;
  created_at: Date;
}

const UserSchema = new Schema({
  _id: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});

export const User = mongoose.model<IUser>('User', UserSchema);

// Trip Model
export interface ITrip extends Document {
  _id: string;
  name: string;
  room_code: string;
  admin_id: string;
  user_id?: string;
  is_locked: boolean;
  created_at: Date;
  updated_at: Date;
}

const TripSchema = new Schema({
  _id: { type: String, required: true },
  name: { type: String, required: true },
  room_code: { type: String, required: true, unique: true },
  admin_id: { type: String, required: true },
  user_id: { type: String, ref: 'User' },
  is_locked: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

export const Trip = mongoose.model<ITrip>('Trip', TripSchema);

// Member Model
export interface IMember extends Document {
  _id: string;
  trip_id: string;
  name: string;
  user_id?: string;
  is_admin: boolean;
  created_at: Date;
}

const MemberSchema = new Schema({
  _id: { type: String, required: true },
  trip_id: { type: String, required: true, ref: 'Trip' },
  name: { type: String, required: true },
  user_id: { type: String, ref: 'User' },
  is_admin: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});

export const Member = mongoose.model<IMember>('Member', MemberSchema);

// Expense Model
export interface IExpenseSplit {
  member_id: string;
  amount: number;
}

export interface IExpense extends Document {
  _id: string;
  trip_id: string;
  paid_by: string;
  description: string;
  amount: number;
  split_type: string;
  splits: IExpenseSplit[];
  created_at: Date;
}

const ExpenseSchema = new Schema({
  _id: { type: String, required: true },
  trip_id: { type: String, required: true, ref: 'Trip' },
  paid_by: { type: String, required: true, ref: 'Member' },
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  split_type: { type: String, default: 'equal' },
  splits: [{
    member_id: { type: String, required: true },
    amount: { type: Number, required: true }
  }],
  created_at: { type: Date, default: Date.now }
});

export const Expense = mongoose.model<IExpense>('Expense', ExpenseSchema);

// ChatMessage Model
export interface IChatMessage extends Document {
  _id: string;
  trip_id: string;
  member_id: string;
  message: string;
  created_at: Date;
}

const ChatMessageSchema = new Schema({
  _id: { type: String, required: true },
  trip_id: { type: String, required: true, ref: 'Trip' },
  member_id: { type: String, required: true, ref: 'Member' },
  message: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});

export const ChatMessage = mongoose.model<IChatMessage>('ChatMessage', ChatMessageSchema);
