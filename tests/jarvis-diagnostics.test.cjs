const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { readConfiguration, diagnostic, failureRecord } = require('../netlify/lib/jarvis-diagnostics.cjs');
const { createRuntime } = require('../netlify/lib/jarvis-firebase.cjs');
const { createHandler } = require('../netlify/functions/jarvis');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const credentials = { project_id: 'demo-myway', client_email: 'private-account@demo-myway.iam.gserviceaccount.com', private_key: privateKey };
const config = { JARVIS_FIREBASE_PROJECT_ID: 'demo-myway', JARVIS_FIREBASE_SERVICE_ACCOUNT: JSON.stringify(credentials) };
function expected(env, code) {
  assert.throws(() => readConfiguration(env), error => {
    const result = diagnostic(error, 'runtime');
    assert.equal(result.code, code);
    assert.ok(!JSON.stringify(result).includes('private-account'));
    assert.ok(!JSON.stringify(result).includes(privateKey.slice(30, 70)));
    return true;
  });
}
test('configuration diagnostics distinguish missing, malformed and mismatched secrets without exposing them', () => {
  expected({}, 'JARVIS_PROJECT_MISSING');
  expected({ JARVIS_FIREBASE_PROJECT_ID: 'demo-myway' }, 'JARVIS_ACCOUNT_MISSING');
  expected({ ...config, JARVIS_FIREBASE_SERVICE_ACCOUNT: '{secret-broken' }, 'JARVIS_ACCOUNT_JSON');
  expected({ ...config, JARVIS_FIREBASE_SERVICE_ACCOUNT: '"private-account"' }, 'JARVIS_ACCOUNT_INVALID');
  expected({ ...config, JARVIS_FIREBASE_PROJECT_ID: 'different-project' }, 'JARVIS_PROJECT_MISMATCH');
  expected({ ...config, JARVIS_FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ ...credentials, private_key: 'private-key-broken' }) }, 'JARVIS_ACCOUNT_INVALID');
  assert.equal(readConfiguration(config).project_id, 'demo-myway');
});
test('safe HTTP diagnostics identify backend failures without echoing SDK messages or stacks', async () => {
  const event = { httpMethod: 'POST', headers: { origin: 'https://pesonaltraine.netlify.app', 'content-type': 'application/json', authorization: 'Bearer user-secret-token' }, body: JSON.stringify({ operation: 'read', action: 'memory.list' }) };
  const env = { JARVIS_ENABLED: 'true', JARVIS_RULES_VERSION: '1' };
  for (const [errorCode, expectedCode, stage] of [[7, 'JARVIS_DB_PERMISSION', 'storage'], [8, 'JARVIS_DB_QUOTA', 'storage'], [14, 'JARVIS_DB_UNAVAILABLE', 'storage'], ['MODULE_NOT_FOUND', 'JARVIS_SERVER_DEPENDENCY', 'runtime'], ['firestore/missing-dependencies', 'JARVIS_SERVER_DEPENDENCY', 'runtime'], ['firestore/invalid-credential', 'JARVIS_SERVER_CREDENTIAL', 'runtime'], ['untrusted-arbitrary-value', 'JARVIS_SERVER_ERROR', 'storage'], ['auth/insufficient-permission', 'JARVIS_AUTH_PERMISSION', 'auth']]) {
    const error = Object.assign(Error('private-key user-secret-token ' + privateKey), { code: errorCode });
    const handler = createHandler({ env, runtime: () => {
      if (stage === 'runtime') throw error;
      return { verify: async () => { if (stage === 'auth') throw error; return { uid: 'alice' }; }, store: { list: async () => { throw error; } } };
    } });
    const result = await handler(event), data = JSON.parse(result.body);
    assert.equal(result.statusCode, 503); assert.equal(data.code, expectedCode);
    for (const secret of ['private-key', 'user-secret-token', privateKey.slice(30, 70)]) assert.ok(!result.body.includes(secret));
  }
});

test('failure logs contain only fixed categories and a known source location, never raw errors', () => {
  const error = Object.assign(new TypeError('private-token ' + privateKey), { code: 'private-token', extra: credentials });
  error.stack = 'private-token ' + privateKey + '\n at runtime (/var/task/netlify/lib/jarvis-firebase.cjs:24:11)';
  const record = failureRecord(error, 'runtime');
  assert.deepEqual(record, { event: 'jarvis_failure', nodeMajor: Number(process.versions.node.split('.')[0]), stage: 'runtime', code: 'JARVIS_RUNTIME_ERROR', upstream: 'other', type: 'TypeError', location: 'jarvis-firebase.cjs:24:11' });
  assert.ok(!JSON.stringify(record).includes('private-token'));
  assert.ok(!JSON.stringify(record).includes(privateKey.slice(30, 70)));
});

test('failed Firestore startup reuses its existing app instead of hiding the failure with duplicate-app', () => {
  const apps = []; let initialized = 0, firestoreCalls = 0;
  const runtime = createRuntime({ env: config, sdk: () => ({
    app: { getApps: () => apps, cert: value => value,
      initializeApp(options, name) { initialized++; assert.equal(apps.length, 0); const app = { options, name }; apps.push(app); return app; } },
    auth: { getAuth: () => ({ verifyIdToken() {} }) },
    firestore: { FieldPath: {}, getFirestore() { if (++firestoreCalls === 1) throw Object.assign(Error('private-key'), { code: 'firestore/missing-dependencies' }); return {}; } }
  }) });
  assert.throws(runtime, error => diagnostic(error, 'runtime').code === 'JARVIS_SERVER_DEPENDENCY');
  const result = runtime(); assert.ok(result.store);
  assert.equal(runtime(), result); assert.equal(initialized, 1); assert.equal(firestoreCalls, 2);
});
