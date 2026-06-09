exports.handler = async function(event, context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const body = JSON.parse(event.body);
    const { type, image, mediaType, text } = body;

    let messages;

    if (type === "food") {
      // Food analysis from text
      messages = [{
        role: "user",
        content: `נתח את הארוחה הבאה וחשב ערכים תזונתיים. החזר JSON בלבד ללא markdown:
{"desc":"<תיאור קצר של הארוחה בעברית>","cal":<קלוריות מספר שלם>,"p":<חלבון גרם מספר שלם>,"c":<פחמימות גרם מספר שלם>,"f":<שומן גרם מספר שלם>,"notes":"<הערות על הדיוק או מידע תזונתי חשוב, קצר>"}

הארוחה: ${text}

חשוב: תן הערכה ריאלית ומדויקת ככל האפשר לפי כמויות סטנדרטיות אם לא צוינו כמויות.`
      }];
    } else {
      // Garmin image analysis
      if (!image) return { statusCode: 400, headers, body: JSON.stringify({ error: "No image provided" }) };
      messages = [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
          { type: "text", text: 'Extract running data from this Garmin/Strava screenshot. Return JSON only, no markdown:\n{"km":<decimal>,"pace":"<MM:SS>","avgHr":<integer or null>,"date":"<YYYY-MM-DD or null>","calories":<integer or null>}' }
        ]
      }];
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
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
