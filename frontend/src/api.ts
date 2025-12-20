const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getAuthHeaders() {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export const api = {
  // Create a new trip
  createTrip: async (tripName: string, adminName: string) => {
    const res = await fetch(`${API_BASE}/trips`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ tripName, adminName })
    });
    if (!res.ok) throw new Error('Failed to create trip');
    return res.json();
  },

  // Join a trip
  joinTrip: async (roomCode: string, memberName: string) => {
    const res = await fetch(`${API_BASE}/trips/join`, {
      method: 'POST',
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to fetch trip');
    return res.json();
  },

  // Lock room
  lockRoom: async (tripId: string) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/lock`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to lock room');
    return res.json();
  },

  // Remove participant
  removeParticipant: async (tripId: string, memberId: string) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/members/${memberId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to remove participant');
    return res.json();
  },

  // Add expense
  addExpense: async (tripId: string, data: { 
    paidBy: string; 
    description: string; 
    amount: number;
    splitType?: 'equal' | 'custom' | 'percentage';
    splits?: { participantId: string; amount: number }[];
  }) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/expenses`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to add expense');
    return res.json();
  },

  // Get balances
  getBalances: async (tripId: string) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/balances`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to fetch balances');
    const data = await res.json();
    return data.balances || [];
  },

  // Get settlement
  getSettlement: async (tripId: string) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/balances`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to fetch settlement');
    const data = await res.json();
    return data.settlements || [];
  },

  // Send chat message
  sendMessage: async (tripId: string, memberId: string, message: string) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/messages`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ memberId, message })
    });
    if (!res.ok) throw new Error('Failed to send message');
    return res.json();
  },

  // Get chat messages
  getMessages: async (tripId: string, limit = 50) => {
    const res = await fetch(`${API_BASE}/trips/${tripId}/messages?limit=${limit}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to fetch messages');
    return res.json();
  }
};
