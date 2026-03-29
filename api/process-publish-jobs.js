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

    const { data, error } = await supabase
      .from("post_publish_jobs")
      .select("id, status, platform, created_at")
      .limit(5);

    if (error) {
      return res.status(500).json({
        ok: false,
        step: "query",
        error: error.message
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Worker test passed",
      rows: data || []
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      step: "catch",
      error: error.message || "Unknown error"
    });
  }
}
