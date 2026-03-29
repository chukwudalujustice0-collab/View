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
    const supabase = createClient(
      process.env.SUPABASE_URL_VALUE,
      process.env.SUPABASE_SERVICE_KEY
    );

    // 🔥 GET QUEUED JOBS
    const { data: jobs, error } = await supabase
      .from("post_publish_jobs")
      .select("*")
      .in("status", ["queued", "retrying"])
      .limit(10);

    if (error) throw error;

    let processed = [];

    for (const job of jobs) {
      try {
        // 🔥 GET POST CONTENT
        const { data: post } = await supabase
          .from("posts")
          .select("*")
          .eq("id", job.post_id)
          .single();

        if (!post) throw new Error("Post not found");

        // 🔥 SIMULATED DELIVERY (we’ll replace with real APIs later)
        console.log(`Publishing to ${job.platform}:`, post.content);

        // 👉 mark success
        await supabase
          .from("post_publish_jobs")
          .update({
            status: "success",
            attempts: job.attempts + 1,
            delivered_at: new Date(),
            finished_at: new Date()
          })
          .eq("id", job.id);

        processed.push({
          job: job.id,
          platform: job.platform,
          status: "success"
        });

      } catch (err) {
        console.error("Job failed:", err.message);

        await supabase
          .from("post_publish_jobs")
          .update({
            status: "failed",
            last_error: err.message,
            attempts: job.attempts + 1,
            finished_at: new Date()
          })
          .eq("id", job.id);

        processed.push({
          job: job.id,
          platform: job.platform,
          status: "failed"
        });
      }
    }

    return res.json({
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
