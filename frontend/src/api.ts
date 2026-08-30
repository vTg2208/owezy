// In production (Vercel), set VITE_API_URL environment variable to your backend URL (e.g., https://your-app.onrender.com/api)
const API_BASE = import.meta.env.VITE_API_URL || '/api';
import { auth } from './firebase';

async function getAuthHeaders(contentType: string | null = 'application/json') {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export const authAPI = {
  syncUser: async (email: string, name: string) => {
    const res = await fetch(`${API_BASE}/auth/sync`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ email, name })
    });
    if (!res.ok) throw new Error('Failed to sync user');
    return res.json();
  },

  getMyTrips: async () => {
    const res = await fetch(`${API_BASE}/auth/my-trips`, {
      headers: await getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to fetch trips');
    const data = await res.json();
    return data.trips || [];
  },

  deleteAccount: async () => {
    const res = await fetch(`${API_BASE}/auth/me`, {
      method: 'DELETE',
      headers: await getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to delete account');
    return res.json();
  }
};

export const api = {
  // Create a new trip
  createTrip: async (tripName: string, adminName: string) => {
    const res = await fetch(`${API_BASE}/trips`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ tripName, adminName })
    });
    if (!res.ok) throw new Error('Failed to create trip');
    return res.json();
  },

  // Join a trip
  joinTrip: async (roomCode: string, memberName: string) => {
    const res = await fetch(`${API_BASE}/trips/join`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ roomCode, memberName })
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to join trip');
    }
    return res.json();
  },

  // Get trip details
  getTrip: async (tripId: string) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}`, {
      headers: await getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to fetch trip');
    return res.json();
  },

  // Lock room
  lockRoom: async (tripId: string) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/lock`, {
      method: 'POST',
      headers: await getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to lock room');
    return res.json();
  },

  // Unlock room
  unlockRoom: async (tripId: string) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/unlock`, {
      method: 'POST',
      headers: await getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to unlock room');
    return res.json();
  },

  // Remove participant
  removeParticipant: async (tripId: string, memberId: string) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/members/${memberId}`, {
      method: 'DELETE',
      headers: await getAuthHeaders()
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to remove participant');
    }
    return res.json();
  },

  // Add expense
  addExpense: async (tripId: string, data: { 
    paidBy: string; 
    description: string; 
    amount: number;
    splitType?: 'equal' | 'custom' | 'percentage';
    splits?: { participantId: string; amount: number }[];
    receiptId?: string;
  }) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/expenses`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to add expense');
    return res.json();
  },

  uploadReceipt: async (tripId: string, file: File): Promise<{
    receipt_id: string;
    receipt_url: string;
    content_type: string;
    byte_size: number;
    checksum_sha256: string;
    status: 'pending';
    pending_expires_at: string;
  }> => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/receipts`, {
      method: 'POST',
      headers: await getAuthHeaders(file.type || 'application/octet-stream'),
      body: file,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to upload receipt');
    }
    return res.json();
  },

  readReceipt: async (receiptUrl: string, signal?: AbortSignal): Promise<Blob> => {
    const normalizedBase = API_BASE.replace(/\/$/, '');
    const url = receiptUrl.startsWith('/api/')
      ? `${normalizedBase}${receiptUrl.slice('/api'.length)}`
      : receiptUrl;
    const res = await fetch(url, { headers: await getAuthHeaders(null), signal });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to load receipt');
    }
    return res.blob();
  },

  // Get balances
  getBalances: async (tripId: string) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/balances`, {
      headers: await getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to fetch balances');
    const data = await res.json();
    return data.balances || [];
  },

  // Get settlement
  getSettlement: async (tripId: string) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/balances`, {
      headers: await getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to fetch settlement');
    const data = await res.json();
    return data.settlements || [];
  },

  // Send message
  sendMessage: async (tripId: string, memberId: string, message: string) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/messages`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ memberId, message })
    });
    if (!res.ok) throw new Error('Failed to send message');
    return res.json();
  },

  // Get messages
  getMessages: async (tripId: string) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/messages`, {
      headers: await getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to fetch messages');
    const data = await res.json();
    return data.messages || [];
  }
};
