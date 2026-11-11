# Garmin personal connection

This owner-only connection uses Garmin's official Personal API. It does not use Performance Signal.

In the existing Netlify site's environment variables, configure:

- `GARMIN_PERSONAL_API_KEY`: the personal key created in Garmin Connect.
- `GARMIN_ALLOWED_UID`: your Firebase Authentication user UID, copied from Firebase Console → Authentication → Users. Other signed-in users are denied.
- `FIREBASE_API_KEY`: the existing My Way Firebase web API key (also used by the analyze function).

Redeploy after setting these variables. Never put the Garmin key in index.html, Firestore, GitHub, a chat, or browser storage. Netlify production functions use site environment variables; a local .env.local file alone does not configure production.

My Way fetches the latest 50 running activities on sign-in and periodically while the tab is visible. The profile includes a manual refresh button. Matching Garmin IDs appear once across previously imported runs and the recent feed. The home card uses actual Garmin distance, duration, pace, heart rate and elevation when available. A Garmin run marks a workout complete in the UI when its local date has exactly one planned run. Days with multiple planned runs require manual selection.

The Garmin tab also reads daily sleep, HRV, Body Battery, heart rate, daily summary and activities directly from Garmin. It refreshes when opened and on demand, with a date selector and fetch timestamp. Availability depends on provider fields and device recording. Missing values are not zero; per-section errors do not hide successful sections. Wellness responses are memory-only and cleared on authentication changes; they are not written to Firestore or browser storage.

To enable sync while the app is closed, set `GARMIN_RUN_SYNC_ENABLED=true` for Netlify production Functions. The scheduled function runs every ten minutes and uses the existing server-side Firebase Admin configuration (`JARVIS_FIREBASE_PROJECT_ID` and `JARVIS_FIREBASE_SERVICE_ACCOUNT`) to save the recent feed on the configured owner's user document. It does not require Jarvis itself to be enabled. Keep service-account credentials in Netlify only. Redeploy, run the scheduled function from Netlify's Functions page, and verify the card and completion with a real uploaded run. Deploy Previews require a manual scheduled invocation. A Garmin key that expires or is revoked must be replaced.

References:
- https://developer.garmin.com/gc-developer-program/personal/personal-api/
- https://github.com/garmin/connect-personal-api-python
