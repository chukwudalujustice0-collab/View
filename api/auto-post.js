const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

const CUSTOM_FALLBACK_API_URL =
  process.env.CUSTOM_FALLBACK_API_URL ||
  "https://throbbing-star-8cd8.chukwudalujustice0.workers.dev";

const KLING_API_KEY = process.env.KLING_API_KEY || "";
const KLING_BASE_URL = (
  process.env.KLING_BASE_URL || "https://api.klingapi.com"
).replace(/\/+$/, "");
const KLING_VIDEO_MODEL =
  process.env.KLING_VIDEO_MODEL || "kling-v2.6-std";

const AUTO_POST_CRON_SECRET =
  process.env.AUTO_POST_CRON_SECRET ||
  process.env.CRON_SECRET ||
  "";

const POST_MEDIA_BUCKET =
  process.env.POST_MEDIA_BUCKET || "post-media";

const AUTO_POST_BATCH_LIMIT = clampNumber(
  process.env.AUTO_POST_BATCH_LIMIT || 5,
  1,
  100,
  5
);

const AUTO_POST_VIDEO_POLL_BATCH = clampNumber(
  process.env.AUTO_POST_VIDEO_POLL_BATCH || 10,
  1,
  100,
  10
);

const GEMINI_TEXT_MODEL =
  process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

const USE_GEMINI_IMAGE =
  String(process.env.USE_GEMINI_IMAGE || "true").toLowerCase() === "true";

const VIEW_BASE_URL = (
  process.env.VIEW_BASE_URL ||
  "https://view.ceetice.com"
).replace(/\/+$/, "");

const PROCESS_WORKER_URL =
  process.env.PROCESS_WORKER_URL ||
  `${VIEW_BASE_URL}/api/process-publish-jobs`;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables.");
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

module.exports = async function handler(req, res) {
  setCors(res);

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

    if (!isAuthorized(req)) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized"
      });
    }

    const body =
      req.method === "POST" && req.body
        ? typeof req.body === "string"
          ? safeJsonParse(req.body, {})
          : req.body
        : {};

    let action = String(req.query?.action || body?.action || "")
      .trim()
      .toLowerCase();

    // IMPORTANT:
    // If cron calls /api/auto-post without action,
    // default to "run" so due rules still execute.
    if (!action) {
      action = "run";
    }

    if (action === "test") {
      return await handleTestRun(req, res, body);
    }

    if (action === "run") {
      return await handleRunDueRules(req, res, body);
    }

    if (action === "check") {
      return await handleCheckKlingTasks(req, res);
    }

    return res.status(400).json({
      ok: false,
      error: "Invalid action. Use test, run, or check"
    });
  } catch (error) {
    console.error("auto-post fatal error:", error);

    return res.status(500).json({
      ok: false,
      error: sanitizeErrorMessage(
        error?.message || error || "Internal server error"
      )
    });
  }
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-cron-secret"
  );
  res.setHeader("Cache-Control", "no-store");
}

function isAuthorized(req) {
  const authHeader = req.headers.authorization || "";
  const xCronSecret = req.headers["x-cron-secret"] || "";

  const validSecrets = [
    process.env.CRON_SECRET,
    process.env.AUTO_POST_CRON_SECRET
  ].filter(Boolean);

  if (!validSecrets.length) return true;

  if (xCronSecret && validSecrets.includes(xCronSecret)) return true;
  if (validSecrets.includes(authHeader)) return true;

  if (authHeader.startsWith("Bearer ")) {
    const bearer = authHeader.slice(7).trim();
    if (validSecrets.includes(bearer)) return true;
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

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function trimText(value, max = 5000) {
  return String(value || "").trim().slice(0, max);
}

function sanitizeErrorMessage(errorLike, fallback = "Unknown auto-post error") {
  if (!errorLike) return fallback;

  if (typeof errorLike === "string") {
    return trimText(errorLike.replace(/\s+/g, " "), 600) || fallback;
  }

  if (errorLike instanceof Error) {
    return sanitizeErrorMessage(errorLike.message, fallback);
  }

  return trimText(JSON.stringify(errorLike), 600) || fallback;
}

function normalizePlatformKey(value) {
  const key = String(value || "").trim().toLowerCase();

  if (key === "twitter") return "x";
  if (key === "whatsappbusiness" || key === "whatsapp_business") {
    return "whatsapp";
  }

  return key;
}

function normalizePlatforms(selectedPlatforms, platformsLabel) {
  let platforms = [];

  if (Array.isArray(selectedPlatforms) && selectedPlatforms.length) {
    platforms = selectedPlatforms;
  } else if (
    typeof selectedPlatforms === "string" &&
    selectedPlatforms.trim()
  ) {
    const parsed = safeJsonParse(selectedPlatforms, null);
    if (Array.isArray(parsed)) platforms = parsed;
  } else if (platformsLabel) {
    platforms = String(platformsLabel)
      .split(",")
      .map((v) => v.trim());
  }

  const normalized = platforms
    .map(normalizePlatformKey)
    .filter(Boolean);

  return normalized.length ? [...new Set(normalized)] : ["view"];
}

function normalizeContentType(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "text_only";
  return key;
}

function contentNeedsTextBody(contentType) {
  const type = normalizeContentType(contentType);
  return ["text", "text_only"].includes(type);
}

function contentNeedsCaption(contentType) {
  const type = normalizeContentType(contentType);
  return [
    "text",
    "text_only",
    "image",
    "image_with_caption",
    "video",
    "video_with_caption"
  ].includes(type);
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
  const visual = String(rule?.visual_style || "").toLowerCase();
  if (visual.includes("landscape")) return "16:9";
  if (visual.includes("portrait")) return "2:3";
  return "1:1";
}

function buildStoragePath(userId, prefix, extension) {
  const id = crypto.randomUUID();
  const date = new Date().toISOString().slice(0, 10);
  return `auto-post/${userId}/${prefix}/${date}/${id}.${extension}`;
}

function buildPollinationsUrl(prompt, aspect = "1:1") {
  const seed = Date.now();
  const enhancedPrompt = [
    trimText(prompt, 3500),
    "high quality",
    "professional social media visual",
    "sharp focus",
    "clean composition",
    "no watermark"
  ].join(", ");

  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    enhancedPrompt
  )}?seed=${seed}&model=flux&nologo=true&private=true&enhance=true&safe=true&aspect=${encodeURIComponent(
    aspect
  )}`;
}

function buildPromptFromRule(rule) {
  const pieces = [];
  const normalizedType = normalizeContentType(rule.content_type);

  if (rule.prompt_template) pieces.push(trimText(rule.prompt_template, 3000));
  else if (rule.topic) pieces.push(trimText(rule.topic, 3000));
  else if (rule.title) pieces.push(trimText(rule.title, 400));

  if (rule.caption_style) {
    pieces.push(`Caption style: ${rule.caption_style}.`);
  }

  if (rule.visual_style) {
    pieces.push(`Visual style: ${rule.visual_style}.`);
  }

  if (normalizedType === "text" || normalizedType === "text_only") {
    pieces.push("Create a polished social media text post.");
  } else if (
    normalizedType === "image" ||
    normalizedType === "image_with_caption"
  ) {
    pieces.push("Create a polished social media image and caption.");
  } else if (normalizedType === "image_only") {
    pieces.push("Create a polished social media image only. No long caption.");
  } else if (
    normalizedType === "video" ||
    normalizedType === "video_with_caption"
  ) {
    pieces.push("Create a polished short vertical social media video and caption.");
  } else if (normalizedType === "video_only") {
    pieces.push("Create a polished short vertical social media video only. No long caption.");
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
    text.includes("quota exceeded") ||
    text.includes("try again later") ||
    text.includes("timed out")
  );
}

function extractTextFromGemini(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part?.text || "")
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

function extractOpenRouterText(json) {
  return trimText(
    json?.choices?.[0]?.message?.content ||
      json?.choices?.[0]?.text ||
      "",
    12000
  );
}

function buildLocalFallbackText(rule) {
  const title = trimText(rule?.title || "Auto Post", 120);
  const topic = trimText(rule?.topic || rule?.prompt_template || "", 1200);

  return {
    title: title || "Auto Post",
    text_content: topic
      ? `${topic}\n\n#View #Ceetify`
      : "New update from View. Stay connected for more.",
    caption: topic
      ? `${trimText(topic, 300)} #View #Ceetify`
      : "New update from View. #View #Ceetify"
  };
}

async function callGeminiGenerateContent({
  model,
  contents,
  responseMimeType
}) {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY.");
  }

  const body = { contents };

  if (responseMimeType) {
    body.generationConfig = { responseMimeType };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
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

async function callOpenRouterText(prompt) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY.");
  }

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: "user", content: prompt }]
      })
    }
  );

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(json?.error?.message || "OpenRouter request failed.");
  }

  const text = extractOpenRouterText(json);

  if (!text) {
    throw new Error("OpenRouter returned empty text.");
  }

  return text;
}

async function callCustomFallbackApi(payload) {
  if (!CUSTOM_FALLBACK_API_URL) {
    throw new Error("Missing CUSTOM_FALLBACK_API_URL.");
  }

  const response = await fetch(CUSTOM_FALLBACK_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  let json = {};

  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { text: raw };
  }

  if (!response.ok) {
    throw new Error(
      json?.error || json?.message || "Custom fallback API failed."
    );
  }

  return json;
}

async function fetchPollinationsImageUrl(prompt, aspect = "1:1") {
  const url = buildPollinationsUrl(prompt, aspect);
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Pollinations image request failed.");
  }

  return url;
}

async function uploadBase64ToStorage({
  bucket,
  path,
  base64Data,
  contentType
}) {
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

async function fetchAndUploadRemoteFile({
  userId,
  remoteUrl,
  prefix,
  extension,
  contentType
}) {
  const response = await fetch(remoteUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Unable to download remote file for ${prefix}.`);
  }

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

  const { data } = supabase.storage
    .from(POST_MEDIA_BUCKET)
    .getPublicUrl(filePath);

  return data.publicUrl;
}

async function generateTextWithFallbacks({ rule, prompt }) {
  const finalPrompt = `${prompt}

Return strict JSON with these keys:
title
text_content
caption

Rules:
- text_content is the main post body
- caption is the shorter caption version
- keep it polished and ready for posting`;

  let provider = "gemini";
  let providerModel = GEMINI_TEXT_MODEL;
  let providerError = null;
  let rawText = "";

  try {
    const raw = await callGeminiGenerateContent({
      model: GEMINI_TEXT_MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: finalPrompt }]
        }
      ],
      responseMimeType: "application/json"
    });

    rawText = extractTextFromGemini(raw);

    if (!rawText) {
      throw new Error("Gemini returned empty text.");
    }
  } catch (error) {
    providerError = sanitizeErrorMessage(error);

    try {
      rawText = await callOpenRouterText(finalPrompt);
      provider = "openrouter";
      providerModel = OPENROUTER_MODEL;
    } catch (openRouterError) {
      providerError = `${providerError} | OpenRouter: ${sanitizeErrorMessage(
        openRouterError
      )}`;

      try {
        const workerJson = await callCustomFallbackApi({
          mode: "text",
          prompt: finalPrompt,
          title: rule?.title || "",
          topic: rule?.topic || ""
        });

        rawText = trimText(
          workerJson?.text ||
            workerJson?.output ||
            workerJson?.result ||
            workerJson?.caption ||
            "",
          12000
        );

        if (!rawText) {
          throw new Error("Worker API returned empty text.");
        }

        provider = "custom_fallback_api";
        providerModel = "workers-dev";
      } catch (customError) {
        providerError = `${providerError} | Worker: ${sanitizeErrorMessage(
          customError
        )}`;

        const fallback = buildLocalFallbackText(rule);

        return {
          provider: "local_fallback",
          provider_model: "local-safe-fallback",
          title: fallback.title,
          text_content: fallback.text_content,
          caption: fallback.caption,
          media_url: null,
          media_type: "text",
          status: "generated",
          publish_status: "pending",
          generation_meta: {
            provider_error: providerError
          }
        };
      }
    }
  }

  const parsed = safeJsonParse(rawText, {}) || {};

  return {
    provider,
    provider_model: providerModel,
    title: trimText(parsed.title || rule.title || "", 120),
    text_content: trimText(
      parsed.text_content || parsed.caption || rawText,
      5000
    ),
    caption: trimText(
      parsed.caption || parsed.text_content || rawText,
      2200
    ),
    media_url: null,
    media_type: "text",
    status: "generated",
    publish_status: "pending",
    generation_meta: {
      raw_text: rawText,
      provider_error: providerError
    }
  };
}

async function generateImageWithFallbacks({ rule, prompt }) {
  const needsCaption = contentNeedsCaption(rule.content_type);
  const aspect = getAspectFromRule(rule);

  let title = trimText(rule.title || "", 120);
  let caption = "";
  let imagePrompt = trimText(prompt, 4000);
  let promptProvider = "local";

  try {
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
    const parsed = safeJsonParse(captionText, {}) || {};

    title = trimText(parsed.title || rule.title || "", 120);
    caption = needsCaption ? trimText(parsed.caption || "", 2200) : "";
    imagePrompt = trimText(parsed.image_prompt || prompt, 4000);
    promptProvider = "gemini-text";
  } catch (error) {
    promptProvider = `local:${sanitizeErrorMessage(error)}`;
  }

  if (USE_GEMINI_IMAGE) {
    try {
      const imageRaw = await callGeminiGenerateContent({
        model: GEMINI_IMAGE_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: imagePrompt }]
          }
        ]
      });

      const imagePart = extractInlineImagePart(imageRaw);

      if (!imagePart?.data) {
        throw new Error(
          "Gemini image generation did not return image data."
        );
      }

      const filePath = buildStoragePath(rule.user_id, "image", "png");

      const mediaUrl = await uploadBase64ToStorage({
        bucket: POST_MEDIA_BUCKET,
        path: filePath,
        base64Data: imagePart.data,
        contentType: imagePart.mimeType || "image/png"
      });

      return {
        provider: "gemini",
        provider_model: GEMINI_IMAGE_MODEL,
        title,
        text_content: null,
        caption,
        media_url: mediaUrl,
        media_type: "image",
        status: "generated",
        publish_status: "pending",
        generation_meta: {
          image_prompt: imagePrompt,
          aspect,
          image_mode: "gemini",
          prompt_provider: promptProvider
        }
      };
    } catch (geminiImageError) {
      try {
        const workerJson = await callCustomFallbackApi({
          mode: "image",
          prompt: imagePrompt,
          aspect,
          title,
          caption
        });

        const workerImageUrl = trimText(
          workerJson?.image_url ||
            workerJson?.url ||
            workerJson?.media_url ||
            "",
          5000
        );

        if (workerImageUrl) {
          return {
            provider: "custom_fallback_api",
            provider_model: "workers-dev-image",
            title,
            text_content: null,
            caption,
            media_url: workerImageUrl,
            media_type: "image",
            status: "generated",
            publish_status: "pending",
            generation_meta: {
              image_prompt: imagePrompt,
              aspect,
              image_mode: "worker_fallback",
              prompt_provider: promptProvider,
              gemini_error: sanitizeErrorMessage(geminiImageError)
            }
          };
        }

        throw new Error("Worker API returned no image URL.");
      } catch (workerImageError) {
        const mediaUrl = await fetchPollinationsImageUrl(
          imagePrompt,
          aspect
        );

        return {
          provider: "pollinations",
          provider_model: "pollinations-free",
          title,
          text_content: null,
          caption,
          media_url: mediaUrl,
          media_type: "image",
          status: "generated",
          publish_status: "pending",
          generation_meta: {
            image_prompt: imagePrompt,
            aspect,
            image_mode: "pollinations_fallback",
            prompt_provider: promptProvider,
            gemini_error: sanitizeErrorMessage(geminiImageError),
            worker_error: sanitizeErrorMessage(workerImageError)
          }
        };
      }
    }
  }

  try {
    const workerJson = await callCustomFallbackApi({
      mode: "image",
      prompt: imagePrompt,
      aspect,
      title,
      caption
    });

    const workerImageUrl = trimText(
      workerJson?.image_url ||
        workerJson?.url ||
        workerJson?.media_url ||
        "",
      5000
    );

    if (workerImageUrl) {
      return {
        provider: "custom_fallback_api",
        provider_model: "workers-dev-image",
        title,
        text_content: null,
        caption,
        media_url: workerImageUrl,
        media_type: "image",
        status: "generated",
        publish_status: "pending",
        generation_meta: {
          image_prompt: imagePrompt,
          aspect,
          image_mode: "worker_only",
          prompt_provider: promptProvider
        }
      };
    }
  } catch {
    // continue to pollinations fallback
  }

  const mediaUrl = await fetchPollinationsImageUrl(imagePrompt, aspect);

  return {
    provider: "pollinations",
    provider_model: "pollinations-free",
    title,
    text_content: null,
    caption,
    media_url: mediaUrl,
    media_type: "image",
    status: "generated",
    publish_status: "pending",
    generation_meta: {
      image_prompt: imagePrompt,
      aspect,
      image_mode: "pollinations_only",
      prompt_provider: promptProvider
    }
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
      Authorization: `Bearer ${KLING_API_KEY}`
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
    const message =
      json?.message || json?.error || "Kling video request failed.";
    const error = new Error(message);
    error.isTemporary = isTemporaryProviderError(message);
    throw error;
  }

  const taskId = json?.task_id || json?.data?.task_id || json?.id;

  if (!taskId) {
    throw new Error("Kling did not return a task ID.");
  }

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
    .eq("id", ruleId);

  if (error) throw error;
}

function computeNextRunAt(rule) {
  const now = new Date();
  const frequency = String(rule.frequency || "daily");
  const scheduleTimes = normalizeScheduleTimes(rule);
  const next = pickNextScheduledDate(now, frequency, scheduleTimes, rule);
  return next.toISOString();
}

function normalizeScheduleTimes(rule) {
  let times = [];

  if (Array.isArray(rule.schedule_times) && rule.schedule_times.length) {
    times = rule.schedule_times;
  } else if (
    typeof rule.schedule_times === "string" &&
    rule.schedule_times.trim()
  ) {
    const parsed = safeJsonParse(rule.schedule_times, []);
    if (Array.isArray(parsed)) times = parsed;
  }

  if (!times.length && rule.post_time) {
    times = [rule.post_time];
  }

  times = times
    .map((t) => String(t || "").trim())
    .filter((t) => /^\d{2}:\d{2}$/.test(t))
    .sort();

  return times.length ? times : ["09:00"];
}

function pickNextScheduledDate(now, frequency, scheduleTimes, rule) {
  const candidates = [];

  for (const time of scheduleTimes) {
    const [hh, mm] = time.split(":").map(Number);
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    candidate.setHours(hh, mm, 0, 0);

    if (
      frequency === "three_times_daily" ||
      frequency === "twice_daily" ||
      frequency === "daily"
    ) {
      if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
      candidates.push(candidate);
      continue;
    }

    if (frequency === "every_2_days") {
      if (candidate <= now) candidate.setDate(candidate.getDate() + 2);
      candidates.push(candidate);
      continue;
    }

    if (frequency === "weekly_day") {
      const weekdayMap = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6
      };

      const target =
        weekdayMap[
          String(rule.schedule_day_of_week || "monday").toLowerCase()
        ] ?? 1;

      const diff = (target - candidate.getDay() + 7) % 7;
      candidate.setDate(candidate.getDate() + diff);

      if (candidate <= now) {
        candidate.setDate(candidate.getDate() + 7);
      }

      candidates.push(candidate);
      continue;
    }

    if (frequency === "weekly") {
      if (candidate <= now) candidate.setDate(candidate.getDate() + 7);
      candidates.push(candidate);
      continue;
    }

    if (frequency === "biweekly") {
      if (candidate <= now) candidate.setDate(candidate.getDate() + 14);
      candidates.push(candidate);
      continue;
    }

    if (frequency === "monthly") {
      const day = Math.max(
        1,
        Math.min(31, Number(rule.schedule_day_of_month || 1))
      );

      candidate.setDate(day);

      if (candidate <= now) {
        candidate.setMonth(candidate.getMonth() + 1);
        candidate.setDate(day);
      }

      candidates.push(candidate);
      continue;
    }

    if (candidate <= now) {
      candidate.setDate(candidate.getDate() + 1);
    }

    candidates.push(candidate);
  }

  candidates.sort((a, b) => a.getTime() - b.getTime());

  return candidates[0] || new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

async function updateRuleAfterSuccess(rule) {
  await updateRuleStatus(rule.id, {
    last_status: rule.is_active ? "success" : "paused",
    last_error: null,
    next_run_at: computeNextRunAt(rule)
  });
}

async function createGeneratedContent(payload) {
  const { data, error } = await supabase
    .from("auto_generated_contents")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function updateGeneratedContent(id, fields) {
  const { error } = await supabase
    .from("auto_generated_contents")
    .update({
      ...fields,
      updated_at: nowIso()
    })
    .eq("id", id);

  if (error) throw error;
}

async function createViewPost({
  user_id,
  title,
  content_type,
  text_content,
  caption,
  media_url,
  media_type,
  selected_platforms
}) {
  const normalizedType = normalizeContentType(content_type);

  let content = "";

  if (contentNeedsTextBody(normalizedType)) {
    content = text_content || caption || title || "";
  } else if (contentNeedsCaption(normalizedType)) {
    content = caption || title || "";
  } else {
    content = "";
  }

  const payload = {
    user_id,
    content: content || null,
    privacy: "public",
    selected_platforms,
    publish_status: "queued",
    status: "queued",
    media_url: media_url || null,
    media_type: media_type || (media_url ? "image" : null),
    media_path: null,
    media_name: null,
    created_at: nowIso()
  };

  const { data, error } = await supabase
    .from("posts")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function queueJobsLikeCreatePost({
  postId,
  userId,
  selectedPlatforms
}) {
  const platforms = (selectedPlatforms || [])
    .map(normalizePlatformKey)
    .filter(Boolean);

  if (!platforms.length) {
    return { queued: 0 };
  }

  const jobs = platforms.map((platform) => ({
    post_id: postId,
    user_id: userId,
    platform,
    status: "queued"
  }));

  const { error } = await supabase
    .from("post_publish_jobs")
    .insert(jobs);

  if (error) throw error;

  return { queued: jobs.length };
}

async function triggerWorkerLikeCreatePost({
  postId = null,
  userId = null
} = {}) {
  const payload = {
    limit: 20,
    concurrency: 4
  };

  if (postId) payload.post_id = postId;
  if (userId) payload.user_id = userId;

  const primaryUrl =
    process.env.PROCESS_WORKER_URL ||
    `${VIEW_BASE_URL}/api/process-publish-jobs`;

  const fallbackUrl =
    "https://view-psi-lac.vercel.app/api/process-publish-jobs";

  const urls = [...new Set([primaryUrl, fallbackUrl].filter(Boolean))];
  const errors = [];

  for (const url of urls) {
    try {
      const postResponse = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        cache: "no-store",
        body: JSON.stringify(payload)
      });

      const postRaw = await postResponse.text();
      let postJson = {};

      try {
        postJson = postRaw ? JSON.parse(postRaw) : {};
      } catch {
        postJson = { raw: postRaw };
      }

      if (postResponse.ok) {
        return {
          triggered: true,
          method: "POST",
          url,
          response: postJson
        };
      }

      errors.push(
        `POST ${url} -> ${postResponse.status}: ${
          postJson?.error || postRaw || "Worker failed"
        }`
      );
    } catch (error) {
      errors.push(`POST ${url} failed: ${sanitizeErrorMessage(error)}`);
    }

    try {
      const getResponse = await fetch(url, {
        method: "GET",
        cache: "no-store"
      });

      const getRaw = await getResponse.text();
      let getJson = {};

      try {
        getJson = getRaw ? JSON.parse(getRaw) : {};
      } catch {
        getJson = { raw: getRaw };
      }

      if (getResponse.ok) {
        return {
          triggered: true,
          method: "GET",
          url,
          response: getJson
        };
      }

      errors.push(
        `GET ${url} -> ${getResponse.status}: ${
          getJson?.error || getRaw || "Worker failed"
        }`
      );
    } catch (error) {
      errors.push(`GET ${url} failed: ${sanitizeErrorMessage(error)}`);
    }
  }

  return {
    triggered: false,
    error: errors.join(" | ")
  };
}

function mergeGenerationMeta(existing, extra) {
  let base = {};

  if (
    existing &&
    typeof existing === "object" &&
    !Array.isArray(existing)
  ) {
    base = existing;
  } else if (typeof existing === "string" && existing.trim()) {
    const parsed = safeJsonParse(existing, null);

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      base = parsed;
    }
  }

  return { ...base, ...extra };
}

function normalizeKlingStatus(payload) {
  const root = payload?.data || payload || {};

  const status = String(
    root.status ||
      root.task_status ||
      root.state ||
      root.taskState ||
      ""
  ).toLowerCase();

  let state = "processing";

  if (
    ["succeed", "succeeded", "success", "completed", "done"].includes(
      status
    )
  ) {
    state = "success";
  } else if (
    ["fail", "failed", "error", "cancelled", "canceled"].includes(
      status
    )
  ) {
    state = "failed";
  }

  const outputs = root.outputs || root.output || root.result || {};

  const videoUrl =
    outputs.video_url ||
    outputs.videoUrl ||
    outputs.url ||
    root.video_url ||
    root.videoUrl ||
    root.url ||
    null;

  const thumbnailUrl =
    outputs.thumbnail_url ||
    outputs.thumbnailUrl ||
    root.thumbnail_url ||
    root.thumbnailUrl ||
    null;

  const error =
    root.error_message ||
    root.error ||
    root.message ||
    null;

  return {
    state,
    video_url: videoUrl,
    thumbnail_url: thumbnailUrl,
    error
  };
}

function buildRunMessage(baseMessage, publishQueueResult) {
  if (!publishQueueResult) return baseMessage;

  const queued = Number(publishQueueResult.queued || 0);

  return `${baseMessage} Queued ${queued} publish job${
    queued === 1 ? "" : "s"
  }.`;
}

async function processRule(rule, options = {}) {
  const startedAt = nowIso();
  let runId = null;
  let generatedContentId = null;

  try {
    runId = await createRunLog({
      user_id: rule.user_id,
      rule_id: rule.id,
      title: rule.title,
      status: "processing",
      message: options.forced
        ? "Started manual rule processing"
        : "Started rule processing",
      started_at: startedAt
    });

    await updateRuleStatus(rule.id, {
      last_status: "processing",
      last_error: null,
      last_run_at: startedAt
    });

    const normalizedPlatforms = normalizePlatforms(
      rule.selected_platforms,
      rule.platforms_label
    );

    const prompt = buildPromptFromRule(rule);
    const normalizedType = normalizeContentType(rule.content_type);

    let generated;

    if (contentNeedsTextBody(normalizedType)) {
      generated = await generateTextWithFallbacks({ rule, prompt });
    } else if (contentNeedsImage(normalizedType)) {
      generated = await generateImageWithFallbacks({ rule, prompt });
    } else if (contentNeedsVideo(normalizedType)) {
      generated = await generateVideoWithKling({ rule, prompt });
    } else {
      generated = await generateTextWithFallbacks({ rule, prompt });
    }

    generatedContentId = await createGeneratedContent({
      user_id: rule.user_id,
      rule_id: rule.id,
      title: generated.title || rule.title,
      content_type: normalizedType,
      prompt_used: prompt,
      text_content: generated.text_content || null,
      caption: generated.caption || null,
      media_url: generated.media_url || null,
      thumbnail_url: generated.thumbnail_url || null,
      selected_platforms: normalizedPlatforms,
      platforms_label: normalizedPlatforms.join(", "),
      status: generated.status,
      publish_status: generated.publish_status || "pending",
      error_message: null,
      provider: generated.provider || null,
      provider_model: generated.provider_model || null,
      provider_task_id: generated.provider_task_id || null,
      generation_meta: generated.generation_meta || {}
    });

    if (contentNeedsVideo(normalizedType) && generated.status === "processing") {
      await finalizeRunLog(runId, {
        status: "success",
        message: "Video task submitted and waiting for completion.",
        completed_at: nowIso(),
        generated_content_id: generatedContentId
      });

      await updateRuleAfterSuccess(rule);

      return {
        rule_id: rule.id,
        run_id: runId,
        generated_content_id: generatedContentId,
        status: "processing",
        message: "Video task submitted"
      };
    }

    const postId = await createViewPost({
      user_id: rule.user_id,
      title: generated.title || rule.title,
      content_type: normalizedType,
      text_content: generated.text_content || null,
      caption: generated.caption || null,
      media_url: generated.media_url || null,
      media_type: generated.media_type || null,
      selected_platforms: normalizedPlatforms
    });

    await updateGeneratedContent(generatedContentId, {
      post_id: postId,
      status: "posted",
      publish_status: "queued",
      posted_at: nowIso()
    });

    const publishQueueResult = await queueJobsLikeCreatePost({
      postId,
      userId: rule.user_id,
      selectedPlatforms: normalizedPlatforms
    });

    let workerTriggerResult = await triggerWorkerLikeCreatePost({
      postId,
      userId: rule.user_id
    });

    if (!workerTriggerResult.triggered) {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const retryResult = await triggerWorkerLikeCreatePost({
        postId,
        userId: rule.user_id
      });

      workerTriggerResult = {
        ...workerTriggerResult,
        retry: retryResult
      };
    }

    const retryTriggered = !!workerTriggerResult?.retry?.triggered;

    if (!workerTriggerResult.triggered && !retryTriggered) {
      throw new Error(
        workerTriggerResult?.retry?.error ||
          workerTriggerResult?.error ||
          "Publish worker trigger failed"
      );
    }

    await finalizeRunLog(runId, {
      status: "success",
      message: buildRunMessage(
        "Rule processed successfully.",
        publishQueueResult
      ),
      completed_at: nowIso(),
      generated_content_id: generatedContentId
    });

    await updateRuleAfterSuccess(rule);

    return {
      rule_id: rule.id,
      run_id: runId,
      generated_content_id: generatedContentId,
      post_id: postId,
      status: "success",
      publish_queue: publishQueueResult,
      worker_trigger: workerTriggerResult
    };
  } catch (error) {
    console.error("processRule error:", rule.id, error);
    const temporary = isTemporaryProviderError(error?.message || "");

    if (runId) {
      await finalizeRunLog(runId, {
        status: temporary ? "processing" : "failed",
        message: temporary
          ? "Temporary provider overload. Retry later."
          : "Rule processing failed",
        error_message: sanitizeErrorMessage(error),
        completed_at: nowIso(),
        generated_content_id: generatedContentId
      });
    }

    await updateRuleStatus(rule.id, {
      last_status: temporary ? "processing" : "failed",
      last_error: sanitizeErrorMessage(error)
    });

    return {
      rule_id: rule.id,
      run_id: runId,
      generated_content_id: generatedContentId,
      status: temporary ? "processing" : "failed",
      error: sanitizeErrorMessage(error)
    };
  }
}

async function findLatestRunIdForItem(item) {
  const { data, error } = await supabase
    .from("auto_post_runs")
    .select("id")
    .eq("generated_content_id", item.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data?.id) return data.id;

  const fallback = await supabase
    .from("auto_post_runs")
    .select("id")
    .eq("rule_id", item.rule_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return fallback.data?.id || null;
}

async function checkOneKlingTask(item) {
  try {
    const statusResponse = await fetch(
      `${KLING_BASE_URL}/v1/videos/${encodeURIComponent(
        item.provider_task_id
      )}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${KLING_API_KEY}`
        }
      }
    );

    const statusJson = await statusResponse.json().catch(() => ({}));

    if (!statusResponse.ok) {
      throw new Error(
        statusJson?.message ||
          statusJson?.error ||
          "Kling status request failed."
      );
    }

    const normalized = normalizeKlingStatus(statusJson);
    const runId = await findLatestRunIdForItem(item);

    if (normalized.state === "processing") {
      await updateGeneratedContent(item.id, {
        generation_meta: mergeGenerationMeta(item.generation_meta, {
          last_poll_response: statusJson,
          last_polled_at: nowIso()
        })
      });

      return {
        generated_content_id: item.id,
        task_id: item.provider_task_id,
        status: "processing"
      };
    }

    if (normalized.state === "failed") {
      await updateGeneratedContent(item.id, {
        status: "failed",
        error_message:
          normalized.error || "Kling video generation failed.",
        generation_meta: mergeGenerationMeta(item.generation_meta, {
          last_poll_response: statusJson,
          failed_at: nowIso()
        })
      });

      if (runId) {
        await finalizeRunLog(runId, {
          status: "failed",
          message: "Kling video generation failed",
          error_message: normalized.error || "Kling failure",
          completed_at: nowIso()
        });
      }

      if (item.rule_id) {
        await updateRuleStatus(item.rule_id, {
          last_status: "failed",
          last_error: normalized.error || "Kling failure"
        });
      }

      return {
        generated_content_id: item.id,
        task_id: item.provider_task_id,
        status: "failed",
        error: normalized.error || "Kling failure"
      };
    }

    if (normalized.state !== "success" || !normalized.video_url) {
      return {
        generated_content_id: item.id,
        task_id: item.provider_task_id,
        status: "processing"
      };
    }

    const uploadedVideoUrl = await fetchAndUploadRemoteFile({
      userId: item.user_id,
      remoteUrl: normalized.video_url,
      prefix: "video",
      extension: "mp4",
      contentType: "video/mp4"
    });

    let thumbnailUrl = null;

    if (normalized.thumbnail_url) {
      try {
        thumbnailUrl = await fetchAndUploadRemoteFile({
          userId: item.user_id,
          remoteUrl: normalized.thumbnail_url,
          prefix: "thumbnail",
          extension: "jpg",
          contentType: "image/jpeg"
        });
      } catch (thumbError) {
        console.error("thumbnail upload error:", thumbError);
      }
    }

    const selectedPlatforms = normalizePlatforms(
      item.selected_platforms,
      item.platforms_label
    );

    const postId = await createViewPost({
      user_id: item.user_id,
      title: item.title,
      content_type: "video",
      text_content: item.text_content || null,
      caption: item.caption || null,
      media_url: uploadedVideoUrl,
      media_type: "video",
      selected_platforms: selectedPlatforms
    });

    await updateGeneratedContent(item.id, {
      media_url: uploadedVideoUrl,
      thumbnail_url: thumbnailUrl,
      post_id: postId,
      status: "posted",
      publish_status: "queued",
      posted_at: nowIso(),
      error_message: null,
      generation_meta: mergeGenerationMeta(item.generation_meta, {
        last_poll_response: statusJson,
        completed_at: nowIso()
      })
    });

    const publishQueueResult = await queueJobsLikeCreatePost({
      postId,
      userId: item.user_id,
      selectedPlatforms
    });

    let workerTriggerResult = await triggerWorkerLikeCreatePost({
      postId,
      userId: item.user_id
    });

    if (!workerTriggerResult.triggered) {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const retryResult = await triggerWorkerLikeCreatePost({
        postId,
        userId: item.user_id
      });

      workerTriggerResult = {
        ...workerTriggerResult,
        retry: retryResult
      };
    }

    const retryTriggered = !!workerTriggerResult?.retry?.triggered;

    if (!workerTriggerResult.triggered && !retryTriggered) {
      throw new Error(
        workerTriggerResult?.retry?.error ||
          workerTriggerResult?.error ||
          "Publish worker trigger failed"
      );
    }

    if (runId) {
      await finalizeRunLog(runId, {
        status: "success",
        message: buildRunMessage(
          "Kling video completed and post created.",
          publishQueueResult
        ),
        completed_at: nowIso(),
        generated_content_id: item.id
      });
    }

    if (item.rule_id) {
      const { data: rule } = await supabase
        .from("auto_post_rules")
        .select("*")
        .eq("id", item.rule_id)
        .single();

      if (rule) {
        await updateRuleAfterSuccess(rule);
      }
    }

    return {
      generated_content_id: item.id,
      task_id: item.provider_task_id,
      post_id: postId,
      status: "success",
      publish_queue: publishQueueResult,
      worker_trigger: workerTriggerResult
    };
  } catch (error) {
    console.error("checkOneKlingTask error:", item.id, error);

    await updateGeneratedContent(item.id, {
      error_message: sanitizeErrorMessage(error),
      generation_meta: mergeGenerationMeta(item.generation_meta, {
        last_poll_error: sanitizeErrorMessage(error),
        last_polled_at: nowIso()
      })
    });

    return {
      generated_content_id: item.id,
      task_id: item.provider_task_id,
      status: "error",
      error: sanitizeErrorMessage(error)
    };
  }
}

async function lockRule(ruleId) {
  const lockId = crypto.randomUUID();

  const { data, error } = await supabase
    .from("auto_post_rules")
    .update({
      last_status: "processing",
      processing_lock_id: lockId,
      processing_started_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", ruleId)
    .or("last_status.is.null,last_status.neq.processing")
    .select("id")
    .maybeSingle();

  if (error) throw error;

  return data?.id ? lockId : null;
}

async function unlockRule(ruleId, lockId) {
  try {
    await supabase
      .from("auto_post_rules")
      .update({
        processing_lock_id: null,
        processing_started_at: null,
        updated_at: nowIso()
      })
      .eq("id", ruleId)
      .eq("processing_lock_id", lockId);
  } catch (error) {
    console.error("unlockRule error:", error);
  }
}

async function handleTestRun(req, res, body) {
  const ruleId =
    req.query?.rule_id ||
    body?.rule_id ||
    req.query?.id ||
    body?.id;

  if (!ruleId) {
    return res.status(400).json({
      ok: false,
      error: "Missing rule_id"
    });
  }

  const { data: rule, error: ruleError } = await supabase
    .from("auto_post_rules")
    .select("*")
    .eq("id", ruleId)
    .single();

  if (ruleError || !rule) {
    return res.status(404).json({
      ok: false,
      error: "Rule not found"
    });
  }

  const result = await processRule(rule, { forced: true });

  return res.status(result.status === "failed" ? 500 : 200).json({
    ok: result.status !== "failed",
    action: "test",
    triggered_rule_id: ruleId,
    result
  });
}

async function handleRunDueRules(req, res, body) {
  const forcedRuleId =
    req.headers["x-force-rule-id"] ||
    req.query?.rule_id ||
    body?.rule_id ||
    null;

  let rules = [];

  if (forcedRuleId) {
    const { data: forcedRule, error: forcedRuleError } = await supabase
      .from("auto_post_rules")
      .select("*")
      .eq("id", forcedRuleId)
      .single();

    if (forcedRuleError || !forcedRule) {
      return res.status(404).json({
        ok: false,
        error: "Forced rule not found"
      });
    }

    rules = [forcedRule];
  } else {
    const { data, error } = await supabase
      .from("auto_post_rules")
      .select("*")
      .eq("is_active", true)
      .lte("next_run_at", nowIso())
      .order("next_run_at", { ascending: true })
      .limit(AUTO_POST_BATCH_LIMIT);

    if (error) throw error;

    rules = data || [];
  }

  if (!rules.length) {
    return res.status(200).json({
      ok: true,
      action: "run",
      processed: 0,
      message: "No due rules found."
    });
  }

  const results = [];

  for (const rule of rules) {
    let lockId = null;

    try {
      lockId = await lockRule(rule.id);

      if (!lockId && !forcedRuleId) {
        results.push({
          rule_id: rule.id,
          status: "skipped",
          message: "Rule is already processing"
        });
        continue;
      }

      const result = await processRule(rule, {
        forced: !!forcedRuleId
      });

      results.push(result);
    } finally {
      if (lockId) {
        await unlockRule(rule.id, lockId);
      }
    }
  }

  return res.status(200).json({
    ok: true,
    action: "run",
    processed: results.length,
    forced: !!forcedRuleId,
    results
  });
}

async function handleCheckKlingTasks(req, res) {
  const { data: pendingItems, error } = await supabase
    .from("auto_generated_contents")
    .select("*")
    .eq("media_type", "video")
    .eq("status", "processing")
    .not("provider_task_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(AUTO_POST_VIDEO_POLL_BATCH);

  if (error) throw error;

  if (!pendingItems || !pendingItems.length) {
    return res.status(200).json({
      ok: true,
      action: "check",
      processed: 0,
      message: "No processing Kling video jobs found."
    });
  }

  const results = [];

  for (const item of pendingItems) {
    results.push(await checkOneKlingTask(item));
  }

  return res.status(200).json({
    ok: true,
    action: "check",
    processed: results.length,
    results
  });
}
