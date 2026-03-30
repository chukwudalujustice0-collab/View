const { createClient } = require("@supabase/supabase-js");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const now = () => new Date().toISOString();

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
      .limit(10);

    for (const job of jobs || []) {
      try {
        const { data: post } = await supabase
          .from("posts")
          .select("*")
          .eq("id", job.post_id)
          .single();

        if (!post) throw new Error("Post not found");

        await supabase
          .from("post_publish_jobs")
          .update({
            status: "processing",
            started_at: now()
          })
          .eq("id", job.id);

        let result;

        if (job.platform === "youtube") {
          result = await uploadToYouTube(supabase, post, job.user_id);
        } else {
          result = {
            platform_post_id: post.id,
            response_payload: { ok: true }
          };
        }

        await supabase
          .from("post_publish_jobs")
          .update({
            status: "success",
            platform_post_id: result.platform_post_id,
            response_payload: result.response_payload,
            finished_at: now(),
            updated_at: now()
          })
          .eq("id", job.id);

      } catch (err) {
        await supabase
          .from("post_publish_jobs")
          .update({
            status: "failed",
            last_error: err.message,
            finished_at: now(),
            updated_at: now()
          })
          .eq("id", job.id);
      }
    }

    return res.json({ success: true });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

/* ===========================
   🔥 REAL YOUTUBE UPLOAD
=========================== */
async function uploadToYouTube(supabase, post, userId) {
  // get connected account
  const { data: account } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("platform", "youtube")
    .single();

  if (!account?.access_token) {
    throw new Error("YouTube not connected");
  }

  // 🔥 FIX: support BOTH storage + URL
  let videoBuffer;
  let contentType = post.media_type || "video/mp4";

  if (post.media_path) {
    const { data } = await supabase.storage
      .from("post-media")
      .download(post.media_path);

    if (!data) throw new Error("Storage file missing");

    videoBuffer = Buffer.from(await data.arrayBuffer());

  } else if (post.media_url) {
    const response = await fetch(post.media_url);
    if (!response.ok) throw new Error("Failed to fetch media_url");

    videoBuffer = Buffer.from(await response.arrayBuffer());

  } else {
    throw new Error("No media found");
  }

  // STEP 1: INIT upload
  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": contentType,
        "X-Upload-Content-Length": videoBuffer.length
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

  if (!uploadUrl) {
    throw new Error("Failed to get upload URL");
  }

  // STEP 2: UPLOAD video
  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": videoBuffer.length
    },
    body: videoBuffer
  });

  const result = await upload.json();

  if (!result.id) {
    throw new Error("YouTube upload failed");
  }

  return {
    platform_post_id: result.id,
    response_payload: result
  };
}
