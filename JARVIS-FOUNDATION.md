# Jarvis בתוך MyWay — בסיס ראשון

## מצב והיקף

אין קריאות OpenAI, מיקרופון, מודל AI, התקנת OpenJarvis או איסוף שיחות ברקע.
השרת כבוי כברירת מחדל. אין לפרוס לאתר החי או לשנות כללי Firebase בלי אישור בעל האתר.
המסך בעברית נפתח מהפרופיל: **Jarvis — זיכרון והרשאות**.

האתר הקיים הוא `index.html` עם Firebase Auth ו־Firestore compat 10.7.1.
השמירות הקיימות מתבצעות במסמך `users/{uid}` עם merge. הפונקציות הקיימות
`analyze` (Anthropic), `garmin` ו־`google-calendar` נשארו ללא שינוי.
Netlify הגיש את תיקיית השורש. כעת `npm run build` מעתיק רק נכסי דפדפן
ל־`dist`, כדי שלא לפרסם תלויות, בדיקות וקוד שרת. הפונקציות עדיין מתוך `netlify/functions`.
במאגר המקורי לא היו כללי Firestore. ב־8 בנובמבר 2026 בעל האתר העביר את הכללים
מהקונסולה: owner read/write על `users/{userId}` בלבד. לפי הקוד שסופק אין allow
על Jarvis או על תתי־אוספים, ולכן הוא תואם להגבלה החדשה. זו סקירה של הטקסט
שנמסר, ולא בדיקה עצמאית של ההגדרות החיות בקונסולה.

## הרשאות וגבולות אמון

| פעולה | הרשאה |
|---|---|
| `memory.list`, `proposal.list` | קריאה עצמאית, בתחום המשתמש המאומת |
| `context.read` | קריאת goals/tasks/user_plan בלבד, בבחירה מפורשת, עד 64KB |
| `memory.create/update/delete` | הצעה → סקירה → אישור נפרד |
| שינוי משימות/יומן/אימונים, שליחה, תשלום, קריאת מודל | חסום בשלב זה |

`POST /.netlify/functions/jarvis` מקבל Bearer Firebase ID token. Firebase Admin
מאמת חתימה, תוקף ופרויקט, ובודק ביטול הרשאה. UID תמיד נגזר מהאסימון; אין שדה UID מהלקוח.
Origin מדויק, JSON בלבד, ללא CORS, וגבול גוף בקשה 8KB. `JARVIS_ALLOWED_ORIGIN`
בוחר כתובת אחת; ברירת המחדל היא האתר החי. ערך חלופי חייב להיות כתובת deploy-preview
של אותו אתר Netlify, ונבדק בהשוואה מלאה ללא wildcard. Origin הוא הגנת דפדפן נוספת;
הוא אינו תחליף לאימות. מוגבל ל־30 הצעות לשעה לכל משתמש באמצעות מונה טרנזקציוני.
קריאה אינה כותבת נתונים ואינה מתקשרת לספק AI. אין מפתחות או אסימונים בתשובות.

האישור הוא קריאה נפרדת עם מזהה הצעה אקראי שנשמר בשרת, בתוקף 10 דקות.
הלקוח אינו יכול לשלוח payload חלופי באישור. עריכה ומחיקה כוללות גרסת זיכרון
ותצוגת "לפני" מהשרת. טרנזקציית Firestore אחת בודקת בעלות/תוקף/מצב/גרסה,
משנה את הזיכרון, צורכת את ההצעה ורושמת audit ללא תוכן אישי. אישור כפול,
מקביל, מאוחר או לגרסה מיושנת נכשל. אין side effects חיצוניים בתוך טרנזקציה.

מסלול HTTP זה מיועד לממשק משתמש מהימן. אימות משתמש אינו הוכחה ללחיצה פיזית:
קוד שרירותי שמחזיק באסימון המשתמש מסוגל לקרוא ל־API בשמו. **אין לתת אסימון
משתמש, service account או פונקציית confirm למודל או ל־OpenJarvis.** חיבור עתידי
דורש זהות סוכן נפרדת, הרשאות קריאה/הצעה בלבד וערוץ אישור אנושי מבודד.
ה־service כבר דוחה `decide` עבור actor שאינו `human`, אך אין כיום endpoint סוכן.
אין לטעון שמנגנון זה מגביל את פעולות המשתמש הידניות או את כל הפונקציות הישנות;
הוא אוכף את פעולות Jarvis החדשות בלבד. תוכן זיכרונות הוא מידע לא מהימן, לא הוראות.

## מודל הנתונים (schemaVersion: 1)

- `jarvisUsers/{uid}/memories/{id}`: `kind` (goal/preference/conversation/decision),
  `content` עד 2000 תווים, `source` (user/assistant_inference),
  `sensitivity` (personal/sensitive), `version`, `createdAt`, `updatedAt` במילישניות.
  מידע שסופק ומסקנת עוזר מוצגים בנפרד; תווית source אינה הוכחה למקור.
- `.../proposals/{id}`: פעולה ומטען מאומת, targetId, בעלים, מצב pending,
  תאריכי יצירה ותפוגה, before לעריכה/מחיקה. לאחר טיפול התוכן ו־before נמחקים.
  `expiresAt` הוא מספר במילישניות ומניע גם ניקוי מוגבל בשרת ללא TTL.
- `.../audit/{proposalId}`: פעולה, targetId, תוצאה וזמן בלבד, בלי תוכן הזיכרון.
- `.../internal/proposalQuota`: מונה הצעות וזמן חידוש המכסה.

זיכרון נשמר עד מחיקה מפורשת, ללא העתק ב־localStorage וללא embeddings.
הפרויקט בתוכנית Spark לפי בעל האתר. אין להפעיל TTL או לשדרג חיוב לצורך שלב זה.
לפני שמירת הצעה חדשה השרת מנקה עד 10 מסמכי הצעות שפג תוקפם, של אותו משתמש
בלבד. השאילתה לפי `expiresAt` והמחיקות נמצאות באותה טרנזקציה עם ההצעה ומכסתה;
אין scheduler, collection-group scan או אינדקס מורכב. רשומות audit וזיכרונות נשארים ללא שינוי.
קריאות אינן מנקות ואינן כותבות, והן מסתירות payload ו־before של בקשות שפגו.
אישור שפג תוקפו חסום גם אם המסמך עוד לא נמחק. ללא בקשות חדשות אין הבטחה
למועד מחיקה מהמסד; backlog מתנקה בהדרגה, עד 10 רשומות בכל בקשה חדשה.
מחיקות רגילות צורכות מכסות Firestore החינמיות; חריגה ממכסת Spark עלולה לחסום
פעולות. זה אינו תחליף למדיניות מחיקה מתוזמנת עם מועד מובטח.
מחיקת זיכרון אינה מוחקת גיבויים; יש לקבוע בנפרד מדיניות שמירה ומחיקת חשבון
לכל תתי־האוספים. גם הצעה אחרת שעדיין ממתינה עשויה להכיל עותק לפני מחיקה עד לניקוי הבא.

## הפעלה מבוקרת — רק לאחר אישור לפריסה

1. `npm ci --ignore-scripts`, `npm test`, `npm run build`, `npm run test:rules` עם Node 24.22.1+ (ענף 24) ו־Java 21+.
   `.nvmrc` ו־CI בוחרים Node 24, בהתאמה לדרישות כלי הבדיקה העדכניים.
2. לבדוק את כללי Firestore הקיימים בקונסולה ולהשוות למשתמשי האתר ולמבנה המאגר.
   הקובץ החדש משמר owner read/write למסמך `users/{uid}` בלבד ודוחה תתי־אוספים
   וגישה לכל יתר האוספים. יש למזג כללי פיצ'רים נוספים אם קיימים מחוץ למאגר.
   כלל allow רחב אחר יעקוף deny, ולכן אין להשאיר wildcard allow על Jarvis.
3. לפרוס את הכללים המאומתים לפרויקט הנכון; אין .firebaserc שמצביע אוטומטית לפרויקט חי.
4. להשאיר את תוכנית Spark ללא TTL. להגדיר service account ייעודי לשרת עם Firebase Auth לקריאת
   סטטוס משתמש ו־Firestore, בלי הרשאות IAM/admin כלליות. Admin עוקף Security Rules,
   ולכן אימות המשתמש ובעלות הנתיב נאכפים גם בפונקציה עצמה.
5. לשמור ב־Netlify Functions בלבד (לא בקוד, בדפדפן, ב־build או בלוגים):
   `JARVIS_FIREBASE_PROJECT_ID`, `JARVIS_FIREBASE_SERVICE_ACCOUNT` (JSON סודי).
   אין לשמור קובץ service account בתיקייה המוגשת לציבור.
6. רק לאחר השלמת הכללים והבדיקות, להגדיר `JARVIS_RULES_VERSION=1` ו־`JARVIS_ENABLED=true`.
   אלה שערי תפעול, לא בדיקה אוטומטית שהכללים אכן נפרסו. ללא שניהם מתקבל 503.
   ל־PR #3 יש להגדיר `JARVIS_ALLOWED_ORIGIN=https://deploy-preview-3--pesonaltraine.netlify.app`
   בהיקף Functions ובהקשר Deploy Previews בלבד, יחד עם משתני Jarvis האחרים.
   אין להוסיף את ערך ה־preview להקשר Production. משתנים מחייבים פריסה מחדש של ה־preview.
   גם דומיין ה־preview המדויק צריך להיות מורשה ב־Firebase Authentication לפני בדיקת כניסה.
7. smoke test בחשבון בדיקה: הוספה/עריכה/מחיקה בשתי לחיצות, יציאה מהחשבון,
   הפרדה בין משתמשים, ותכונות האימון/תזונה/Google/Garmin הקיימות.

Rollback: להסיר `JARVIS_ENABLED` כדי לחסום את ה־API מיידית. אין שינוי במסמכי users.
כללי Firestore מופעלים בנפרד מפריסת Netlify; אין rollback אוטומטי ביניהם.
הניקוי משתמש בקריאות ובמחיקות רגילות לפי מכסות Spark, בלי שירות TTL בתשלום. אין בתקופה זו
תשתית AI בתשלום, ואין הבטחה למגבלת $15 לפני בניית בקרת שימוש נפרדת.

בדיקת תלויות מקומית: אין ממצאי audit בתלויות production לאחר עדכון Firebase Admin.
בכלי הפיתוח (בעיקר Firebase CLI ותלויותיו) נשארו 14 ממצאים בינוניים; אין ממצאים
גבוהים לאחר override תואם 1.x ל־gRPC. כלי פיתוח אלה אינם נכסי האתר ואינם נדרשים
בפונקציית Jarvis בפרודקשן. אין להפעיל `npm audit fix --force` שמציע downgrade
בלי לבדוק תאימות מחדש. יש לבחון את הדוח שוב לפני פריסה.

## אבחון הגדרת שרת בלי חשיפת סודות

השרת מחזיר רק הודעות קבועות וקודי `JARVIS_*` שנבחרו ברשימה סגורה. אין החזרה
של הודעות SDK גולמיות, stack traces, תוכן משתני סביבה, חשבונות שירות או אסימונים.
הממשק מציג את הקוד ב־textContent; אפשר להעביר לתמיכה רק את ההודעה והקוד.

| קוד | מה לבדוק |
|---|---|
| `JARVIS_PROJECT_MISSING` | `JARVIS_FIREBASE_PROJECT_ID` בהיקף Functions ובהקשר הנכון |
| `JARVIS_ACCOUNT_MISSING` | `JARVIS_FIREBASE_SERVICE_ACCOUNT` בהיקף Functions ובהקשר הנכון |
| `JARVIS_ACCOUNT_JSON` / `JARVIS_ACCOUNT_INVALID` | JSON מלא ומפתח RSA תקין, בהדבקה ישירות ל־Netlify |
| `JARVIS_PROJECT_MISMATCH` | מזהה הפרויקט תואם ל־project_id של חשבון השירות |
| `JARVIS_AUTH_PERMISSION` | Firebase Authentication Viewer לחשבון השירות |
| `JARVIS_DB_PERMISSION` | Cloud Datastore User לחשבון השירות בפרויקט הנכון |
| `JARVIS_DB_QUOTA` | מכסות Spark או מגבלת משאבים; אין צורך לשדרג אוטומטית |
| `JARVIS_SERVER_DEPENDENCY` | תיקון אריזת תלויות הפריסה |

שינוי משתנים מחייב פריסה מחדש באותו הקשר. אין לשלוח את קובץ המפתח או לוג
גולמי שמכיל סודות. קוד התקלה מסווג את השגיאה; אינו מחליף בדיקה של הגדרות
החשבון והרשאותיו בפועל. שגיאות משתמש (אסימון שפג/בוטל וכדומה) נשארות 401;
הרשאה חסרה לשירות מחזירה 503 עם קוד אבחון קבוע.

## OpenJarvis והמשך קולי

נבדק [OpenJarvis](https://github.com/open-jarvis/OpenJarvis) ב־8 בנובמבר 2026:
פרויקט Apache 2.0 עם סביבת Python, מנועי inference וסוכנים מקומיים. לא הועתק
ולא הותקן קוד ממנו. כרגע ממשיכים ללא לפטופ מארח לפי בקשת בעל האתר.
חיבור עתידי אפשרי כשירות נפרד, דרך gateway מאומת ומצומצם; אין לחשוף שרת
מקומי או shell tools לאינטרנט. פרופיל shared/server והרשאות מפורשות יידרשו:
ברירות המחדל של OpenJarvis כוללות גם memory:write, בניגוד למדיניות האישור כאן.
ראו [Security](https://open-jarvis.github.io/OpenJarvis/user-guide/security/).

הכפתור המרחף והשיחה הקולית בעתיד ישתמשו באותו שער הרשאות. אישור למודל בתשלום,
בחירת ספק, מדידה ומגבלת תקציב בצד השרת יטופלו לפני הפעלת כל קריאת מודל.

מקורות למימוש: [Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens),
[transactions](https://firebase.google.com/docs/firestore/manage-data/transactions),
[Security Rules](https://firebase.google.com/docs/firestore/security/rules-conditions).
מכסות Spark וההבדל מול TTL: [Firestore quotas](https://firebase.google.com/docs/firestore/quotas).
