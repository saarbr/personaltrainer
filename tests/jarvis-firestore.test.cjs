const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { createService } = require('../netlify/lib/jarvis-policy.cjs');
test('real Firestore adapter atomically consumes proposals under concurrent confirmation', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  // Fake generated credentials only; emulator uses no production credentials.
  process.env.JARVIS_FIREBASE_PROJECT_ID = 'demo-myway';
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  process.env.JARVIS_FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'demo-myway', client_email: 'test@demo-myway.iam.gserviceaccount.com', private_key: privateKey });
  const { store } = require('../netlify/lib/jarvis-firebase.cjs').runtime();
  const service = createService(store), uid = 'adapter-test';
  const memory = { kind: 'goal', content: 'אימון', source: 'user', sensitivity: 'personal' };
  const { proposal: p } = await service.propose(uid, 'memory.create', { memory });
  assert.equal((await service.read(uid, 'memory.list')).items.length, 0);
  const results = await Promise.allSettled([1, 2].map(() => service.decide(uid, p.id, 'confirm', 'human')));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal((await service.read(uid, 'memory.list')).items[0].content, memory.content);
  const recorded = await store.get(`jarvisUsers/${uid}/proposals/${p.id}`);
  assert.equal(recorded.state, 'executed'); assert.equal(recorded.payload, undefined);
  assert.ok(recorded.purgeAt.toMillis() > 0);
  const { proposal: d } = await service.propose(uid, 'memory.delete', { id: p.targetId, version: 1 });
  await service.decide(uid, d.id, 'confirm', 'human');
  assert.equal((await service.read(uid, 'memory.list')).items.length, 0);
  const { deleteApp, getApps } = require('firebase-admin/app');
  await Promise.all(getApps().map(deleteApp));
});
