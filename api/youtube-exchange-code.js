import { createClient } from "@supabase/supabase-js";

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

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL_VALUE,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: jobs, error } = await supabase
      .from("post_publish_jobs")
      .select("*")
      .eq("status", "queued")
      .limit(10);

    if (error) throw error;

    let results = [];

    for (const job of jobs || []) {
      try {
        const { data: post } = await supabase
          .from("posts")
          .select("*")
          .eq("id", job.post_id)
          .single();

        if (!post) throw new Error("Post not found");

        let response = {};

        // ✅ HANDLE PLATFORMS
        if (job.platform === "youtube") {
          if (!post.media_url || !post.media_type?.startsWith("video/")) {
            throw new Error("YouTube requires a video");
          }

          const { data: account } = await supabase
            .from("connected_accounts")
            .select("*")
            .eq("user_id", job.user_id)
            .eq("platform", "youtube")
            .single();

          if (!account) throw new Error("YouTube not connected");

          response = await uploadToYouTube(post, account);
        }

        else if (job.platform === "view") {
          response = { success: true };
        }

        else {
          response = { skipped: true };
        }

        await supabase
          .from("post_publish_jobs")
          .update({
            status: "success",
            delivered_at: new Date().toISOString(),
            response_payload: response,
            last_error: null
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

        results.push({ job: job.id, status: "failed", error: err.message });
      }
    }

    return res.json({
      success: true,
      processed: results.length,
      results
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

// ✅ SAFE YOUTUBE UPLOAD (SIMPLIFIED)
async function uploadToYouTube(post, account) {
  try {
    const res = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          snippet: {
            title: "Uploaded from View",
            description: post.content || ""
          },
          status: {
            privacyStatus: "private"
          }
        })
      }
    );

    const data = await res.json();

    return {
      message: "YouTube upload initialized",
      data
    };

  } catch (err) {
    throw new Error("YouTube upload failed");
  }
}
