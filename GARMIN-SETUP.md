# Garmin personal connection

This owner-only connection uses Garmin's official Personal API. It does not use Performance Signal.

In the existing Netlify site's environment variables, configure:

- `GARMIN_PERSONAL_API_KEY`: the personal key created in Garmin Connect.
- `GARMIN_ALLOWED_UID`: your Firebase Authentication user UID, copied from Firebase Console → Authentication → Users. Other signed-in users are denied.
- `FIREBASE_API_KEY`: the existing My Way Firebase web API key (also used by the analyze function).

Redeploy after setting these variables. Never put the Garmin key in index.html, Firestore, GitHub, a chat, or browser storage. Netlify production functions use site environment variables; a local .env.local file alone does not configure production.

Open My Way, sign in as the allowed user, and open your profile. Choose the Garmin import button. It fetches 50 running activities per page; confirm before adding each page to your history. Repeating an import skips matching Garmin activity IDs. Existing manual entries are not automatically merged; check for those duplicates. Importing does not mark planned sessions complete. RPE and training type are not inferred. The page reports skipped records lacking the distance, provider speed or local date needed by the existing run history.

The Garmin tab also reads daily sleep, HRV, Body Battery, heart rate, daily summary and activities directly from Garmin. It refreshes when opened and on demand, with a date selector and fetch timestamp. Availability depends on provider fields and device recording. Missing values are not zero; per-section errors do not hide successful sections. Wellness responses are memory-only and cleared on authentication changes; they are not written to Firestore or browser storage.

This is on-demand data access, not background monitoring. After a key expires or is revoked, replace the server variable and redeploy. A signed-in live request is still needed to verify actual provider data and field coverage.

References:
- https://developer.garmin.com/gc-developer-program/personal/personal-api/
- https://github.com/garmin/connect-personal-api-python
