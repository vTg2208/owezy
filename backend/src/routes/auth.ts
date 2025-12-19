import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { db } from '../database';
import { User, AuthResponse } from '../types';
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
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as User | undefined;
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userId = nanoid();
    db.prepare(`
      INSERT INTO users (id, email, password, name)
      VALUES (?, ?, ?, ?)
    `).run(userId, email.toLowerCase(), hashedPassword, name);

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
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    const response: AuthResponse = {
      user: {
        id: user.id,
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
router.get('/me', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?')
      .get(req.userId) as Omit<User, 'password'> | undefined;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    console.error('[AUTH] Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Get user's trips
router.get('/my-trips', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const trips = db.prepare(`
      SELECT * FROM trips 
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(req.userId);

    res.json({ trips });
  } catch (error) {
    console.error('[AUTH] Get trips error:', error);
    res.status(500).json({ error: 'Failed to get trips' });
  }
});

export default router;
