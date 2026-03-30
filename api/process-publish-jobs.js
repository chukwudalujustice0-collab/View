const { createClient } = require("@supabase/supabase-js");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeStoragePath(rawPath = "") {
  let path = String(rawPath || "").trim();
  if (!path) return "";

  if (path.startsWith("/")) path = path.slice(1);

  const bucket = process.env.POST_MEDIA_BUCKET || "post-media";
  if (path.startsWith(bucket + "/")) {
    path = path.slice(bucket.length + 1);
  }

  if (path.startsWith("public/")) {
    path = path.slice("public/".length);
  }

  return path;
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

  const statuses = jobs.map(j => String(j.status || "").toLowerCase());

  let publishStatus = "queued";

  if (statuses.every(s => s === "success")) {
    publishStatus = "published";
  } else if (statuses.some(s => s === "failed") && statuses.some(s => s === "success")) {
    publishStatus = "partial";
  } else if (statuses.every(s => s === "failed")) {
    publishStatus = "failed";
  } else if (statuses.some(s => s === "processing")) {
    publishStatus = "processing";
  } else if (statuses.some(s => s === "retrying")) {
    publishStatus = "retrying";
  } else if (statuses.some(s => s === "queued")) {
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
  const { data, error } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", platform)
    .eq("status", "connected")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`${platform} account not connected`);
  return data;
}

async function refreshGoogleToken(supabase, account) {
  if (!account.refresh_token) {
    throw new Error("YouTube token expired. Reconnect YouTube because no refresh token was found.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in Vercel environment variables.");
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

  if (account.platform === "youtube") {
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

  if (!(post.media_type || "").startsWith("video/")) {
    throw new Error(`YouTube requires a video file. Current media_type: ${post.media_type || "unknown"}`);
  }

  if (!account?.access_token) {
    throw new Error("Missing YouTube access token.");
  }

  const { buffer, contentType, source } = await getMediaFromPost(supabase, post);

  // Check the token can actually access a YouTube channel.
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
    throw new Error(
      `YouTube upload session start failed. ` +
      `HTTP ${initRes.status}. ` +
      `Response: ${initText}`
    );
  }

  if (!uploadUrl) {
    throw new Error(
      `YouTube did not return an upload URL. ` +
      `This usually means missing upload scope, invalid token, or channel permission issue. ` +
      `Response: ${initText}`
    );
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
    throw new Error(
      `YouTube video upload failed. ` +
      `HTTP ${uploadRes.status}. ` +
      `Response: ${result?.error?.message || uploadText || "Unknown error"}`
    );
  }

  if (!result.id) {
    throw new Error(
      `YouTube upload finished but no video ID was returned. Response: ${uploadText}`
    );
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

async function publishToPlatform(supabase, post, job) {
  if (job.platform === "youtube") {
    const account = await getConnectedAccount(supabase, job.user_id, "youtube");
    const validAccount = await ensureValidToken(supabase, account);
    return await uploadToYouTube(supabase, post, validAccount);
  }

  if (job.platform === "view") {
    return {
      platform_post_id: post.id,
      response_payload: {
        ok: true,
        platform: "view",
        local: true
      }
    };
  }

  if (job.platform === "facebook") throw new Error("Facebook publishing is not added yet.");
  if (job.platform === "x") throw new Error("X publishing is not added yet.");
  if (job.platform === "instagram") throw new Error("Instagram publishing is not added yet.");
  if (job.platform === "tiktok") throw new Error("TikTok publishing is not added yet.");
  if (job.platform === "telegram") throw new Error("Telegram publishing is not added yet.");
  if (job.platform === "whatsapp") throw new Error("WhatsApp publishing is not added yet.");

  throw new Error(`Unsupported platform: ${job.platform}`);
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL_VALUE;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({
        success: false,
        error: "Missing SUPABASE_URL_VALUE or SUPABASE_SERVICE_KEY."
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const { data: jobs, error } = await supabase
      .from("post_publish_jobs")
      .select("*")
      .in("status", ["queued", "retrying"])
      .order("created_at", { ascending: true })
      .limit(20);

    if (error) throw error;

    const processed = [];
    const touchedPostIds = new Set();

    for (const job of jobs || []) {
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
            status: "success",
            attempts: (job.attempts || 0) + 1,
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
            platform: job.platform,
            status: "success",
            platform_post_id: result.platform_post_id || null,
            response_payload: result.response_payload || null,
            attempts: (job.attempts || 0) + 1
          });

        await updatePostSummary(supabase, job.post_id);

        processed.push({
          job: job.id,
          platform: job.platform,
          status: "success",
          platform_post_id: result.platform_post_id || null
        });
      } catch (err) {
        const failedAt = nowIso();
        const message = err.message || "Unknown error";

        await supabase
          .from("post_publish_jobs")
          .update({
            status: "failed",
            last_error: message,
            attempts: (job.attempts || 0) + 1,
            finished_at: failedAt,
            updated_at: failedAt
          })
          .eq("id", job.id);

        await supabase
          .from("post_publish_logs")
          .insert({
            post_id: job.post_id,
            job_id: job.id,
            user_id: job.user_id,
            platform: job.platform,
            status: "failed",
            error_message: message,
            attempts: (job.attempts || 0) + 1
          });

        try {
          await updatePostSummary(supabase, job.post_id);
        } catch (_) {}

        processed.push({
          job: job.id,
          platform: job.platform,
          status: "failed",
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
