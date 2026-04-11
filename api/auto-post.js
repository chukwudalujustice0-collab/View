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
const KLING_VIDEO_MODEL = process.env.KLING_VIDEO_MODEL || "kling-v2.6-pro";

const POST_MEDIA_BUCKET = process.env.POST_MEDIA_BUCKET || "post-media";
const AUTO_POST_BATCH_LIMIT = Number(process.env.AUTO_POST_BATCH_LIMIT || 5);
const AUTO_POST_VIDEO_POLL_BATCH = Number(process.env.AUTO_POST_VIDEO_POLL_BATCH || 10);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

module.exports = async function handler(req, res) {
  // CORS
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

    const action = String(
      req.query?.action ||
      req.body?.action ||
      ""
    ).trim().toLowerCase();

    if (!action) {
      return res.status(400).json({
        ok: false,
        error: "Missing action. Use action=test, action=run, or action=check"
      });
    }

    if (action === "test") {
      return await handleTestRun(req, res);
    }

    if (action === "run") {
      return await handleRunDueRules(req, res);
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

async function handleTestRun(req, res) {
  const ruleId =
    req.query?.rule_id ||
    req.body?.rule_id ||
    req.query?.id ||
    req.body?.id;

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

async function handleRunDueRules(req, res) {
  const forcedRuleId =
    req.headers["x-force-rule-id"] ||
    req.query?.rule_id ||
    req.body?.rule_id ||
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
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from("auto_post_rules")
      .select("*")
      .eq("is_active", true)
      .lte("next_run_at", nowIso)
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
    const result = await processRule(rule, { forced: !!forcedRuleId });
    results.push(result);
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
    .eq("content_type", "video")
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
    const result = await checkOneKlingTask(item);
    results.push(result);
  }

  return res.status(200).json({
    ok: true,
    action: "check",
    processed: results.length,
    results
  });
}

async function processRule(rule, options = {}) {
  const startedAt = new Date().toISOString();
  let runId = null;
  let generatedContentId = null;

  try {
    runId = await createRunLog({
      user_id: rule.user_id,
      rule_id: rule.id,
      title: rule.title,
      status: "processing",
      message: options.forced ? "Started manual rule processing" : "Started rule processing",
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

async function checkOneKlingTask(item) {
  try {
    const statusResponse = await fetch(`${KLING_BASE_URL}/v1/videos/${encodeURIComponent(item.provider_task_id)}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${KLING_API_KEY}`
      }
    });

    const statusJson = await statusResponse.json().catch(() => ({}));

    if (!statusResponse.ok) {
      throw new Error(statusJson?.message || statusJson?.error || "Kling status request failed.");
    }

    const normalized = normalizeKlingStatus(statusJson);
    const runId = await findLatestRunIdForItem(item);

    if (normalized.state === "processing") {
      await updateGeneratedContent(item.id, {
        generation_meta: mergeGenerationMeta(item.generation_meta, {
          last_poll_response: statusJson,
          last_polled_at: new Date().toISOString()
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
        error_message: normalized.error || "Kling video generation failed.",
        generation_meta: mergeGenerationMeta(item.generation_meta, {
          last_poll_response: statusJson,
          failed_at: new Date().toISOString()
        })
      });

      if (runId) {
        await finalizeRunLog(runId, {
          status: "failed",
          message: "Kling video generation failed",
          error_message: normalized.error || "Kling failure",
          completed_at: new Date().toISOString()
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

    const postId = await createViewPost({
      user_id: item.user_id,
      title: item.title,
      content_type: "video",
      text_content: item.text_content || null,
      caption: item.caption || null,
      media_url: uploadedVideoUrl,
      selected_platforms: normalizePlatforms(item.selected_platforms, item.platforms_label)
    });

    await updateGeneratedContent(item.id, {
      media_url: uploadedVideoUrl,
      thumbnail_url: thumbnailUrl,
      post_id: postId,
      status: "posted",
      publish_status: "queued",
      posted_at: new Date().toISOString(),
      error_message: null,
      generation_meta: mergeGenerationMeta(item.generation_meta, {
        last_poll_response: statusJson,
        completed_at: new Date().toISOString()
      })
    });

    await queueCrossPostJobs({
      user_id: item.user_id,
      post_id: postId,
      platforms: normalizePlatforms(item.selected_platforms, item.platforms_label)
    });

    if (runId) {
      await finalizeRunLog(runId, {
        status: "success",
        message: "Kling video completed and post created.",
        completed_at: new Date().toISOString(),
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
      status: "success"
    };
  } catch (error) {
    console.error("checkOneKlingTask error:", item.id, error);

    await updateGeneratedContent(item.id, {
      error_message: error?.message || "Unknown polling error",
      generation_meta: mergeGenerationMeta(item.generation_meta, {
        last_poll_error: error?.message || "Unknown polling error",
        last_polled_at: new Date().toISOString()
      })
    });

    return {
      generated_content_id: item.id,
      task_id: item.provider_task_id,
      status: "error",
      error: error?.message || "Unknown polling error"
    };
  }
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
      model: KLING_VIDEO_MODEL,
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
    provider_model: KLING_VIDEO_MODEL,
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

async function callGeminiGenerateContent({ model, contents, responseMimeType }) {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY.");
  }

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

  if (rule.frequency === "every_2_days") next.setDate(next.getDate() + 2);
  else if (rule.frequency === "weekly") next.setDate(next.getDate() + 7);
  else next.setDate(next.getDate() + 1);

  return next.toISOString();
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
      updated_at: new Date().toISOString()
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
  if (["succeed", "succeeded", "success", "completed", "done"].includes(status)) state = "success";
  else if (["fail", "failed", "error", "cancelled", "canceled"].includes(status)) state = "failed";

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

async function fetchAndUploadRemoteFile({ userId, remoteUrl, prefix, extension, contentType }) {
  const response = await fetch(remoteUrl);
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

  const { data } = supabase.storage.from(POST_MEDIA_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

function mergeGenerationMeta(existing, extra) {
  let base = {};

  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    base = existing;
  } else if (typeof existing === "string" && existing.trim()) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed;
      }
    } catch (_) {}
  }

  return {
    ...base,
    ...extra
  };
}
