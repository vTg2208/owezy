# 🚀 Quick Start Guide - Fresh Installation

## Prerequisites
- Node.js installed
- Two terminals ready

## Step-by-Step Startup

### 1. Clean Start (First Time or After Changes)

```powershell
# Kill any running node processes
Stop-Process -Name node -Force -ErrorAction SilentlyContinue

# Navigate to backend
cd backend

# Remove old database to apply new schema
Remove-Item data\tripexpense.db -ErrorAction SilentlyContinue

# Install dependencies (if needed)
npm install

# Start backend server
npm run dev
```

**Expected Output:**
```
[DATABASE] Initialized at C:\...\backend\data\tripexpense.db
[SERVER] Server running on http://localhost:3000
API endpoints: http://localhost:3000/api
```

### 2. Start Frontend (New Terminal)

```powershell
# Navigate to frontend
cd frontend

# Install dependencies (if needed)
npm install

# Start development server
npm run dev
```

**Expected Output:**
```
  VITE v5.4.21  ready in X ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

### 3. Open Browser

```
http://localhost:5173
```

**You should see:** Login/Register page (NO guest access)

---

## First Time User Flow

### Register Your Account
1. Click **"Register"**
2. Fill in:
   - Name: `Your Name`
   - Email: `you@example.com`
   - Password: `yourpassword` (min 6 chars)
3. Click **"Create Account"**
4. ✅ Auto-logged in → Redirected to Dashboard

### Create Your First Trip
1. From Dashboard → Click **"Create New Trip"**
2. Or from Home → Click **"Create a Trip"**
3. Fill in:
   - Trip Name: `Beach Vacation`
   - Your Name: `John`
4. Click **"Create Trip"**
5. ✅ Room code generated (e.g., `ABC123`)
6. ✅ Redirected to trip dashboard

### Invite Others (Testing Multi-User)
1. Open **Incognito/Private Window**
2. Go to `http://localhost:5173`
3. Click **"Register"** (create different account)
4. Click **"Join a Trip"**
5. Enter:
   - Room Code: `ABC123` (from step above)
   - Your Name: `Jane`
6. ✅ Joined the trip!

### Test Participant Removal
1. **As Admin (first window):**
   - Go to trip dashboard
   - Click "Participants" tab
   - Click **"Remove"** next to Jane
   - Confirm removal

2. **As Removed User (incognito window):**
   - Wait up to 15 seconds
   - Alert appears: "You have been removed from this trip"
   - ✅ Auto-redirected to home

---

## Testing Authentication

### Test 1: Logout & Login
```
1. Click your name (top right) → Logout
2. Redirected to /login
3. Enter credentials → Login
4. ✅ Back in your dashboard
```

### Test 2: Session Persistence
```
1. Login to your account
2. Close browser completely
3. Reopen browser → Go to http://localhost:5173
4. ✅ Still logged in! (no re-login needed)
```

### Test 3: Unauthorized Access
```
1. Logout
2. Try to visit: http://localhost:5173/dashboard
3. ✅ Redirected to /login (protected route)
```

---

## Quick Troubleshooting

### "Port 3000 already in use"
```powershell
# Kill all node processes
Stop-Process -Name node -Force

# Restart backend
cd backend
npm run dev
```

### "Cannot find module" errors
```powershell
# Backend
cd backend
rm -r node_modules
npm install

# Frontend
cd frontend
rm -r node_modules
npm install
```

### "Database error" or "Schema mismatch"
```powershell
cd backend
Remove-Item data\tripexpense.db
npm run dev
# Fresh database with correct schema
```

### "Not staying logged in"
```
1. Open DevTools (F12)
2. Application → Local Storage
3. Should see:
   - auth_token: "eyJhbG..."
   - auth_user: "{...}"
4. If missing → Clear storage, re-login
```

---

## API Testing (Optional)

### Test Registration
```powershell
$body = @{
  email = "test@example.com"
  password = "test123"
  name = "Test User"
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/api/auth/register" `
  -Method POST `
  -Body $body `
  -ContentType "application/json" `
  -UseBasicParsing
```

### Test Login
```powershell
$body = @{
  email = "test@example.com"
  password = "test123"
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/api/auth/login" `
  -Method POST `
  -Body $body `
  -ContentType "application/json" `
  -UseBasicParsing
```

---

## Production Build

### Build for Production
```powershell
# Backend
cd backend
npm run build
# Output: dist/

# Frontend
cd frontend
npm run build
# Output: dist/
```

### Run Production Build
```powershell
# Backend
cd backend
npm start

# Frontend (serve static files)
# Use nginx, Apache, or serve package
npm install -g serve
serve -s dist -l 5173
```

---

## Environment Variables (Production)

Create `backend/.env`:
```env
JWT_SECRET=your-super-secret-256-bit-key-change-this
PORT=3000
NODE_ENV=production
```

Create `frontend/.env`:
```env
VITE_API_URL=https://your-domain.com/api
```

---

## Database Management

### View Database
```powershell
cd backend\data
sqlite3 tripexpense.db

# SQLite commands:
.tables              # List tables
.schema users        # Show users table schema
SELECT * FROM users; # View all users
.exit                # Exit
```

### Backup Database
```powershell
# Copy database file
Copy-Item backend\data\tripexpense.db backend\data\backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').db
```

### Reset Database
```powershell
cd backend
Remove-Item data\tripexpense.db
npm run dev
# Creates fresh database with latest schema
```

---

## Common Commands Reference

```powershell
# Start development
cd backend && npm run dev      # Terminal 1
cd frontend && npm run dev     # Terminal 2

# Build for production
cd backend && npm run build
cd frontend && npm run build

# Clean restart
Stop-Process -Name node -Force
cd backend && Remove-Item data\tripexpense.db && npm run dev

# View logs
# Backend: Shows in terminal
# Frontend: Browser DevTools (F12) → Console

# Database check
cd backend\data
sqlite3 tripexpense.db "SELECT * FROM users;"

# Test API
# See PowerShell examples above
```

---

## Success Checklist

After starting, verify:
- [ ] Backend running on http://localhost:3000
- [ ] Frontend running on http://localhost:5173
- [ ] Can register new account
- [ ] Can login with credentials
- [ ] Stay logged in after refresh
- [ ] Can create trip
- [ ] Can join trip (incognito)
- [ ] Can remove participant
- [ ] Removed user gets notified
- [ ] Logout works
- [ ] Protected routes redirect to login

If all checked ✅ **System is fully operational!**

---

## Need Help?

1. Check [PROJECT_COMPLETE.md](PROJECT_COMPLETE.md) for full documentation
2. Check [FINAL_CHECKLIST.md](FINAL_CHECKLIST.md) for feature verification
3. Check [AUTH_GUIDE.md](AUTH_GUIDE.md) for authentication details
4. Review backend terminal for error logs
5. Check browser console (F12) for frontend errors

**Happy Hacking! 🚀**
