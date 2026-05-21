import https from 'https';
import http from 'http';
import mongoose from 'mongoose';

const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tripexpense';
const SERVER_PING_INTERVAL_MS = 10 * 60 * 1000;
const DATABASE_PING_INTERVAL_MS = 60 * 1000;

let heartbeatStarted = false;
let serverPingTimer: NodeJS.Timeout | null = null;
let databasePingTimer: NodeJS.Timeout | null = null;

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
    if (mongoose.connection.readyState !== 1) {
      console.log('[CRON] Database connection is not active, reconnecting...');
      await mongoose.connect(MONGODB_URI);
    }

    await mongoose.connection.db?.command({ ping: 1 });
    console.log('[CRON] Database ping successful');
  } catch (error) {
    console.error('[CRON] Database ping failed:', error);
    try {
      if (mongoose.connection.readyState !== 1) {
        await mongoose.disconnect();
      }
    } catch (disconnectError) {
      console.error('[CRON] Database reconnect cleanup failed:', disconnectError);
    }
  }
};

// Schedule tasks
export const startCronJobs = () => {
  if (heartbeatStarted) {
    return;
  }

  heartbeatStarted = true;

  // Keep the app and MongoDB warm with frequent heartbeats so neither side goes idle.
  serverPingTimer = setInterval(() => {
    pingServer();
  }, SERVER_PING_INTERVAL_MS);

  databasePingTimer = setInterval(() => {
    void pingDatabase();
  }, DATABASE_PING_INTERVAL_MS);

  if (serverPingTimer.unref) {
    serverPingTimer.unref();
  }

  if (databasePingTimer.unref) {
    databasePingTimer.unref();
  }
  
  console.log('[CRON] Jobs scheduled: Server ping (every 10m), Database ping (every 1m)');

  // Run immediately on startup to verify 
  void pingDatabase();
};
