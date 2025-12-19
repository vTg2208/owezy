# Quick Start Guide

## 🚀 Running the Application

### Terminal 1 - Backend
```bash
cd backend
npm run dev
```
Backend will run on: http://localhost:3000

### Terminal 2 - Frontend
```bash
cd frontend
npm run dev
```
Frontend will run on: http://localhost:5173

## 📝 How to Use

### 1. Create a Trip
- Open http://localhost:5173
- Click "Create New Trip"
- Enter trip name (e.g., "Goa Trip 2025")
- You'll get a 6-digit room code

### 2. Join Trip
- Share the room code with friends
- They click "Join Existing Trip"
- Enter room code and their name

### 3. Add Expenses
- Any participant can add expenses
- Select who paid
- Choose split type:
  - **Equal**: Split equally among all or selected participants
  - **Custom**: Specify exact amount per person
  - **Percentage**: Allocate by percentage

### 4. View Balances
- Click "Balances" tab to see who owes what
- Green = Gets money back
- Red = Owes money

### 5. Settlement Plan
- Click "Settlement" tab
- See optimized payment plan
- Minimum number of transactions to settle all debts

### 6. Room Controls (Admin Only)
- First person to join becomes admin
- Admin can remove participants (before locking)
- Click "Lock Room" to prevent new joins
- Once locked, participant list is frozen

## 🔄 Auto-Sync
- All data syncs automatically every 15 seconds
- No need to refresh manually
- Low bandwidth optimized

## 🎯 Features Implemented

✅ **P0 - MVP Core**
- Trip creation with room code
- Join trip via code
- Add expenses with equal split
- Balance calculation
- Settlement plan generation

✅ **P1 - Enhanced**
- Room locking
- Remove participants
- Custom amount splits
- Percentage splits
- Expense history with details

## 📊 API Endpoints

- `POST /api/trips` - Create trip
- `POST /api/trips/:code/join` - Join trip
- `GET /api/trips/:tripId` - Get trip details
- `POST /api/trips/:tripId/lock` - Lock room
- `DELETE /api/trips/:tripId/participants/:id` - Remove participant
- `POST /api/trips/:tripId/expenses` - Add expense
- `GET /api/trips/:tripId/expenses` - Get all expenses
- `GET /api/trips/:tripId/balances` - Get balances
- `GET /api/trips/:tripId/settlement` - Get settlement plan

## 🛠️ Tech Stack
- **Backend**: Express.js + TypeScript + SQLite + better-sqlite3
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS
- **Sync**: Polling (15s intervals)

## 📦 Database
- SQLite database stored in `backend/trips.db`
- Auto-created on first run
- All data persists between restarts

Enjoy managing your trip expenses! 🎉
