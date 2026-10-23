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
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/credyazh';

try {
  await mongoose.connect(mongoUri);
  const maskedUri = mongoUri.replace(/:([^:@]+)@/, ':****@');
  console.log(`Connected to MongoDB: ${maskedUri}`);
} catch (err) {
  console.error(`Error connecting to MongoDB (${err.message}). Check your MONGODB_URI in server/.env`);
  process.exit(1);
}

await LedgerEvent.syncIndexes(); // make sure the idempotency and single-reversal indexes exist
app.listen(port, () => console.log(`CredYazh API on http://localhost:${port}`));
