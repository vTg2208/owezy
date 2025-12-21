import { Router, Request, Response } from 'express';
import { User, Trip, Member } from '../models';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { auth } from '../firebase';

const router = Router();

// Sync user from Firebase to MongoDB
// This endpoint is called after Firebase login on frontend to ensure user exists in DB
router.post('/sync', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { email, name } = req.body;
    const userId = req.userId; // From Firebase token

    if (!userId || !email) {
      return res.status(400).json({ error: 'User ID and email are required' });
    }

    // Check if user exists, if not create
    let user = await User.findById(userId);
    
    if (!user) {
      user = await User.create({
        _id: userId,
        email: email.toLowerCase(),
        name: name || email.split('@')[0] // Fallback name
      });
    } else {
      // Update name if provided
      if (name && user.name !== name) {
        user.name = name;
        await user.save();
      }
    }

    res.json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('[AUTH] Sync error:', error);
    res.status(500).json({ error: 'Failed to sync user' });
  }
});

// Get current user (verify token)
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.userId);

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

// Delete account
router.delete('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;

    // 1. Delete from MongoDB
    await User.findByIdAndDelete(userId);
    
    // 2. Delete from Firebase Authentication
    await auth.deleteUser(userId);

    res.json({ success: true });
  } catch (error) {
    console.error('[AUTH] Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
