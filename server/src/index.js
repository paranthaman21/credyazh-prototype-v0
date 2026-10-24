import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { router } from './routes.js';
import { LedgerEvent } from './models.js';

const app = express();
const port = process.env.PORT || 4000;

// Database Connection Helper with caching
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
    console.error(`Error connecting to MongoDB (${err.message}). Check your MONGODB_URI`);
    if (process.env.VERCEL !== '1') {
      process.exit(1);
    }
    throw err;
  }
}

// Top-level connection attempt for serverless & local
try {
  await connectDB();
} catch (err) {
  console.warn('Initial DB connect attempt failed; middleware will retry on request:', err.message);
}

// 1. Core Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 2. Health Check
app.get('/health', (_req, res) => res.json({ ok: true }));

// 3. Ensure DB connection BEFORE any API routes run
app.use(async (_req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ error: 'Database connection failed: ' + err.message });
  }
});

// 4. API Routes
app.use('/api', router);

// 5. Global Error Handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled server error:', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

// 6. Local Server Listener
if (process.env.VERCEL !== '1') {
  app.listen(port, () => console.log(`CredYazh API on http://localhost:${port}`));
}

export default app;
