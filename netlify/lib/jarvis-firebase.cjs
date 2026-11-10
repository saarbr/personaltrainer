'use strict';
function loadSdk() {
  return { app: require('firebase-admin/app'), auth: require('firebase-admin/auth'), firestore: require('firebase-admin/firestore') };
}
function createRuntime({ env = process.env, sdk = loadSdk } = {}) {
let cached;
return function runtime() {
  if (cached) return cached;
  const { readConfiguration } = require('./jarvis-diagnostics.cjs');
  const credentials = readConfiguration(env);
  const modules = sdk();
  const { initializeApp, getApps, cert } = modules.app;
  const { getAuth } = modules.auth;
  const { getFirestore, FieldPath } = modules.firestore;
  // If Firestore initialization fails, retry using the app already created.
  // Otherwise a duplicate-app error can hide the original startup failure.
  const app = getApps().find(app => app.name === 'jarvis') || initializeApp({ credential: cert(credentials), projectId: credentials.project_id }, 'jarvis');
  if (app.options.projectId !== credentials.project_id) {
    const { SetupError } = require('./jarvis-diagnostics.cjs');
    throw new SetupError('JARVIS_PROJECT_MISMATCH');
  }
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
};
}
module.exports = { createRuntime, runtime: createRuntime() };
