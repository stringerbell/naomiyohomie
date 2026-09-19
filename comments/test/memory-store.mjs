// In-memory twin of src/store.js for unit tests.

export function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async insert(c) {
      rows.set(c.id, {
        id: c.id, page: c.page, name: c.name, message: c.message, status: 'pending', reply: '',
        ip_hash: c.ipHash, created_at: c.createdAt, decided_at: null,
      });
    },
    async get(id) { return rows.has(id) ? { ...rows.get(id) } : null; },
    async listApproved(page) {
      return [...rows.values()]
        .filter((r) => r.page === page && r.status === 'approved')
        .sort((a, b) => b.created_at - a.created_at)
        .map((r) => ({ ...r }));
    },
    async countSince(since, ipHash = null) {
      return [...rows.values()].filter((r) => r.created_at >= since && (!ipHash || r.ip_hash === ipHash)).length;
    },
    async decide(id, status, reply, at) {
      Object.assign(rows.get(id), { status, reply, decided_at: at });
    },
  };
}
