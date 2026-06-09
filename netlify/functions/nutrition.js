exports.handler = async function(event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { text } = JSON.parse(event.body);
    if (!text) return { statusCode: 400, headers, body: JSON.stringify({ error: "No text provided" }) };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{
          role: "user",
          content: `אתה מומחה תזונה. המשתמש תיאר מה אכל. חשב ערכים תזונתיים מדויקים.
החזר JSON בלבד, ללא markdown, ללא טקסט נוסף:
{
  "desc": "<תיאור קצר של הארוחה בעברית>",
  "kcal": <מספר שלם>,
  "protein": <גרם חלבון, מספר שלם>,
  "carbs": <גרם פחמימות, מספר שלם>,
  "fat": <גרם שומן, מספר שלם>,
  "notes": "<הערה קצרה אם צריך, אחרת null>"
}

תיאור המשתמש: "${text}"`
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) return { statusCode: 500, headers, body: JSON.stringify({ error: data.error?.message || "API error" }) };

    const raw = data.content?.map(b => b.text || "").join("").trim().replace(/```json|```/g, "").trim();
    const result = JSON.parse(raw);
    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
