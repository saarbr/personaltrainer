'use strict';
const { randomUUID } = require('node:crypto');
class Problem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new Problem(status, message); };
const POLICY = Object.freeze({
  'memory.list': 'read', 'context.read': 'read', 'proposal.list': 'read',
  'memory.create': 'approval', 'memory.update': 'approval', 'memory.delete': 'approval'
});
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail(400, 'בקשה לא תקינה.');
}
function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) fail(400, 'מזהה לא תקין.');
  return value;
}
function memory(value) {
  exact(value, ['kind', 'content', 'source', 'sensitivity']);
  if (!['goal', 'preference', 'conversation', 'decision'].includes(value.kind) ||
      typeof value.content !== 'string' || !value.content.trim() || value.content.length > 2000 ||
      !['user', 'assistant_inference'].includes(value.source) ||
      !['personal', 'sensitive'].includes(value.sensitivity)) fail(400, 'זיכרון לא תקין.');
  // A source label is provenance, never a permission or an instruction to execute.
  return { kind: value.kind, content: value.content.trim(), source: value.source, sensitivity: value.sensitivity };
}
function mutation(action, value) {
  if (POLICY[action] !== 'approval') fail(403, 'הפעולה אינה נתמכת.');
  exact(value, action === 'memory.create' ? ['memory'] : action === 'memory.update' ? ['id', 'version', 'memory'] : ['id', 'version']);
  const result = {};
  if (action !== 'memory.create') {
    result.id = id(value.id);
    if (!Number.isSafeInteger(value.version) || value.version < 1) fail(400, 'גרסה לא תקינה.');
    result.version = value.version;
  }
  if (action !== 'memory.delete') result.memory = memory(value.memory);
  return result;
}
function page(value) {
  exact(value, ['limit', 'after']);
  const limit = value.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(400, 'גודל עמוד לא תקין.');
  return { limit, after: value.after === undefined ? null : id(value.after) };
}
function createService(store, { now = Date.now, uuid = randomUUID } = {}) {
  const base = uid => `jarvisUsers/${id(uid)}`;
  return {
    async read(uid, action, payload = {}) {
      const root = base(uid);
      if (POLICY[action] !== 'read') fail(403, 'נדרש אישור לשינוי נתונים.');
      if (action === 'memory.list' || action === 'proposal.list') {
        const { limit, after } = page(payload);
        let rows = await store.list(`${root}/${action === 'memory.list' ? 'memories' : 'proposals'}`, limit, after);
        if (action === 'proposal.list') rows = rows.map(row => {
          if (row.state !== 'pending' || row.expiresAt > now()) return row;
          // Reads remain read-only and never return expired personal payloads.
          const { payload, before, ...metadata } = row;
          return { ...metadata, state: 'expired' };
        });
        return { items: rows, next: rows.length === limit ? rows.at(-1).id : null };
      }
      exact(payload, ['sections']);
      const allowed = ['goals', 'tasks', 'user_plan'];
      if (!Array.isArray(payload.sections) || !payload.sections.length || payload.sections.length > 3 || payload.sections.some(s => !allowed.includes(s))) fail(400, 'תחומי מידע לא תקינים.');
      const data = await store.get(`users/${uid}`) || {};
      const context = Object.fromEntries(payload.sections.map(k => [k, data[k] ?? null]));
      if (Buffer.byteLength(JSON.stringify(context)) > 64000) fail(413, 'המידע גדול מדי. יש לבחור תחום מצומצם יותר.');
      return { context, trust: 'untrusted_data', fetchedAt: now() };
    },
    async propose(uid, action, payload) {
      const root = base(uid), normalized = mutation(action, payload), time = now();
      const proposal = { id: uuid(), schemaVersion: 1, uid, action, payload: normalized,
        targetId: action === 'memory.create' ? uuid() : normalized.id,
        state: 'pending', createdAt: time, expiresAt: time + 10 * 60000 };
      await store.transaction(async tx => {
        const quotaPath = `${root}/internal/proposalQuota`;
        const quota = await tx.get(quotaPath);
        const count = quota?.until > time ? quota.count : 0;
        if (count >= 30) fail(429, 'הגעת למגבלת הבקשות. נסה שוב בעוד שעה.');
        if (action !== 'memory.create') {
          const before = await tx.get(`${root}/memories/${normalized.id}`);
          if (!before || before.version !== normalized.version) fail(409, 'הזיכרון השתנה. יש לרענן את הרשימה.');
          proposal.before = before;
        }
        // Spark-compatible retention housekeeping, only during an already
        // requested proposal write. Never on autonomous reads, never memories.
        // Query and deletes share the proposal transaction so a failed cleanup
        // cannot leave a newly created proposal behind with an error response.
        const expired = await tx.expired(`${root}/proposals`, time, 10);
        for (const row of expired) {
          if (row.uid === uid && Number.isFinite(row.expiresAt) && row.expiresAt <= time) {
            tx.delete(`${root}/proposals/${id(row.id)}`);
          }
        }
        tx.set(`${root}/proposals/${proposal.id}`, proposal);
        tx.set(quotaPath, { count: count + 1, until: quota?.until > time ? quota.until : time + 3600000 });
      });
      return { proposal };
    },
    async decide(uid, proposalId, decision, actor) {
      const root = base(uid); id(proposalId);
      if (actor !== 'human' || !['confirm', 'reject'].includes(decision)) fail(403, 'נדרש אישור משתמש.');
      // Execution, consumption and metadata-only audit commit atomically. Retried
      // transactions cannot replay an approved operation or call an external API.
      return store.transaction(async tx => {
        const proposalPath = `${root}/proposals/${proposalId}`;
        const proposal = await tx.get(proposalPath);
        if (!proposal || proposal.uid !== uid) fail(404, 'הבקשה לא נמצאה.');
        if (proposal.state !== 'pending' || proposal.expiresAt <= now()) fail(409, 'הבקשה טופלה או פגה.');
        const normalized = mutation(proposal.action, proposal.payload);
        const target = `${root}/memories/${id(proposal.targetId)}`;
        const existing = decision === 'confirm' ? await tx.get(target) : null;
        const time = now();
        if (decision === 'confirm') {
          if (proposal.action === 'memory.create' && existing) fail(409, 'הזיכרון כבר קיים.');
          if (proposal.action !== 'memory.create' && (!existing || existing.version !== normalized.version)) fail(409, 'הזיכרון השתנה. יש להכין בקשה חדשה.');
          if (proposal.action === 'memory.delete') tx.delete(target);
          else tx.set(target, { ...normalized.memory, id: proposal.targetId, schemaVersion: 1,
            version: (existing?.version || 0) + 1, createdAt: existing?.createdAt ?? time, updatedAt: time });
        }
        const state = decision === 'confirm' ? 'executed' : 'rejected';
        // Do not retain deleted/edited content in proposals or audit documents.
        tx.set(proposalPath, { id: proposalId, uid, schemaVersion: 1, action: proposal.action,
          targetId: proposal.targetId, state, createdAt: proposal.createdAt, expiresAt: proposal.expiresAt, decidedAt: time });
        tx.set(`${root}/audit/${proposalId}`, { schemaVersion: 1, action: proposal.action, targetId: proposal.targetId, state, at: time });
        return { state, targetId: proposal.targetId };
      });
    }
  };
}
module.exports = { POLICY, Problem, exact, id, createService };
