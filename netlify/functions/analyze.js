async function verifyFirebaseToken(token) {
  if (!token) return false;
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) return false;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token }) }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return !!(data.users && data.users.length > 0);
  } catch {
    return false;
  }
}

exports.handler = async function(event, context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  const authHeader = event.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const valid = await verifyFirebaseToken(token);
  if (!valid) return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const body = JSON.parse(event.body);
    const { type, image, mediaType, text } = body;

    let messages;

    if (type === "food") {
      messages = [{
        role: "user",
        content: `נתח את הארוחה הבאה וחשב ערכים תזונתיים. החזר JSON בלבד ללא markdown:
{"desc":"<תיאור קצר של הארוחה בעברית>","cal":<קלוריות מספר שלם>,"p":<חלבון גרם מספר שלם>,"c":<פחמימות גרם מספר שלם>,"f":<שומן גרם מספר שלם>,"notes":"<הערות על הדיוק או מידע תזונתי חשוב, קצר>"}

הארוחה: ${text}

חשוב: תן הערכה ריאלית ומדויקת ככל האפשר לפי כמויות סטנדרטיות אם לא צוינו כמויות.`
      }];
    } else if (type === "splits") {
      if (!image) return { statusCode: 400, headers, body: JSON.stringify({ error: "No image provided" }) };
      messages = [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
          { type: "text", text: 'Extract all lap/split data from this Garmin/Strava splits screenshot. Return JSON only, no markdown:\n{"splits":[{"lap":<int>,"dist":<decimal km>,"pace":"<MM:SS or null>","hr":<int or null>,"time":"<MM:SS or null>"}]}\nInclude every lap row visible. If it\'s an interval workout with work/rest laps, include all of them.' }
        ]
      }];
    } else {
      if (!image) return { statusCode: 400, headers, body: JSON.stringify({ error: "No image provided" }) };
      messages = [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
          { type: "text", text: 'Extract running data from this Garmin/Strava screenshot. Return JSON only, no markdown:\n{"km":<decimal>,"pace":"<MM:SS>","avgHr":<integer or null>,"date":"<YYYY-MM-DD or null>","calories":<integer or null>}' }
        ]
      }];
    }

    const maxTokens = type === "splits" ? 1200 : 500;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        messages
      })
    });

    const data = await response.json();
    if (!response.ok) return { statusCode: 500, headers, body: JSON.stringify({ error: data.error?.message || "Claude API error" }) };

    const text2 = data.content?.map(b => b.text || "").join("").trim().replace(/```json|```/g, "").trim();
    const result = JSON.parse(text2);
    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
