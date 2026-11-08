# Persistent Google Calendar connection

The Calendar tab and home daily timeline read calendars and events; no calendar writes are implemented. Persistent authorization uses Google's offline authorization-code flow with PKCE. Refresh and access credentials are encrypted with AES-256-GCM in a Secure, HttpOnly, SameSite=Lax cookie scoped to the calendar function. Each API request also verifies Firebase identity and binds the cookie to that user. Events are not persisted in Firestore. This is on-demand synchronization, not background monitoring.

## One-time production setup

1. In the Google Cloud project used for My Way, enable Google Calendar API. Under Google Auth Platform / Clients create or reuse a **Web application** OAuth client.
2. Add this exact authorized redirect URI:
   `https://pesonaltraine.netlify.app/.netlify/functions/google-calendar?action=callback`
3. Configure consent for `openid`, `email`, and `https://www.googleapis.com/auth/calendar.readonly`. Use the same Google account as My Way sign-in. In external Testing mode Google normally expires refresh authorization after seven days for Calendar scopes. Set the intended publishing status and complete any verification Google requires to avoid that testing limitation; consent can still be revoked or expire under Google's policies.
4. In Netlify environment variables, set these for **Functions**, production context:
   - `GOOGLE_CALENDAR_CLIENT_ID`: OAuth Web client ID.
   - `GOOGLE_CALENDAR_CLIENT_SECRET`: OAuth client secret; mark Secret.
   - `GOOGLE_CALENDAR_COOKIE_KEY`: random 32-byte encryption key as 64 hex characters; mark Secret. Generate locally using `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Do not commit the generated value or place it in a published file.
   - Existing `FIREBASE_API_KEY` must remain configured for verifying the My Way login.
5. Redeploy after setting variables. Open My Way, connect the calendar once and approve Google consent. Later openings use the encrypted cookie and refresh access server-side. Clearing cookies, signing in on another device, changing the encryption key, revoking Google consent or reaching session expiry (up to 180 days) requires reconnecting.

Until server configuration is complete, the existing Firebase popup still works. Its short-lived access token is saved in sessionStorage, bound to the Firebase UID, so reloading the same tab restores access until it expires (about 50 minutes). This fallback does not provide a long-term connection. Disconnect clears local access and, when active, the encrypted server session. Google account consent itself can be revoked in Google account settings.

## Validation

`node --test tests/google-week.test.cjs tests/google-connection.test.cjs`

Tests cover timezone and weekly display behavior, cookie encryption, PKCE/state validation, identity isolation, server-side token refresh, read endpoint restrictions, disconnect, and reload restoration. Live OAuth consent and long-term renewal must also be checked after production configuration; mocked tests cannot establish that those credentials are configured.

Google documentation: https://developers.google.com/identity/protocols/oauth2/web-server and https://developers.google.com/identity/protocols/oauth2#expiration
