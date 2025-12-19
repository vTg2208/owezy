# 🚀 Deployment Guide - Trip Expense Manager

## Quick Deployment Options

### Option 1: Railway (Recommended - Easiest)
**Cost:** Free tier available  
**Time:** ~10 minutes  
**Best for:** Full-stack apps with database

### Option 2: Render
**Cost:** Free tier available  
**Time:** ~15 minutes  
**Best for:** Separate backend/frontend hosting

### Option 3: Vercel + Railway
**Cost:** Free tiers available  
**Time:** ~20 minutes  
**Best for:** Optimized frontend with backend API

### Option 4: DigitalOcean/VPS
**Cost:** $5-10/month  
**Time:** ~1 hour  
**Best for:** Full control, production-grade

---

## 🎯 Pre-Deployment Checklist

### 1. Environment Variables Setup

Create `backend/.env`:
```env
# REQUIRED: Change this to a strong secret!
JWT_SECRET=your-super-secret-256-bit-random-key-here

# Optional
PORT=3000
NODE_ENV=production
```

Generate a strong JWT secret:
```powershell
# PowerShell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

### 2. Update CORS Settings

Edit `backend/src/server.ts`:
```typescript
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
```

### 3. Update Frontend API URL

Create `frontend/.env.production`:
```env
VITE_API_URL=https://your-backend-url.com/api
```

Update `frontend/src/api.ts`:
```typescript
const API_BASE = import.meta.env.VITE_API_URL || '/api';
```

And `frontend/src/api/auth.ts`:
```typescript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
```

### 4. Build Both Projects

```powershell
# Backend
cd backend
npm run build

# Frontend
cd ../frontend
npm run build
```

Verify `backend/dist/` and `frontend/dist/` folders exist.

---

## 🚂 Option 1: Deploy to Railway (Recommended)

Railway handles backend + database + frontend in one place.

### Step 1: Prepare Your Code

1. **Add `railway.json` to backend folder:**
```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

2. **Update `backend/package.json`:**
```json
{
  "scripts": {
    "start": "node dist/server.js",
    "build": "tsc",
    "dev": "tsx watch src/server.ts"
  }
}
```

3. **Create `.gitignore` in root:**
```
node_modules/
dist/
*.db
.env
.env.local
```

### Step 2: Deploy Backend to Railway

1. Go to [railway.app](https://railway.app)
2. Click **"Start a New Project"**
3. Select **"Deploy from GitHub repo"**
4. Connect your GitHub account
5. Push your code to GitHub (if not already)
6. Select your repository
7. Railway auto-detects the backend

### Step 3: Add Environment Variables

In Railway Dashboard:
1. Select your backend service
2. Go to **Variables** tab
3. Add:
   - `JWT_SECRET`: (your secret from step 1)
   - `PORT`: `3000`
   - `NODE_ENV`: `production`
   - `FRONTEND_URL`: (will add after deploying frontend)

### Step 4: Deploy Frontend to Railway

1. Click **"+ New"** → **"GitHub Repo"**
2. Select same repository
3. Click **"Add Service"**
4. Set **Root Directory** to `frontend`
5. Railway auto-detects Vite

Or use **Vercel** for frontend (better for Vite):
1. Go to [vercel.com](https://vercel.com)
2. Import your repository
3. Set Root Directory: `frontend`
4. Add env variable: `VITE_API_URL` = Railway backend URL
5. Deploy

### Step 5: Update CORS

1. Get your frontend URL from Railway/Vercel
2. Update backend `FRONTEND_URL` environment variable
3. Railway will auto-redeploy

### Step 6: Test

1. Visit your frontend URL
2. Register a new user
3. Create a trip
4. Verify everything works

**Your app is live! 🎉**

---

## 🎨 Option 2: Render (Separate Hosting)

### Backend on Render

1. Go to [render.com](https://render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name:** `trip-expense-backend`
   - **Root Directory:** `backend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `node dist/server.js`
   - **Environment:** `Node`

5. Add Environment Variables:
   - `JWT_SECRET`: your-secret-key
   - `NODE_ENV`: production
   - `PORT`: 3000

6. Click **"Create Web Service"**

### Frontend on Render

1. Click **"New +"** → **"Static Site"**
2. Select same repository
3. Configure:
   - **Name:** `trip-expense-frontend`
   - **Root Directory:** `frontend`
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`

4. Add Environment Variable:
   - `VITE_API_URL`: (your backend URL from above)

5. Click **"Create Static Site"**

### Update CORS

Add frontend URL to backend `FRONTEND_URL` environment variable in Render.

---

## ☁️ Option 3: Vercel + Railway

**Frontend:** Vercel (Best for Vite/React)  
**Backend + DB:** Railway

### Deploy Backend to Railway
(Follow Railway steps above for backend only)

### Deploy Frontend to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click **"Add New..."** → **"Project"**
3. Import your repository
4. Configure:
   - **Framework Preset:** Vite
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`

5. Add Environment Variable:
   - Key: `VITE_API_URL`
   - Value: `https://your-railway-backend.up.railway.app/api`

6. Click **"Deploy"**

7. Update Railway backend `FRONTEND_URL` with Vercel URL

**Done! Frontend on Vercel, Backend on Railway** 🚀

---

## 🖥️ Option 4: DigitalOcean VPS (Production)

### Step 1: Create Droplet

1. Go to [digitalocean.com](https://digitalocean.com)
2. Create Droplet:
   - **Image:** Ubuntu 22.04 LTS
   - **Plan:** Basic ($6/month)
   - **Datacenter:** Nearest to you
   - **Authentication:** SSH key (recommended)

### Step 2: Connect to Server

```powershell
ssh root@your-droplet-ip
```

### Step 3: Install Dependencies

```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install Nginx
apt install -y nginx

# Install PM2 (process manager)
npm install -g pm2

# Install Certbot (for SSL)
apt install -y certbot python3-certbot-nginx
```

### Step 4: Clone Your Repository

```bash
cd /var/www
git clone https://github.com/yourusername/sudden-hack.git
cd sudden-hack
```

### Step 5: Setup Backend

```bash
cd backend

# Install dependencies
npm install

# Build
npm run build

# Create .env file
nano .env
```

Paste:
```env
JWT_SECRET=your-super-secret-key
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://yourdomain.com
```

Save: `Ctrl+X`, `Y`, `Enter`

```bash
# Start with PM2
pm2 start dist/server.js --name trip-backend
pm2 save
pm2 startup
```

### Step 6: Setup Frontend

```bash
cd ../frontend

# Install dependencies
npm install

# Create production env
echo "VITE_API_URL=https://yourdomain.com/api" > .env.production

# Build
npm run build
```

### Step 7: Configure Nginx

```bash
nano /etc/nginx/sites-available/trip-expense
```

Paste:
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Frontend
    location / {
        root /var/www/sudden-hack/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Save and enable:
```bash
ln -s /etc/nginx/sites-available/trip-expense /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### Step 8: Setup SSL (HTTPS)

```bash
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Follow prompts to get free SSL certificate.

### Step 9: Setup Firewall

```bash
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw enable
```

**Your app is now live on your domain! 🎉**

---

## 🗄️ Database Considerations

### Development (SQLite)
Currently using SQLite file database - works fine for small scale.

### Production Options

#### Keep SQLite (Simple)
✅ Pros: Simple, no extra service needed  
❌ Cons: Not ideal for high traffic

**Setup:** Database file persists in backend folder

#### Upgrade to PostgreSQL (Recommended)
✅ Pros: Better for production, scalable  
❌ Cons: More complex setup

**Railway/Render:** Add PostgreSQL service (free tier available)

**Migration Steps:**
1. Install PostgreSQL driver: `npm install pg`
2. Replace `better-sqlite3` with `pg`
3. Update database.ts to use PostgreSQL
4. Run migrations

---

## 🔒 Security Checklist

Before going live:

- [ ] Changed `JWT_SECRET` to strong random value
- [ ] Enabled HTTPS (SSL certificate)
- [ ] Updated CORS to specific domain (not `*`)
- [ ] Set `NODE_ENV=production`
- [ ] Removed console.logs in production
- [ ] Set secure cookie flags (if using cookies)
- [ ] Rate limiting on auth endpoints (optional)
- [ ] Database backups configured
- [ ] Firewall configured (VPS only)
- [ ] Error monitoring setup (Sentry, etc.)
- [ ] Environment variables not in git
- [ ] `.env` files in `.gitignore`

---

## 📊 Post-Deployment Monitoring

### Railway/Render
- Check built-in logs in dashboard
- Monitor resource usage
- Set up alerts

### VPS (DigitalOcean)
```bash
# View backend logs
pm2 logs trip-backend

# Check status
pm2 status

# Monitor resources
htop

# Nginx logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

---

## 🐛 Common Deployment Issues

### "Cannot find module"
```bash
# Make sure you ran build
npm run build

# Check dist folder exists
ls dist/
```

### CORS Errors
```typescript
// backend/src/server.ts
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
```

### 404 on Frontend Routes
Nginx needs to handle SPA routing:
```nginx
try_files $uri $uri/ /index.html;
```

### Database Connection Issues
```bash
# Check database file permissions
ls -la backend/data/

# Create data directory if missing
mkdir -p backend/data
```

### Environment Variables Not Loading
```bash
# Verify .env exists
cat backend/.env

# Check process.env in code
console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'Set' : 'Missing');
```

---

## 🔄 Updating Your Deployment

### Railway/Render
```bash
git add .
git commit -m "Update feature"
git push origin main
# Auto-deploys on push
```

### VPS
```bash
ssh root@your-droplet-ip

cd /var/www/sudden-hack
git pull

# Update backend
cd backend
npm install
npm run build
pm2 restart trip-backend

# Update frontend
cd ../frontend
npm install
npm run build
```

---

## 💰 Cost Comparison

| Platform | Backend | Frontend | Database | Total/Month |
|----------|---------|----------|----------|-------------|
| Railway | Free-$5 | Free-$5 | Included | $0-10 |
| Render | Free-$7 | Free | Free | $0-7 |
| Vercel+Railway | Free-$5 | Free | Included | $0-5 |
| DigitalOcean | Included | Included | Included | $6 |
| Heroku | $7 | Free | $5 | $12 |

**Recommendation:** Start with Railway (free) or Vercel+Railway combo.

---

## 🎯 Quick Start Deployment (Fastest)

### 5-Minute Railway Deploy

```bash
# 1. Install Railway CLI
npm install -g railway

# 2. Login
railway login

# 3. Deploy backend
cd backend
railway init
railway up

# 4. Get backend URL
railway domain

# 5. Deploy frontend to Vercel
cd ../frontend
npm install -g vercel
vercel --prod
# Set VITE_API_URL when prompted to Railway URL

# Done! ✅
```

---

## 📞 Need Help?

- Railway Docs: https://docs.railway.app
- Render Docs: https://render.com/docs
- Vercel Docs: https://vercel.com/docs
- DigitalOcean Tutorials: https://www.digitalocean.com/community/tutorials

**Your app is ready to deploy! Choose your platform and follow the steps above.** 🚀
