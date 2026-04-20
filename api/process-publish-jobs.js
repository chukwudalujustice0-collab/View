const { createClient } = require("@supabase/supabase-js");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-cron-secret");
  res.setHeader("Cache-Control", "no-store");
}

// 🔥 AUTH REMOVED COMPLETELY
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

  if (error) throw new Error(error.message);
  if (!jobs?.length) return;

  const statuses = jobs.map(j => (j.status || "").toLowerCase());

  let publishStatus = "queued";

  if (statuses.every(s => s === "success")) publishStatus = "published";
  else if (statuses.some(s => s === "failed") && statuses.some(s => s === "success")) publishStatus = "partial";
  else if (statuses.every(s => s === "failed")) publishStatus = "failed";
  else if (statuses.includes("processing")) publishStatus = "processing";

  const payload = {
    publish_status: publishStatus,
    status: publishStatus,
    updated_at: nowIso()
  };

  if (publishStatus === "published") {
    payload.published_at = nowIso();
  }

  await supabase.from("posts").update(payload).eq("id", postId);
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
  if (!data) throw new Error(`${platform} not connected`);

  return data;
}

async function getMediaFromPost(supabase, post) {
  if (post.media_path) {
    const bucket = process.env.POST_MEDIA_BUCKET || "post-media";
    const path = normalizeStoragePath(post.media_path);

    const { data, error } = await supabase.storage
      .from(bucket)
      .download(path);

    if (error || !data) throw new Error("Storage download failed");

    const arrayBuffer = await data.arrayBuffer();

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: post.media_type || data.type
    };
  }

  if (post.media_url) {
    const res = await fetch(post.media_url);

    if (!res.ok) throw new Error("Media fetch failed");

    const buffer = Buffer.from(await res.arrayBuffer());

    return {
      buffer,
      contentType: post.media_type || res.headers.get("content-type")
    };
  }

  throw new Error("No media found");
}

async function getYouTubeChannel(accessToken) {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  const data = await res.json();

  if (!res.ok) throw new Error("YouTube channel error");
  if (!data.items?.length) throw new Error("No YouTube channel");

  return data.items[0];
}

async function uploadToYouTube(supabase, post, account) {
  if (!post.media_type?.startsWith("video/")) {
    throw new Error("YouTube requires video");
  }

  const { buffer, contentType } = await getMediaFromPost(supabase, post);

  await getYouTubeChannel(account.access_token);

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": contentType
      },
      body: JSON.stringify({
        snippet: {
          title: (post.content || "View Upload").slice(0, 100),
          description: post.content || ""
        },
        status: { privacyStatus: "public" }
      })
    }
  );

  const uploadUrl = initRes.headers.get("location");

  if (!uploadUrl) throw new Error("Upload URL missing");

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: buffer
  });

  const result = await uploadRes.json();

  if (!uploadRes.ok) throw new Error("Upload failed");

  return {
    platform_post_id: result.id
  };
}

async function publishToPlatform(supabase, post, job) {
  if (job.platform === "youtube") {
    const acc = await getConnectedAccount(supabase, job.user_id, "youtube");
    return await uploadToYouTube(supabase, post, acc);
  }

  return { platform_post_id: post.id };
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: jobs } = await supabase
      .from("post_publish_jobs")
      .select("*")
      .in("status", ["queued", "retrying"])
      .limit(20);

    if (!jobs?.length) {
      return res.json({ success: true, processed: 0 });
    }

    const results = [];

    for (const job of jobs) {
      try {
        const { data: post } = await supabase
          .from("posts")
          .select("*")
          .eq("id", job.post_id)
          .single();

        const result = await publishToPlatform(supabase, post, job);

        await supabase.from("post_publish_jobs").update({
          status: "success",
          platform_post_id: result.platform_post_id,
          updated_at: nowIso()
        }).eq("id", job.id);

        await updatePostSummary(supabase, job.post_id);

        results.push({ job: job.id, status: "success" });

      } catch (err) {
        await supabase.from("post_publish_jobs").update({
          status: "failed",
          last_error: err.message,
          updated_at: nowIso()
        }).eq("id", job.id);

        results.push({ job: job.id, status: "failed" });
      }
    }

    return res.json({ success: true, processed: results.length, results });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
