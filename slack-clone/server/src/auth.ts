import { Router, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { hashPassword, verifyPassword } from './password.js';
import type { AuthedRequest, PublicUser, SessionRow, UserRow } from './types.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const AVATAR_COLORS = ['#e01e5a', '#2eb67d', '#ecb22e', '#36c5f0', '#611f69', '#e8912d'];

function publicUser(id: string): PublicUser {
  return db
    .prepare(
      'SELECT id, email, display_name, avatar_color, created_at, last_seen_at FROM users WHERE id = ?'
    )
    .get(id) as PublicUser;
}

function createSession(userId: string): string {
  const token = randomUUID();
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    now,
    now + SESSION_TTL_MS
  );
  return token;
}

/** Middleware: resolves the session cookie and attaches `req.user` / `req.sessionToken`. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = req.cookies?.sid as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'not authenticated' });
    return;
  }

  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as
    | SessionRow
    | undefined;

  if (!session) {
    res.status(401).json({ error: 'invalid session' });
    return;
  }
  if (session.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.status(401).json({ error: 'session expired' });
    return;
  }

  const user = db
    .prepare('SELECT id, email, display_name, avatar_color, created_at, last_seen_at FROM users WHERE id = ?')
    .get(session.user_id) as PublicUser | undefined;

  if (!user) {
    res.status(401).json({ error: 'user not found' });
    return;
  }

  req.user = user;
  req.sessionToken = token;
  next();
}

export const authRouter = Router();

authRouter.post('/register', (req: AuthedRequest, res: Response) => {
  const { email, password, displayName } = req.body ?? {};
  if (!email || !password || !displayName) {
    res.status(400).json({ error: 'email, password, and displayName are required' });
    return;
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    res.status(400).json({ error: 'invalid email address' });
    return;
  }
  if (String(password).length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'email already registered' });
    return;
  }

  const id = randomUUID();
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

  db.prepare(
    'INSERT INTO users (id, email, password_hash, display_name, avatar_color, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, normalizedEmail, hashPassword(String(password)), String(displayName).trim(), color, Date.now(), null);

  // Auto-join #general
  const general = db.prepare('SELECT id FROM channels WHERE name = ? AND is_direct = 0').get('general') as
    | { id: string }
    | undefined;
  if (general) {
    db.prepare('INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)').run(
      general.id,
      id,
      Date.now()
    );
  }

  const token = createSession(id);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS });
  res.status(201).json({ user: publicUser(id) });
});

authRouter.post('/login', (req: AuthedRequest, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail) as UserRow | undefined;

  if (!user || !verifyPassword(String(password), user.password_hash)) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const token = createSession(user.id);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS });
  res.json({ user: publicUser(user.id) });
});

authRouter.post('/logout', requireAuth, (req: AuthedRequest, res: Response) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  res.clearCookie('sid');
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user });
});
