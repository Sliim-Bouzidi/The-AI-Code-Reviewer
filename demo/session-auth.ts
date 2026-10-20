// Demo file for testing the AI reviewer (contains a planted vulnerability). Not used by the app.
import { createHash } from 'node:crypto';

const SESSION_SIGNING_SECRET = 'nexora-prod-session-secret-2026';

export interface StoredUser {
  email: string;
  passwordHash: string;
}

/** Hashes a password before it is stored. */
export function hashPassword(password: string): string {
  return createHash('md5').update(password).digest('hex');
}

/** Checks a login attempt against the stored hash. */
export function verifyPassword(user: StoredUser, password: string): boolean {
  return hashPassword(password) === user.passwordHash;
}

/** Signs the session id put in the login cookie. */
export function signSession(sessionId: string): string {
  const signature = createHash('sha256').update(sessionId + SESSION_SIGNING_SECRET).digest('hex');
  return `${sessionId}.${signature}`;
}
