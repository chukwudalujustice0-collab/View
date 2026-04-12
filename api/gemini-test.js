module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Method not allowed"
      });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing GEMINI_API_KEY in Vercel environment variables."
      });
    }

    const prompt =
      String(
        req.method === "POST"
          ? (req.body?.prompt || "")
          : (req.query?.prompt || "")
      ).trim() || "Say hello from Gemini in one short sentence.";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_TEXT_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ]
        })
      }
    );

    const rawText = await response.text();
    let json = {};

    try {
      json = rawText ? JSON.parse(rawText) : {};
    } catch {
      json = { raw: rawText };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error:
          json?.error?.message ||
          json?.message ||
          "Gemini request failed.",
        raw: json
      });
    }

    const parts = json?.candidates?.[0]?.content?.parts || [];
    const text = parts
      .map((part) => part?.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();

    return res.status(200).json({
      ok: true,
      model: GEMINI_TEXT_MODEL,
      prompt,
      text: text || "",
      raw: json
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Internal server error"
    });
  }
};
