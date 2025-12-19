# Quick Start Guide - Authentication System

## 🚀 Start the Application

### 1. Start Backend (Terminal 1)
```bash
cd backend
npm run dev
```
Server runs at: `http://localhost:3000`

### 2. Start Frontend (Terminal 2)
```bash
cd frontend
npm run dev
```
App runs at: `http://localhost:5173`

## 📝 Testing Authentication Flow

### Scenario 1: New User Registration

1. **Open**: http://localhost:5173/
2. **Click**: "Register" button
3. **Fill Form**:
   - Name: `John Doe`
   - Email: `john@example.com`
   - Password: `password123`
4. **Click**: "Create Account"
5. **Result**: Automatically logged in → Redirected to Dashboard

### Scenario 2: Existing User Login

1. **Open**: http://localhost:5173/login
2. **Fill Form**:
   - Email: `john@example.com`
   - Password: `password123`
3. **Click**: "Login"
4. **Result**: Logged in → Dashboard

### Scenario 3: Persistent Login (Reload Test)

1. **Login** (as above)
2. **Close browser/tab**
3. **Reopen**: http://localhost:5173/dashboard
4. **Result**: ✅ Still logged in (no re-login needed)

### Scenario 4: Create Trip as Authenticated User

1. **Login**: http://localhost:5173/login
2. **Navigate**: Dashboard → "Create New Trip"
3. **Create Trip**:
   - Trip Name: `Beach Vacation`
   - Your Name: `John`
4. **Result**: Trip automatically linked to your account

### Scenario 5: View All My Trips

1. **Login**: http://localhost:5173/login
2. **Navigate**: Dashboard
3. **View**: All trips you created
4. **Click**: Any trip to open it

### Scenario 6: Guest Mode (No Login)

1. **Open**: http://localhost:5173/
2. **Click**: "Create a Trip" (without logging in)
3. **Create Trip**: Works normally
4. **Result**: Trip NOT saved to any account (guest mode)

## 🧪 API Testing with cURL

### Register User
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123",
    "name": "Test User"
  }'
```

**Response**:
```json
{
  "user": {
    "id": "abc123",
    "email": "test@example.com",
    "name": "Test User"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Login User
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123"
  }'
```

### Get Current User (Protected Route)
```bash
# Replace YOUR_TOKEN with the token from register/login response
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Get User's Trips
```bash
curl -X GET http://localhost:3000/api/auth/my-trips \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 🔍 Verify Data Persistence

### Check localStorage (Browser DevTools)

1. **Open DevTools**: Press `F12`
2. **Go to**: Application → Storage → Local Storage
3. **Check for**:
   - `auth_token`: Your JWT token
   - `auth_user`: Your user info (JSON)
   - `currentTrip`: Current active trip

### Check Database

```bash
# In backend directory
sqlite3 data/tripexpense.db

# View users
SELECT * FROM users;

# View trips with user links
SELECT id, name, room_code, user_id FROM trips;

# Exit
.exit
```

## 🎯 Key Features Demonstrated

### ✅ User Registration
- Email/password signup
- Password hashing (bcrypt)
- Auto-login after registration

### ✅ User Login
- Email/password authentication
- JWT token generation (30-day expiry)
- Secure session management

### ✅ Persistent Sessions
- Token stored in localStorage
- Auto-restore on page reload
- Token validation on app start
- No re-login needed (30 days)

### ✅ User Dashboard
- View all personal trips
- Quick access to trips
- User profile display
- Logout functionality

### ✅ Protected Routes
- Backend: JWT middleware
- Frontend: Auth context
- Token in Authorization header
- Automatic token refresh

### ✅ Guest Mode
- Works without login
- Trips not linked to account
- Full functionality
- Can register later

## 🐛 Troubleshooting

### "Invalid credentials" Error
- ✅ Check email spelling
- ✅ Check password (min 6 chars)
- ✅ Ensure user registered first

### "Token expired" Error
- ✅ Login again (30-day expiry)
- ✅ Check backend JWT_SECRET consistency

### Not Staying Logged In
- ✅ Check browser localStorage enabled
- ✅ Check for console errors (F12)
- ✅ Verify token in localStorage

### Dashboard Shows No Trips
- ✅ Create trips while logged in
- ✅ Guest trips won't appear here
- ✅ Check database for user_id link

### Backend Connection Error
- ✅ Ensure backend running (port 3000)
- ✅ Check CORS settings
- ✅ Verify API_URL in frontend

## 📊 User Flow Diagram

```
New User Journey:
┌──────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐
│   Home   │ -> │ Register │ -> │ Dashboard │ -> │  Trips   │
└──────────┘    └──────────┘    └───────────┘    └──────────┘
                     ↓
                 Auto-Login
                 Token Saved
                 
Returning User:
┌──────────┐    ┌───────────┐    ┌──────────┐
│  Any URL │ -> │  Verify   │ -> │ Dashboard│
└──────────┘    │   Token   │    └──────────┘
                └───────────┘
                 (Auto-login)

Guest User:
┌──────────┐    ┌──────────┐
│   Home   │ -> │  Trips   │ (No auth needed)
└──────────┘    └──────────┘
```

## 🎓 For Your Mentor

### Demo Script (5 minutes)

1. **Show Registration** (30s)
   - Click Register → Fill form → Auto-login

2. **Show Persistent Login** (30s)
   - Refresh page → Still logged in

3. **Show Trip Creation** (1m)
   - Create trip → Goes to Dashboard

4. **Show Dashboard** (1m)
   - List of all trips → Click to view

5. **Show Logout/Login** (1m)
   - Logout → Login again → Same trips

6. **Show Guest Mode** (30s)
   - Use without account → Fully functional

7. **Backend Code** (1m)
   - Show JWT middleware
   - Show password hashing
   - Show database schema

### Technical Highlights
- ✅ JWT authentication (industry standard)
- ✅ Bcrypt password hashing (10 rounds)
- ✅ localStorage persistence
- ✅ Token expiration (30 days)
- ✅ Protected API routes
- ✅ Guest + Auth modes
- ✅ React Context for state
- ✅ TypeScript full-stack
