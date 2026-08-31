import admin from 'firebase-admin';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    else {
      const serviceAccountPath = path.join(process.cwd(), 'service-account-key.json');
      if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      } else {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      }
    }
  } catch {
    throw new Error('Firebase Admin initialization failed; verify the configured credential source');
  }
}

export const auth = admin.auth();
