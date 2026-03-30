import { createClient } from "@supabase/supabase-js";

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
  const bucketPrefix = `${bucket}/`;

  if (path.startsWith(bucketPrefix)) {
    path = path.slice(bucketPrefix.length);
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
  if (!data) throw new Error(`${platform} account not connected.`);
  return data;
}

async function refreshGoogleToken(supabase, account) {
  if (!account.refresh_token) {
    throw new Error("YouTube token expired. Reconnect account.");
  }

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
      last_synced_at: nowIso(),
      last_error: null
    })
    .eq("id", account.id);

  if (error) {
    throw new Error(error.message);
  }

  return {
    ...account,
    access_token: data.access_token,
    token_type: data.token_type || "Bearer",
    token_expires_at: tokenExpiresAt
  };
}

async function ensureValidToken(supabase, account) {
  if (!account.access_token) {
    throw new Error(`No access token for ${account.platform}.`);
  }

  if (!account.token_expires_at) {
    return account;
  }

  const expiresAt = new Date(account.token_expires_at).getTime();
  const soon = Date.now() + 60 * 1000;

  if (expiresAt > soon) {
    return account;
  }

  if (account.platform === "youtube") {
    return await refreshGoogleToken(supabase, account);
  }

  return account;
}

async function getVideoFileFromPost(supabase, post) {
  if (post.media_path) {
    const bucket = process.env.POST_MEDIA_BUCKET || "post-media";
    const path = normalizeStoragePath(post.media_path);

    if (!path) {
      throw new Error("Invalid media_path");
    }

    const { data, error } = await supabase.storage
      .from(bucket)
      .download(path);

    if (error || !data) {
      throw new Error(error?.message || "Could not download media from storage");
    }

    const arrayBuffer = await data.arrayBuffer();

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: post.media_type || data.type || "video/mp4"
    };
  }

  if (post.media_url) {
    const fileRes = await fetch(post.media_url);

    if (!fileRes.ok) {
      throw new Error("Could not fetch media_url");
    }

    const arrayBuffer = await fileRes.arrayBuffer();

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: post.media_type || fileRes.headers.get("content-type") || "video/mp4"
    };
  }

  throw new Error("No media_path or media_url found for this post");
}

async function uploadToYouTubeFromPost(supabase, post, account) {
  if (!(post.media_type || "").startsWith("video/")) {
    throw new Error("YouTube requires a video file");
  }

  const { buffer, contentType } = await getVideoFileFromPost(supabase, post);

  const metadata = {
    snippet: {
      title: post.title || post.media_name || "View Upload",
      description: post.content || ""
    },
    status: {
      privacyStatus: "private"
    }
  };

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
      body: JSON.stringify(metadata)
    }
  );

  if (!initRes.ok) {
    const errorText = await initRes.text();
    throw new Error(`YouTube init failed: ${errorText}`);
  }

  const uploadUrl = initRes.headers.get("location");

  if (!uploadUrl) {
    throw new Error("YouTube upload URL missing");
  }

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": contentType,
      "Content-Length": String(buffer.length)
    },
    body: buffer
  });

  const uploadText = await uploadRes.text();
  let uploadData = {};

  try {
    uploadData = uploadText ? JSON.parse(uploadText) : {};
  } catch {
    uploadData = { raw: uploadText };
  }

  if (!uploadRes.ok) {
    throw new Error(uploadData?.error?.message || uploadData?.error || "YouTube upload failed");
  }

  return {
    platform_post_id: uploadData.id || null,
    response_payload: uploadData
  };
}

async function publishToPlatform(supabase, post, job) {
  if (job.platform === "youtube") {
    const account = await getConnectedAccount(supabase, job.user_id, "youtube");
    const validAccount = await ensureValidToken(supabase, account);
    return await uploadToYouTubeFromPost(supabase, post, validAccount);
  }

  if (job.platform === "view") {
    return {
      platform_post_id: post.id,
      response_payload: { ok: true, platform: "view", local: true }
    };
  }

  if (job.platform === "x") {
    return {
      platform_post_id: `x_stub_${Date.now()}`,
      response_payload: { ok: true, platform: "x", mode: "stub" }
    };
  }

  if (job.platform === "facebook") {
    return {
      platform_post_id: `facebook_stub_${Date.now()}`,
      response_payload: { ok: true, platform: "facebook", mode: "stub" }
    };
  }

  return {
    platform_post_id: `stub_${job.platform}_${Date.now()}`,
    response_payload: { ok: true, platform: job.platform, mode: "stub" }
  };
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL_VALUE,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: jobs, error } = await supabase
      .from("post_publish_jobs")
      .select("*")
      .in("status", ["queued", "retrying"])
      .order("created_at", { ascending: true })
      .limit(20);

    if (error) {
      throw error;
    }

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
        if (!post) throw new Error("Post not found");

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
          status: "success"
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
}
