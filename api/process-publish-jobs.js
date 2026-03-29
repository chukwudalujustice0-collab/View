import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL_VALUE,
  process.env.SUPABASE_SERVICE_KEY
);

const MAX_ATTEMPTS = 4;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const nowIso = new Date().toISOString();

    const { data: jobs, error: jobsError } = await supabase
      .from("post_publish_jobs")
      .select(`
        id,
        post_id,
        user_id,
        platform,
        status,
        attempts,
        next_retry_at,
        last_error,
        posts:post_id (
          id,
          user_id,
          content,
          privacy,
          selected_platforms,
          publish_status,
          media_name,
          media_type,
          media_path,
          media_url,
          created_at
        )
      `)
      .in("status", ["queued", "retrying"])
      .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
      .order("created_at", { ascending: true })
      .limit(20);

    if (jobsError) throw jobsError;

    const results = [];

    for (const job of jobs || []) {
      const result = await processOneJob(job);
      results.push(result);
    }

    return res.status(200).json({
      ok: true,
      processed: results.length,
      results
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Worker failed"
    });
  }
}

async function processOneJob(job) {
  const startedAt = new Date().toISOString();

  await supabase
    .from("post_publish_jobs")
    .update({
      status: "processing",
      started_at: startedAt,
      updated_at: startedAt
    })
    .eq("id", job.id);

  try {
    const post = job.posts;
    if (!post) throw new Error("Post not found.");

    validatePlatformContent(job.platform, post);

    let publishResult;

    if (job.platform === "view") {
      publishResult = {
        platform_post_id: post.id,
        response_payload: { ok: true, local: true }
      };
    } else {
      const account = await getConnectedAccount(job.user_id, job.platform);
      const validAccount = await ensureValidToken(account);
      publishResult = await publishToPlatform(job.platform, validAccount, post);
    }

    const finishedAt = new Date().toISOString();

    await supabase
      .from("post_publish_jobs")
      .update({
        status: "success",
        attempts: (job.attempts || 0) + 1,
        platform_post_id: publishResult.platform_post_id || null,
        response_payload: publishResult.response_payload || null,
        delivered_at: finishedAt,
        finished_at: finishedAt,
        next_retry_at: null,
        last_error: null,
        updated_at: finishedAt
      })
      .eq("id", job.id);

    await supabase
      .from("post_publish_logs")
      .insert({
        post_id: job.post_id,
        job_id: job.id,
        user_id: job.user_id,
        platform: job.platform,
        status: "success",
        platform_post_id: publishResult.platform_post_id || null,
        response_payload: publishResult.response_payload || null,
        attempts: (job.attempts || 0) + 1
      });

    await refreshPostSummary(job.post_id);

    return {
      job_id: job.id,
      status: "success",
      message: "Delivered"
    };
  } catch (error) {
    const attempts = (job.attempts || 0) + 1;
    const message = error.message || "Unknown error";
    const finishedAt = new Date().toISOString();

    const shouldRetry = attempts < MAX_ATTEMPTS && isRetryableError(message);
    const nextStatus = shouldRetry ? "retrying" : "failed";
    const retryAt = shouldRetry ? computeNextRetry(attempts) : null;

    await supabase
      .from("post_publish_jobs")
      .update({
        status: nextStatus,
        attempts,
        last_error: message,
        next_retry_at: retryAt,
        finished_at: finishedAt,
        updated_at: finishedAt
      })
      .eq("id", job.id);

    await supabase
      .from("post_publish_logs")
      .insert({
        post_id: job.post_id,
        job_id: job.id,
        user_id: job.user_id,
        platform: job.platform,
        status: nextStatus,
        error_message: message,
        attempts
      });

    await refreshPostSummary(job.post_id);

    return {
      job_id: job.id,
      status: nextStatus,
      message
    };
  }
}

function validatePlatformContent(platform, post) {
  const mediaType = post.media_type || "";
  const hasMedia = !!post.media_url;
  const isVideo = mediaType.startsWith("video/");
  const isImage = mediaType.startsWith("image/");
  const hasText = !!(post.content && post.content.trim());

  if (platform === "view") return;
  if (platform === "youtube" && !isVideo) throw new Error("YouTube requires a video.");
  if (platform === "tiktok" && !isVideo) throw new Error("TikTok requires a video.");
  if (platform === "instagram" && !(isImage || isVideo)) throw new Error("Instagram requires image or video.");
  if (platform === "facebook" && !hasText && !hasMedia) throw new Error("Facebook requires text or media.");
  if (platform === "x" && !hasText && !hasMedia) throw new Error("X requires text or media.");
  if (platform === "whatsapp" && !hasText && !hasMedia) throw new Error("WhatsApp requires text or media.");
  if (platform === "telegram" && !hasText && !hasMedia) throw new Error("Telegram requires text or media.");
}

function isRetryableError(message) {
  const text = String(message || "").toLowerCase();

  const nonRetryable = [
    "not connected",
    "requires a video",
    "requires image or video",
    "requires text or media",
    "page id missing",
    "reconnect account",
    "permission",
    "unsupported",
    "invalid_grant"
  ];

  if (nonRetryable.some(x => text.includes(x))) return false;
  return true;
}

function computeNextRetry(attempt) {
  const now = new Date();
  let minutes = 2;

  if (attempt === 1) minutes = 2;
  else if (attempt === 2) minutes = 10;
  else if (attempt === 3) minutes = 30;
  else minutes = 60;

  now.setMinutes(now.getMinutes() + minutes);
  return now.toISOString();
}

async function getConnectedAccount(userId, platform) {
  const { data, error } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", platform)
    .eq("status", "connected")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`${platform} account not connected.`);
  return data;
}

async function ensureValidToken(account) {
  if (!account.access_token) {
    throw new Error(`No access token for ${account.platform}.`);
  }

  if (!account.token_expires_at) {
    return account;
  }

  const expiresAt = new Date(account.token_expires_at).getTime();
  const now = Date.now();

  if (expiresAt > now + 60000) {
    return account;
  }

  if (!account.refresh_token) {
    throw new Error(`${account.platform} token expired. Reconnect account.`);
  }

  if (account.platform === "youtube") {
    return await refreshGoogleToken(account);
  }

  return account;
}

async function refreshGoogleToken(account) {
  const form = new URLSearchParams();
  form.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
  form.set("client_secret", process.env.GOOGLE_CLIENT_SECRET || "");
  form.set("refresh_token", account.refresh_token);
  form.set("grant_type", "refresh_token");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Google token refresh failed.");
  }

  const tokenExpiresAt = new Date(
    Date.now() + Number(data.expires_in || 3600) * 1000
  ).toISOString();

  const { error } = await supabase
    .from("connected_accounts")
    .update({
      access_token: data.access_token,
      token_type: data.token_type || "Bearer",
      token_expires_at: tokenExpiresAt,
      last_synced_at: new Date().toISOString(),
      last_error: null
    })
    .eq("id", account.id);

  if (error) throw new Error(error.message);

  return {
    ...account,
    access_token: data.access_token,
    token_type: data.token_type || "Bearer",
    token_expires_at: tokenExpiresAt
  };
}

async function publishToPlatform(platform, account, post) {
  switch (platform) {
    case "facebook":
      return await publishToFacebook(account, post);
    case "instagram":
      return await publishToInstagram(account, post);
    case "whatsapp":
      return await publishToWhatsApp(account, post);
    case "tiktok":
      return await publishToTikTok(account, post);
    case "x":
      return await publishToX(account, post);
    case "telegram":
      return await publishToTelegram(account, post);
    case "youtube":
      return await publishToYouTube(account, post);
    default:
      throw new Error(`${platform} publishing not implemented.`);
  }
}

async function publishToFacebook(account, post) {
  const pageId = account.external_page_id || account.external_user_id;
  if (!pageId) throw new Error("Facebook page ID missing.");

  const form = new URLSearchParams();
  form.set("access_token", account.access_token);

  if (post.media_url) {
    form.set("url", post.media_url);
    if (post.content) form.set("caption", post.content);

    const response = await fetch(`https://graph.facebook.com/v23.0/${pageId}/photos`, {
      method: "POST",
      body: form
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "Facebook photo publish failed.");

    return {
      platform_post_id: data.post_id || data.id || null,
      response_payload: data
    };
  }

  form.set("message", post.content || "");

  const response = await fetch(`https://graph.facebook.com/v23.0/${pageId}/feed`, {
    method: "POST",
    body: form
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Facebook post publish failed.");

  return {
    platform_post_id: data.id || null,
    response_payload: data
  };
}

async function publishToInstagram(account, post) {
  return {
    platform_post_id: `instagram-pending-${post.id}`,
    response_payload: { ok: true, mode: "stub", message: "Instagram real API next." }
  };
}

async function publishToWhatsApp(account, post) {
  return {
    platform_post_id: `whatsapp-pending-${post.id}`,
    response_payload: { ok: true, mode: "stub", message: "WhatsApp real API next." }
  };
}

async function publishToTikTok(account, post) {
  return {
    platform_post_id: `tiktok-pending-${post.id}`,
    response_payload: { ok: true, mode: "stub", message: "TikTok real API next." }
  };
}

async function publishToX(account, post) {
  return {
    platform_post_id: `x-pending-${post.id}`,
    response_payload: { ok: true, mode: "stub", message: "X real API next." }
  };
}

async function publishToTelegram(account, post) {
  return {
    platform_post_id: `telegram-pending-${post.id}`,
    response_payload: { ok: true, mode: "stub", message: "Telegram real API next." }
  };
}

async function publishToYouTube(account, post) {
  return {
    platform_post_id: `youtube-pending-${post.id}`,
    response_payload: { ok: true, mode: "stub", message: "YouTube real API next." }
  };
}

async function refreshPostSummary(postId) {
  const { data: jobs, error } = await supabase
    .from("post_publish_jobs")
    .select("status")
    .eq("post_id", postId);

  if (error || !jobs) return;

  const statuses = jobs.map(j => j.status);
  let publishStatus = "queued";

  if (statuses.length && statuses.every(s => s === "success")) {
    publishStatus = "success";
  } else if (statuses.some(s => s === "processing")) {
    publishStatus = "processing";
  } else if (statuses.some(s => s === "retrying")) {
    publishStatus = "retrying";
  } else if (statuses.some(s => s === "failed") && statuses.some(s => s === "success")) {
    publishStatus = "partial";
  } else if (statuses.length && statuses.every(s => s === "failed")) {
    publishStatus = "failed";
  } else if (statuses.some(s => s === "queued")) {
    publishStatus = "queued";
  }

  await supabase
    .from("posts")
    .update({ publish_status: publishStatus })
    .eq("id", postId);
}
