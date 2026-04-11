export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY on server" });
    }

    const {
      prompt = "",
      mode = "caption",
      tone = "engaging",
      platform = "general",
      extra = "",
      maxOutputTokens = 700
    } = req.body || {};

    const cleanPrompt = String(prompt).trim();
    if (!cleanPrompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const modeInstructions = {
      caption: "Write a strong social media caption.",
      short_post: "Write a short social media post.",
      long_post: "Write a longer social media post.",
      reel_script: "Write a short reel/video script with hook, body, and closing line.",
      hashtags: "Write only useful hashtags.",
      product_ad: "Write persuasive ad copy for a product post.",
      ideas: "Give multiple post ideas the user can choose from."
    };

    const instruction =
      modeInstructions[mode] || modeInstructions.caption;

    const systemText = `
You are an expert social media content assistant for a premium social app called View.
Task: ${instruction}

Rules:
- Tone: ${tone}
- Platform: ${platform}
- Keep the output clean and ready to paste
- No markdown
- Do not use headings unless needed
- Be specific, polished, and engaging
- If hashtags are useful, keep them relevant and not excessive
- If extra instructions are provided, follow them
Extra instructions: ${extra || "None"}
`;

    const body = {
      contents: [
        {
          parts: [
            {
              text: `${systemText}\n\nUser request:\n${cleanPrompt}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.8,
        topP: 0.95,
        maxOutputTokens: Number(maxOutputTokens) || 700
      }
    };

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Gemini request failed"
      });
    }

    const text = (data?.candidates || [])
      .flatMap(candidate => candidate?.content?.parts || [])
      .map(part => part?.text || "")
      .join("")
      .trim();

    if (!text) {
      return res.status(500).json({ error: "Gemini returned empty output" });
    }

    return res.status(200).json({
      ok: true,
      text
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
