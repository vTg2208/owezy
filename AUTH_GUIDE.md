# User Authentication Setup Guide

## Overview
Your Trip Expense Manager now has a complete JWT-based authentication system with persistent login functionality.

## Features Added

### Backend
1. **User Management**
   - User registration with email/password
   - Secure password hashing with bcryptjs
   - JWT token authentication (30-day expiry)
   - User session management

2. **Database Schema**
   - New `users` table with email, password, name
   - Linked trips to users via `user_id` foreign key
   - Supports both authenticated and guest trips

3. **API Endpoints**
   - `POST /api/auth/register` - Create new user account
   - `POST /api/auth/login` - Login with email/password
   - `GET /api/auth/me` - Get current user (verify token)
   - `GET /api/auth/my-trips` - Get all trips for logged-in user

4. **Middleware**
   - `authenticateToken` - Protect routes requiring auth
   - `optionalAuth` - Allow both authenticated and guest access

### Frontend
1. **Authentication Context**
   - Global auth state management
   - Auto-restore session from localStorage
   - Token validation on app load

2. **New Pages**
   - **Login** (`/login`) - Email/password login
   - **Register** (`/register`) - Create new account
   - **Dashboard** (`/dashboard`) - User's personal trip dashboard

3. **Persistent Login**
   - Token stored in localStorage
   - Auto-login on page refresh
   - 30-day session duration

## How to Use

### For First-Time Users

1. **Register an Account**
   ```
   - Visit: http://localhost:5173/register
   - Enter: Name, Email, Password (min 6 chars)
   - Click: "Create Account"
   - Automatically logged in and redirected to dashboard
   ```

2. **Login Later**
   ```
   - Visit: http://localhost:5173/login
   - Enter: Email, Password
   - Click: "Login"
   - Redirected to dashboard
   ```

3. **Persistent Session**
   - Close browser/tab
   - Come back anytime
   - Still logged in (token in localStorage)
   - Valid for 30 days

### User Flow

```
┌─────────────┐
│   Home      │ ← Can use without login (guest mode)
│   /         │
└──────┬──────┘
       │
       ├─────► Register (/register) ──┐
       │                               │
       ├─────► Login (/login) ─────────┤
       │                               ▼
       │                         ┌──────────────┐
       │                         │  Dashboard   │
       │                         │  /dashboard  │
       │                         └──────┬───────┘
       │                                │
       ▼                                │
┌──────────────┐                        │
│ Create Trip  │◄───────────────────────┘
│ Join Trip    │
└──────────────┘
```

### Guest vs Authenticated Mode

**Guest Mode (No Login)**
- Create trips without account
- Join trips without account
- Trips not saved to account
- Session persists until browser storage cleared

**Authenticated Mode**
- All trips automatically saved to your account
- View all your trips in dashboard
- Access trips from any device (same login)
- Persistent across devices

## Technical Details

### Token Storage
```javascript
// Token automatically stored on login/register
localStorage.setItem('auth_token', token);
localStorage.setItem('auth_user', JSON.stringify(user));

// Auto-loaded on app start
useEffect(() => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    // Verify token is still valid
    verifyToken(token);
  }
}, []);
```

### Security
- Passwords hashed with bcrypt (10 rounds)
- JWT tokens signed with secret key
- 30-day token expiration
- Tokens sent via Authorization header
- HTTPS recommended for production

### API Authorization
```javascript
// Frontend automatically includes token
headers: {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
}

// Backend validates on protected routes
const decoded = jwt.verify(token, JWT_SECRET);
req.userId = decoded.userId;
```

## Environment Variables (Production)

Create `.env` file in backend:
```env
JWT_SECRET=your-super-secret-key-change-this
PORT=3000
```

## Testing Authentication

### 1. Test Registration
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123","name":"Test User"}'
```

### 2. Test Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
```

### 3. Test Protected Route
```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## Troubleshooting

### Token Expired
- Users automatically logged out
- Must login again
- Increase expiry in auth.ts: `expiresIn: '90d'`

### Can't Login After Refresh
- Check localStorage in DevTools
- Should see `auth_token` and `auth_user`
- Clear storage and re-login if corrupted

### Database Reset
```bash
# Backend terminal
rm data/tripexpense.db
npm run dev  # Recreates with new schema
```

## Future Enhancements
- [ ] Password reset via email
- [ ] Email verification
- [ ] OAuth (Google/GitHub)
- [ ] Refresh tokens
- [ ] Two-factor authentication
- [ ] User profile management

## Database Migration
The database automatically adds the `users` table and `user_id` column on first run. Existing trips will have `user_id = NULL` (guest trips).

## Next Steps
1. Start both servers (backend + frontend)
2. Visit http://localhost:5173/register
3. Create an account
4. Create some trips
5. Logout and login to verify persistence
6. Check dashboard to see all your trips
