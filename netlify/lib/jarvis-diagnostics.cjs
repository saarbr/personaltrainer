'use strict';
const { createPrivateKey } = require('node:crypto');
const messages = Object.freeze({
  JARVIS_PROJECT_MISSING: 'חסר בשרת המשתנה JARVIS_FIREBASE_PROJECT_ID עבור תצוגת הניסיון.',
  JARVIS_ACCOUNT_MISSING: 'חסר בשרת המשתנה הסודי JARVIS_FIREBASE_SERVICE_ACCOUNT עבור תצוגת הניסיון.',
  JARVIS_ACCOUNT_JSON: 'הגדרת חשבון השירות אינה JSON תקין. יש להדביק ב־Netlify את הקובץ המלא ללא שינוי.',
  JARVIS_PROJECT_MISMATCH: 'מזהה הפרויקט ב־Netlify אינו תואם לפרויקט שבקובץ חשבון השירות.',
  JARVIS_ACCOUNT_INVALID: 'קובץ חשבון השירות חסר או לא תקין. יש לבדוק את ההגדרה הסודית ב־Netlify.',
  JARVIS_SERVER_DEPENDENCY: 'רכיב Firebase חסר בפריסת השרת. נדרש תיקון של הפריסה.',
  JARVIS_AUTH_PERMISSION: 'לחשבון השירות חסרה הרשאת בדיקת משתמשים. יש לבדוק Firebase Authentication Viewer.',
  JARVIS_SERVER_CREDENTIAL: 'השרת לא הצליח להזדהות מול Firebase. יש לבדוק את חשבון השירות והמפתח ב־Netlify.',
  JARVIS_DB_PERMISSION: 'לחשבון השירות חסרה גישה למסד. יש לבדוק את תפקיד Cloud Datastore User בפרויקט הנכון.',
  JARVIS_DB_QUOTA: 'Firestore דיווח על מגבלת משאבים או מכסה. יש לבדוק שימוש ולהמתין לפני ניסיון נוסף.',
  JARVIS_DB_UNAVAILABLE: 'החיבור למסד אינו זמין כרגע. יש לנסות שוב מאוחר יותר.',
  JARVIS_SERVER_ERROR: 'Jarvis אינו זמין כרגע. יש להעביר לתמיכה את קוד התקלה בלבד.'
});
class SetupError extends Error {
  constructor(code) { super(messages[code]); this.code = code; }
}
function readConfiguration(env) {
  if (!env.JARVIS_FIREBASE_PROJECT_ID) throw new SetupError('JARVIS_PROJECT_MISSING');
  if (!env.JARVIS_FIREBASE_SERVICE_ACCOUNT) throw new SetupError('JARVIS_ACCOUNT_MISSING');
  let credentials;
  try { credentials = JSON.parse(env.JARVIS_FIREBASE_SERVICE_ACCOUNT); }
  catch { throw new SetupError('JARVIS_ACCOUNT_JSON'); }
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) ||
      typeof credentials.project_id !== 'string' || typeof credentials.client_email !== 'string' ||
      !/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(credentials.client_email) ||
      typeof credentials.private_key !== 'string') throw new SetupError('JARVIS_ACCOUNT_INVALID');
  if (credentials.project_id !== env.JARVIS_FIREBASE_PROJECT_ID) throw new SetupError('JARVIS_PROJECT_MISMATCH');
  try {
    if (createPrivateKey(credentials.private_key).asymmetricKeyType !== 'rsa') throw Error('Invalid key type');
  } catch { throw new SetupError('JARVIS_ACCOUNT_INVALID'); }
  return credentials;
}
function diagnostic(error, stage) {
  let code = 'JARVIS_SERVER_ERROR';
  if (error instanceof SetupError && Object.hasOwn(messages, error.code)) code = error.code;
  else if (stage === 'runtime' && error?.code === 'MODULE_NOT_FOUND') code = 'JARVIS_SERVER_DEPENDENCY';
  else if (error?.code === 'auth/insufficient-permission') code = 'JARVIS_AUTH_PERMISSION';
  else if (['app/invalid-credential', 'auth/invalid-credential', 'auth/invalid-certificate', 'auth/project-not-found'].includes(error?.code)) code = 'JARVIS_SERVER_CREDENTIAL';
  else if (stage === 'storage' && [7, 'PERMISSION_DENIED'].includes(error?.code)) code = 'JARVIS_DB_PERMISSION';
  else if (stage === 'storage' && [8, 'RESOURCE_EXHAUSTED'].includes(error?.code)) code = 'JARVIS_DB_QUOTA';
  else if (stage === 'storage' && [4, 14, 'DEADLINE_EXCEEDED', 'UNAVAILABLE'].includes(error?.code)) code = 'JARVIS_DB_UNAVAILABLE';
  // Only fixed allowlisted messages/codes: never serialize error.message,
  // stack, provider details, credentials, account identifiers or token data.
  return { error: messages[code], code };
}
module.exports = { SetupError, readConfiguration, diagnostic };
