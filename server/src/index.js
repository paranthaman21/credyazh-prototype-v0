import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { router } from './routes.js';
import { LedgerEvent } from './models.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', router);
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Something went wrong' }); });

const port = process.env.PORT || 4000;
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/credyazh';

let isConnected = false;
async function connectDB() {
  if (mongoose.connection.readyState >= 1) return;
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/credyazh';
  try {
    await mongoose.connect(mongoUri);
    const maskedUri = mongoUri.replace(/:([^:@]+)@/, ':****@');
    console.log(`Connected to MongoDB: ${maskedUri}`);
    if (!isConnected) {
      await LedgerEvent.syncIndexes().catch(() => {});
      isConnected = true;
    }
  } catch (err) {
    console.error(`Error connecting to MongoDB (${err.message}). Check your MONGODB_URI in server/.env`);
    if (process.env.VERCEL !== '1') {
      process.exit(1);
    }
    throw err;
  }
}

// Ensure database connection for all requests
app.use(async (_req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ error: 'Database connection failed: ' + err.message });
  }
});

if (process.env.VERCEL !== '1') {
  await connectDB();
  app.listen(port, () => console.log(`CredYazh API on http://localhost:${port}`));
}

export default app;
