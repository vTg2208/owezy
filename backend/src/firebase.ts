import admin from 'firebase-admin';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    console.log('[FIREBASE] Attempting to initialize Admin SDK...');
    
    // 1. Try environment variable (Best for production/Render)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log('[FIREBASE] Found FIREBASE_SERVICE_ACCOUNT environment variable');
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    // 2. Try local file (Best for local dev)
    else {
      const serviceAccountPath = path.join(process.cwd(), 'service-account-key.json');
      if (fs.existsSync(serviceAccountPath)) {
        console.log(`[FIREBASE] Found service account at: ${serviceAccountPath}`);
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      } else {
        console.log('[FIREBASE] Service account file not found, trying default credentials...');
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      }
    }
    
    console.log('[FIREBASE] Admin SDK initialized successfully');
  } catch (error) {
    console.error('[FIREBASE] Failed to initialize Admin SDK:', error);
    console.log('[FIREBASE] Ensure GOOGLE_APPLICATION_CREDENTIALS is set or service account is provided.');
  }
}

export const auth = admin.auth();
