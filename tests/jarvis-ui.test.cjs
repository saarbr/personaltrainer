const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../jarvis-memory.js'), 'utf8');
function setup(fetch) {
  const dom = new JSDOM('<button id="opener">Jarvis</button>', { runScripts: 'outside-only', url: 'https://pesonaltraine.netlify.app' });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  let changed;
  w.auth = { onAuthStateChanged(fn) { changed = fn; } };
  w.AbortSignal = AbortSignal; w.fetch = fetch; w.eval(source);
  const login = uid => changed(uid ? { uid, getIdToken: async () => uid + '-token' } : null);
  login('alice');
  return { dom, w, login };
}
const response = data => ({ ok: true, json: async () => data });
async function settled(w) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setImmediate(r));
    if (w.document.querySelector('dialog')?.dataset.busy === 'false') return;
  }
  throw Error('UI did not settle');
}
function click(w, text) {
  const b = [...w.document.querySelectorAll('button')].find(b => b.textContent === text);
  assert.ok(b, text); b.click();
}
test('setup failures display the safe diagnostic code in the Hebrew status area', async () => {
  const { w, dom } = setup(async () => ({ ok: false, json: async () => ({ error: 'חסרה הגדרת שרת.', code: 'JARVIS_PROJECT_MISSING' }) }));
  try {
    w.openJarvisMemory(); await settled(w);
    assert.equal(w.document.querySelector('[role="status"]').textContent, 'חסרה הגדרת שרת. (JARVIS_PROJECT_MISSING)');
    assert.equal(w.localStorage.length, 0);
  } finally { dom.window.close(); }
});
test('Hebrew memory form previews exact proposal and requires a distinct confirmation', async () => {
  const calls = [], item = { id: 'm1', version: 1, content: '<img src=x onerror=alert(1)>', kind: 'preference', source: 'assistant_inference', sensitivity: 'sensitive' };
  const { w, dom } = setup(async (_, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    assert.equal(options.headers.Authorization, 'Bearer alice-token');
    if (body.operation === 'propose') return response({ proposal: { id: 'p1', action: body.action, payload: body.payload } });
    if (body.operation === 'confirm') return response({ state: 'executed' });
    return response({ items: calls.some(c => c.operation === 'confirm') ? [item] : [], next: null });
  });
  try {
    w.openJarvisMemory(); await settled(w);
    click(w, 'זיכרון חדש'); await settled(w);
    const text = w.document.querySelector('textarea'); text.value = item.content;
    const selects = w.document.querySelectorAll('select'); selects[1].value = 'assistant_inference'; selects[2].value = 'sensitive';
    w.document.querySelector('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await settled(w);
    assert.equal(calls.filter(c => c.operation === 'confirm').length, 0);
    assert.ok(w.document.querySelector('dialog').textContent.includes(item.content));
    assert.equal(w.document.querySelectorAll('img').length, 0);
    assert.ok(w.document.querySelector('dialog').textContent.includes('מסקנת עוזר'));
    click(w, 'אישור שמירת זיכרון'); await settled(w);
    assert.deepEqual(calls.find(c => c.operation === 'confirm'), { operation: 'confirm', proposalId: 'p1' });
    click(w, 'בקשת מחיקה'); await settled(w);
    const last = calls.at(-1); assert.equal(last.action, 'memory.delete'); assert.deepEqual(last.payload, { id: 'm1', version: 1 });
  } finally { dom.window.close(); }
});
test('logout removes private dialog and discards late responses from a previous owner', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { w, dom, login } = setup(async () => pending);
  try {
    w.openJarvisMemory(); await new Promise(r => setImmediate(r));
    login(null); assert.equal(w.document.querySelector('dialog'), null);
    login('bob');
    release(response({ items: [{ content: 'alice private data' }], next: null }));
    await new Promise(r => setImmediate(r));
    assert.ok(!w.document.body.textContent.includes('alice private data'));
    assert.equal(w.localStorage.length, 0);
  } finally { dom.window.close(); }
});
