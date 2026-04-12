const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const KLING_API_KEY = process.env.KLING_API_KEY;
const KLING_BASE_URL = (process.env.KLING_BASE_URL || "https://api.klingapi.com").replace(/\/+$/, "");
const AUTO_POST_CRON_SECRET = process.env.AUTO_POST_CRON_SECRET;

const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const KLING_VIDEO_MODEL = process.env.KLING_VIDEO_MODEL || "kling-v2.6-std";
const USE_GEMINI_IMAGE = String(process.env.USE_GEMINI_IMAGE || "false").toLowerCase() === "true";

const POST_MEDIA_BUCKET = process.env.POST_MEDIA_BUCKET || "post-media";
const AUTO_POST_BATCH_LIMIT = Number(process.env.AUTO_POST_BATCH_LIMIT || 5);
const AUTO_POST_VIDEO_POLL_BATCH = Number(process.env.AUTO_POST_VIDEO_POLL_BATCH || 10);

const VIEW_BASE_URL = (process.env.VIEW_BASE_URL || `https://${process.env.VERCEL_URL || "view-psi-lac.vercel.app"}`).replace(/\/+$/, "");
const PROCESS_WORKER_URL = process.env.PROCESS_WORKER_URL || `${VIEW_BASE_URL}/api/process-publish-jobs`;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-cron-secret");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const action = String(req.query?.action || req.body?.action || "").trim().toLowerCase();

    if (!action) {
      return res.status(400).json({
        ok: false,
        error: "Missing action. Use action=test, action=run, or action=check"
      });
    }

    if (action === "test") return await handleTestRun(req, res);
    if (action === "run") return await handleRunDueRules(req, res);
    if (action === "check") return await handleCheckKlingTasks(req, res);

    return res.status(400).json({
      ok: false,
      error: "Invalid action. Use test, run, or check"
    });
  } catch (error) {
    console.error("auto-post fatal error:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Internal server error"
    });
  }
};

function isAuthorized(req) {
  const authHeader = req.headers.authorization || "";
  const xCronSecret = req.headers["x-cron-secret"] || "";

  if (!AUTO_POST_CRON_SECRET) return true;
  if (xCronSecret && xCronSecret === AUTO_POST_CRON_SECRET) return true;
  if (authHeader === AUTO_POST_CRON_SECRET) return true;
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim() === AUTO_POST_CRON_SECRET;
  }
  return false;
}

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizePlatformKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "twitter") return "x";
  if (key === "whatsapp_business" || key === "whatsappbusiness") return "whatsapp";
  return key;
}

function normalizeContentType(value) {
  const key = String(value || "").trim().toLowerCase();
  return key || "text_only";
}

function normalizePlatforms(selectedPlatforms, platformsLabel) {
  let platforms = [];

  if (Array.isArray(selectedPlatforms) && selectedPlatforms.length) {
    platforms = selectedPlatforms;
  } else if (typeof selectedPlatforms === "string" && selectedPlatforms.trim()) {
    const parsed = safeJsonParse(selectedPlatforms, null);
    if (Array.isArray(parsed)) platforms = parsed;
  } else if (platformsLabel) {
    platforms = String(platformsLabel)
      .split(",")
      .map(v => v.trim());
  }

  platforms = platforms
    .map(normalizePlatformKey)
    .filter(Boolean);

  return platforms.length ? platforms : ["view"];
}

function extractTextFromGemini(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts
    .map(part => part?.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractInlineImagePart(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];

  for (const part of parts) {
    if (part?.inlineData?.data) {
      return {
        data: part.inlineData.data,
        mimeType: part.inlineData.mimeType || "image/png"
      };
    }
    if (part?.inline_data?.data) {
      return {
        data: part.inline_data.data,
        mimeType: part.inline_data.mime_type || "image/png"
      };
    }
  }

  return null;
}

function buildPollinationsUrl(prompt, aspect = "1:1") {
  const seed = Date.now();
  const enhancedPrompt = [
    prompt,
    "high quality",
    "professional social media visual",
    "clean composition",
    "sharp focus",
    "no watermark"
  ].join(", ");

  return `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?seed=${seed}&model=flux&nologo=true&private=true&enhance=true&safe=true&aspect=${encodeURIComponent(aspect)}`;
}

function buildStoragePath(userId, prefix, extension) {
  const id = crypto.randomUUID();
  const date = new Date().toISOString().slice(0, 10);
  return `auto-post/${userId}/${prefix}/${date}/${id}.${extension}`;
}

async function uploadBase64ToStorage({ bucket, path, base64Data, contentType }) {
  const buffer = Buffer.from(base64Data, "base64");

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType,
      upsert: false
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function fetchAndUploadRemoteFile({ userId, remoteUrl, prefix, extension, contentType }) {
  const response = await fetch(remoteUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to download remote file for ${prefix}.`);

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const filePath = buildStoragePath(userId, prefix, extension);

  const { error } = await supabase.storage
    .from(POST_MEDIA_BUCKET)
    .upload(filePath, buffer, {
      contentType,
      upsert: false
    });

  if (error) throw error;

  const { data } = supabase.storage.from(POST_MEDIA_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function trimText(value, max = 5000) {
  return String(value || "").trim().slice(0, max);
}

function buildPromptFromRule(rule) {
  const pieces = [];
  const normalizedType = normalizeContentType(rule.content_type);

  if (rule.prompt_template) pieces.push(String(rule.prompt_template).trim());
  else if (rule.topic) pieces.push(String(rule.topic).trim());
  else if (rule.title) pieces.push(String(rule.title).trim());

  if (rule.caption_style) pieces.push(`Caption style: ${rule.caption_style}.`);
  if (rule.visual_style) pieces.push(`Visual style: ${rule.visual_style}.`);

  if (normalizedType === "text" || normalizedType === "text_only") {
    pieces.push("Create a strong social media text post.");
  } else if (normalizedType === "image" || normalizedType === "image_with_caption") {
    pieces.push("Create a social-media-ready image concept.");
  } else if (normalizedType === "image_only") {
    pieces.push("Create a social-media-ready image only. Do not create a long caption.");
  } else if (normalizedType === "video" || normalizedType === "video_with_caption") {
    pieces.push("Create a short vertical social media video concept.");
  } else if (normalizedType === "video_only") {
    pieces.push("Create a short vertical social media video only. Do not create a long caption.");
  } else {
    pieces.push("Create polished social media content.");
  }

  return pieces.filter(Boolean).join("\n");
}

function isTemporaryProviderError(message = "") {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("high demand") ||
    text.includes("temporarily unavailable") ||
    text.includes("overloaded") ||
    text.includes("resource exhausted") ||
    text.includes("rate limit") ||
    text.includes("try again later") ||
    text.includes("quota exceeded")
  );
}

async function callGeminiGenerateContent({ model, contents, responseMimeType }) {
  if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY.");

  const body = { contents };
  if (responseMimeType) {
    body.generationConfig = { responseMimeType };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.error?.message || "Gemini request failed.");
  }

  return json;
}

function contentNeedsCaption(contentType) {
  const type = normalizeContentType(contentType);
  return [
    "text",
    "text_only",
    "image_with_caption",
    "video_with_caption",
    "image",
    "video"
  ].includes(type);
}

function contentNeedsTextBody(contentType) {
  const type = normalizeContentType(contentType);
  return ["text", "text_only"].includes(type);
}

function contentNeedsImage(contentType) {
  const type = normalizeContentType(contentType);
  return ["image", "image_only", "image_with_caption"].includes(type);
}

function contentNeedsVideo(contentType) {
  const type = normalizeContentType(contentType);
  return ["video", "video_only", "video_with_caption"].includes(type);
}

function getAspectFromRule(rule) {
  const style = String(rule.visual_style || "").toLowerCase();
  if (style.includes("portrait")) return "2:3";
  if (style.includes("landscape")) return "16:9";
  return "1:1";
}

async function generateTextWithGemini({ rule, prompt }) {
  const raw = await callGeminiGenerateContent({
    model: GEMINI_TEXT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${prompt}

Return strict JSON with these keys:
title
text_content
caption

Rules:
- text_content is the main post body
- caption is the shorter caption version
- keep it polished and ready for posting`
          }
        ]
      }
    ],
    responseMimeType: "application/json"
  });

  const text = extractTextFromGemini(raw);
  const parsed = safeJsonParse(text, {}) || {};

  return {
    provider: "gemini",
    provider_model: GEMINI_TEXT_MODEL,
    title: trimText(parsed.title || rule.title || "", 120),
    text_content: trimText(parsed.text_content || parsed.caption || text, 5000),
    caption: trimText(parsed.caption || parsed.text_content || text, 2200),
    media_url: null,
    media_type: null,
    status: "generated",
    publish_status: "pending",
    generation_meta: { raw_text: text }
  };
}

async function generateImageSmart({ rule, prompt }) {
  const needsCaption = contentNeedsCaption(rule.content_type);

  const captionRaw = await callGeminiGenerateContent({
    model: GEMINI_TEXT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${prompt}

Return strict JSON with these keys:
title
caption
image_prompt

Rules:
- image_prompt must describe the exact image to generate
- caption should be empty if the requested mode is image only
- keep title short`
          }
        ]
      }
    ],
    responseMimeType: "application/json"
  });

  const captionText = extractTextFromGemini(captionRaw);
  const captionParsed = safeJsonParse(captionText, {}) || {};
  const imagePrompt = trimText(captionParsed.image_prompt || prompt, 4000);
  const aspect = getAspectFromRule(rule);

  let mediaUrl = buildPollinationsUrl(imagePrompt, aspect);
  let provider = "pollinations";
  let providerModel = "pollinations-free";
  let generationMeta = { image_prompt: imagePrompt, aspect, image_mode: "pollinations" };

  if (USE_GEMINI_IMAGE) {
    try {
      const imageRaw = await callGeminiGenerateContent({
        model: GEMINI_IMAGE_MODEL,
        contents: [{ role: "user", parts: [{ text: imagePrompt }] }]
      });

      const imagePart = extractInlineImagePart(imageRaw);
      if (!imagePart?.data) {
        throw new Error("Gemini image generation did not return image data.");
      }

      const filePath = buildStoragePath(rule.user_id, "image", "png");
      mediaUrl = await uploadBase64ToStorage({
        bucket: POST_MEDIA_BUCKET,
        path: filePath,
        base64Data: imagePart.data,
        contentType: imagePart.mimeType || "image/png"
      });

      provider = "gemini";
      providerModel = GEMINI_IMAGE_MODEL;
      generationMeta = { image_prompt: imagePrompt, aspect, image_mode: "gemini" };
    } catch (error) {
      generationMeta = {
        image_prompt: imagePrompt,
        aspect,
        image_mode: "pollinations_fallback",
        gemini_error: error?.message || "Unknown Gemini image error"
      };
    }
  }

  return {
    provider,
    provider_model: providerModel,
    title: trimText(captionParsed.title || rule.title || "", 120),
    text_content: null,
    caption: needsCaption ? trimText(captionParsed.caption || "", 2200) : "",
    media_url: mediaUrl,
    media_type: "image",
    status: "generated",
    publish_status: "pending",
    generation_meta: generationMeta
  };
}

async function generateVideoWithKling({ rule, prompt }) {
  if (!KLING_API_KEY) {
    throw new Error("Missing KLING_API_KEY.");
  }

  const needsCaption = contentNeedsCaption(rule.content_type);

  const prepRaw = await callGeminiGenerateContent({
    model: GEMINI_TEXT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${prompt}

Return strict JSON with these keys:
title
caption
video_prompt

Rules:
- video_prompt must be optimized for video generation
- caption should be empty if the requested mode is video only
- keep title short`
          }
        ]
      }
    ],
    responseMimeType: "application/json"
  });

  const prepText = extractTextFromGemini(prepRaw);
  const prepParsed = safeJsonParse(prepText, {}) || {};
  const videoPrompt = trimText(prepParsed.video_prompt || prompt, 4000);

  const response = await fetch(`${KLING_BASE_URL}/v1/videos/text2video`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${KLING_API_KEY}`
    },
    body: JSON.stringify({
      model: KLING_VIDEO_MODEL,
      prompt: videoPrompt,
      duration: Number(process.env.KLING_VIDEO_DURATION || 5),
      aspect_ratio: process.env.KLING_VIDEO_ASPECT_RATIO || "9:16",
      mode: process.env.KLING_VIDEO_MODE || "standard"
    })
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = json?.message || json?.error || "Kling video request failed.";
    const error = new Error(message);
    error.isTemporary = isTemporaryProviderError(message);
    throw error;
  }

  const taskId = json?.task_id || json?.data?.task_id || json?.id;
  if (!taskId) throw new Error("Kling did not return a task ID.");

  return {
    provider: "kling",
    provider_model: KLING_VIDEO_MODEL,
    provider_task_id: taskId,
    title: trimText(prepParsed.title || rule.title || "", 120),
    text_content: null,
    caption: needsCaption ? trimText(prepParsed.caption || "", 2200) : "",
    media_url: null,
    media_type: "video",
    status: "processing",
    publish_status: "pending",
    generation_meta: {
      video_prompt: videoPrompt,
      kling_response: json
    }
  };
}

async function createRunLog(payload) {
  const { data, error } = await supabase
    .from("auto_post_runs")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function finalizeRunLog(runId, fields) {
  const { error } = await supabase
    .from("auto_post_runs")
    .update({
      ...fields,
      updated_at: nowIso()
    })
    .eq("id", runId);

  if (error) throw error;
}

async function updateRuleStatus(ruleId, fields) {
  const { error } = await supabase
    .from("auto_post_rules")
    .update({
      ...fields,
      updated_at: nowIso()
    })
    .eq("id", rule
