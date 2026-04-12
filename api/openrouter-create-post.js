module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
    const VIEW_BASE_URL = process.env.VIEW_BASE_URL || "https://view.ceetice.com";

    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing OPENROUTER_API_KEY."
      });
    }

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const prompt = String(body.prompt || "").trim();
    const tone = String(body.tone || "professional").trim();
    const mode = String(body.mode || "caption").trim().toLowerCase();

    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "Prompt is required."
      });
    }

    let instruction = "";

    if (mode === "caption") {
      instruction = [
        "You are writing a polished social media post for the View app.",
        `Tone: ${tone}.`,
        "Return only the final post text.",
        "Do not add labels like Caption: or Explanation:.",
        "Keep it engaging, clear, and ready to post."
      ].join(" ");
    } else if (mode === "hashtags") {
      instruction = [
        "Generate a short list of strong social media hashtags.",
        `Tone: ${tone}.`,
        "Return only the hashtags in one line."
      ].join(" ");
    } else {
      instruction = [
        "Write a polished social media post.",
        `Tone: ${tone}.`,
        "Return only the final result."
      ].join(" ");
    }

    const openrouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": VIEW_BASE_URL,
        "X-Title": "View by Ceetify"
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: "system",
            content: instruction
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 500
      })
    });

    const rawText = await openrouterResponse.text();
    let json = {};

    try {
      json = rawText ? JSON.parse(rawText) : {};
    } catch {
      json = { raw: rawText };
    }

    if (!openrouterResponse.ok) {
      return res.status(openrouterResponse.status).json({
        ok: false,
        error:
          json?.error?.message ||
          json?.message ||
          json?.error ||
          "OpenRouter request failed.",
        raw: json
      });
    }

    const text =
      json?.choices?.[0]?.message?.content ||
      json?.choices?.[0]?.text ||
      "";

    if (!String(text).trim()) {
      return res.status(500).json({
        ok: false,
        error: "OpenRouter returned empty output.",
        raw: json
      });
    }

    return res.status(200).json({
      ok: true,
      provider: "openrouter",
      model: OPENROUTER_MODEL,
      text: String(text).trim(),
      raw: json
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Internal server error"
    });
  }
};
