'use strict';
const { createService, Problem, exact } = require('../lib/jarvis-policy.cjs');
const { diagnostic } = require('../lib/jarvis-diagnostics.cjs');
const ORIGIN = 'https://pesonaltraine.netlify.app';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
function createHandler({ runtime = () => require('../lib/jarvis-firebase.cjs').runtime(), env = process.env } = {}) {
  return async event => {
    if (event.httpMethod !== 'POST') return reply(405, { error: 'השיטה אינה נתמכת.' });
    const h = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    // Same-origin human API. No wildcard CORS and no model/provider tokens.
    // An explicit per-context setting selects ONE origin, never a wildcard.
    // Preview settings belong in Netlify's Deploy Previews context only.
    const origin = env.JARVIS_ALLOWED_ORIGIN ?? ORIGIN;
    const validOrigin = origin === ORIGIN || /^https:\/\/deploy-preview-[1-9]\d*--pesonaltraine\.netlify\.app$/.test(origin);
    if (!validOrigin || h.origin !== origin || h['content-type']?.split(';')[0].trim() !== 'application/json') return reply(403, { error: 'מקור הבקשה אינו מורשה.' });
    if (env.JARVIS_ENABLED !== 'true' || env.JARVIS_RULES_VERSION !== '1') return reply(503, { error: 'Jarvis עדיין לא הופעל בשרת.' });
    if (!/^Bearer \S+$/.test(h.authorization || '')) return reply(401, { error: 'נדרשת כניסה לחשבון.' });
    if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 8192) return reply(413, { error: 'בקשה גדולה מדי.' });
    let stage = 'runtime';
    try {
      const { verify, store } = runtime();
      let user;
      try { user = await verify(h.authorization.slice(7)); } catch (error) {
        if (['auth/insufficient-permission', 'app/invalid-credential', 'auth/invalid-credential', 'auth/invalid-certificate', 'auth/project-not-found'].includes(error?.code)) return reply(503, diagnostic(error, 'auth'));
        return reply(401, { error: 'יש להיכנס שוב לחשבון.' });
      }
      if (!user?.uid) return reply(401, { error: 'נדרשת כניסה לחשבון.' });
      let body; try { body = JSON.parse(event.body); } catch { throw new Problem(400, 'JSON לא תקין.'); }
      exact(body, ['operation', 'action', 'payload', 'proposalId']);
      const service = createService(store);
      stage = 'storage';
      switch (body.operation) {
        case 'read':
          exact(body, ['operation', 'action', 'payload']);
          return reply(200, await service.read(user.uid, body.action, body.payload));
        case 'propose':
          exact(body, ['operation', 'action', 'payload']);
          return reply(201, await service.propose(user.uid, body.action, body.payload));
        case 'confirm': case 'reject':
          exact(body, ['operation', 'proposalId']);
          return reply(200, await service.decide(user.uid, body.proposalId, body.operation, 'human'));
        default: throw new Problem(403, 'הפעולה אינה נתמכת.');
      }
    } catch (error) {
      return error instanceof Problem ? reply(error.status, { error: error.message }) : reply(503, diagnostic(error, stage));
    }
  };
}
exports.createHandler = createHandler;
exports.handler = createHandler();
