// /api/process-publish-jobs.js

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    // ✅ Use your existing Vercel variable names
    const SUPABASE_URL =
      process.env.SUPABASE_URL_VALUE ||
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    const SUPABASE_ANON_KEY =
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // 🚨 Safe check (prevents crash)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Missing Supabase env:", {
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
      });

      return res.status(500).json({
        error: "Missing Supabase configuration",
      });
    }

    // ✅ Create Supabase admin client
    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

    // 🔥 Fetch pending jobs (adjust table if needed)
    const { data: jobs, error } = await supabase
      .from("publish_jobs")
      .select("*")
      .eq("status", "pending")
      .limit(10);

    if (error) {
      console.error("Fetch jobs error:", error);
      return res.status(500).json({
        error: "Failed to fetch jobs",
      });
    }

    // ✅ If no jobs, return safely
    if (!jobs || jobs.length === 0) {
      return res.status(200).json({
        message: "No pending jobs",
      });
    }

    // 🔥 Process jobs (basic version)
    for (const job of jobs) {
      try {
        console.log("Processing job:", job.id);

        // 👉 You will plug real publishing logic here later

        // ✅ Mark as completed
        await supabase
          .from("publish_jobs")
          .update({ status: "completed" })
          .eq("id", job.id);

      } catch (err) {
        console.error("Job failed:", job.id, err);

        await supabase
          .from("publish_jobs")
          .update({
            status: "failed",
            error: err.message,
          })
          .eq("id", job.id);
      }
    }

    return res.status(200).json({
      message: "Jobs processed successfully",
    });

  } catch (error) {
    console.error("Function crash:", error);

    return res.status(500).json({
      error: "Internal server error",
      message: error?.message || "Unknown error",
    });
  }
}
