/* Jarvis foundation: no model, microphone, background ingestion or local storage. */
(() => {
  'use strict';
  let user = null, generation = 0, dialog = null, returnFocus = null;
  const kinds = { goal: 'מטרה', preference: 'העדפה', conversation: 'סיכום שיחה', decision: 'החלטה' };
  const actions = { 'memory.create': 'שמירת זיכרון', 'memory.update': 'עריכת זיכרון', 'memory.delete': 'מחיקת זיכרון' };
  function el(tag, text, parent) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  function button(label, parent, handler) {
    const b = el('button', label, parent); b.type = 'button'; b.className = 'btn';
    b.addEventListener('click', () => run(handler)); return b;
  }
  function clear() {
    generation++;
    if (dialog) dialog.remove();
    dialog = null;
  }
  async function api(body) {
    const owner = user, version = generation;
    if (!owner) throw Error('יש להיכנס לחשבון.');
    const token = await owner.getIdToken();
    if (owner !== user || version !== generation) return null;
    const response = await fetch('/.netlify/functions/jarvis', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (owner !== user || version !== generation) return null;
    if (!response.ok) throw Error(data.error || 'לא ניתן להשלים את הבקשה.');
    return data;
  }
  async function run(fn) {
    const panel = dialog, version = generation;
    if (!panel || panel.dataset.busy === 'true') return;
    panel.dataset.busy = 'true';
    panel.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try { await fn(); }
    catch (error) {
      if (version === generation && dialog === panel) panel.querySelector('[role="status"]').textContent = error.message;
    } finally {
      if (dialog === panel) { panel.dataset.busy = 'false'; panel.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
    }
  }
  function content() {
    const host = dialog.querySelector('[data-content]'); host.replaceChildren();
    dialog.querySelector('[role="status"]').textContent = ''; return host;
  }
  function details(item, host) {
    el('p', kinds[item.kind] || item.kind, host);
    const p = el('p', item.content, host); p.style.whiteSpace = 'pre-wrap';
    el('small', (item.source === 'assistant_inference' ? 'מסקנת עוזר — דורשת אימות' : 'מידע שנמסר על ידך') +
      (item.sensitivity === 'sensitive' ? ' · מידע רגיש' : ''), host);
  }
  async function review(proposal) {
    const host = content();
    el('h3', actions[proposal.action], host);
    el('p', 'הבקשה תקפה לעשר דקות. הנתונים ישתנו רק לאחר לחיצה על אישור.', host);
    if (proposal.before) { el('h4', 'לפני השינוי', host); details(proposal.before, host); }
    if (proposal.payload.memory) { el('h4', 'הזיכרון המוצע', host); details(proposal.payload.memory, host); }
    button('אישור ' + actions[proposal.action], host, async () => {
      const result = await api({ operation: 'confirm', proposalId: proposal.id });
      if (result) await list();
    }).classList.add('btn-p');
    button('דחיית הבקשה', host, async () => {
      const result = await api({ operation: 'reject', proposalId: proposal.id }); if (result) await list();
    });
    button('חזרה בלי לבצע', host, list);
  }
  async function propose(action, payload) {
    const result = await api({ operation: 'propose', action, payload });
    if (result) await review(result.proposal);
  }
  function edit(item) {
    const host = content(), form = el('form', undefined, host);
    const label = el('label', 'תוכן הזיכרון', form), text = el('textarea', undefined, label);
    text.className = 'inp'; text.maxLength = 2000; text.required = true; text.value = item?.content || '';
    const choose = (name, options, selected) => {
      const label = el('label', name, form), select = el('select', undefined, label); select.className = 'inp';
      Object.entries(options).forEach(([value, title]) => { const o = el('option', title, select); o.value = value; });
      select.value = selected; return select;
    };
    const kind = choose('סוג הזיכרון', kinds, item?.kind || 'preference');
    const source = choose('מקור', { user: 'מידע שמסרתי', assistant_inference: 'מסקנת עוזר — דורשת אימות' }, item?.source || 'user');
    const sensitivity = choose('רגישות', { personal: 'אישי', sensitive: 'רגיש' }, item?.sensitivity || 'personal');
    el('p', 'אין לשמור סיסמאות או מפתחות גישה. לא נשמרת היסטוריית שיחות אוטומטית.', form);
    const submit = el('button', 'הכנת בקשה לאישור', form); submit.type = 'submit'; submit.className = 'btn btn-p';
    form.addEventListener('submit', event => { event.preventDefault(); run(() => propose(item ? 'memory.update' : 'memory.create', {
      ...(item ? { id: item.id, version: item.version } : {}),
      memory: { kind: kind.value, content: text.value, source: source.value, sensitivity: sensitivity.value }
    })); });
    button('חזרה', host, list); text.focus();
  }
  async function list(after) {
    const result = await api({ operation: 'read', action: 'memory.list', payload: { limit: 20, ...(typeof after === 'string' ? { after } : {}) } });
    if (!result) return;
    const host = content();
    el('p', 'קריאה היא אוטומטית. כל שמירה, עריכה ומחיקה מחייבת אישור. שיחה קולית תתווסף בהמשך.', host);
    button('זיכרון חדש', host, () => edit());
    button('בקשות לאישור', host, () => proposals());
    if (!result.items.length) el('p', 'אין זיכרונות בעמוד הזה.', host);
    result.items.forEach(item => {
      const card = el('article', undefined, host); card.className = 'card'; details(item, card);
      button('עריכה', card, () => edit(item));
      button('בקשת מחיקה', card, () => propose('memory.delete', { id: item.id, version: item.version }));
    });
    if (result.next) button('לעמוד הבא', host, () => list(result.next));
    if (after) button('לעמוד הראשון', host, () => list());
  }
  async function proposals(after) {
    const result = await api({ operation: 'read', action: 'proposal.list', payload: { limit: 20, ...(after ? { after } : {}) } });
    if (!result) return;
    const host = content(); el('h3', 'בקשות לאישור', host);
    result.items.filter(p => p.state === 'pending' && p.expiresAt > Date.now()).forEach(p => button(actions[p.action], host, () => review(p)));
    if (result.next) button('לעמוד הבא', host, () => proposals(result.next));
    button('חזרה לזיכרונות', host, list);
  }
  window.openJarvisMemory = () => {
    clear(); returnFocus = document.activeElement;
    dialog = el('dialog'); dialog.dir = 'rtl'; dialog.setAttribute('aria-labelledby', 'jarvis-title');
    dialog.style.cssText = 'margin:auto;width:min(94vw,640px);max-height:85vh;overflow:auto;background:var(--bg);color:var(--text);border:1px solid var(--border2);border-radius:12px;padding:20px';
    const title = el('h2', 'Jarvis — זיכרון והרשאות', dialog); title.id = 'jarvis-title';
    button('סגירה', dialog, () => { clear(); returnFocus?.focus(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); clear(); returnFocus?.focus(); });
    const status = el('p', '', dialog); status.setAttribute('role', 'status');
    const host = el('div', undefined, dialog); host.dataset.content = '';
    document.body.appendChild(dialog); dialog.showModal(); run(list);
  };
  auth.onAuthStateChanged(next => { clear(); user = next; });
})();
