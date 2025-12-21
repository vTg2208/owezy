import { Router, Request, Response, NextFunction } from 'express';
import { generateRoomCode, generateId } from '../utils/helpers';
import { calculateBalances, calculateSettlements } from '../utils/balances';
import { Trip, Member, Expense, ChatMessage } from '../models';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Create a new trip (requires authentication)
router.post('/trips', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripName, adminName } = req.body;
    if (!tripName || !adminName) {
      res.status(400).json({ error: 'tripName and adminName are required' });
      return;
    }

    const tripId = generateId();
    const memberId = generateId();
    const roomCode = generateRoomCode();

    // Create Trip
    await Trip.create({
      _id: tripId,
      name: tripName,
      room_code: roomCode,
      admin_id: memberId,
      user_id: req.userId,
      is_locked: false
    });

    // Create Admin Member
    await Member.create({
      _id: memberId,
      trip_id: tripId,
      name: adminName,
      user_id: req.userId,
      is_admin: true
    });

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
router.post('/trips/join', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { roomCode, memberName } = req.body;
    if (!roomCode || !memberName) {
      res.status(400).json({ error: 'roomCode and memberName are required' });
      return;
    }

    const trip = await Trip.findOne({ room_code: roomCode });
    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    if (trip.is_locked) {
      res.status(403).json({ error: 'Trip is locked' });
      return;
    }

    // Check if user is already a member
    const existingUserMember = await Member.findOne({ trip_id: trip._id, user_id: req.userId });
    if (existingUserMember) {
      res.status(200).json({
        tripId: trip._id,
        tripName: trip.name,
        member: { id: existingUserMember._id, name: existingUserMember.name, isAdmin: existingUserMember.is_admin }
      });
      return;
    }

    // Check for duplicate names
    // Case insensitive check using regex
    const existingMember = await Member.findOne({ 
      trip_id: trip._id, 
      name: { $regex: new RegExp(`^${memberName}$`, 'i') } 
    });
    
    if (existingMember) {
      res.status(400).json({ error: 'A member with this name already exists in the trip' });
      return;
    }

    const memberId = generateId();
    await Member.create({
      _id: memberId,
      trip_id: trip._id,
      name: memberName,
      user_id: req.userId,
      is_admin: false
    });

    res.status(201).json({
      tripId: trip._id,
      tripName: trip.name,
      member: { id: memberId, name: memberName, isAdmin: false }
    });
  } catch (error) {
    next(error);
  }
});

// Get trip details (requires authentication)
router.get('/trips/:tripId', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId } = req.params;

    const trip = await Trip.findById(tripId);
    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    const members = await Member.find({ trip_id: tripId });
    const expenses = await Expense.find({ trip_id: tripId }).sort({ created_at: -1 });

    // Populate paid_by_name manually or use populate() if I set up refs correctly.
    // Since I have members list, I can map it.
    const memberMap = new Map(members.map(m => [m._id, m.name]));

    const expensesWithNames = expenses.map(e => ({
      id: e._id,
      trip_id: e.trip_id,
      paid_by: e.paid_by,
      paid_by_name: memberMap.get(e.paid_by) || 'Unknown',
      description: e.description,
      amount: e.amount,
      split_type: e.split_type,
      receipt_url: e.receipt_url,
      created_at: e.created_at
    }));

    res.json({
      trip: {
        id: trip._id,
        name: trip.name,
        room_code: trip.room_code,
        admin_id: trip.admin_id,
        is_locked: trip.is_locked ? 1 : 0, // Convert to number for frontend
        created_at: trip.created_at
      },
      participants: members.map(m => ({
        id: m._id,
        trip_id: m.trip_id,
        name: m.name,
        is_admin: m.is_admin ? 1 : 0, // Convert to number
        created_at: m.created_at
      })),
      expenses: expensesWithNames
    });
  } catch (error) {
    next(error);
  }
});

// Add an expense with flexible splitting (requires authentication)
router.post('/trips/:tripId/expenses', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId } = req.params;
    const { paidBy, description, amount, splitType = 'equal', splits, receiptUrl } = req.body;

    if (!paidBy || !description || !amount) {
      res.status(400).json({ error: 'paidBy, description, and amount are required' });
      return;
    }

    const trip = await Trip.findById(tripId);
    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    const members = await Member.find({ trip_id: tripId });
    const expenseId = generateId();

    // Calculate splits based on type
    let splitAmounts: { member_id: string; amount: number }[] = [];

    if (splitType === 'equal') {
      const splitAmount = Number((amount / members.length).toFixed(2));
      splitAmounts = members.map(m => ({ member_id: m._id, amount: splitAmount }));
    } else if (splitType === 'custom') {
      if (!splits || !Array.isArray(splits)) {
        res.status(400).json({ error: 'Custom splits required for custom split type' });
        return;
      }
      splitAmounts = splits.map((s: any) => ({
        member_id: s.participantId,
        amount: Number(s.amount)
      }));
    } else if (splitType === 'percentage') {
      if (!splits || !Array.isArray(splits)) {
        res.status(400).json({ error: 'Percentage splits required for percentage split type' });
        return;
      }
      splitAmounts = splits.map((s: any) => ({
        member_id: s.participantId,
        amount: Number(((s.amount / 100) * amount).toFixed(2))
      }));
    }

    await Expense.create({
      _id: expenseId,
      trip_id: tripId,
      paid_by: paidBy,
      description,
      amount,
      split_type: splitType,
      splits: splitAmounts,
      receipt_url: receiptUrl
    });

    res.status(201).json({ expenseId, splitType, memberCount: members.length });
  } catch (error) {
    next(error);
  }
});

// Get balances for a trip (requires authentication)
router.get('/trips/:tripId/balances', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId } = req.params;
    
    const members = await Member.find({ trip_id: tripId });
    const expenses = await Expense.find({ trip_id: tripId });
    
    const balances = calculateBalances(members, expenses);
    const settlements = calculateSettlements(balances);

    res.json({ balances, settlements });
  } catch (error) {
    next(error);
  }
});

// Lock a trip (requires authentication)
router.post('/trips/:tripId/lock', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId } = req.params;
    
    await Trip.findByIdAndUpdate(tripId, { is_locked: true });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Unlock a trip (requires authentication)
router.post('/trips/:tripId/unlock', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId } = req.params;
    
    await Trip.findByIdAndUpdate(tripId, { is_locked: false });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Remove a member from a trip (requires authentication)
router.delete('/trips/:tripId/members/:memberId', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId, memberId } = req.params;
    
    const member = await Member.findOne({ _id: memberId, trip_id: tripId });
    if (!member) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    // Get the requester's member record for this trip
    const requester = await Member.findOne({ trip_id: tripId, user_id: req.userId });
    
    if (!requester) {
      res.status(403).json({ error: 'You are not a member of this trip' });
      return;
    }

    const isSelf = requester._id === memberId;
    const isAdmin = requester.is_admin;

    // Only allow if removing self or if admin is removing someone else
    if (!isSelf && !isAdmin) {
      res.status(403).json({ error: 'Only admin can remove other members' });
      return;
    }

    // Check for associated expenses or messages
    // In MongoDB we don't have FK constraints, so we must check manually.
    const hasExpenses = await Expense.exists({ trip_id: tripId, paid_by: memberId });
    const hasMessages = await ChatMessage.exists({ trip_id: tripId, member_id: memberId });

    if (hasExpenses || hasMessages) {
      res.status(400).json({ error: 'Cannot remove member with associated expenses or messages.' });
      return;
    }
    
    await Member.deleteOne({ _id: memberId });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Send a chat message (requires authentication)
router.post('/trips/:tripId/messages', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId } = req.params;
    const { memberId, message } = req.body;

    if (!memberId || !message) {
      res.status(400).json({ error: 'memberId and message are required' });
      return;
    }

    const messageId = generateId();
    await ChatMessage.create({
      _id: messageId,
      trip_id: tripId,
      member_id: memberId,
      message
    });

    res.status(201).json({ messageId, success: true });
  } catch (error) {
    next(error);
  }
});

// Get chat messages for a trip (requires authentication)
router.get('/trips/:tripId/messages', authenticateToken, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tripId } = req.params;
    const { limit = 50 } = req.query;

    const messages = await ChatMessage.find({ trip_id: tripId })
      .sort({ created_at: -1 })
      .limit(Number(limit));

    // Populate member names
    const memberIds = [...new Set(messages.map(m => m.member_id))];
    const members = await Member.find({ _id: { $in: memberIds } });
    const memberMap = new Map(members.map(m => [m._id, m.name]));

    const messagesWithNames = messages.map(m => ({
      id: m._id,
      trip_id: m.trip_id,
      member_id: m.member_id,
      message: m.message,
      created_at: m.created_at,
      member_name: memberMap.get(m.member_id) || 'Unknown'
    }));

    res.json({ messages: messagesWithNames });
  } catch (error) {
    next(error);
  }
});

export default router;
