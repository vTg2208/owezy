# 🎭 Demo Guide - 3 User Scenario

## Setup
Make sure both servers are running:
- ✅ Backend: `npm run dev` in `/backend` folder (Port 3000)
- ✅ Frontend: `npm run dev` in `/frontend` folder (Port 5173)

## Multi-User Demo Strategy

### Option 1: Multiple Browser Windows (Recommended)
Open **3 separate browser windows** side by side:
- Window 1: Host (Alice)
- Window 2: Participant 1 (Bob)  
- Window 3: Participant 2 (Charlie)

### Option 2: Different Browsers
- Chrome: Host (Alice)
- Firefox: Participant 1 (Bob)
- Edge: Participant 2 (Charlie)

### Option 3: Incognito/Private Windows
Open 3 incognito/private windows in the same browser

---

## 📋 Step-by-Step Demo Script

### **Act 1: Creating the Trip (Window 1 - Alice)**

1. Open `http://localhost:5173` in Window 1
2. Click **"Create New Trip"**
3. Enter trip details:
   - Trip Name: `Goa Trip 2025`
   - Your Name: `Alice`
4. Click **"Create Trip"**
5. **IMPORTANT:** Copy the 6-digit room code that appears (e.g., `A3K7M9`)
6. You'll be redirected to the trip dashboard

---

### **Act 2: First Friend Joins (Window 2 - Bob)**

1. Open `http://localhost:5173` in Window 2
2. Click **"Join Existing Trip"**
3. Enter details:
   - Room Code: `[paste the code from Alice]`
   - Your Name: `Bob`
4. Click **"Join Trip"**
5. Bob now sees the trip dashboard with Alice and Bob listed

**Switch back to Window 1 (Alice)** - You'll see Bob appear in the participants list (polling updates every 15 seconds, or refresh manually)

---

### **Act 3: Second Friend Joins (Window 3 - Charlie)**

1. Open `http://localhost:5173` in Window 3
2. Click **"Join Existing Trip"**
3. Enter details:
   - Room Code: `[same code]`
   - Your Name: `Charlie`
4. Click **"Join Trip"**
5. Charlie sees all 3 participants

**Check Windows 1 & 2** - All windows now show 3 participants

---

### **Act 4: Adding Expenses**

#### **Expense 1: Hotel Booking (Alice pays)**
In Window 1 (Alice):
1. Fill in the "Add Expense" form:
   - Amount: `12000`
   - Who Paid?: `Alice`
   - Description: `Hotel booking for 3 nights`
2. Click **"Add Expense"**
3. Switch to "📋 Expenses" tab to see the expense

#### **Expense 2: Dinner (Bob pays)**
In Window 2 (Bob):
1. Add expense:
   - Amount: `1500`
   - Who Paid?: `Bob`
   - Description: `Dinner at beach restaurant`
2. Click **"Add Expense"**

#### **Expense 3: Taxi (Charlie pays)**
In Window 3 (Charlie):
1. Add expense:
   - Amount: `900`
   - Who Paid?: `Charlie`
   - Description: `Taxi to airport`
2. Click **"Add Expense"**

---

### **Act 5: Viewing Balances**

In **any window**, click the **"💰 Balances"** tab:

Expected results (amounts split equally):
- **Alice**: +₹7,200 (paid ₹12,000, owes ₹4,800)
- **Bob**: -₹3,300 (paid ₹1,500, owes ₹4,800)
- **Charlie**: -₹3,900 (paid ₹900, owes ₹4,800)

---

### **Act 6: Settlement Plan**

Click the **"🤝 Settlement"** tab in any window:

You'll see the optimal settlement transactions:
- Charlie pays ₹3,900 to Alice
- Bob pays ₹3,300 to Alice

Just 2 transactions to settle everything! 🎉

---

### **Act 7: Locking the Room (Alice only)**

In Window 1 (Alice - the host):
1. Click the **"🔒 Lock Room"** button at the top
2. The room is now locked

**Try in Window 2 or 3**: 
- Try to create a new expense - it still works (existing members can continue)
- Try to join with a 4th user in a new window - it should fail (room is locked)

---

## 🎬 Quick Demo Checklist

- [ ] 3 browser windows open side-by-side
- [ ] Alice creates trip and copies room code
- [ ] Bob joins using room code
- [ ] Charlie joins using room code
- [ ] All 3 can see each other in participants list
- [ ] Alice adds hotel expense (₹12,000)
- [ ] Bob adds dinner expense (₹1,500)
- [ ] Charlie adds taxi expense (₹900)
- [ ] View balances - shows who owes whom
- [ ] View settlement - shows optimal payment plan
- [ ] Alice locks the room
- [ ] Verify new users can't join

---

## 💡 Demo Tips

1. **Arrange windows**: Use Windows Snap (Win + Arrow keys) to arrange 3 windows side by side
2. **Refresh to sync**: While polling updates every 15s, you can manually refresh to see updates immediately
3. **Clear localStorage**: If you need to reset, open DevTools (F12) → Console → run `localStorage.clear()` then refresh
4. **Watch the magic**: The settlement algorithm minimizes transactions automatically!

---

## 🐛 Troubleshooting

**Issue**: Participant doesn't see updates
- **Solution**: Wait 15 seconds for auto-poll, or manually refresh the page

**Issue**: Can't join room
- **Solution**: Check if room is locked. Verify room code is correct (case-sensitive)

**Issue**: Balances don't update
- **Solution**: Click the "💰 Balances" tab to refresh, or reload the page

---

## 🎯 What to Highlight in Demo

1. **Easy Room Creation**: Just trip name + your name
2. **Simple Joining**: 6-character code makes it easy to share
3. **Real-time-ish Updates**: Auto-polling every 15 seconds
4. **Smart Settlement**: Optimal transaction calculation
5. **Room Locking**: Prevent new joiners after trip starts
6. **Mobile-First UI**: Beautiful gradient design with Tailwind CSS

Enjoy your demo! 🚀
