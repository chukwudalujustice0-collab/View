const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  "";

const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL ||
  "gemini-2.5-flash-image";

const GEMINI_TEXT_MODEL =
  process.env.GEMINI_TEXT_MODEL ||
  "gemini-2.5-flash";

const IMAGE_COST = Number(process.env.AI_IMAGE_COST || 10);
const CAPTION_COST = Number(process.env.AI_CAPTION_COST || 1);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

function json(res, status, payload) {
  return res.status(status).json(payload);
}

function normalizeType(value) {
  const t = String(value || "both").trim().toLowerCase();
  if (["image", "caption", "both"].includes(t)) return t;
  return "both";
}

function sanitizeText(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function mapAspect(size) {
  const s = String(size || "square").toLowerCase();
  if (s === "portrait") return "2:3";
  if (s === "landscape") return "16:9";
  return "1:1";
}

function buildImagePrompt({ prompt, style, size }) {
  const styleMap = {
    realistic: "realistic photography, detailed, natural lighting",
    luxury: "luxury premium design, elegant, polished, rich details",
    minimal: "minimal clean design, premium composition, simple luxury",
    cinematic: "cinematic lighting, dramatic composition, high detail",
    poster: "social media poster design, bold clean layout, eye-catching"
  };

  const sizeMap = {
    square: "square composition",
    portrait: "portrait composition",
    landscape: "landscape composition"
  };

  return [
    sanitizeText(prompt, 2000),
    styleMap[String(style || "").toLowerCase()] || styleMap.realistic,
    sizeMap[String(size || "").toLowerCase()] || sizeMap.square,
    "high quality, sharp focus, professional visual, no watermark"
  ].join(", ");
}

function buildCaptionPrompt({ prompt, style, size }) {
  return [
    "Write one polished social media caption.",
    "Make it catchy, premium, clean, and ready to post.",
    `Style: ${style || "realistic"}.`,
    `Format: ${size || "square"}.`,
    `User request: ${sanitizeText(prompt, 2000)}.`,
    "Return only the caption text."
  ].join(" ");
}

function safeBase64ToBuffer(base64String) {
  const clean = String(base64String || "").trim();
  return Buffer.from(clean, "base64");
}

function extensionFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  return "png";
}

function buildDataUrl(mimeType, base64Data) {
  return `data:${mimeType};base64,${base64Data}`;
}

async function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
}

async function getAuthedUser(req) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token) {
    throw new Error("Missing bearer token");
  }

  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    throw new Error("Invalid session");
  }

  return data.user;
}

async function getCreditBalance(supabase, userId) {
  const { data, error } = await supabase
    .from("ai_credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message || "Could not load AI credits");

  return Number(data?.balance || 0);
}

async function deductCredits(supabase, userId, amount) {
  const currentBalance = await getCreditBalance(supabase, userId);

  if (currentBalance < amount) {
    throw new Error("You do not have enough AI credits.");
  }

  const nextBalance = currentBalance - amount;

  const { error } = await supabase
    .from("ai_credits")
    .update({
      balance: nextBalance,
      updated_at: new Date().toISOString()
    })
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message || "Failed to deduct AI credits");
  }

  return nextBalance;
}

async function ensureGenerationHistoryTable(supabase) {
  try {
    await supabase.from("ai_generation_history").select("id").limit(1);
  } catch (_) {
    // ignore
  }
}

async function saveHistory(supabase, payload) {
  try {
    await ensureGenerationHistoryTable(supabase);
    await supabase.from("ai_generation_history").insert(payload);
  } catch (_) {
    // ignore
  }
}

async function uploadGeneratedImageToSupabase(supabase, userId, mimeType, base64Data) {
  const ext = extensionFromMime(mimeType);
  const filePath = `ai-generated/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const bucket = process.env.POST_MEDIA_BUCKET || "post-media";

  const buffer = safeBase64ToBuffer(base64Data);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(filePath, buffer, {
      contentType: mimeType || "image/png",
      upsert: false
    });

  if (uploadError) {
    return {
      image_url: buildDataUrl(mimeType || "image/png", base64Data),
      image_path: null,
      storage_bucket: null
    };
  }

  const { data: publicUrlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(filePath);

  return {
    image_url: publicUrlData?.publicUrl || buildDataUrl(mimeType || "image/png", base64Data),
    image_path: filePath,
    storage_bucket: bucket
  };
}

async function generateGeminiImage(prompt, style, size) {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const client = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = client.getGenerativeModel({ model: GEMINI_IMAGE_MODEL });

  const finalPrompt = buildImagePrompt({ prompt, style, size });
  const aspect = mapAspect(size);

  const result = await model.generateContent([
    {
      text: `${finalPrompt}. Aspect ratio ${aspect}.`
    }
  ]);

  const response = result?.response;
  const candidates = response?.candidates || [];

  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || [];
    for (const part of parts) {
      const inlineData = part?.inlineData;
      if (inlineData?.data) {
        return {
          mimeType: inlineData.mimeType || "image/png",
          data: inlineData.data
        };
      }
    }
  }

  throw new Error("Gemini image generation returned no image.");
}

async function generateGeminiCaption(prompt, style, size) {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const client = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = client.getGenerativeModel({ model: GEMINI_TEXT_MODEL });

  const finalPrompt = buildCaptionPrompt({ prompt, style, size });
  const result = await model.generateContent(finalPrompt);
  const text = result?.response?.text?.() || "";

  const clean = sanitizeText(text, 3000);
  if (!clean) {
    throw new Error("Gemini caption generation returned empty text.");
  }

  return clean;
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    const prompt = sanitizeText(body.prompt, 2000);
    const style = sanitizeText(body.style || "realistic", 50);
    const size = sanitizeText(body.size || "square", 50);
    const type = normalizeType(body.type);

    if (!prompt) {
      return json(res, 400, { ok: false, error: "Prompt is required." });
    }

    const user = await getAuthedUser(req);
    const supabase = await getSupabase();

    const currentBalance = await getCreditBalance(supabase, user.id);

    let neededCredits = 0;
    if (type === "image") neededCredits = IMAGE_COST;
    if (type === "caption") neededCredits = CAPTION_COST;
    if (type === "both") neededCredits = IMAGE_COST + CAPTION_COST;

    if (currentBalance < neededCredits) {
      return json(res, 400, {
        ok: false,
        error: "You do not have enough AI credits.",
        required_credits: neededCredits,
        balance: currentBalance
      });
    }

    let imageResult = null;
    let captionText = "";
    let remainingCredits = currentBalance;

    if (type === "image" || type === "both") {
      const geminiImage = await generateGeminiImage(prompt, style, size);
      imageResult = await uploadGeneratedImageToSupabase(
        supabase,
        user.id,
        geminiImage.mimeType,
        geminiImage.data
      );
      remainingCredits = await deductCredits(supabase, user.id, IMAGE_COST);
    }

    if (type === "caption" || type === "both") {
      captionText = await generateGeminiCaption(prompt, style, size);
      remainingCredits = await deductCredits(
        supabase,
        user.id,
        type === "both" ? CAPTION_COST : CAPTION_COST
      );
    }

    await saveHistory(supabase, {
      user_id: user.id,
      prompt,
      type,
      style,
      size,
      image_url: imageResult?.image_url || null,
      image_path: imageResult?.image_path || null,
      caption: captionText || null,
      credits_used: neededCredits,
      created_at: new Date().toISOString()
    });

    return json(res, 200, {
      ok: true,
      type,
      image_url: imageResult?.image_url || null,
      image_path: imageResult?.image_path || null,
      caption: captionText || "",
      remaining_credits: remainingCredits,
      image_cost: type === "image" || type === "both" ? IMAGE_COST : 0,
      caption_cost: type === "caption" || type === "both" ? CAPTION_COST : 0,
      total_cost: neededCredits,
      image_model: GEMINI_IMAGE_MODEL,
      text_model: GEMINI_TEXT_MODEL
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: error?.message || "Internal server error"
    });
  }
};
