import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { User, Trip, Member } from '../models';
import { AuthResponse } from '../types';
import { JWT_SECRET, authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Register new user
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userId = nanoid();
    const newUser = await User.create({
      _id: userId,
      email: email.toLowerCase(),
      password: hashedPassword,
      name
    });

    // Generate token
    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });

    const response: AuthResponse = {
      user: {
        id: userId,
        email: email.toLowerCase(),
        name
      },
      token
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('[AUTH] Registration error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });

    const response: AuthResponse = {
      user: {
        id: user._id,
        email: user.email,
        name: user.name
      },
      token
    };

    res.json(response);
  } catch (error) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Get current user (verify token)
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.userId).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('[AUTH] Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Get user's trips
router.get('/my-trips', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Find all memberships for this user
    const memberships = await Member.find({ user_id: req.userId });
    const tripIds = memberships.map(m => m.trip_id);

    // Find all trips associated with these memberships
    const trips = await Trip.find({ _id: { $in: tripIds } }).sort({ created_at: -1 });

    // Map trips to include the member_id for the current user
    const tripsWithMemberId = trips.map(trip => {
      const membership = memberships.find(m => m.trip_id === trip._id);
      return {
        id: trip._id,
        name: trip.name,
        room_code: trip.room_code,
        admin_id: trip.admin_id,
        is_locked: trip.is_locked ? 1 : 0, // Convert boolean to number for frontend compatibility
        created_at: trip.created_at,
        member_id: membership ? membership._id : null
      };
    });

    res.json({ trips: tripsWithMemberId });
  } catch (error) {
    console.error('[AUTH] Get trips error:', error);
    res.status(500).json({ error: 'Failed to get trips' });
  }
});

export default router;
