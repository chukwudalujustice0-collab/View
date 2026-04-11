module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing GEMINI_API_KEY in environment variables."
      });
    }

    const prompt = String(req.body?.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "Prompt is required."
      });
    }

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
              parts: [
                {
                  text: `${prompt}\n\nReply directly with the final answer only.`
                }
              ]
            }
          ]
        })
      }
    );

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: json?.error?.message || "Gemini request failed."
      });
    }

    const parts = json?.candidates?.[0]?.content?.parts || [];
    const text = parts
      .map(part => part?.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();

    if (!text) {
      return res.status(500).json({
        ok: false,
        error: "Gemini returned empty text."
      });
    }

    return res.status(200).json({
      ok: true,
      text
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Internal server error"
    });
  }
};
