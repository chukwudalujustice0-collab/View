import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL_VALUE ||
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res.send(JSON.stringify(payload));
}

function normalizePlatform(value) {
  return String(value || "").trim().toLowerCase();
}

function makePlatformPostId(platform, jobId) {
  return `${platform}_${jobId}_${Date.now()}`;
}

async function addLog(supabase, payload) {
  try {
    await supabase.from("post_publish_logs").insert(payload);
  } catch (e) {
    console.error("Log insert failed:", e?.message || e);
  }
}

async function processOneJob(supabase, job) {
  const now = new Date().toISOString();
  const platform = normalizePlatform(job.platform);

  const { data: post, error: postError } = await supabase
    .from("posts")
    .select("id, user_id, content, media_url, media_type, publish_status, selected_platforms, created_at")
    .eq("id", job.post_id)
    .maybeSingle();

  if (postError) {
    throw new Error(postError.message || "Could not load post");
  }

  if (!post) {
    await supabase
      .from("post_publish_jobs")
      .update({
        status: "failed",
        last_error: "Post not found",
        updated_at: now
      })
      .eq("id", job.id);

    await addLog(supabase, {
      post_id: job.post_id,
      job_id: job.id,
      platform,
      status: "failed",
      attempts: (job.attempts || 0) + 1,
      error_message: "Post not found",
      created_at: now
    });

    return { ok: false, reason: "Post not found" };
  }

  await supabase
    .from("post_publish_jobs")
    .update({
      status: "processing",
      attempts: (job.attempts || 0) + 1,
      updated_at: now,
      last_error: null
    })
    .eq("id", job.id);

  if (platform === "view") {
    const platformPostId = makePlatformPostId(platform, job.id);

    await supabase
      .from("post_publish_jobs")
      .update({
        status: "success",
        platform_post_id: platformPostId,
        delivered_at: now,
        last_error: null,
        next_retry_at: null,
        updated_at: now
      })
      .eq("id", job.id);

    await addLog(supabase, {
      post_id: job.post_id,
      job_id: job.id,
      platform,
      status: "success",
      attempts: (job.attempts || 0) + 1,
      platform_post_id: platformPostId,
      created_at: now
    });

    return { ok: true, status: "success", platform };
  }

  const { data: account, error: accountError } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("user_id", post.user_id)
    .eq("platform", platform)
    .limit(1)
    .maybeSingle();

  if (accountError) {
    throw new Error(accountError.message || "Could not check connected account");
  }

  if (!account) {
    const message = `No connected ${platform} account found`;

    await supabase
      .from("post_publish_jobs")
      .update({
        status: "failed",
        last_error: message,
        next_retry_at: null,
        updated_at: now
      })
      .eq("id", job.id);

    await addLog(supabase, {
      post_id: job.post_id,
      job_id: job.id,
      platform,
      status: "failed",
      attempts: (job.attempts || 0) + 1,
      error_message: message,
      created_at: now
    });

    return { ok: false, reason: message, platform };
  }

  const connected =
    account.is_connected === true ||
    account.connected === true ||
    account.status === "connected" ||
    account.status === "active";

  if (!connected) {
    const message = `${platform} account exists but is not active`;

    await supabase
      .from("post_publish_jobs")
      .update({
        status: "failed",
        last_error: message,
        next_retry_at: null,
        updated_at: now
      })
      .eq("id", job.id);

    await addLog(supabase, {
      post_id: job.post_id,
      job_id: job.id,
      platform,
      status: "failed",
      attempts: (job.attempts || 0) + 1,
      error_message: message,
      created_at: now
    });

    return { ok: false, reason: message, platform };
  }

  const token =
    account.access_token ||
    account.page_access_token ||
    account.token ||
    account.auth_token ||
    null;

  if (!token) {
    const message = `${platform} account is connected but missing access token`;

    await supabase
      .from("post_publish_jobs")
      .update({
        status: "failed",
        last_error: message,
        next_retry_at: null,
        updated_at: now
      })
      .eq("id", job.id);

    await addLog(supabase, {
      post_id: job.post_id,
      job_id: job.id,
      platform,
      status: "failed",
      attempts: (job.attempts || 0) + 1,
      error_message: message,
      created_at: now
    });

    return { ok: false, reason: message, platform };
  }

  const message = `${platform} delivery handler is not wired yet`;

  await supabase
    .from("post_publish_jobs")
    .update({
      status: "failed",
      last_error: message,
      next_retry_at: null,
      updated_at: now
    })
    .eq("id", job.id);

  await addLog(supabase, {
    post_id: job.post_id,
    job_id: job.id,
    platform,
    status: "failed",
    attempts: (job.attempts || 0) + 1,
    error_message: message,
    created_at: now
  });

  return { ok: false, reason: message, platform };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return json(res, 200, { ok: true });
  }

  if (req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, {
        error: "Missing Supabase configuration"
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: jobs, error: jobsError } = await supabase
      .from("post_publish_jobs")
      .select("id, post_id, platform, status, attempts, last_error, next_retry_at, created_at, updated_at")
      .in("status", ["queued", "retrying"])
      .order("created_at", { ascending: true })
      .limit(20);

    if (jobsError) {
      return json(res, 500, {
        error: jobsError.message || "Failed to fetch jobs"
      });
    }

    if (!jobs || jobs.length === 0) {
      return json(res, 200, {
        ok: true,
        processed: 0,
        success: 0,
        failed: 0,
        message: "No pending jobs"
      });
    }

    let processed = 0;
    let success = 0;
    let failed = 0;
    const results = [];

    for (const job of jobs) {
      try {
        const result = await processOneJob(supabase, job);
        processed += 1;
        if (result.ok) success += 1;
        else failed += 1;
        results.push({
          job_id: job.id,
          platform: job.platform,
          ok: !!result.ok,
          reason: result.reason || null
        });
      } catch (err) {
        const message = err?.message || "Unexpected worker error";
        const now = new Date().toISOString();

        await supabase
          .from("post_publish_jobs")
          .update({
            status: "failed",
            last_error: message,
            updated_at: now
          })
          .eq("id", job.id);

        await addLog(supabase, {
          post_id: job.post_id,
          job_id: job.id,
          platform: normalizePlatform(job.platform),
          status: "failed",
          attempts: (job.attempts || 0) + 1,
          error_message: message,
          created_at: now
        });

        processed += 1;
        failed += 1;
        results.push({
          job_id: job.id,
          platform: job.platform,
          ok: false,
          reason: message
        });
      }
    }

    return json(res, 200, {
      ok: true,
      processed,
      success,
      failed,
      message: `Processed ${processed} job(s)`,
      results
    });
  } catch (error) {
    console.error("process-publish-jobs crash:", error);
    return json(res, 500, {
      error: error?.message || "Internal server error"
    });
  }
}
