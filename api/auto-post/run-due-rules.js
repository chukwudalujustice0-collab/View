const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const KLING_API_KEY = process.env.KLING_API_KEY;
const KLING_BASE_URL = (process.env.KLING_BASE_URL || "https://api.klingapi.com").replace(/\/+$/, "");
const AUTO_POST_CRON_SECRET = process.env.AUTO_POST_CRON_SECRET;

const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "nano-banana";
const POST_MEDIA_BUCKET = process.env.POST_MEDIA_BUCKET || "post-media";
const BATCH_LIMIT = Number(process.env.AUTO_POST_BATCH_LIMIT || 5);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const nowIso = new Date().toISOString();

    const { data: dueRules, error: dueRulesError } = await supabase
      .from("auto_post_rules")
      .select("*")
      .eq("is_active", true)
      .lte("next_run_at", nowIso)
      .order("next_run_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (dueRulesError) {
      throw dueRulesError;
    }

    if (!dueRules || !dueRules.length) {
      return res.status(200).json({
        ok: true,
        message: "No due rules found.",
        processed: 0
      });
    }

    const results = [];

    for (const rule of dueRules) {
      const result = await processRule(rule);
      results.push(result);
    }

    return res.status(200).json({
      ok: true,
      processed: results.length,
      results
    });
  } catch (error) {
    console.error("run-due-rules fatal error:", error);
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

async function processRule(rule) {
  const startedAt = new Date().toISOString();
  let runId = null;
  let generatedContentId = null;

  try {
    runId = await createRunLog({
      user_id: rule.user_id,
      rule_id: rule.id,
      title: rule.title,
      status: "processing",
      message: "Started rule processing",
      started_at: startedAt
    });

    await updateRuleStatus(rule.id, {
      last_status: "processing",
      last_error: null,
      last_run_at: startedAt
    });

    const normalizedPlatforms = normalizePlatforms(rule.selected_platforms, rule.platforms_label);
    const prompt = buildPromptFromRule(rule);

    let generated;

    if (rule.content_type === "text") {
      generated = await generateTextWithGemini({ rule, prompt });
    } else if (rule.content_type === "image") {
      generated = await generateImageWithGemini({ rule, prompt });
    } else if (rule.content_type === "video") {
      generated = await generateVideoWithKling({ rule, prompt });
    } else {
      throw new Error(`Unsupported content_type: ${rule.content_type}`);
    }

    generatedContentId = await createGeneratedContent({
      user_id: rule.user_id,
      rule_id: rule.id,
      title: generated.title || rule.title,
      content_type: rule.content_type,
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

    let postId = null;

    if (rule.content_type === "video" && generated.status === "processing") {
      await finalizeRunLog(runId, {
        status: "success",
        message: "Video task submitted to Kling and waiting for completion.",
        completed_at: new Date().toISOString(),
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

    postId = await createViewPost({
      user_id: rule.user_id,
      title: generated.title || rule.title,
      content_type: rule.content_type,
      text_content: generated.text_content || null,
      caption: generated.caption || null,
      media_url: generated.media_url || null,
      selected_platforms: normalizedPlatforms
    });

    await supabase
      .from("auto_generated_contents")
      .update({
        post_id: postId,
        status: "posted",
        publish_status: "queued",
        posted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", generatedContentId);

    await queueCrossPostJobs({
      user_id: rule.user_id,
      post_id: postId,
      platforms: normalizedPlatforms
    });

    await finalizeRunLog(runId, {
      status: "success",
      message: "Rule processed successfully.",
      completed_at: new Date().toISOString(),
      generated_content_id: generatedContentId
    });

    await updateRuleAfterSuccess(rule);

    return {
      rule_id: rule.id,
      run_id: runId,
      generated_content_id: generatedContentId,
      post_id: postId,
      status: "success"
    };
  } catch (error) {
    console.error("processRule error:", rule.id, error);

    if (runId) {
      await finalizeRunLog(runId, {
        status: "failed",
        message: "Rule processing failed",
        error_message: error?.message || "Unknown error",
        completed_at: new Date().toISOString(),
        generated_content_id: generatedContentId
      });
    }

    await updateRuleStatus(rule.id, {
      last_status: "failed",
      last_error: error?.message || "Unknown error"
    });

    return {
      rule_id: rule.id,
      run_id: runId,
      generated_content_id: generatedContentId,
      status: "failed",
      error: error?.message || "Unknown error"
    };
  }
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
      updated_at: new Date().toISOString()
    })
    .eq("id", runId);

  if (error) throw error;
}

async function updateRuleStatus(ruleId, fields) {
  const { error } = await supabase
    .from("auto_post_rules")
    .update({
      ...fields,
      updated_at: new Date().toISOString()
    })
    .eq("id", ruleId);

  if (error) throw error;
}

async function updateRuleAfterSuccess(rule) {
  const nextRunAt = computeNextRunAt(rule);
  await updateRuleStatus(rule.id, {
    last_status: rule.is_active ? "success" : "paused",
    last_error: null,
    next_run_at: nextRunAt
  });
}

function computeNextRunAt(rule) {
  const base = new Date();
  const [hh, mm] = String(rule.post_time || "09:00").split(":").map(Number);

  const next = new Date(base);
  next.setSeconds(0, 0);
  next.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);

  if (rule.frequency === "every_2_days") {
    next.setDate(next.getDate() + 2);
  } else if (rule.frequency === "weekly") {
    next.setDate(next.getDate() + 7);
  } else {
    next.setDate(next.getDate() + 1);
  }

  return next.toISOString();
}

function normalizePlatforms(selectedPlatforms, platformsLabel) {
  if (Array.isArray(selectedPlatforms) && selectedPlatforms.length) {
    return selectedPlatforms.map(String).map(v => v.toLowerCase());
  }

  if (typeof selectedPlatforms === "string" && selectedPlatforms.trim()) {
    try {
      const parsed = JSON.parse(selectedPlatforms);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map(String).map(v => v.toLowerCase());
      }
    } catch (_) {}
  }

  if (platformsLabel) {
    return String(platformsLabel)
      .split(",")
      .map(v => v.trim().toLowerCase())
      .filter(Boolean);
  }

  return ["view"];
}

function buildPromptFromRule(rule) {
  const pieces = [];

  if (rule.prompt_template) pieces.push(String(rule.prompt_template).trim());
  else if (rule.topic) pieces.push(String(rule.topic).trim());

  if (rule.caption_style) pieces.push(`Caption style: ${rule.caption_style}.`);
  if (rule.visual_style && rule.content_type !== "text") pieces.push(`Visual style: ${rule.visual_style}.`);

  if (rule.content_type === "text") {
    pieces.push("Return a strong social media title, the main text content, and a short caption.");
  } else if (rule.content_type === "image") {
    pieces.push("Generate a social-media-ready image concept and a strong caption for posting.");
  } else if (rule.content_type === "video") {
    pieces.push("Create a short vertical video concept suitable for social media posting.");
  }

  return pieces.filter(Boolean).join("\n");
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

async function createViewPost({
  user_id,
  title,
  content_type,
  text_content,
  caption,
  media_url,
  selected_platforms
}) {
  const content = text_content || caption || title || "";
  const mediaType =
    content_type === "image" ? "image" :
    content_type === "video" ? "video" :
    "text";

  const payload = {
    user_id,
    content,
    media_url: media_url || null,
    media_type: mediaType,
    selected_platforms,
    publish_status: "queued",
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("posts")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function queueCrossPostJobs({ user_id, post_id, platforms }) {
  const externalPlatforms = platforms.filter(p => p !== "view");
  if (!externalPlatforms.length) return;

  const rows = externalPlatforms.map(platform => ({
    user_id,
    post_id,
    platform,
    status: "queued",
    attempts: 0,
    created_at: new Date().toISOString()
  }));

  const { error } = await supabase.from("post_publish_jobs").insert(rows);
  if (error) throw error;
}

async function generateTextWithGemini({ rule, prompt }) {
  const raw = await callGeminiGenerateContent({
    model: GEMINI_TEXT_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: `${prompt}\n\nReturn JSON with keys: title, text_content, caption.` }]
      }
    ],
    responseMimeType: "application/json"
  });

  const text = extractTextFromGemini(raw);
  const parsed = safeJsonParse(text);

  return {
    provider: "gemini",
    provider_model: GEMINI_TEXT_MODEL,
    title: parsed?.title || rule.title,
    text_content: parsed?.text_content || text,
    caption: parsed?.caption || parsed?.text_content || text,
    status: "generated",
    publish_status: "pending",
    generation_meta: { raw_text: text }
  };
}

async function generateImageWithGemini({ rule, prompt }) {
  const captionRaw = await callGeminiGenerateContent({
    model: GEMINI_TEXT_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: `${prompt}\n\nReturn JSON with keys: title, caption, image_prompt.` }]
      }
    ],
    responseMimeType: "application/json"
  });

  const captionText = extractTextFromGemini(captionRaw);
  const captionParsed = safeJsonParse(captionText) || {};
  const imagePrompt = captionParsed.image_prompt || prompt;

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
    throw new Error("Gemini image generation did not return image data.");
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
    title: captionParsed.title || rule.title,
    caption: captionParsed.caption || rule.title,
    media_url: mediaUrl,
    status: "generated",
    publish_status: "pending",
    generation_meta: { image_prompt: imagePrompt }
  };
}

async function generateVideoWithKling({ rule, prompt }) {
  const prepRaw = await callGeminiGenerateContent({
    model: GEMINI_TEXT_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: `${prompt}\n\nReturn JSON with keys: title, caption, video_prompt.` }]
      }
    ],
    responseMimeType: "application/json"
  });

  const prepText = extractTextFromGemini(prepRaw);
  const prepParsed = safeJsonParse(prepText) || {};
  const videoPrompt = prepParsed.video_prompt || prompt;

  const response = await fetch(`${KLING_BASE_URL}/v1/videos/text2video`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${KLING_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.KLING_VIDEO_MODEL || "kling-v2.1",
      prompt: videoPrompt,
      duration: Number(process.env.KLING_VIDEO_DURATION || 5),
      aspect_ratio: process.env.KLING_VIDEO_ASPECT_RATIO || "9:16",
      mode: process.env.KLING_VIDEO_MODE || "standard"
    })
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.message || json?.error || "Kling video request failed.");
  }

  const taskId = json?.task_id || json?.data?.task_id || json?.id;
  if (!taskId) {
    throw new Error("Kling did not return a task ID.");
  }

  return {
    provider: "kling",
    provider_model: process.env.KLING_VIDEO_MODEL || "kling-v2.1",
    provider_task_id: taskId,
    title: prepParsed.title || rule.title,
    caption: prepParsed.caption || rule.title,
    status: "processing",
    publish_status: "pending",
    generation_meta: {
      video_prompt: videoPrompt,
      kling_response: json
    }
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

  const body = {
    contents
  };

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

function extractTextFromGemini(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map(part => part?.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();

  if (text) return text;
  return "";
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

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
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
