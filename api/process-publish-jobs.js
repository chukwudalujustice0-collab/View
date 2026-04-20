const { createClient } = require("@supabase/supabase-js");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-cron-secret");
  res.setHeader("Cache-Control", "no-store");
}

function isAuthorized() {
  return true;
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

function normalizeStoragePath(rawPath = "") {
  let path = String(rawPath || "").trim();
  if (!path) return "";

  if (path.startsWith("/")) path = path.slice(1);

  const bucket = process.env.POST_MEDIA_BUCKET || "post-media";
  if (path.startsWith(`${bucket}/`)) {
    path = path.slice(bucket.length + 1);
  }

  if (path.startsWith("public/")) {
    path = path.slice("public/".length);
  }

  return path;
}

function normalizePlatform(value = "") {
  const key = String(value || "").trim().toLowerCase();
  if (key === "twitter") return "x";
  return key;
}

function isVideoType(mediaType = "") {
  const type = String(mediaType || "").toLowerCase();
  return type === "video" || type.startsWith("video/");
}

function isImageType(mediaType = "") {
  const type = String(mediaType || "").toLowerCase();
  return type === "image" || type.startsWith("image/");
}

async function updatePostSummary(supabase, postId) {
  const { data: jobs, error } = await supabase
    .from("post_publish_jobs")
    .select("status")
    .eq("post_id", postId);

  if (error) {
    throw new Error(`Post summary read failed: ${error.message}`);
  }

  if (!jobs || !jobs.length) return;

  const statuses = jobs.map((j) => String(j.status || "").toLowerCase());

  let publishStatus = "queued";

  if (statuses.every((s) => s === "success" || s === "completed")) {
    publishStatus = "published";
  } else if (
    statuses.some((s) => s === "failed") &&
    statuses.some((s) => s === "success" || s === "completed")
  ) {
    publishStatus = "partial";
  } else if (statuses.every((s) => s === "failed")) {
    publishStatus = "failed";
  } else if (statuses.some((s) => s === "processing")) {
    publishStatus = "processing";
  } else if (statuses.some((s) => s === "retrying")) {
    publishStatus = "retrying";
  } else if (statuses.some((s) => s === "queued")) {
    publishStatus = "queued";
  }

  const payload = {
    publish_status: publishStatus,
    status: publishStatus,
    updated_at: nowIso()
  };

  if (publishStatus === "published") {
    payload.published_at = nowIso();
  }

  const { error: updateError } = await supabase
    .from("posts")
    .update(payload)
    .eq("id", postId);

  if (updateError) {
    throw new Error(`Post summary update failed: ${updateError.message}`);
  }
}

async function getConnectedAccount(supabase, userId, platform) {
  const normalizedPlatform = normalizePlatform(platform);

  const { data, error } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .in("platform", normalizedPlatform === "x" ? ["x", "twitter"] : [normalizedPlatform])
    .eq("status", "connected")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`${normalizedPlatform} account not connected`);
  return data;
}

async function refreshGoogleToken(supabase, account) {
  if (!account.refresh_token) {
    throw new Error("YouTube token expired. Reconnect YouTube because no refresh token was found.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment variables.");
  }

  const form = new URLSearchParams();
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("refresh_token", account.refresh_token);
  form.set("grant_type", "refresh_token");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${data.error_description || data.error || text || "Unknown error"}`);
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
      last_synced_at: nowIso(),
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

async function ensureValidToken(supabase, account) {
  if (!account.access_token) {
    throw new Error(`No access token found for ${account.platform}. Reconnect the account.`);
  }

  if (!account.token_expires_at) return account;

  const expiresAt = new Date(account.token_expires_at).getTime();
  const soon = Date.now() + 60 * 1000;

  if (expiresAt > soon) return account;

  if (normalizePlatform(account.platform) === "youtube") {
    return await refreshGoogleToken(supabase, account);
  }

  return account;
}

async function getMediaFromPost(supabase, post) {
  if (post.media_path) {
    const bucket = process.env.POST_MEDIA_BUCKET || "post-media";
    const path = normalizeStoragePath(post.media_path);

    if (!path) {
      throw new Error("The saved media_path is invalid.");
    }

    const { data, error } = await supabase.storage
      .from(bucket)
      .download(path);

    if (error || !data) {
      throw new Error(error?.message || "Could not download media from Supabase Storage.");
    }

    const arrayBuffer = await data.arrayBuffer();

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: post.media_type || data.type || "application/octet-stream",
      source: "storage"
    };
  }

  if (post.media_url) {
    const fileRes = await fetch(post.media_url);

    if (!fileRes.ok) {
      throw new Error(`Failed to fetch media_url. HTTP ${fileRes.status}`);
    }

    const arrayBuffer = await fileRes.arrayBuffer();

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: post.media_type || fileRes.headers.get("content-type") || "application/octet-stream",
      source: "url"
    };
  }

  throw new Error("This post has no media_path and no media_url.");
}

async function getYouTubeChannel(accessToken) {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const text = await res.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`YouTube channel check failed: ${text}`);
  }

  if (!data.items || !data.items.length) {
    throw new Error("No YouTube channel was returned for this account. Make sure the connected Google account has a YouTube channel.");
  }

  return data.items[0];
}

async function uploadToYouTube(supabase, post, account) {
  if (!post.media_url && !post.media_path) {
    throw new Error("No media file found for YouTube upload.");
  }

  if (!isVideoType(post.media_type)) {
    throw new Error(`YouTube requires a video file. Current media_type: ${post.media_type || "unknown"}`);
  }

  if (!account?.access_token) {
    throw new Error("Missing YouTube access token.");
  }

  const { buffer, contentType, source } = await getMediaFromPost(supabase, post);
  const channel = await getYouTubeChannel(account.access_token);

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": contentType,
        "X-Upload-Content-Length": String(buffer.length)
      },
      body: JSON.stringify({
        snippet: {
          title: post.media_name || post.content || "View Upload",
          description: post.content || "",
          categoryId: "22"
        },
        status: {
          privacyStatus: post.privacy === "public" ? "public" : "private"
        }
      })
    }
  );

  const initText = await initRes.text();
  const uploadUrl = initRes.headers.get("location");

  if (!initRes.ok) {
    throw new Error(`YouTube upload session start failed. HTTP ${initRes.status}. Response: ${initText}`);
  }

  if (!uploadUrl) {
    throw new Error(`YouTube did not return an upload URL. Response: ${initText}`);
  }

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buffer.length)
    },
    body: buffer
  });

  const uploadText = await uploadRes.text();

  let result = {};
  try {
    result = uploadText ? JSON.parse(uploadText) : {};
  } catch {
    result = { raw: uploadText };
  }

  if (!uploadRes.ok) {
    throw new Error(`YouTube video upload failed. HTTP ${uploadRes.status}. Response: ${result?.error?.message || uploadText || "Unknown error"}`);
  }

  if (!result.id) {
    throw new Error(`YouTube upload finished but no video ID was returned. Response: ${uploadText}`);
  }

  return {
    platform_post_id: result.id,
    response_payload: {
      youtube_video_id: result.id,
      youtube_channel_id: channel.id,
      youtube_channel_title: channel?.snippet?.title || null,
      media_source: source,
      raw: result
    }
  };
}

async function publishToFacebook(post, account) {
  if (!account?.access_token) throw new Error("Missing Facebook access token.");
  if (!account.page_id) throw new Error("Missing Facebook page_id.");

  const hasMedia = !!(post.media_url || post.media_path);

  let endpoint = "";
  let body = null;

  if (isVideoType(post.media_type) && hasMedia) {
    endpoint = `https://graph.facebook.com/v20.0/${account.page_id}/videos`;
    body = new URLSearchParams({
      access_token: account.access_token,
      file_url: post.media_url || "",
      description: post.content || ""
    });
  } else if (hasMedia) {
    endpoint = `https://graph.facebook.com/v20.0/${account.page_id}/photos`;
    body = new URLSearchParams({
      access_token: account.access_token,
      url: post.media_url || "",
      caption: post.content || "",
      published: "true"
    });
  } else {
    endpoint = `https://graph.facebook.com/v20.0/${account.page_id}/feed`;
    body = new URLSearchParams({
      access_token: account.access_token,
      message: post.content || ""
    });
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok || !data.id) {
    throw new Error(`Facebook publish failed: ${data?.error?.message || text || "Unknown error"}`);
  }

  return {
    platform_post_id: data.id,
    response_payload: data
  };
}

async function publishToInstagram(post, account) {
  if (!account?.access_token) throw new Error("Missing Instagram access token.");

  const igUserId =
    account.instagram_user_id ||
    account.ig_user_id ||
    account.external_user_id;

  if (!igUserId) throw new Error("Missing Instagram user ID.");
  if (!post.media_url) throw new Error("Instagram publishing requires media_url.");

  const createContainerEndpoint = `https://graph.facebook.com/v20.0/${igUserId}/media`;
  const createBody = new URLSearchParams({
    access_token: account.access_token,
    caption: post.content || ""
  });

  if (isVideoType(post.media_type)) {
    createBody.set("media_type", "REELS");
    createBody.set("video_url", post.media_url);
  } else {
    createBody.set("image_url", post.media_url);
  }

  const createRes = await fetch(createContainerEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: createBody.toString()
  });

  const createText = await createRes.text();
  let createData = {};
  try {
    createData = createText ? JSON.parse(createText) : {};
  } catch {
    createData = { raw: createText };
  }

  if (!createRes.ok || !createData.id) {
    throw new Error(`Instagram media container failed: ${createData?.error?.message || createText || "Unknown error"}`);
  }

  const publishRes = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: account.access_token,
      creation_id: createData.id
    }).toString()
  });

  const publishText = await publishRes.text();
  let publishData = {};
  try {
    publishData = publishText ? JSON.parse(publishText) : {};
  } catch {
    publishData = { raw: publishText };
  }

  if (!publishRes.ok || !publishData.id) {
    throw new Error(`Instagram publish failed: ${publishData?.error?.message || publishText || "Unknown error"}`);
  }

  return {
    platform_post_id: publishData.id,
    response_payload: {
      container_id: createData.id,
      publish: publishData
    }
  };
}

async function publishToTelegram(post, account) {
  const botToken = account.bot_token || process.env.TELEGRAM_BOT_TOKEN || "";
  const chatId = account.chat_id || account.channel_id || account.external_user_id || "";

  if (!botToken) throw new Error("Missing Telegram bot token.");
  if (!chatId) throw new Error("Missing Telegram chat/channel ID.");

  let method = "sendMessage";
  let payload = {
    chat_id: chatId,
    text: post.content || ""
  };

  if (post.media_url && isImageType(post.media_type)) {
    method = "sendPhoto";
    payload = {
      chat_id: chatId,
      photo: post.media_url,
      caption: post.content || ""
    };
  } else if (post.media_url && isVideoType(post.media_type)) {
    method = "sendVideo";
    payload = {
      chat_id: chatId,
      video: post.media_url,
      caption: post.content || ""
    };
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok) {
    throw new Error(`Telegram publish failed: ${data?.description || "Unknown error"}`);
  }

  return {
    platform_post_id: String(data?.result?.message_id || ""),
    response_payload: data
  };
}

async function publishToLinkedIn(post, account) {
  if (!account?.access_token) throw new Error("Missing LinkedIn access token.");

  const author =
    account.organization_urn ||
    account.person_urn ||
    account.external_user_id;

  if (!author) throw new Error("Missing LinkedIn author URN.");

  const body = {
    author,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: {
          text: post.content || ""
        },
        shareMediaCategory: "NONE"
      }
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
    }
  };

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0"
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`LinkedIn publish failed: ${data?.message || text || "Unknown error"}`);
  }

  const linkedInId = res.headers.get("x-restli-id") || data.id || null;

  return {
    platform_post_id: linkedInId,
    response_payload: data
  };
}

async function publishToX(post, account) {
  if (!account?.access_token) throw new Error("Missing X access token.");
  throw new Error("X publish flow needs your exact OAuth/media posting setup.");
}

async function publishToTikTok(post, account) {
  if (!account?.access_token) throw new Error("Missing TikTok access token.");
  throw new Error("TikTok direct publish needs your exact TikTok content posting setup.");
}

async function publishToPlatform(supabase, post, job) {
  const platform = normalizePlatform(job.platform);

  if (platform === "view") {
    return {
      platform_post_id: `view_${post.id}`,
      response_payload: {
        ok: true,
        platform: "view",
        local: true
      }
    };
  }

  if (platform === "youtube") {
    const account = await getConnectedAccount(supabase, job.user_id, "youtube");
    const validAccount = await ensureValidToken(supabase, account);
    return await uploadToYouTube(supabase, post, validAccount);
  }

  if (platform === "facebook") {
    const account = await getConnectedAccount(supabase, job.user_id, "facebook");
    const validAccount = await ensureValidToken(supabase, account);
    return await publishToFacebook(post, validAccount);
  }

  if (platform === "instagram") {
    const account = await getConnectedAccount(supabase, job.user_id, "instagram");
    const validAccount = await ensureValidToken(supabase, account);
    return await publishToInstagram(post, validAccount);
  }

  if (platform === "telegram") {
    const account = await getConnectedAccount(supabase, job.user_id, "telegram");
    return await publishToTelegram(post, account);
  }

  if (platform === "linkedin") {
    const account = await getConnectedAccount(supabase, job.user_id, "linkedin");
    const validAccount = await ensureValidToken(supabase, account);
    return await publishToLinkedIn(post, validAccount);
  }

  if (platform === "x") {
    const account = await getConnectedAccount(supabase, job.user_id, "x");
    const validAccount = await ensureValidToken(supabase, account);
    return await publishToX(post, validAccount);
  }

  if (platform === "tiktok") {
    const account = await getConnectedAccount(supabase, job.user_id, "tiktok");
    const validAccount = await ensureValidToken(supabase, account);
    return await publishToTikTok(post, validAccount);
  }

  if (platform === "whatsapp") {
    throw new Error("WhatsApp publishing is not configured in this worker.");
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized"
    });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL_VALUE;

    const SUPABASE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({
        success: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const body =
      req.method === "POST" && req.body
        ? typeof req.body === "string"
          ? safeJsonParse(req.body, {})
          : req.body
        : {};

    const requestedPostId = body?.post_id || req.query?.post_id || null;
    const requestedUserId = body?.user_id || req.query?.user_id || null;
    const requestedLimit = Number(body?.limit || req.query?.limit || 20);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, requestedLimit))
      : 20;

    let jobsQuery = supabase
      .from("post_publish_jobs")
      .select("*")
      .in("status", ["queued", "retrying"])
      .order("created_at", { ascending: true })
      .limit(limit);

    if (requestedPostId) {
      jobsQuery = jobsQuery.eq("post_id", requestedPostId);
    }

    if (requestedUserId) {
      jobsQuery = jobsQuery.eq("user_id", requestedUserId);
    }

    const { data: jobs, error } = await jobsQuery;
    if (error) throw error;

    const now = nowIso();
    const runnableJobs = (jobs || []).filter((job) => {
      if (job.status !== "retrying") return true;
      if (!job.next_retry_at) return true;
      return job.next_retry_at <= now;
    });

    if (!runnableJobs.length) {
      return res.status(200).json({
        success: true,
        processed: 0,
        details: [],
        message: "No pending publish jobs found."
      });
    }

    const processed = [];
    const touchedPostIds = new Set();

    for (const job of runnableJobs) {
      touchedPostIds.add(job.post_id);

      try {
        const { data: post, error: postError } = await supabase
          .from("posts")
          .select("*")
          .eq("id", job.post_id)
          .single();

        if (postError) throw postError;
        if (!post) throw new Error("Post not found.");

        const processingAt = nowIso();

        const { error: markProcessingError } = await supabase
          .from("post_publish_jobs")
          .update({
            status: "processing",
            started_at: processingAt,
            updated_at: processingAt
          })
          .eq("id", job.id);

        if (markProcessingError) throw markProcessingError;

        const result = await publishToPlatform(supabase, post, job);
        const deliveredAt = nowIso();

        const { error: updateJobError } = await supabase
          .from("post_publish_jobs")
          .update({
            status: "completed",
            attempts: Number(job.attempts || 0) + 1,
            delivered_at: deliveredAt,
            finished_at: deliveredAt,
            platform_post_id: result.platform_post_id || null,
            response_payload: result.response_payload || null,
            last_error: null,
            next_retry_at: null,
            updated_at: deliveredAt
          })
          .eq("id", job.id);

        if (updateJobError) throw updateJobError;

        await supabase
          .from("post_publish_logs")
          .insert({
            post_id: job.post_id,
            job_id: job.id,
            user_id: job.user_id,
            platform: normalizePlatform(job.platform),
            status: "completed",
            platform_post_id: result.platform_post_id || null,
            response_payload: result.response_payload || null,
            attempts: Number(job.attempts || 0) + 1
          });

        await updatePostSummary(supabase, job.post_id);

        processed.push({
          job: job.id,
          platform: normalizePlatform(job.platform),
          status: "completed",
          platform_post_id: result.platform_post_id || null
        });
      } catch (err) {
        const failedAt = nowIso();
        const message = err.message || "Unknown error";
        const attempts = Number(job.attempts || 0) + 1;
        const retryable = attempts < 3;
        const nextRetryAt = retryable
          ? new Date(Date.now() + attempts * 2 * 60 * 1000).toISOString()
          : null;

        await supabase
          .from("post_publish_jobs")
          .update({
            status: retryable ? "retrying" : "failed",
            last_error: message,
            attempts,
            next_retry_at: nextRetryAt,
            finished_at: retryable ? null : failedAt,
            updated_at: failedAt
          })
          .eq("id", job.id);

        await supabase
          .from("post_publish_logs")
          .insert({
            post_id: job.post_id,
            job_id: job.id,
            user_id: job.user_id,
            platform: normalizePlatform(job.platform),
            status: retryable ? "retrying" : "failed",
            error_message: message,
            attempts
          });

        try {
          await updatePostSummary(supabase, job.post_id);
        } catch (_) {}

        processed.push({
          job: job.id,
          platform: normalizePlatform(job.platform),
          status: retryable ? "retrying" : "failed",
          error: message
        });
      }
    }

    for (const postId of touchedPostIds) {
      try {
        await updatePostSummary(supabase, postId);
      } catch (_) {}
    }

    return res.status(200).json({
      success: true,
      processed: processed.length,
      details: processed
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Unknown server error"
    });
  }
};
