import type { Request } from 'express';

/** A user as returned to the client (never includes the password hash). */
export interface PublicUser {
  id: string;
  email: string;
  display_name: string;
  avatar_color: string;
  created_at: number;
  last_seen_at: number | null;
}

/** Full user row as stored in the DB. */
export interface UserRow extends PublicUser {
  password_hash: string;
}

export interface SessionRow {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface ChannelRow {
  id: string;
  name: string;
  is_direct: number;
  created_by: string | null;
  created_at: number;
}

export interface MessageRow {
  id: string;
  channel_id: string;
  user_id: string;
  body: string;
  created_at: number;
  edited_at: number | null;
  deleted_at: number | null;
}

/** Express request augmented by the `requireAuth` middleware. */
export interface AuthedRequest extends Request {
  user?: PublicUser;
  sessionToken?: string;
}
