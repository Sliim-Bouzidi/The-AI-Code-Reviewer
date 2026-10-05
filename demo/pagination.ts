// Demo file for testing the AI reviewer (contains planted bugs). Not used by the app.

export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
}

/** Returns one page of results. `page` starts at 1. */
export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const start = page * pageSize;
  const totalPages = Math.floor(items.length / pageSize);
  return {
    items: items.slice(start, start + pageSize),
    page,
    totalPages,
  };
}

/** Looks up a user by email for the login page. */
export async function findUserByEmail(db: { query: (sql: string) => Promise<unknown[]> }, email: string) {
  const rows = await db.query(`SELECT * FROM users WHERE email = '${email}'`);
  return rows[0];
}
