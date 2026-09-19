// D1-backed storage. The in-memory twin used by unit tests lives in
// test/memory-store.mjs and must keep the same behaviour.

const MAX_LISTED = 200;

export function d1Store(db) {
  return {
    async insert(c) {
      await db.prepare(
        'INSERT INTO comments (id, page, name, message, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(c.id, c.page, c.name, c.message, c.ipHash, c.createdAt).run();
    },

    async get(id) {
      return db.prepare('SELECT id, page, name, message, status, reply, created_at FROM comments WHERE id = ?')
        .bind(id).first();
    },

    // The status filter here is the quarantine: pending and rejected never leave.
    async listApproved(page) {
      const { results } = await db.prepare(
        `SELECT id, name, message, reply, created_at FROM comments
         WHERE page = ? AND status = 'approved' ORDER BY created_at DESC LIMIT ?`,
      ).bind(page, MAX_LISTED).all();
      return results;
    },

    async countSince(since, ipHash = null) {
      const row = ipHash
        ? await db.prepare('SELECT COUNT(*) AS n FROM comments WHERE created_at >= ? AND ip_hash = ?').bind(since, ipHash).first()
        : await db.prepare('SELECT COUNT(*) AS n FROM comments WHERE created_at >= ?').bind(since).first();
      return row.n;
    },

    async decide(id, status, reply, at) {
      await db.prepare('UPDATE comments SET status = ?, reply = ?, decided_at = ? WHERE id = ?')
        .bind(status, reply, at, id).run();
    },
  };
}
