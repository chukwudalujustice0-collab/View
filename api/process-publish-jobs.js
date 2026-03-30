const { createClient } = require("@supabase/supabase-js");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const now = () => new Date().toISOString();

async function updatePostSummary(supabase, postId) {
  const { data: jobs } = await supabase
    .from("post_publish_jobs")
    .select("status")
    .eq("post_id", postId);

  if (!jobs?.length) return;

  const statuses = jobs.map(j => j.status);

  let status = "queued";

  if (statuses.every(s => s === "success")) status = "published";
  else if (statuses.every(s => s === "failed")) status = "failed";
  else if (statuses.some(s => s === "failed")) status = "partial";
  else if (statuses.some(s => s === "processing")) status = "processing";

  await supabase
    .from("posts")
    .update({
      publish_status: status,
      status,
      updated_at: now(),
      ...(status === "published" && { published_at: now() })
    })
    .eq("id", postId);
}

async function uploadToYouTube(post, account) {
  if (!post.media_url) {
    throw new Error("No media_url found");
  }

  if (!post.media_type?.startsWith("video/")) {
    throw new Error("YouTube requires video");
  }

  // STEP 1: fetch video file
  const fileRes = await fetch(post.media_url);
  if (!fileRes.ok) throw new Error("Failed to fetch video");

  const buffer = Buffer.from(await fileRes.arrayBuffer());

  // STEP 2: create upload session
  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": post.media_type,
        "X-Upload-Content-Length": buffer.length
      },
      body: JSON.stringify({
        snippet: {
          title: post.media_name || "View Upload",
          description: post.content || ""
        },
        status: {
          privacyStatus: "public"
        }
      })
    }
  );

  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("Upload URL missing");

  // STEP 3: upload file
  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": post.media_type,
      "Content-Length": buffer.length
    },
    body: buffer
  });

  const result = await upload.json();

  if (!upload.ok) {
    throw new Error(result?.error?.message || "Upload failed");
  }

  return result.id;
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL_VALUE,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: jobs } = await supabase
      .from("post_publish_jobs")
      .select("*")
      .in("status", ["queued", "retrying"])
      .limit(20);

    const processed = [];

    for (const job of jobs || []) {
      try {
        const { data: post } = await supabase
          .from("posts")
          .select("*")
          .eq("id", job.post_id)
          .single();

        await supabase
          .from("post_publish_jobs")
          .update({ status: "processing", updated_at: now() })
          .eq("id", job.id);

        let platformPostId = null;

        // 🔥 REAL YOUTUBE UPLOAD
        if (job.platform === "youtube") {
          const { data: account } = await supabase
            .from("connected_accounts")
            .select("*")
            .eq("user_id", job.user_id)
            .eq("platform", "youtube")
            .single();

          if (!account) throw new Error("YouTube not connected");

          platformPostId = await uploadToYouTube(post, account);
        }

        // View local post
        if (job.platform === "view") {
          platformPostId = post.id;
        }

        await supabase
          .from("post_publish_jobs")
          .update({
            status: "success",
            platform_post_id: platformPostId,
            updated_at: now()
          })
          .eq("id", job.id);

        await supabase
          .from("post_publish_logs")
          .insert({
            post_id: job.post_id,
            job_id: job.id,
            platform: job.platform,
            status: "success",
            platform_post_id: platformPostId
          });

        await updatePostSummary(supabase, job.post_id);

        processed.push({ job: job.id, success: true });

      } catch (err) {
        await supabase
          .from("post_publish_jobs")
          .update({
            status: "failed",
            last_error: err.message,
            updated_at: now()
          })
          .eq("id", job.id);

        processed.push({ job: job.id, error: err.message });
      }
    }

    return res.json({ success: true, processed });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
