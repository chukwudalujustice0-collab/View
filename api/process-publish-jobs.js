const { createClient } = require("@supabase/supabase-js");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function updatePostSummary(supabase, postId) {
  const { data: jobs, error } = await supabase
    .from("post_publish_jobs")
    .select("status")
    .eq("post_id", postId);

  if (error) {
    throw new Error(`Post summary read failed: ${error.message}`);
  }

  if (!jobs || !jobs.length) {
    return;
  }

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
    updated_at: new Date().toISOString()
  };

  if (publishStatus === "published") {
    payload.published_at = new Date().toISOString();
  }

  const { error: updateError } = await supabase
    .from("posts")
    .update(payload)
    .eq("id", postId);

  if (updateError) {
    throw new Error(`Post summary update failed: ${updateError.message}`);
  }
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
        error: "Missing Supabase env variables"
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

        if (postError) {
          throw postError;
        }

        if (!post) {
          throw new Error("Post not found");
        }

        const processingAt = new Date().toISOString();

        const { error: markProcessingError } = await supabase
          .from("post_publish_jobs")
          .update({
            status: "processing",
            started_at: processingAt,
            updated_at: processingAt
          })
          .eq("id", job.id);

        if (markProcessingError) {
          throw markProcessingError;
        }

        // Simulated delivery for now
        const deliveredAt = new Date().toISOString();
        const platformPostId = `post_${job.platform}_${Date.now()}`;

        const responsePayload = {
          ok: true,
          mode: "simulated",
          platform: job.platform,
          post_id: post.id,
          content: post.content || null,
          media_url: post.media_url || null
        };

        const { error: updateJobError } = await supabase
          .from("post_publish_jobs")
          .update({
            status: "success",
            attempts: (job.attempts || 0) + 1,
            delivered_at: deliveredAt,
            finished_at: deliveredAt,
            platform_post_id: platformPostId,
            response_payload: responsePayload,
            last_error: null,
            next_retry_at: null,
            updated_at: deliveredAt
          })
          .eq("id", job.id);

        if (updateJobError) {
          throw updateJobError;
        }

        await supabase
          .from("post_publish_logs")
          .insert({
            post_id: job.post_id,
            job_id: job.id,
            user_id: job.user_id,
            platform: job.platform,
            status: "success",
            platform_post_id: platformPostId,
            response_payload: responsePayload,
            attempts: (job.attempts || 0) + 1
          });

        await updatePostSummary(supabase, job.post_id);

        processed.push({
          job: job.id,
          platform: job.platform,
          status: "success"
        });
      } catch (err) {
        const failedAt = new Date().toISOString();
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
      error: err.message
    });
  }
};
