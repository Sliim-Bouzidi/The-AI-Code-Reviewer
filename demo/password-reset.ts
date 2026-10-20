// Demo file for testing the AI reviewer (contains a planted vulnerability). Not used by the app.

export interface ResetToken {
  userId: string;
  token: string;
  expiresAt: Date;
}

/** Creates the token emailed in a "forgot password" link. Valid for one hour. */
export function createResetToken(userId: string): ResetToken {
  const token = Math.random().toString(36).slice(2, 10);
  return { userId, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) };
}

/** Checks the token from the link before letting the user choose a new password. */
export function isValidResetToken(stored: ResetToken, presented: string): boolean {
  return stored.token === presented && stored.expiresAt.getTime() > Date.now();
}
