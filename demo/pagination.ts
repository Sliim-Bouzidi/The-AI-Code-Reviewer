// Demo file for testing the AI reviewer. Not used by the app.

export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
}

/** Returns one page of results. `page` starts at 1. */
export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('pageSize must be a positive integer');
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page)), totalPages);
  const start = (current - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: current,
    totalPages,
  };
}

/** Looks up a user by email for the login page. The email is sent as a query parameter, never spliced into the SQL. */
export async function findUserByEmail(
  db: { query: (sql: string, params: unknown[]) => Promise<unknown[]> },
  email: string,
) {
  const rows = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0];
}
