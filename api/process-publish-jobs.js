const { createClient } = require("@supabase/supabase-js");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
      .limit(10);

    if (error) {
      throw error;
    }

    const processed = [];

    for (const job of jobs || []) {
      try {
        const { data: post, error: postError } = await supabase
          .from("posts")
          .select("*")
          .eq("id", job.post_id)
          .single();

        if (postError) throw postError;
        if (!post) throw new Error("Post not found");

        await supabase
          .from("post_publish_jobs")
          .update({
            status: "processing",
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", job.id);

        // simulated delivery for now
        const deliveredAt = new Date().toISOString();
        const platformPostId = `post_${job.platform}_${Date.now()}`;

        const { error: updateJobError } = await supabase
          .from("post_publish_jobs")
          .update({
            status: "success",
            attempts: (job.attempts || 0) + 1,
            delivered_at: deliveredAt,
            finished_at: deliveredAt,
            platform_post_id: platformPostId,
            response_payload: {
              ok: true,
              mode: "simulated",
              platform: job.platform,
              post_id: post.id
            },
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
            platform_post_id: platformPostId,
            response_payload: {
              ok: true,
              mode: "simulated",
              platform: job.platform,
              post_id: post.id
            },
            attempts: (job.attempts || 0) + 1
          });

        processed.push({
          job: job.id,
          platform: job.platform,
          status: "success"
        });

      } catch (err) {
        const failedAt = new Date().toISOString();

        await supabase
          .from("post_publish_jobs")
          .update({
            status: "failed",
            last_error: err.message,
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
            error_message: err.message,
            attempts: (job.attempts || 0) + 1
          });

        processed.push({
          job: job.id,
          platform: job.platform,
          status: "failed",
          error: err.message
        });
      }
    }

    // update each post summary status after jobs are processed
    const postIds = [...new Set((jobs || []).map(j => j.post_id))];

    for (const postId of postIds) {
      const { data: postJobs, error: postJobsError } = await supabase
        .from("post_publish_jobs")
        .select("status")
        .eq("post_id", postId);

      if (postJobsError || !postJobs || !postJobs.length) continue;

      const statuses = postJobs.map(j => j.status);

      let publishStatus = "queued";

      if (statuses.every(status => status === "success")) {
        publishStatus = "published";
      } else if (statuses.some(status => status === "failed") && statuses.some(status => status === "success")) {
        publishStatus = "partial";
      } else if (statuses.every(status => status === "failed")) {
        publishStatus = "failed";
      } else if (statuses.some(status => status === "processing")) {
        publishStatus = "processing";
      } else if (statuses.some(status => status === "retrying")) {
        publishStatus = "retrying";
      }

      await supabase
        .from("posts")
        .update({
          publish_status: publishStatus
        })
        .eq("id", postId);
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
