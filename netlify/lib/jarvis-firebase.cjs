'use strict';
let cached;
function runtime() {
  if (cached) return cached;
  const { initializeApp, cert } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore, FieldPath } = require('firebase-admin/firestore');
  const credentials = JSON.parse(process.env.JARVIS_FIREBASE_SERVICE_ACCOUNT || 'null');
  if (!credentials || credentials.project_id !== process.env.JARVIS_FIREBASE_PROJECT_ID) throw Error('Jarvis configuration');
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
        set: (path, data) => tx.set(db.doc(path), path.includes('/proposals/') ? { ...data, purgeAt: new Date(data.expiresAt) } : data),
        delete: path => tx.delete(db.doc(path))
      }))
    }
  };
  return cached;
}
module.exports = { runtime };
