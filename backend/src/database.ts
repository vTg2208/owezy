import mongoose from 'mongoose';

export async function initializeDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/tripexpense';
  
  try {
    await mongoose.connect(uri);
    console.log(`[DATABASE] Connected to MongoDB`);
  } catch (error) {
    console.error('[DATABASE] Connection error:', error);
    throw error;
  }
}
