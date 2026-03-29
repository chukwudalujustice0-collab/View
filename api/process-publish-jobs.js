export default async function handler(req, res) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL_VALUE;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

    const response = await fetch(`${SUPABASE_URL}/rest/v1/post_publish_jobs?status=eq.queued&select=*`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    });

    const jobs = await response.json();

    if (!jobs.length) {
      return res.json({ message: "No jobs in queue" });
    }

    for (const job of jobs) {
      try {
        // 🔥 simulate publishing (replace with real APIs later)
        let platformPostId = "post_" + Date.now();

        // ✅ update job success
        await fetch(`${SUPABASE_URL}/rest/v1/post_publish_jobs?id=eq.${job.id}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            status: "success",
            platform_post_id: platformPostId,
            delivered_at: new Date().toISOString()
          })
        });

        // ✅ log success
        await fetch(`${SUPABASE_URL}/rest/v1/post_publish_logs`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            post_id: job.post_id,
            job_id: job.id,
            user_id: job.user_id,
            platform: job.platform,
            status: "success",
            platform_post_id: platformPostId
          })
        });

      } catch (err) {
        // ❌ update failure
        await fetch(`${SUPABASE_URL}/rest/v1/post_publish_jobs?id=eq.${job.id}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            status: "failed",
            last_error: err.message
          })
        });
      }
    }

    res.json({ success: true, processed: jobs.length });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
