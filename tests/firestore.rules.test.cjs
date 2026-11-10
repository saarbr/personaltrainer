const { test } = require('node:test');
const fs = require('node:fs');
test('Firestore rules deny direct Jarvis access and preserve owner-only MyWay saves', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
  const { doc, getDoc, setDoc, deleteDoc, setLogLevel } = require('firebase/firestore');
  setLogLevel('silent');
  const env = await initializeTestEnvironment({ projectId: 'demo-myway', firestore: { rules: fs.readFileSync(require.resolve('../firestore.rules'), 'utf8') } });
  try {
    const alice = env.authenticatedContext('alice').firestore(), bob = env.authenticatedContext('bob').firestore(), guest = env.unauthenticatedContext().firestore();
    await assertSucceeds(setDoc(doc(alice, 'users/alice'), { tasks: [], profile: { name: 'א' } }));
    await assertSucceeds(getDoc(doc(alice, 'users/alice')));
    for (const db of [bob, guest]) { await assertFails(getDoc(doc(db, 'users/alice'))); await assertFails(setDoc(doc(db, 'users/alice'), { profile: {} })); }
    for (const db of [alice, bob, guest]) for (const collection of ['memories', 'proposals', 'audit', 'internal']) {
      const ref = doc(db, `jarvisUsers/alice/${collection}/one`);
      await assertFails(getDoc(ref)); await assertFails(setDoc(ref, { approved: true })); await assertFails(deleteDoc(ref));
    }
    await assertFails(setDoc(doc(alice, 'users/alice/memories/fake'), { approved: true }));
  } finally { await env.cleanup(); }
});
