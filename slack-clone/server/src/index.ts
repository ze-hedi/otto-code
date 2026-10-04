import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { authRouter } from './auth.js';
import './db.js'; // ensure schema + seed run on startup

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'slack-clone-server' });
});

app.use('/api/auth', authRouter);

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`Slack clone server listening on http://localhost:${PORT}`);
});
