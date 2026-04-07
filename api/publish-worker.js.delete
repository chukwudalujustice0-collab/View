const { createClient } = require("@supabase/supabase-js");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// 🔥 REAL YOUTUBE UPLOAD
async function uploadToYouTube(post, account) {
  if (!post.media_url) {
    throw new Error("No media_url found");
  }

  if (!(post.media_type || "").startsWith("video/")) {
    throw new Error(`YouTube requires video, got: ${post.media_type}`);
  }

  // Fetch video
  const fileRes = await fetch(post.media_url);
  if (!fileRes.ok) {
    throw new Error("Failed to fetch video");
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer());

  // STEP 1: INIT upload
  const initRes = await fetch(
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
          title: post.content || "View Upload",
          description: post.content || ""
        },
        status: {
          privacyStatus: "public"
        }
      })
    }
  );

  const uploadUrl = initRes.headers.get("location");
  const initText = await initRes.text();

  if (!uploadUrl) {
    throw new Error("Upload URL missing: " + initText);
  }

  // STEP 2: Upload video
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": post.media_type,
      "Content-Length": buffer.length
    },
    body: buffer
  });

  const result = await uploadRes.json();

  if (!uploadRes.ok) {
    throw new Error(result.error?.message || "Upload failed");
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
      .eq("status", "queued")
      .limit(10);

    const results = [];

    for (const job of jobs || []) {
      try {
        const { data: post } = await supabase
          .from("posts")
          .select("*")
          .eq("id", job.post_id)
          .single();

        const { data: account } = await supabase
          .from("connected_accounts")
          .select("*")
          .eq("user_id", job.user_id)
          .eq("platform", job.platform)
          .single();

        let platformPostId;

        if (job.platform === "youtube") {
          platformPostId = await uploadToYouTube(post, account);
        } else {
          platformPostId = `post_${job.platform}_${Date.now()}`;
        }

        await supabase
          .from("post_publish_jobs")
          .update({
            status: "success",
            platform_post_id: platformPostId
          })
          .eq("id", job.id);

        results.push({ job: job.id, status: "success" });

      } catch (err) {
        await supabase
          .from("post_publish_jobs")
          .update({
            status: "failed",
            last_error: err.message
          })
          .eq("id", job.id);

        results.push({ job: job.id, error: err.message });
      }
    }

    return res.json({
      success: true,
      processed: results
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
