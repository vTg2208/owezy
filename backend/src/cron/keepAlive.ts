import cron from 'node-cron';
import https from 'https';
import http from 'http';
import mongoose from 'mongoose';

const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;

// Function to keep the server alive
const pingServer = () => {
  console.log(`[CRON] Pinging server at ${BACKEND_URL}/health to keep it alive...`);
  
  const protocol = BACKEND_URL.startsWith('https') ? https : http;
  
  protocol.get(`${BACKEND_URL}/health`, (res) => {
    console.log(`[CRON] Server ping status: ${res.statusCode}`);
  }).on('error', (err) => {
    console.error(`[CRON] Server ping failed: ${err.message}`);
  });
};

// Function to keep the database connection alive
const pingDatabase = async () => {
    try {
        if (mongoose.connection.readyState === 1) { // 1 = connected
            await mongoose.connection.db?.command({ ping: 1 });
            console.log('[CRON] Database ping successful');
        } else {
            console.log('[CRON] Database not connected, skipping ping');
        }
    } catch (error) {
        console.error('[CRON] Database ping failed:', error);
    }
}

// Schedule tasks
export const startCronJobs = () => {
  // Ping server every 14 minutes to prevent Render free tier from sleeping (it sleeps after 15 mins of inactivity)
  cron.schedule('*/14 * * * *', () => {
    pingServer();
  });

  // Ping database every 5 minutes to keep connection active
  cron.schedule('*/5 * * * *', () => {
    pingDatabase();
  });
  
  console.log('[CRON] Jobs scheduled: Server ping (every 14m), Database ping (every 5m)');

  // Run immediately on startup to verify 
  pingDatabase();
};
