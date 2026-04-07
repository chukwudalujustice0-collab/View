const { createClient } = require("@supabase/supabase-js");

const JOB_STATUS = {
  QUEUED: "queued",
  PROCESSING: "processing",
  RETRYING: "retrying",
  COMPLETED: "completed",
  FAILED: "failed",
};

const ALLOWED_JOB_STATUSES = new Set(Object.values(JOB_STATUS));

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

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function trimText(value, max = 3000) {
  return String(value || "").slice(0, max);
}

function isVideo(mediaType = "", mediaUrl = "") {
  const mt = String(mediaType || "").toLowerCase();
  const url = String(mediaUrl || "").toLowerCase();
  return (
    mt.startsWith("video/") ||
    [".mp4", ".mov", ".m4v", ".webm", ".ogg"].some((ext) => url.includes(ext))
  );
}

function isImage(mediaType = "", mediaUrl = "") {
  const mt = String(mediaType || "").toLowerCase();
  const url = String(mediaUrl || "").toLowerCase();
  return (
    mt.startsWith("image/") ||
    [".jpg", ".jpeg", ".png", ".gif", ".webp"].some((ext) => url.includes(ext))
  );
}

function getPostText(post) {
  const title = String(post?.title || "").trim();
  const content = String(post?.content || "").trim();
  if (title && content) return `${title}\n\n${content}`.trim();
  return title || content || "";
}

function getMediaUrl(post) {
  return String(post?.media_url || post?.media_path || "").trim();
}

function getMediaType(post) {
  return String(post?.media_type || "").trim();
}

function getSupabase() {
  const url = getEnv("SUPABASE_URL", ["SUPABASE_URL_VALUE", "NEXT_PUBLIC_SUPABASE_URL"]);
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY", ["SUPABASE_SERVICE_KEY"]);
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function isAllowedJobStatus(status) {
  return ALLOWED_JOB_STATUSES.has(String(status || "").trim().toLowerCase());
}

function extractApiErrorMessage(payload, fallback = "Request failed") {
  if (!payload) return fallback;

  if (typeof payload === "string") {
    const cleaned = payload.replace(/\s+/g, " ").trim();
    return trimText(cleaned || fallback, 500);
  }

  return trimText(
    payload?.error?.message ||
      payload?.message ||
      payload?.error_description ||
      payload?.description ||
      payload?.detail ||
      payload?.title ||
      payload?.errorDetails ||
      fallback,
    500
  );
}

function sanitizeErrorMessage(errorLike, fallback = "Unknown publish error") {
  if (!errorLike) return fallback;

  if (typeof errorLike === "string") {
    const cleaned = errorLike.replace(/\s+/g, " ").trim();
    if (!cleaned) return fallback;

    const lower = cleaned.toLowerCase();
    if (
      lower.includes('"uploadurl"') ||
      lower.includes('"uploadinstructions"') ||
      lower.includes('"uploadedvideo"') ||
      lower.includes('"value":')
    ) {
      return "Provider returned upload session data instead of a final publish result";
    }

    return trimText(cleaned, 500);
  }

  if (errorLike instanceof Error) {
    return sanitizeErrorMessage(errorLike.message, fallback);
  }

  return trimText(JSON.stringify(errorLike), 500);
}

async function addLog(supabase, payload) {
  try {
    await supabase.from("post_publish_logs").insert(payload);
  } catch (e) {
    console.error("post_publish_logs insert failed:", e?.message || e);
  }
}

async function markJob(supabase, jobId, patch) {
  const nextStatus = patch?.status;
  if (nextStatus && !isAllowedJobStatus(nextStatus)) {
    throw new Error(`Refusing to write invalid job status: ${nextStatus}`);
  }

  const update = { ...patch, updated_at: nowIso() };
  const { error } = await supabase.from("post_publish_jobs").update(update).eq("id", jobId);

  if (error) throw new Error(error.message || "Failed updating job");
}

async function fetchBinaryWithMeta(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch media: ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    buffer,
    contentType: res.headers.get("content-type") || "application/octet-stream",
    contentLength: buffer.length,
  };
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
  const mediaUrl = getMediaUrl(post);
  const mediaType = getMediaType(post);

  if (!mediaUrl) throw new Error("YouTube requires media_url/media_path");
  if (!isVideo(mediaType, mediaUrl)) {
    throw new Error(`YouTube requires video media, got ${mediaType || "unknown"}`);
  }

  const accessToken = resolveAccessToken(account);
  if (!accessToken) throw new Error("Missing YouTube access token");

  const text = getPostText(post);
  const title = hasText(text) ? trimText(text, 100) : "View Upload";
  const description = hasText(text) ? trimText(text, 5000) : "";

  const media = await fetchBinaryWithMeta(mediaUrl);

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mediaType || media.contentType || "video/mp4",
        "X-Upload-Content-Length": String(media.contentLength),
      },
      body: JSON.stringify({
        snippet: { title, description },
        status: { privacyStatus: "public" },
      }),
    }
  );

  const initText = await initRes.text();
  const uploadUrl = initRes.headers.get("location");

  if (!initRes.ok || !uploadUrl) {
    throw new Error(`YouTube init failed: ${extractApiErrorMessage(initText, `HTTP ${initRes.status}`)}`);
  }

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mediaType || media.contentType || "video/mp4",
      "Content-Length": String(media.contentLength),
    },
    body: media.buffer,
  });

  const uploadText = await uploadRes.text();
  const uploadJson = safeJsonParse(uploadText, {});

  if (!uploadRes.ok) {
    throw new Error(
      extractApiErrorMessage(uploadJson, uploadText || `YouTube upload failed: ${uploadRes.status}`)
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

  const text = getPostText(post);
  const mediaUrl = getMediaUrl(post);
  const mediaType = getMediaType(post);

  let endpoint = "sendMessage";
  let body = { chat_id: chatId, text: hasText(text) ? trimText(text, 4096) : " " };

  if (mediaUrl && isImage(mediaType, mediaUrl)) {
    endpoint = "sendPhoto";
    body = { chat_id: chatId, photo: mediaUrl };
    if (hasText(text)) body.caption = trimText(text, 1024);
  } else if (mediaUrl && isVideo(mediaType, mediaUrl)) {
    endpoint = "sendVideo";
    body = { chat_id: chatId, video: mediaUrl };
    if (hasText(text)) body.caption = trimText(text, 1024);
  } else if (mediaUrl) {
    endpoint = "sendDocument";
    body = { chat_id: chatId, document: mediaUrl };
    if (hasText(text)) body.caption = trimText(text, 1024);
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const textRes = await res.text();
  const data = safeJsonParse(textRes, {});

  if (!res.ok || data?.ok === false) {
    throw new Error(extractApiErrorMessage(data, textRes || "Telegram publish failed"));
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

  const mediaUrl = getMediaUrl(post);
  const mediaType = getMediaType(post);
  const text = getPostText(post);

  let url = `https://graph.facebook.com/v23.0/${pageId}/feed`;
  let body;

  if (mediaUrl && isImage(mediaType, mediaUrl)) {
    url = `https://graph.facebook.com/v23.0/${pageId}/photos`;
    body = new URLSearchParams({
      url: mediaUrl,
      access_token: accessToken,
    });
    if (hasText(text)) body.set("caption", trimText(text, 2200));
  } else if (mediaUrl && isVideo(mediaType, mediaUrl)) {
    url = `https://graph.facebook.com/v23.0/${pageId}/videos`;
    body = new URLSearchParams({
      file_url: mediaUrl,
      access_token: accessToken,
    });
    if (hasText(text)) body.set("description", trimText(text, 2200));
    if (hasText(text)) body.set("title", trimText(text, 100));
  } else {
    if (!hasText(text)) {
      throw new Error("Facebook text-only post requires content");
    }
    body = new URLSearchParams({
      message: trimText(text, 5000),
      access_token: accessToken,
    });
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const textRes = await res.text();
  const data = safeJsonParse(textRes, {});

  if (!res.ok || data?.error) {
    throw new Error(extractApiErrorMessage(data, textRes || "Facebook publish failed"));
  }

  return String(data?.post_id || data?.id || makePlatformPostId("facebook", post.id));
}

async function sendToInstagram(post, account) {
  const accessToken = resolveAccessToken(account);
  if (!accessToken) throw new Error("Missing Instagram access token");

  const igUserId = resolveConnectedAccountField(account, [
    "instagram_user_id",
    "ig_user_id",
    "external_user_id",
    "platform_user_id",
    "external_id",
    "account_id",
  ]);
  if (!igUserId) throw new Error("Missing Instagram user id");

  const mediaUrl = getMediaUrl(post);
  const mediaType = getMediaType(post);
  const caption = getPostText(post);

  if (!mediaUrl) {
    throw new Error("Instagram publishing requires media_url/media_path");
  }

  let createBody;

  if (isImage(mediaType, mediaUrl)) {
    createBody = new URLSearchParams({
      image_url: mediaUrl,
      access_token: accessToken,
    });
    if (hasText(caption)) createBody.set("caption", trimText(caption, 2200));
  } else if (isVideo(mediaType, mediaUrl)) {
    createBody = new URLSearchParams({
      media_type: "REELS",
      video_url: mediaUrl,
      access_token: accessToken,
    });
    if (hasText(caption)) createBody.set("caption", trimText(caption, 2200));
  } else {
    throw new Error(`Instagram unsupported media type: ${mediaType || "unknown"}`);
  }

  const createRes = await fetch(`https://graph.facebook.com/v23.0/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: createBody,
  });

  const createText = await createRes.text();
  const createData = safeJsonParse(createText, {});

  if (!createRes.ok || createData?.error || !createData?.id) {
    throw new Error(extractApiErrorMessage(createData, createText || "Instagram media container failed"));
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
    throw new Error(extractApiErrorMessage(publishData, publishText || "Instagram publish failed"));
  }

  return String(publishData?.id || createData.id || makePlatformPostId("instagram", post.id));
}

function resolveLinkedInAuthorUrn(account) {
  const explicitUrn = resolveConnectedAccountField(account, [
    "linkedin_person_urn",
    "linkedin_organization_urn",
    "author_urn",
  ]);
  if (explicitUrn) return explicitUrn;

  const orgId = resolveConnectedAccountField(account, [
    "organization_id",
    "linkedin_organization_id",
    "company_id",
    "page_id",
  ]);
  if (orgId) return `urn:li:organization:${orgId}`;

  const personId = resolveConnectedAccountField(account, [
    "external_user_id",
    "linkedin_user_id",
    "platform_user_id",
    "external_id",
    "account_id",
  ]);
  if (personId) return `urn:li:person:${personId}`;

  throw new Error("Missing LinkedIn author identity");
}

function getLinkedInHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "LinkedIn-Version": "202602",
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

async function registerLinkedInImage(mediaUrl, accessToken, ownerUrn) {
  const initRes = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: getLinkedInHeaders(accessToken),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: ownerUrn,
      },
    }),
  });

  const initText = await initRes.text();
  const initData = safeJsonParse(initText, {});
  const uploadUrl = initData?.value?.uploadUrl;
  const imageUrn = initData?.value?.image;

  if (!initRes.ok || !uploadUrl || !imageUrn) {
    throw new Error(extractApiErrorMessage(initData, initText || "LinkedIn image initialize failed"));
  }

  const media = await fetchBinaryWithMeta(mediaUrl);

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": media.contentType,
      "Content-Length": String(media.contentLength),
    },
    body: media.buffer,
  });

  if (!uploadRes.ok) {
    const uploadText = await uploadRes.text();
    throw new Error(extractApiErrorMessage(uploadText, "LinkedIn image upload failed"));
  }

  return imageUrn;
}

async function registerLinkedInVideo(mediaUrl, accessToken, ownerUrn) {
  const media = await fetchBinaryWithMeta(mediaUrl);

  const initRes = await fetch("https://api.linkedin.com/rest/videos?action=initializeUpload", {
    method: "POST",
    headers: getLinkedInHeaders(accessToken),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: ownerUrn,
        fileSizeBytes: media.contentLength,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  });

  const initText = await initRes.text();
  const initData = safeJsonParse(initText, {});
  const value = initData?.value || {};
  const videoUrn = value.video;
  const uploadInstructions = Array.isArray(value.uploadInstructions) ? value.uploadInstructions : [];
  const hasUploadTokenKey = Object.prototype.hasOwnProperty.call(value, "uploadToken");
  const uploadToken = hasUploadTokenKey ? String(value.uploadToken ?? "") : "";

  if (!initRes.ok || !videoUrn || !uploadInstructions.length) {
    throw new Error(extractApiErrorMessage(initData, initText || "LinkedIn video initialize failed"));
  }

  const uploadedPartIds = [];

  for (const part of uploadInstructions) {
    const start = Number(part.firstByte || 0);
    const end = Number(part.lastByte != null ? part.lastByte : media.contentLength - 1);
    const chunk = media.buffer.subarray(start, end + 1);

    const uploadRes = await fetch(part.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": media.contentType || "application/octet-stream",
        "Content-Length": String(chunk.length),
      },
      body: chunk,
    });

    const uploadText = await uploadRes.text();

    if (!uploadRes.ok) {
      throw new Error(extractApiErrorMessage(uploadText, "LinkedIn video upload failed"));
    }

    const etagRaw = uploadRes.headers.get("etag") || uploadRes.headers.get("ETag");
    if (!etagRaw) {
      throw new Error("LinkedIn video upload missing ETag header");
    }

    const cleanEtag = etagRaw.replace(/^W\//, "").replace(/^"|"$/g, "");
    uploadedPartIds.push(cleanEtag);
  }

  const finalizePayload = {
    finalizeUploadRequest: {
      video: videoUrn,
      uploadedPartIds,
    },
  };

  if (hasUploadTokenKey) {
    finalizePayload.finalizeUploadRequest.uploadToken = uploadToken;
  }

  const finalizeRes = await fetch("https://api.linkedin.com/rest/videos?action=finalizeUpload", {
    method: "POST",
    headers: getLinkedInHeaders(accessToken),
    body: JSON.stringify(finalizePayload),
  });

  const finalizeText = await finalizeRes.text();
  const finalizeData = safeJsonParse(finalizeText, {});

  if (!finalizeRes.ok) {
    throw new Error(extractApiErrorMessage(finalizeData, finalizeText || "LinkedIn video finalize failed"));
  }

  return videoUrn;
}

async function sendToLinkedIn(post, account) {
  const accessToken = resolveAccessToken(account);
  if (!accessToken) throw new Error("Missing LinkedIn access token");

  const author = resolveLinkedInAuthorUrn(account);
  const commentary = getPostText(post);
  const mediaUrl = getMediaUrl(post);
  const mediaType = getMediaType(post);

  const body = {
    author,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (hasText(commentary)) {
    body.commentary = trimText(commentary, 3000);
  }

  if (mediaUrl && isImage(mediaType, mediaUrl)) {
    const imageUrn = await registerLinkedInImage(mediaUrl, accessToken, author);
    body.content = {
      media: {
        id: imageUrn,
      },
    };
  } else if (mediaUrl && isVideo(mediaType, mediaUrl)) {
    const videoUrn = await registerLinkedInVideo(mediaUrl, accessToken, author);
    body.content = {
      media: {
        id: videoUrn,
      },
    };
  } else if (!hasText(commentary)) {
    throw new Error("LinkedIn text-only post requires content when there is no media");
  }

  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: getLinkedInHeaders(accessToken),
    body: JSON.stringify(body),
  });

  const textRes = await res.text();
  const idHeader = res.headers.get("x-restli-id");
  const data = safeJsonParse(textRes, {});

  if (!res.ok) {
    throw new Error(extractApiErrorMessage(data, textRes || "LinkedIn publish failed"));
  }

  return String(idHeader || data?.id || makePlatformPostId("linkedin", post.id));
}

async function sendToX(post, account) {
  const bearer = getEnv("X_BEARER_TOKEN", ["TWITTER_BEARER_TOKEN"]);
  const accessToken = resolveAccessToken(account) || bearer;
  if (!accessToken) throw new Error("Missing X access token/bearer token");

  const text = getPostText(post);
  if (!hasText(text)) throw new Error("X posting currently requires text content");

  const res = await fetch("https://api.x.com/2/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: trimText(text, 280) }),
  });

  const bodyText = await res.text();
  const data = safeJsonParse(bodyText, {});

  if (!res.ok || data?.errors) {
    throw new Error(extractApiErrorMessage(data, bodyText || "X publish failed"));
  }

  return String(data?.data?.id || makePlatformPostId("x", post.id));
}

async function sendToTikTok(post, account) {
  const accessToken = resolveAccessToken(account);
  if (!accessToken) throw new Error("Missing TikTok access token");

  const mediaUrl = getMediaUrl(post);
  const mediaType = getMediaType(post);
  const text = getPostText(post);

  if (!mediaUrl) throw new Error("TikTok requires media_url/media_path");

  let sourceInfo;

  if (isVideo(mediaType, mediaUrl)) {
    sourceInfo = {
      source: "PULL_FROM_URL",
      video_url: mediaUrl,
    };
  } else if (isImage(mediaType, mediaUrl)) {
    sourceInfo = {
      source: "PULL_FROM_URL",
      photo_images: [mediaUrl],
    };
  } else {
    throw new Error(`TikTok unsupported media type: ${mediaType || "unknown"}`);
  }

  const privacyLevel =
    resolveConnectedAccountField(account, ["privacy_level"]) || "PUBLIC_TO_EVERYONE";
  const postMode = resolveConnectedAccountField(account, ["post_mode"]) || "DIRECT_POST";

  const body = {
    post_info: {
      title: hasText(text) ? trimText(text, 90) : "View post",
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
    throw new Error(extractApiErrorMessage(data, textRes || "TikTok publish init failed"));
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
  const [{ data: post, error: postError }, { data: account, error: accountError }] =
    await Promise.all([
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

  const statuses = jobs.map((j) => String(j.status || "").toLowerCase());
  let publishStatus = "queued";

  if (statuses.length && statuses.every((s) => s === JOB_STATUS.COMPLETED)) {
    publishStatus = "published";
  } else if (
    statuses.some((s) => s === JOB_STATUS.COMPLETED) &&
    statuses.some((s) => s === JOB_STATUS.FAILED)
  ) {
    publishStatus = "partial";
  } else if (
    statuses.some((s) => s === JOB_STATUS.COMPLETED) &&
    statuses.some((s) => s === JOB_STATUS.RETRYING || s === JOB_STATUS.QUEUED)
  ) {
    publishStatus = "partial";
  } else if (statuses.some((s) => s === JOB_STATUS.PROCESSING)) {
    publishStatus = "processing";
  } else if (statuses.some((s) => s === JOB_STATUS.RETRYING || s === JOB_STATUS.QUEUED)) {
    publishStatus = "queued";
  } else if (statuses.length && statuses.every((s) => s === JOB_STATUS.FAILED)) {
    publishStatus = "failed";
  }

  await supabase
    .from("posts")
    .update({ publish_status: publishStatus, updated_at: nowIso() })
    .eq("id", postId);
}

async function processJob(supabase, job) {
  const startedAt = nowIso();
  const platform = normalizePlatform(job.platform);
  const attempts = (job.attempts || 0) + 1;

  await markJob(supabase, job.id, {
    status: JOB_STATUS.PROCESSING,
    attempts,
    last_error: null,
  });

  const { post, account } = await loadPostAndAccount(supabase, job);
  const platformPostId = await dispatchPlatform(post, account, platform);

  await markJob(supabase, job.id, {
    status: JOB_STATUS.COMPLETED,
    platform_post_id: String(platformPostId),
    delivered_at: startedAt,
    next_retry_at: null,
    last_error: null,
  });

  await addLog(supabase, {
    post_id: job.post_id,
    job_id: job.id,
    platform,
    status: JOB_STATUS.COMPLETED,
    attempts,
    platform_post_id: String(platformPostId),
    created_at: startedAt,
  });

  await updatePostAggregateStatus(supabase, job.post_id);

  return {
    ok: true,
    job_id: job.id,
    platform,
    platform_post_id: String(platformPostId),
    status: JOB_STATUS.COMPLETED,
  };
}

async function failJob(supabase, job, message) {
  const attempts = (job.attempts || 0) + 1;
  const retryable = attempts < 3;
  const nextRetryAt = retryable
    ? new Date(Date.now() + attempts * 2 * 60 * 1000).toISOString()
    : null;
  const status = retryable ? JOB_STATUS.RETRYING : JOB_STATUS.FAILED;
  const cleanMessage = sanitizeErrorMessage(message);

  await markJob(supabase, job.id, {
    status,
    last_error: cleanMessage,
    next_retry_at: nextRetryAt,
    attempts,
  });

  await addLog(supabase, {
    post_id: job.post_id,
    job_id: job.id,
    platform: normalizePlatform(job.platform),
    status,
    attempts,
    error_message: cleanMessage,
    created_at: nowIso(),
  });

  await updatePostAggregateStatus(supabase, job.post_id);

  return {
    ok: false,
    job_id: job.id,
    platform: normalizePlatform(job.platform),
    error: cleanMessage,
    status,
  };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runner() {
    while (true) {
      const currentIndex = index++;
      if (currentIndex >= items.length) return;
      const current = items[currentIndex];
      results[currentIndex] = await worker(current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runner());
  await Promise.all(workers);
  return results;
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
    const statuses = [JOB_STATUS.QUEUED, JOB_STATUS.RETRYING];
    const now = new Date().toISOString();
    const body =
      req.method === "POST" && req.body
        ? typeof req.body === "string"
          ? safeJsonParse(req.body, {})
          : req.body
        : {};
    const query = req.query || {};
    const batchSize = clampNumber(query.limit || body.limit || 20, 1, 100, 20);
    const concurrency = clampNumber(query.concurrency || body.concurrency || 4, 1, 10, 4);

    const { data: jobs, error: jobsError } = await supabase
      .from("post_publish_jobs")
      .select("*")
      .in("status", statuses)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (jobsError) {
      throw new Error(jobsError.message || "Failed to load publish jobs");
    }

    const runnableJobs = (jobs || []).filter((job) => {
      if (job.status !== JOB_STATUS.RETRYING) return true;
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

    const results = await runWithConcurrency(runnableJobs, concurrency, async (job) => {
      try {
        return await processJob(supabase, job);
      } catch (err) {
        console.error(`Publish failed for job ${job.id}:`, err);
        return await failJob(supabase, job, err?.message || "Unknown publish error");
      }
    });

    return res.status(200).json({
      success: true,
      processed: results.length,
      success_count: results.filter((r) => r.ok).length,
      failed_count: results.filter((r) => !r.ok).length,
      results,
      message: `Processed ${results.length} job(s) with concurrency ${Math.min(
        concurrency,
        runnableJobs.length
      )}`,
    });
  } catch (err) {
    console.error("process-publish-jobs fatal:", err);
    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(err?.message || err || "Internal server error"),
    });
  }
};
