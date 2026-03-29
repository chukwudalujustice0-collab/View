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
    const SUPABASE_URL = process.env.SUPABASE_URL_VALUE;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!SUPABASE_URL) {
      return res.status(500).json({
        ok: false,
        step: "env",
        error: "Missing SUPABASE_URL_VALUE"
      });
    }

    if (!SUPABASE_KEY) {
      return res.status(500).json({
        ok: false,
        step: "env",
        error: "Missing SUPABASE_SERVICE_KEY"
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const { data: jobs, error: jobsError } = await supabase
      .from("post_publish_jobs")
      .select("id, post_id, user_id, platform, status, attempts, next_retry_at, created_at")
      .in("status", ["queued", "retrying"])
      .order("created_at", { ascending: false })
      .limit(20);

    if (jobsError) {
      return res.status(500).json({
        ok: false,
        step: "query_jobs",
        error: jobsError.message
      });
    }

    const { data: posts, error: postsError } = await supabase
      .from("posts")
      .select("id, user_id, content, publish_status, created_at")
      .order("created_at", { ascending: false })
      .limit(5);

    if (postsError) {
      return res.status(500).json({
        ok: false,
        step: "query_posts",
        error: postsError.message
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Worker test passed",
      queued_jobs: jobs?.length || 0,
      latest_jobs: jobs || [],
      latest_posts: posts || []
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      step: "catch",
      error: error.message || "Unknown server error"
    });
  }
}
