# Trip Expense Manager 🚀

A real-time expense sharing application for group trips, built for managing shared costs efficiently.

## Features
- 🎯 Create trips with unique room codes
- 👥 Multi-participant expense tracking
- 💰 Automatic balance calculation
- 🔒 Room locking mechanism
- 📊 Smart settlement algorithm
- 💱 Multiple split types (equal, custom, percentage)

## Tech Stack
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS
- **Backend**: Express + TypeScript + SQLite
- **Real-time**: Polling mechanism (15s intervals)

## Setup & Installation

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Backend Setup
```bash
cd backend
npm install
npm run dev
```
Server runs on http://localhost:3000

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
App runs on http://localhost:5173

## Project Structure
```
sudden-hack/
├── backend/           # Express API server
│   ├── src/
│   │   ├── models/    # Database models
│   │   ├── routes/    # API routes
│   │   └── server.ts  # Entry point
│   └── package.json
├── frontend/          # React application
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── App.tsx
│   └── package.json
└── README.md
```

## API Endpoints
- `POST /api/trips` - Create new trip
- `POST /api/trips/:code/join` - Join trip
- `POST /api/trips/:tripId/expenses` - Add expense
- `GET /api/trips/:tripId` - Get trip details
- `POST /api/trips/:tripId/lock` - Lock room

## Development Timeline
Built in 5-hour hackathon sprint focusing on core functionality first.

## License
MIT
