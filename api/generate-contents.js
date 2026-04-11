const fetch = require("node-fetch");

/* =========================
   ENV CONFIG
========================= */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

/* =========================
   SAFE JSON PARSER
========================= */
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* =========================
   GEMINI TEXT GENERATION
========================= */
async function generateTextWithGemini(prompt) {
  if (!GEMINI_API_KEY) {
    return {
      title: "Auto Post",
      caption: prompt
    };
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${prompt}

Return JSON like:
{
  "title": "...",
  "caption": "..."
}`
                }
              ]
            }
          ]
        })
      }
    );

    const data = await res.json();

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const parsed = safeJsonParse(text) || {};

    return {
      title: parsed.title || "Auto Post",
      caption: parsed.caption || prompt
    };

  } catch (error) {
    console.log("⚠️ Gemini text failed → fallback");

    return {
      title: "Auto Post",
      caption: prompt
    };
  }
}

/* =========================
   POLLINATIONS IMAGE GENERATOR
========================= */
function generateImageWithPollinations(prompt) {
  const enhancedPrompt = `
${prompt},
modern business advert, social media poster,
professional branding, red and blue theme,
clean layout, high quality, sharp focus,
eye catching design, 4k
`;

  return `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}`;
}

/* =========================
   MAIN CONTENT GENERATOR
========================= */
async function generateContent(rule) {
  try {
    const basePrompt =
      rule?.topic ||
      rule?.title ||
      "Business advert for social media";

    // ✅ TEXT (Gemini or fallback)
    const text = await generateTextWithGemini(basePrompt);

    // ✅ IMAGE (Pollinations)
    const imageUrl = generateImageWithPollinations(basePrompt);

    return {
      provider: "pollinations",
      provider_model: "pollinations-free",

      title: text.title,
      caption: text.caption,
      content: text.caption,

      media_url: imageUrl,
      media_type: "image",

      status: "generated",
      publish_status: "pending"
    };

  } catch (error) {
    console.error("❌ Generation failed:", error);

    // 🔥 FINAL FAILSAFE (system will NEVER break)
    return {
      provider: "fallback",
      provider_model: "static",

      title: "Auto Post",
      caption: "Check out our latest update!",
      content: "Check out our latest update!",

      media_url: "https://picsum.photos/800/600",
      media_type: "image",

      status: "generated",
      publish_status: "pending"
    };
  }
}

module.exports = {
  generateContent
};
