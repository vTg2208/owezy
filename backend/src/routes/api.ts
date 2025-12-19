import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../database';
import { generateRoomCode, generateId } from '../utils/helpers';
import { calculateBalances, calculateSettlements } from '../utils/balances';
import { Trip, Member, Expense, ExpenseSplit, ChatMessage } from '../types';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Create a new trip (requires authentication)
router.post('/trips', authenticateToken, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripName, adminName } = req.body;
    if (!tripName || !adminName) {
      res.status(400).json({ error: 'tripName and adminName are required' });
      return;
    }

    const tripId = generateId();
    const memberId = generateId();
    const roomCode = generateRoomCode();

    // Transaction: Create Trip + Add Admin
    const createTripTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO trips (id, name, room_code, admin_id, user_id) VALUES (?, ?, ?, ?, ?)
      `).run(tripId, tripName, roomCode, memberId, req.userId);

      db.prepare(`
        INSERT INTO members (id, trip_id, name, user_id, is_admin) VALUES (?, ?, ?, ?, 1)
      `).run(memberId, tripId, adminName, req.userId);
    });

    createTripTx();

    res.status(201).json({
      tripId,
      roomCode,
      member: { id: memberId, name: adminName, isAdmin: true }
    });
  } catch (error) {
    next(error);
  }
});

// Join a trip via room code (requires authentication)
router.post('/trips/join', authenticateToken, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { roomCode, memberName } = req.body;
    if (!roomCode || !memberName) {
      res.status(400).json({ error: 'roomCode and memberName are required' });
      return;
    }

    const trip = db.prepare('SELECT * FROM trips WHERE room_code = ?').get(roomCode) as Trip | undefined;
    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    if (trip.is_locked) {
      res.status(403).json({ error: 'Trip is locked' });
      return;
    }

    // Check for duplicate names
    const existingMember = db.prepare('SELECT * FROM members WHERE trip_id = ? AND LOWER(name) = LOWER(?)').get(trip.id, memberName) as Member | undefined;
    if (existingMember) {
      res.status(400).json({ error: 'A member with this name already exists in the trip' });
      return;
    }

    const memberId = generateId();
    db.prepare(`
      INSERT INTO members (id, trip_id, name, user_id, is_admin) VALUES (?, ?, ?, ?, 0)
    `).run(memberId, trip.id, memberName, req.userId);

    res.status(201).json({
      tripId: trip.id,
      tripName: trip.name,
      member: { id: memberId, name: memberName, isAdmin: false }
    });
  } catch (error) {
    next(error);
  }
});

// Get trip details (requires authentication)
router.get('/trips/:tripId', authenticateToken, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId } = req.params;

    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Trip | undefined;
    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    const members = db.prepare('SELECT * FROM members WHERE trip_id = ?').all(tripId) as Member[];
    const expenses = db.prepare(`
      SELECT e.*, m.name as paid_by_name 
      FROM expenses e 
      JOIN members m ON e.paid_by = m.id 
      WHERE e.trip_id = ?
      ORDER BY e.created_at DESC
    `).all(tripId) as (Expense & { paid_by_name: string })[];

    res.json({
      trip: {
        id: trip.id,
        name: trip.name,
        room_code: trip.room_code,
        admin_id: trip.admin_id,
        is_locked: trip.is_locked,
        created_at: trip.created_at
      },
      participants: members.map(m => ({
        id: m.id,
        trip_id: m.trip_id,
        name: m.name,
        is_admin: m.is_admin,
        created_at: m.created_at
      })),
      expenses: expenses.map(e => ({
        id: e.id,
        trip_id: e.trip_id,
        paid_by: e.paid_by,
        paid_by_name: e.paid_by_name,
        description: e.description,
        amount: e.amount,
        split_type: e.split_type,
        created_at: e.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

// Add an expense with flexible splitting (requires authentication)
router.post('/trips/:tripId/expenses', authenticateToken, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId } = req.params;
    const { paidBy, description, amount, splitType = 'equal', splits } = req.body;

    if (!paidBy || !description || !amount) {
      res.status(400).json({ error: 'paidBy, description, and amount are required' });
      return;
    }

    const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Trip | undefined;
    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    const members = db.prepare('SELECT * FROM members WHERE trip_id = ?').all(tripId) as Member[];
    const expenseId = generateId();

    // Calculate splits based on type
    let splitAmounts: { memberId: string; amount: number }[] = [];

    if (splitType === 'equal') {
      const splitAmount = Number((amount / members.length).toFixed(2));
      splitAmounts = members.map(m => ({ memberId: m.id, amount: splitAmount }));
    } else if (splitType === 'custom') {
      if (!splits || !Array.isArray(splits)) {
        res.status(400).json({ error: 'Custom splits required for custom split type' });
        return;
      }
      splitAmounts = splits.map((s: any) => ({
        memberId: s.participantId,
        amount: Number(s.amount)
      }));
    } else if (splitType === 'percentage') {
      if (!splits || !Array.isArray(splits)) {
        res.status(400).json({ error: 'Percentage splits required for percentage split type' });
        return;
      }
      splitAmounts = splits.map((s: any) => ({
        memberId: s.participantId,
        amount: Number(((s.amount / 100) * amount).toFixed(2))
      }));
    }

    // Transaction: Add Expense + Add Splits
    const addExpenseTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO expenses (id, trip_id, paid_by, description, amount, split_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(expenseId, tripId, paidBy, description, amount, splitType);

      const insertSplit = db.prepare(`
        INSERT INTO expense_splits (id, expense_id, member_id, amount) VALUES (?, ?, ?, ?)
      `);
      
      for (const split of splitAmounts) {
        insertSplit.run(generateId(), expenseId, split.memberId, split.amount);
      }
    });

    addExpenseTx();

    res.status(201).json({ expenseId, splitType, memberCount: members.length });
  } catch (error) {
    next(error);
  }
});

// Get balances for a trip (requires authentication)
router.get('/trips/:tripId/balances', authenticateToken, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId } = req.params;
    
    const members = db.prepare('SELECT * FROM members WHERE trip_id = ?').all(tripId) as Member[];
    const expenses = db.prepare('SELECT * FROM expenses WHERE trip_id = ?').all(tripId) as Expense[];
    const splits = db.prepare(`
      SELECT es.* FROM expense_splits es
      JOIN expenses e ON es.expense_id = e.id
      WHERE e.trip_id = ?
    `).all(tripId) as ExpenseSplit[];

    const balances = calculateBalances(members, expenses, splits);
    const settlements = calculateSettlements(balances);

    res.json({ balances, settlements });
  } catch (error) {
    next(error);
  }
});

// Lock a trip (requires authentication)
router.post('/trips/:tripId/lock', authenticateToken, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId } = req.params;
    
    db.prepare('UPDATE trips SET is_locked = 1 WHERE id = ?').run(tripId);
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Remove a member from a trip (requires authentication)
router.delete('/trips/:tripId/members/:memberId', authenticateToken, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId, memberId } = req.params;
    
    const member = db.prepare('SELECT * FROM members WHERE id = ? AND trip_id = ?').get(memberId, tripId) as Member | undefined;
    if (!member) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    if (member.is_admin) {
      res.status(403).json({ error: 'Cannot remove admin' });
      return;
    }
    
    db.prepare('DELETE FROM members WHERE id = ?').run(memberId);
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Send a chat message (requires authentication)
router.post('/trips/:tripId/messages', authenticateToken, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId } = req.params;
    const { memberId, message } = req.body;

    if (!memberId || !message) {
      res.status(400).json({ error: 'memberId and message are required' });
      return;
    }

    const messageId = generateId();
    db.prepare(`
      INSERT INTO chat_messages (id, trip_id, member_id, message)
      VALUES (?, ?, ?, ?)
    `).run(messageId, tripId, memberId, message);

    res.status(201).json({ messageId, success: true });
  } catch (error) {
    next(error);
  }
});

// Get chat messages for a trip (requires authentication)
router.get('/trips/:tripId/messages', authenticateToken, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId } = req.params;
    const { limit = 50 } = req.query;

    const messages = db.prepare(`
      SELECT cm.*, m.name as member_name
      FROM chat_messages cm
      JOIN members m ON cm.member_id = m.id
      WHERE cm.trip_id = ?
      ORDER BY cm.created_at DESC
      LIMIT ?
    `).all(tripId, Number(limit)) as (ChatMessage & { member_name: string })[];

    // Reverse to get chronological order
    res.json(messages.reverse());
  } catch (error) {
    next(error);
  }
});

export default router;
