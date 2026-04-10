const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KLING_API_KEY = process.env.KLING_API_KEY;
const KLING_BASE_URL = (process.env.KLING_BASE_URL || "https://api.klingapi.com").replace(/\/+$/, "");
const AUTO_POST_CRON_SECRET = process.env.AUTO_POST_CRON_SECRET;
const POST_MEDIA_BUCKET = process.env.POST_MEDIA_BUCKET || "post-media";
const BATCH_LIMIT = Number(process.env.AUTO_POST_VIDEO_POLL_BATCH || 10);

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

    const { data: pendingItems, error } = await supabase
      .from("auto_generated_contents")
      .select("*")
      .eq("content_type", "video")
      .eq("status", "processing")
      .not("provider_task_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (error) throw error;

    if (!pendingItems || !pendingItems.length) {
      return res.status(200).json({
        ok: true,
        processed: 0,
        message: "No processing Kling video jobs found."
      });
    }

    const results = [];
    for (const item of pendingItems) {
      const result = await checkOneTask(item);
      results.push(result);
    }

    return res.status(200).json({
      ok: true,
      processed: results.length,
      results
    });
  } catch (error) {
    console.error("check-kling-task fatal error:", error);
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

async function checkOneTask(item) {
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

    const uploadedVideoUrl = await fetchAndUploadRemoteVideo({
      userId: item.user_id,
      remoteUrl: normalized.video_url
    });

    let thumbnailUrl = null;
    if (normalized.thumbnail_url) {
      try {
        thumbnailUrl = await fetchAndUploadRemoteThumbnail({
          userId: item.user_id,
          remoteUrl: normalized.thumbnail_url
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
    console.error("checkOneTask error:", item.id, error);

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
  else state = "processing";

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
    next_run_at: nextRunAt,
    last_run_at: new Date().toISOString()
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
  const mediaType = content_type === "video" ? "video" : "text";

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

async function fetchAndUploadRemoteVideo({ userId, remoteUrl }) {
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error("Unable to download generated Kling video.");
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const filePath = buildStoragePath(userId, "video", "mp4");

  const { error } = await supabase.storage
    .from(POST_MEDIA_BUCKET)
    .upload(filePath, buffer, {
      contentType: "video/mp4",
      upsert: false
    });

  if (error) throw error;

  const { data } = supabase.storage.from(POST_MEDIA_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

async function fetchAndUploadRemoteThumbnail({ userId, remoteUrl }) {
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error("Unable to download generated thumbnail.");
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const filePath = buildStoragePath(userId, "thumbnail", "jpg");

  const { error } = await supabase.storage
    .from(POST_MEDIA_BUCKET)
    .upload(filePath, buffer, {
      contentType: "image/jpeg",
      upsert: false
    });

  if (error) throw error;

  const { data } = supabase.storage.from(POST_MEDIA_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

function buildStoragePath(userId, prefix, extension) {
  const id = crypto.randomUUID();
  const date = new Date().toISOString().slice(0, 10);
  return `auto-post/${userId}/${prefix}/${date}/${id}.${extension}`;
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
