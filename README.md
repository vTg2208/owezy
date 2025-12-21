# Trip Expense Manager 

A comprehensive expense sharing application designed for group trips. Manage shared costs, track balances, and settle debts efficiently with a modern, user-friendly interface.

## Features

### Core Functionality
- **Trip Management**: Create new trips or join existing ones using a unique 6-character room code.
- **Expense Tracking**: Add expenses with support for:
  - Equal splits
  - Custom amounts
  - Percentage splits
- **Receipts**: Upload and view receipt images for every expense (compressed and stored securely).
- **Balances & Settlements**: Real-time calculation of who owes whom, with a simplified settlement plan to minimize transactions.

### Advanced Features
- **Authentication**: Secure Google Sign-In via Firebase Auth.
- **Security**: 
  - Email verification enforcement.
  - Admin controls to **Lock/Unlock** rooms to prevent new members or changes.
  - Ability to remove participants.
- **Chat**: Built-in group chat for trip-related discussions.
- **Account Management**: Full control over your data, including account deletion.

## Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS
- **Backend**: Node.js, Express, TypeScript
- **Database**: MongoDB (Mongoose)
- **Authentication**: Firebase Authentication
- **Deployment**: Vercel (Frontend) + Render (Backend)

## Getting Started

### Prerequisites
- Node.js 18+
- MongoDB Atlas Account
- Firebase Project

### Environment Setup

**Backend (.env)**
```env
PORT=3000
MONGODB_URI=your_mongodb_connection_string
FIREBASE_SERVICE_ACCOUNT={"type": "service_account", ...}
```

**Frontend (.env)**
```env
VITE_API_URL=http://localhost:3000/api
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_bucket.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/vTg2208/owezy.git
   ```

2. **Backend Setup**
   ```bash
   cd backend
   npm install
   npm run dev
   ```

3. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## Deployment

### Backend (Render)
1. Create a new Web Service on Render.
2. Connect your repository.
3. Set Build Command: `npm install && npm run build`
4. Set Start Command: `npm start`
5. Add Environment Variables (`MONGODB_URI`, `FIREBASE_SERVICE_ACCOUNT`).

### Frontend (Vercel)
1. Import project into Vercel.
2. Set Framework Preset to **Vite**.
3. Add Environment Variables (`VITE_API_URL`, `VITE_FIREBASE_*`).
4. Deploy!

## Author

**Vishnu Vardhan Theegela**