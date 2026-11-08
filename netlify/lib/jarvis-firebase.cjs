'use strict';
let cached;
function runtime() {
  if (cached) return cached;
  const { readConfiguration } = require('./jarvis-diagnostics.cjs');
  const credentials = readConfiguration(process.env);
  const { initializeApp, cert } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore, FieldPath } = require('firebase-admin/firestore');
  const app = initializeApp({ credential: cert(credentials), projectId: credentials.project_id }, 'jarvis');
  const db = getFirestore(app);
  cached = {
    verify: token => getAuth(app).verifyIdToken(token, true),
    store: {
      async get(path) { const s = await db.doc(path).get(); return s.exists ? s.data() : null; },
      async list(path, limit, after) {
        let q = db.collection(path).orderBy(FieldPath.documentId()).limit(limit);
        if (after) q = q.startAfter(after);
        return (await q.get()).docs.map(d => { const { purgeAt, ...data } = d.data(); return { ...data, id: d.id }; });
      },
      transaction: fn => db.runTransaction(tx => fn({
        async get(path) { const s = await tx.get(db.doc(path)); return s.exists ? s.data() : null; },
        async expired(path, cutoff, limit) {
          const query = db.collection(path).where('expiresAt', '<=', cutoff).orderBy('expiresAt').limit(limit);
          return (await tx.get(query)).docs.map(doc => ({ ...doc.data(), id: doc.id }));
        },
        set: (path, data) => tx.set(db.doc(path), data),
        delete: path => tx.delete(db.doc(path))
      }))
    }
  };
  return cached;
}
module.exports = { runtime };
