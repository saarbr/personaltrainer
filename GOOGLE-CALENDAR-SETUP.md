# Google Calendar daily and weekly views

The homepage displays today's events; the Calendar tab displays a selectable full week after the user explicitly connects their Google account. It uses the existing Firebase compat SDK and requests calendar.readonly with reauthenticateWithPopup. No Google API write methods are implemented.

Before live verification:
1. Enable Google Calendar API in the Google Cloud project associated with the existing Firebase Google sign-in provider.
2. Configure the OAuth consent screen for the calendar.readonly scope and the intended test users or release status. Reuse the existing authorized domains; for local testing authorize localhost in Firebase Authentication if not already configured.
3. Use the same Google account as the signed-in My Way user and approve the requested calendar read permission yourself.

Tokens and events remain in browser memory and are cleared on a user change or disconnect. Reloading the page requires connecting again. This implementation does not claim continuous background sync or persistent cross-device Google authorization. Events are not copied to Firestore. Existing application data is unchanged.

The overview defaults to the primary and selected readable calendars, allows changing displayed calendars, follows pagination, expands recurring occurrences, handles all-day exclusive ends and overnight events, and uses Asia/Jerusalem for week bounds and display. Individual source failures are labeled partial. The full-calendar link opens Google Calendar, where the user controls any edits.

Validation: node --test tests/google-week.test.cjs covers time zones, DST, overnight/all-day events, pagination, recurrence query flags, escaping and isolation of today's cache from other weeks. Live OAuth and actual Google data still require the configuration and user consent above. The standalone preview uses explicitly labeled sample events, never production calendar data.
