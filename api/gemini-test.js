export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "Gemini test route is working"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const prompt = String(body.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "No prompt provided"
      });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing GEMINI_API_KEY in Vercel environment variables"
      });
    }

    const geminiRes = await fetch(
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
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ]
        })
      }
    );

    const rawText = await geminiRes.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { raw: rawText };
    }

    if (!geminiRes.ok) {
      return res.status(geminiRes.status || 500).json({
        ok: false,
        error: data?.error?.message || data?.message || "Gemini request failed",
        raw: data
      });
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const reply = parts
      .map((part) => part?.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();

    return res.status(200).json({
      ok: true,
      model: GEMINI_TEXT_MODEL,
      reply: reply || "Gemini returned no text",
      raw: data
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Internal server error"
    });
  }
}
