const API_URL = 'owezy.railway.internal/api';

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
  };
  token: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export const authAPI = {
  async register(email: string, password: string, name: string): Promise<AuthResponse> {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name })
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Registration failed');
    }
    return response.json();
  },

  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Login failed');
    }
    return response.json();
  },

  async getCurrentUser(token: string): Promise<User> {
    const response = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error('Failed to get current user');
    }
    const data = await response.json();
    return data.user;
  },

  async getMyTrips(token: string) {
    const response = await fetch(`${API_URL}/auth/my-trips`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error('Failed to get trips');
    }
    const data = await response.json();
    return data.trips;
  }
};
