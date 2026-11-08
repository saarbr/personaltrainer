const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createService, POLICY } = require('../netlify/lib/jarvis-policy.cjs');
const { createHandler } = require('../netlify/functions/jarvis');
// Serialized copy-on-commit store models all-or-nothing transactions and racing
// confirmations. The separate emulator suite tests real Firestore access rules.
function setup() {
  let rows = new Map(), queue = Promise.resolve(), time = 10000, n = 0;
  const clone = value => value === undefined ? null : structuredClone(value);
  const store = {
    get: async path => clone(rows.get(path)),
    list: async (path, limit, after) => [...rows].filter(([key]) => key.startsWith(path + '/') && (!after || key.split('/').at(-1) > after)).sort().slice(0, limit).map(([, value]) => clone(value)),
    transaction(fn) {
      const result = queue.then(async () => {
        const pending = new Map([...rows].map(([k, v]) => [k, clone(v)]));
        const result = await fn({ get: async key => clone(pending.get(key)), set: (key, value) => pending.set(key, clone(value)), delete: key => pending.delete(key) });
        rows = pending; return result;
      });
      queue = result.catch(() => {}); return result;
    }
  };
  return { store, service: createService(store, { now: () => time, uuid: () => `id-${String(++n).padStart(4, '0')}` }),
    tick: delta => { time += delta; }, rows: () => rows };
}
const memory = { kind: 'preference', content: 'אני מעדיף אימון בבוקר', source: 'user', sensitivity: 'personal' };
const rejects = (fn, status) => assert.rejects(fn, e => e.status === status);

test('read allowlist cannot mutate or ingest memory automatically', async () => {
  const { service, rows } = setup();
  assert.deepEqual((await service.read('alice', 'memory.list')).items, []);
  assert.equal(rows().size, 0);
  for (const action of ['memory.create', 'calendar.write', 'task.complete', 'send.message', 'openai.call', '__proto__']) await rejects(() => service.read('alice', action), 403);
  assert.equal(POLICY['memory.create'], 'approval');
  await rejects(() => service.read('alice', 'context.read', { sections: ['tokens'] }), 400);
});

test('owner-scoped proposals require separate confirmation; model cannot approve', async () => {
  const { service, store } = setup();
  const { proposal: p } = await service.propose('alice', 'memory.create', { memory });
  assert.equal((await service.read('alice', 'memory.list')).items.length, 0);
  await rejects(() => service.decide('bob', p.id, 'confirm', 'human'), 404);
  await rejects(() => service.decide('alice', p.id, 'confirm', 'agent'), 403);
  await rejects(() => service.decide('alice', p.id, 'confirm'), 403);
  await service.decide('alice', p.id, 'confirm', 'human');
  const saved = await store.get(`jarvisUsers/alice/memories/${p.targetId}`);
  assert.equal(saved.version, 1); assert.equal(saved.content, memory.content);
  assert.equal((await service.read('bob', 'memory.list')).items.length, 0);
  const audit = await store.get(`jarvisUsers/alice/audit/${p.id}`);
  assert.ok(!JSON.stringify(audit).includes(memory.content));
  assert.ok(!(await store.get(`jarvisUsers/alice/proposals/${p.id}`)).payload);
});

test('expiry, rejection and concurrent confirmation never execute twice', async () => {
  const { service, tick } = setup();
  let p = (await service.propose('alice', 'memory.create', { memory })).proposal;
  tick(600000); await rejects(() => service.decide('alice', p.id, 'confirm', 'human'), 409);
  p = (await service.propose('alice', 'memory.create', { memory })).proposal;
  await service.decide('alice', p.id, 'reject', 'human');
  await rejects(() => service.decide('alice', p.id, 'confirm', 'human'), 409);
  p = (await service.propose('alice', 'memory.create', { memory })).proposal;
  const attempts = await Promise.allSettled([1, 2].map(() => service.decide('alice', p.id, 'confirm', 'human')));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await service.read('alice', 'memory.list')).items.length, 1);
});

test('update/delete bind exact server payload and version; stale proposal stays pending', async () => {
  const { service, store } = setup();
  const p = (await service.propose('alice', 'memory.create', { memory })).proposal;
  await service.decide('alice', p.id, 'confirm', 'human');
  const first = (await service.propose('alice', 'memory.update', { id: p.targetId, version: 1, memory: { ...memory, content: 'ערב' } })).proposal;
  const stale = (await service.propose('alice', 'memory.delete', { id: p.targetId, version: 1 })).proposal;
  assert.equal(stale.before.content, memory.content);
  await service.decide('alice', first.id, 'confirm', 'human');
  await rejects(() => service.decide('alice', stale.id, 'confirm', 'human'), 409);
  assert.equal((await store.get(`jarvisUsers/alice/proposals/${stale.id}`)).state, 'pending');
  const del = (await service.propose('alice', 'memory.delete', { id: p.targetId, version: 2 })).proposal;
  await service.decide('alice', del.id, 'confirm', 'human');
  assert.equal((await service.read('alice', 'memory.list')).items.length, 0);
});

test('validation rejects forged flags, paths, versions, oversized memory and unsupported tools', async () => {
  const { service } = setup();
  for (const bad of [{ memory, approved: true }, { memory: { ...memory, role: 'system' } }, { memory: { ...memory, content: 'a'.repeat(2001) } }, { memory: { ...memory, source: 'system' } }]) await rejects(() => service.propose('alice', 'memory.create', bad), 400);
  await rejects(() => service.propose('alice', 'calendar.write', {}), 403);
  await rejects(() => service.propose('alice', 'memory.delete', { id: '../bob', version: 1 }), 400);
  await rejects(() => service.propose('alice', 'memory.delete', { id: 'one', version: -1 }), 400);
  await rejects(() => service.read('alice', 'memory.list', { limit: 51 }), 400);
  await rejects(() => service.read('alice', 'memory.list', { after: 'a/b' }), 400);
});

test('proposal quota is durable, scoped to owner and resets after an hour', async () => {
  const { service, tick } = setup();
  for (let i = 0; i < 30; i++) await service.propose('alice', 'memory.create', { memory });
  await rejects(() => service.propose('alice', 'memory.create', { memory }), 429);
  await service.propose('bob', 'memory.create', { memory });
  tick(3600000); await service.propose('alice', 'memory.create', { memory });
});

test('HTTP gateway fails closed, binds identity and never echoes backend secrets', async () => {
  const { store } = setup(); let calls = 0;
  const env = { JARVIS_ENABLED: 'true', JARVIS_RULES_VERSION: '1' };
  const handler = createHandler({ env, runtime: () => ({ store, verify: async token => { calls++; if (token !== 'valid') throw Error('private-key'); return { uid: 'alice' }; } }) });
  const request = (body, headers = {}) => ({ httpMethod: 'POST', headers: { origin: 'https://pesonaltraine.netlify.app', 'content-type': 'application/json', authorization: 'Bearer valid', ...headers }, body: JSON.stringify(body) });
  const body = { operation: 'read', action: 'memory.list' };
  assert.equal((await handler({ ...request(body), httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await handler(request(body, { origin: 'https://evil.example' }))).statusCode, 403);
  assert.equal((await handler(request(body, { authorization: '' }))).statusCode, 401);
  assert.equal((await handler(request(body, { 'content-type': 'text/plain' }))).statusCode, 403);
  assert.equal(calls, 0);
  assert.equal((await handler(request(body, { authorization: 'Bearer invalid' }))).statusCode, 401);
  assert.equal((await handler(request(body))).statusCode, 200);
  for (const forged of [{ ...body, uid: 'bob' }, { operation: 'confirm', proposalId: 'p', payload: { memory } }, { operation: 'execute', action: 'memory.create', approved: true }]) assert.ok((await handler(request(forged))).statusCode >= 400);
  assert.equal((await handler({ ...request(body), body: 'null' })).statusCode, 400);
  assert.equal((await handler({ ...request(body), body: '{' })).statusCode, 400);
  assert.equal((await handler({ ...request(body), body: 'a'.repeat(8193) })).statusCode, 413);
  env.JARVIS_ENABLED = 'false'; assert.equal((await handler(request(body))).statusCode, 503);
  env.JARVIS_ENABLED = 'true'; delete env.JARVIS_RULES_VERSION; assert.equal((await handler(request(body))).statusCode, 503);
  const broken = createHandler({ env: { JARVIS_ENABLED: 'true', JARVIS_RULES_VERSION: '1' }, runtime: () => { throw Error('private-key'); } });
  const result = await broken(request(body)); assert.equal(result.statusCode, 503); assert.ok(!result.body.includes('private-key'));
});

test('context is read-only, bounded and restricted to explicit existing MyWay fields', async () => {
  const { service, store, rows } = setup();
  await store.transaction(async tx => tx.set('users/alice', { tasks: { t: 'study' }, goals: {}, tokens: 'private' }));
  const before = JSON.stringify([...rows()]);
  const data = await service.read('alice', 'context.read', { sections: ['tasks'] });
  assert.deepEqual(data.context, { tasks: { t: 'study' } });
  assert.ok(!JSON.stringify(data).includes('private')); assert.equal(JSON.stringify([...rows()]), before);
  await store.transaction(async tx => tx.set('users/alice', { tasks: 'a'.repeat(65000) }));
  await rejects(() => service.read('alice', 'context.read', { sections: ['tasks'] }), 413);
});

test('production handler keeps real runtime lazy and requires explicit enablement', async () => {
  const { handler } = require('../netlify/functions/jarvis');
  assert.equal((await handler({ httpMethod: 'POST', headers: { origin: 'https://pesonaltraine.netlify.app', 'content-type': 'application/json' }, body: '{}' })).statusCode, 503);
});

test('preview accepts exactly the configured site origin and fails closed for unsafe settings', async () => {
  const { store } = setup();
  const preview = 'https://deploy-preview-3--pesonaltraine.netlify.app';
  const env = { JARVIS_ENABLED: 'true', JARVIS_RULES_VERSION: '1', JARVIS_ALLOWED_ORIGIN: preview };
  const handler = createHandler({ env, runtime: () => ({ store, verify: async () => ({ uid: 'alice' }) }) });
  const request = origin => ({ httpMethod: 'POST', headers: { origin, 'content-type': 'application/json', authorization: 'Bearer valid' }, body: JSON.stringify({ operation: 'read', action: 'memory.list' }) });
  assert.equal((await handler(request(preview))).statusCode, 200);
  for (const origin of ['https://pesonaltraine.netlify.app', 'https://deploy-preview-4--pesonaltraine.netlify.app', preview + '.evil.example', preview + '/', undefined]) assert.equal((await handler(request(origin))).statusCode, 403);
  for (const unsafe of ['*', 'null', '', 'http://deploy-preview-3--pesonaltraine.netlify.app', 'https://evil.example', preview + '.evil.example']) {
    env.JARVIS_ALLOWED_ORIGIN = unsafe;
    assert.equal((await handler(request(unsafe))).statusCode, 403);
  }
  delete env.JARVIS_ALLOWED_ORIGIN;
  assert.equal((await handler(request(preview))).statusCode, 403);
  assert.equal((await handler(request('https://pesonaltraine.netlify.app'))).statusCode, 200);
});
