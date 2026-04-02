const { createClient } = require("@supabase/supabase-js");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

function getEnv(name, fallbackNames = []) {
  return process.env[name] || fallbackNames.map((k) => process.env[k]).find(Boolean) || "";
}

function normalizePlatform(value) {
  return String(value || "").trim().toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function makePlatformPostId(platform, id) {
  return `${platform}_${id}_${Date.now()}`;
}

function safeJsonParse(text, fallback = {}) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function isVideo(mediaType = "") {
  return String(mediaType).toLowerCase().startsWith("video/");
}

function isImage(mediaType = "") {
  return String(mediaType).toLowerCase().startsWith("image/");
}

function getPostText(post) {
  return String(post?.content || "").trim();
}

function getSupabase() {
  const url = getEnv("SUPABASE_URL", ["SUPABASE_URL_VALUE", "NEXT_PUBLIC_SUPABASE_URL"]);
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY", ["SUPABASE_SERVICE_KEY"]);
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

async function addLog(supabase, payload) {
  try {
    await supabase.from("post_publish_logs").insert(payload);
  } catch (e) {
    console.error("post_publish_logs insert failed:", e?.message || e);
  }
}

async function markJob(supabase, jobId, patch) {
  const update = { ...patch, updated_at: nowIso() };
  const { error } = await supabase.from("post_publish_jobs").update(update).eq("id", jobId);
  if (error) throw new Error(error.message || "Failed updating job");
}

async function fetchBinaryBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch media: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function resolveConnectedAccountField(account, names) {
  for (const name of names) {
    if (account && account[name] != null && account[name] !== "") {
      return account[name];
    }
  }
  return null;
}

function resolveConnectedFlag(account) {
  return (
    account?.is_connected === true ||
    account?.connected === true ||
    account?.status === "connected" ||
    account?.status === "active"
  );
}

function resolveAccessToken(account) {
  return (
    resolveConnectedAccountField(account, [
      "access_token",
      "page_access_token",
      "token",
      "auth_token",
      "oauth_token",
    ]) || null
  );
}

async function uploadToYouTube(post, account) {
  if (!post.media_url) throw new Error("YouTube requires media_url");
  if (!isVideo(post.media_type)) {
    throw new Error(`YouTube requires video media, got ${post.media_type || "unknown"}`);
  }

  const accessToken = resolveAccessToken(account);
  if (!accessToken) throw new Error("Missing YouTube access token");

  const buffer = await fetchBinaryBuffer(post.media_url);

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": post.media_type || "video/mp4",
        "X-Upload-Content-Length": String(buffer.length),
      },
      body: JSON.stringify({
        snippet: {
          title: getPostText(post) || "View Upload",
          description: getPostText(post) || "",
        },
        status: {
          privacyStatus: "public",
        },
      }),
    }
  );

  const initText = await initRes.text();
  const uploadUrl = initRes.headers.get("location");

  if (!initRes.ok || !uploadUrl) {
    throw new Error(`YouTube init failed: ${initText || initRes.status}`);
  }

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": post.media_type || "video/mp4",
      "Content-Length": String(buffer.length),
    },
    body: buffer,
  });

  const uploadText = await uploadRes.text();
  const uploadJson = safeJsonParse(uploadText, {});

  if (!uploadRes.ok) {
    throw new Error(
      uploadJson?.error?.message || uploadText || `YouTube upload failed: ${uploadRes.status}`
    );
  }

  return uploadJson?.id || makePlatformPostId("youtube", post.id);
}

async function sendToTelegram(post, account) {
  const botToken = getEnv("TELEGRAM_BOT_TOKEN");
  if (!botToken) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const chatId = resolveConnectedAccountField(account, [
    "chat_id",
    "telegram_chat_id",
    "platform_user_id",
    "external_id",
    "account_id",
    "page_id",
  ]);

  if (!chatId) throw new Error("Missing Telegram chat_id on connected account");

  const caption = getPostText(post) || "View post";
  let endpoint = "sendMessage";
  let body = { chat_id: chatId, text: caption };

  if (post.media_url && isImage(post.media_type)) {
    endpoint = "sendPhoto";
    body = { chat_id: chatId, photo: post.media_url, caption };
  } else if (post.media_url && isVideo(post.media_type)) {
    endpoint = "sendVideo";
    body = { chat_id: chatId, video: post.media_url, caption };
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  const data = safeJsonParse(text, {});

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.description || text || "Telegram publish failed");
  }

  return String(data?.result?.message_id || makePlatformPostId("telegram", post.id));
}

async function sendToFacebook(post, account) {
  const accessToken = account?.page_access_token || resolveAccessToken(account);
  if (!accessToken) throw new Error("Missing Facebook Page access token");

  const pageId = resolveConnectedAccountField(account, [
    "page_id",
    "platform_user_id",
    "external_id",
    "account_id",
  ]);
  if (!pageId) throw new Error("Missing Facebook page_id");

  let url = `https://graph.facebook.com/v23.0/${pageId}/feed`;
  let body;

  if (post.media_url && isImage(post.media_type)) {
    url = `https://graph.facebook.com/v23.0/${pageId}/photos`;
    body = new URLSearchParams({
      url: post.media_url,
      caption: getPostText(post) || "",
      access_token: accessToken,
    });
  } else if (post.media_url && isVideo(post.media_type)) {
    url = `https://graph.facebook.com/v23.0/${pageId}/videos`;
    body = new URLSearchParams({
      file_url: post.media_url,
      description: getPostText(post) || "",
      access_token: accessToken,
    });
  } else {
    body = new URLSearchParams({
      message: getPostText(post) || "",
      access_token: accessToken,
    });
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  const data = safeJsonParse(text, {});

  if (!res.ok || data?.error) {
    throw new Error(data?.error?.message || text || "Facebook publish failed");
  }

  return String(data?.post_id || data?.id || makePlatformPostId("facebook", post.id));
}

async function sendToInstagram(post, account) {
  const accessToken = resolveAccessToken(account);
  if (!accessToken) throw new Error("Missing Instagram access token");

  const igUserId = resolveConnectedAccountField(account, [
    "instagram_user_id",
    "ig_user_id",
    "platform_user_id",
    "external_id",
    "account_id",
  ]);
  if (!igUserId) throw new Error("Missing Instagram user id");

  if (!post.media_url) throw new Error("Instagram publishing requires media_url");

  const caption = getPostText(post) || "";
  let createUrl = `https://graph.facebook.com/v23.0/${igUserId}/media`;
  let createBody;

  if (isImage(post.media_type)) {
    createBody = new URLSearchParams({
      image_url: post.media_url,
      caption,
      access_token: accessToken,
    });
  } else if (isVideo(post.media_type)) {
    createBody = new URLSearchParams({
      media_type: "REELS",
      video_url: post.media_url,
      caption,
      access_token: accessToken,
    });
  } else {
    throw new Error(`Instagram unsupported media type: ${post.media_type || "unknown"}`);
  }

  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: createBody,
  });

  const createText = await createRes.text();
  const createData = safeJsonParse(createText, {});

  if (!createRes.ok || createData?.error || !createData?.id) {
    throw new Error(createData?.error?.message || createText || "Instagram media container failed");
  }

  const publishRes = await fetch(`https://graph.facebook.com/v23.0/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: createData.id,
      access_token: accessToken,
    }),
  });

  const publishText = await publishRes.text();
  const publishData = safeJsonParse(publishText, {});

  if (!publishRes.ok || publishData?.error) {
    throw new Error(publishData?.error?.message || publishText || "Instagram publish failed");
  }

  return String(publishData?.id || createData.id || makePlatformPostId("instagram", post.id));
}

async function registerLinkedInImage(mediaUrl, accessToken) {
  const initRes = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        owner: "urn:li:person:me",
        serviceRelationships: [
          {
            relationshipType: "OWNER",
            identifier: "urn:li:userGeneratedContent",
          },
        ],
      },
    }),
  });

  const initText = await initRes.text();
  const initData = safeJsonParse(initText, {});

  const uploadUrl =
    initData?.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]
      ?.uploadUrl;
  const asset = initData?.value?.asset;

  if (!initRes.ok || !uploadUrl || !asset) {
    throw new Error(initData?.message || initText || "LinkedIn image register failed");
  }

  const fileRes = await fetch(mediaUrl);
  if (!fileRes.ok) throw new Error("Could not fetch LinkedIn image source");
  const buffer = Buffer.from(await fileRes.arrayBuffer());

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": fileRes.headers.get("content-type") || "application/octet-stream",
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const uploadText = await uploadRes.text();
    throw new Error(uploadText || "LinkedIn image upload failed");
  }

  return asset;
}

async function sendToLinkedIn(post, account) {
  const accessToken = resolveAccessToken(account);
  if (!accessToken) throw new Error("Missing LinkedIn access token");

  const author =
    resolveConnectedAccountField(account, ["linkedin_person_urn", "author_urn"]) || "urn:li:person:me";

  let content = null;

  if (post.media_url && isImage(post.media_type)) {
    const asset = await registerLinkedInImage(post.media_url, accessToken);
    content = {
      media: {
        id: asset,
        title: getPostText(post) || "View post",
      },
    };
  }

  const body = {
    author,
    commentary: getPostText(post) || "",
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (content) body.content = content;

  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": "202602",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  const idHeader = res.headers.get("x-restli-id");
  const data = safeJsonParse(text, {});

  if (!res.ok) {
    throw new Error(data?.message || text || "LinkedIn publish failed");
  }

  return String(idHeader || data?.id || makePlatformPostId("linkedin", post.id));
}

async function sendToX(post, account) {
  const bearer = getEnv("X_BEARER_TOKEN", ["TWITTER_BEARER_TOKEN"]);
  const accessToken = resolveAccessToken(account) || bearer;
  if (!accessToken) throw new Error("Missing X access token/bearer token");

  const text = getPostText(post);
  if (!text) throw new Error("X posting currently requires text content");

  const res = await fetch("https://api.x.com/2/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  const bodyText = await res.text();
  const data = safeJsonParse(bodyText, {});

  if (!res.ok || data?.errors) {
    throw new Error(data?.detail || data?.title || bodyText || "X publish failed");
  }

  return String(data?.data?.id || makePlatformPostId("x", post.id));
}

async function sendToTikTok(post, account) {
  const accessToken = resolveAccessToken(account);
  if (!accessToken) throw new Error("Missing TikTok access token");
  if (!post.media_url) throw new Error("TikTok requires media_url");

  const text = getPostText(post) || "View post";
  let sourceInfo;

  if (isVideo(post.media_type)) {
    sourceInfo = {
      source: "PULL_FROM_URL",
      video_url: post.media_url,
    };
  } else if (isImage(post.media_type)) {
    sourceInfo = {
      source: "PULL_FROM_URL",
      photo_images: [post.media_url],
    };
  } else {
    throw new Error(`TikTok unsupported media type: ${post.media_type || "unknown"}`);
  }

  const privacyLevel = resolveConnectedAccountField(account, ["privacy_level"]) || "PUBLIC_TO_EVERYONE";
  const postMode = resolveConnectedAccountField(account, ["post_mode"]) || "DIRECT_POST";

  const body = {
    post_info: {
      title: text.slice(0, 90),
      privacy_level: privacyLevel,
      disable_comment: false,
      disable_duet: false,
      disable_stitch: false,
      brand_content_toggle: false,
      brand_organic_toggle: false,
    },
    source_info: sourceInfo,
    post_mode: postMode,
  };

  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });

  const textRes = await res.text();
  const data = safeJsonParse(textRes, {});

  if (!res.ok || data?.error?.code) {
    throw new Error(
      data?.error?.message || data?.error?.code || textRes || "TikTok publish init failed"
    );
  }

  return String(
    data?.data?.publish_id ||
      data?.data?.task_id ||
      data?.data?.share_id ||
      makePlatformPostId("tiktok", post.id)
  );
}

async function dispatchPlatform(post, account, platform) {
  switch (platform) {
    case "view":
      return makePlatformPostId("view", post.id);
    case "telegram":
      return await sendToTelegram(post, account);
    case "youtube":
      return await uploadToYouTube(post, account);
    case "facebook":
      return await sendToFacebook(post, account);
    case "instagram":
      return await sendToInstagram(post, account);
    case "linkedin":
      return await sendToLinkedIn(post, account);
    case "x":
    case "twitter":
      return await sendToX(post, account);
    case "tiktok":
      return await sendToTikTok(post, account);
    default:
      throw new Error(`${platform} delivery handler is not wired yet`);
  }
}

async function loadPostAndAccount(supabase, job) {
  const [{ data: post, error: postError }, { data: account, error: accountError }] = await Promise.all([
    supabase.from("posts").select("*").eq("id", job.post_id).single(),
    supabase
      .from("connected_accounts")
      .select("*")
      .eq("user_id", job.user_id)
      .eq("platform", job.platform)
      .maybeSingle(),
  ]);

  if (postError || !post) throw new Error(postError?.message || "Post not found");

  if (normalizePlatform(job.platform) !== "view") {
    if (accountError) throw new Error(accountError.message || "Connected account lookup failed");
    if (!account) throw new Error(`No connected ${job.platform} account found`);
    if (!resolveConnectedFlag(account)) {
      throw new Error(`${job.platform} account exists but is not active`);
    }
  }

  return { post, account };
}

async function updatePostAggregateStatus(supabase, postId) {
  const { data: jobs, error } = await supabase
    .from("post_publish_jobs")
    .select("status")
    .eq("post_id", postId);

  if (error || !jobs) return;

  const statuses = jobs.map((j) => j.status);
  let publishStatus = "queued";

  if (statuses.length && statuses.every((s) => s === "success")) {
    publishStatus = "published";
  } else if (statuses.some((s) => s === "success") && statuses.some((s) => s === "failed")) {
    publishStatus = "partial";
  } else if (statuses.some((s) => s === "processing")) {
    publishStatus = "processing";
  } else if (statuses.some((s) => s === "retrying" || s === "queued")) {
    publishStatus = "queued";
  } else if (statuses.length && statuses.every((s) => s === "failed")) {
    publishStatus = "failed";
  }

  await supabase.from("posts").update({ publish_status: publishStatus }).eq("id", postId);
}

async function processJob(supabase, job) {
  const startedAt = nowIso();
  const platform = normalizePlatform(job.platform);

  await markJob(supabase, job.id, {
    status: "processing",
    attempts: (job.attempts || 0) + 1,
    last_error: null,
  });

  const { post, account } = await loadPostAndAccount(supabase, job);
  const platformPostId = await dispatchPlatform(post, account, platform);

  await markJob(supabase, job.id, {
    status: "success",
    platform_post_id: String(platformPostId),
    delivered_at: startedAt,
    next_retry_at: null,
    last_error: null,
  });

  await addLog(supabase, {
    post_id: job.post_id,
    job_id: job.id,
    platform,
    status: "success",
    attempts: (job.attempts || 0) + 1,
    platform_post_id: String(platformPostId),
    created_at: startedAt,
  });

  await updatePostAggregateStatus(supabase, job.post_id);

  return {
    ok: true,
    job_id: job.id,
    platform,
    platform_post_id: String(platformPostId),
  };
}

async function failJob(supabase, job, message) {
  const attempts = (job.attempts || 0) + 1;
  const retryable = attempts < 3;
  const nextRetryAt = retryable ? new Date(Date.now() + attempts * 5 * 60 * 1000).toISOString() : null;
  const status = retryable ? "retrying" : "failed";

  await markJob(supabase, job.id, {
    status,
    last_error: message,
    next_retry_at: nextRetryAt,
    attempts,
  });

  await addLog(supabase, {
    post_id: job.post_id,
    job_id: job.id,
    platform: normalizePlatform(job.platform),
    status,
    attempts,
    error_message: message,
    created_at: nowIso(),
  });

  await updatePostAggregateStatus(supabase, job.post_id);

  return {
    ok: false,
    job_id: job.id,
    platform: normalizePlatform(job.platform),
    error: message,
    status,
  };
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const supabase = getSupabase();

    const statuses = ["queued", "retrying"];
    const now = new Date().toISOString();

    let query = supabase
      .from("post_publish_jobs")
      .select("*")
      .in("status", statuses)
      .order("created_at", { ascending: true })
      .limit(10);

    const { data: jobs, error: jobsError } = await query;

    if (jobsError) {
      throw new Error(jobsError.message || "Failed to load publish jobs");
    }

    const runnableJobs = (jobs || []).filter((job) => {
      if (job.status !== "retrying") return true;
      if (!job.next_retry_at) return true;
      return job.next_retry_at <= now;
    });

    if (!runnableJobs.length) {
      return res.status(200).json({
        success: true,
        processed: 0,
        results: [],
        message: "No pending jobs",
      });
    }

    const results = [];

    for (const job of runnableJobs) {
      try {
        const result = await processJob(supabase, job);
        results.push(result);
      } catch (err) {
        const failure = await failJob(supabase, job, err?.message || "Unknown publish error");
        results.push(failure);
      }
    }

    return res.status(200).json({
      success: true,
      processed: results.length,
      success_count: results.filter((r) => r.ok).length,
      failed_count: results.filter((r) => !r.ok).length,
      results,
      message: `Processed ${results.length} job(s)`,
    });
  } catch (err) {
    console.error("process-publish-jobs fatal:", err);
    return res.status(500).json({
      success: false,
      error: err?.message || "Internal server error",
    });
  }
};
