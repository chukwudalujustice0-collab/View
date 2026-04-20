const { createClient } = require("@supabase/supabase-js");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-cron-secret");
  res.setHeader("Cache-Control", "no-store");
}

function isAuthorized() {
  return true;
}

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function trimText(value, max = 5000) {
  return String(value || "").trim().slice(0, max);
}

function normalizePlatform(value = "") {
  const key = String(value || "").trim().toLowerCase();
  if (key === "twitter") return "x";
  if (key === "whatsappbusiness" || key === "whatsapp_business") return "whatsapp";
  return key;
}

function normalizeStoragePath(rawPath = "") {
  let path = String(rawPath || "").trim();
  if (!path) return "";

  if (path.startsWith("/")) path = path.slice(1);

  const bucket = process.env.POST_MEDIA_BUCKET || "post-media";
  if (path.startsWith(`${bucket}/`)) {
    path = path.slice(bucket.length + 1);
  }

  if (path.startsWith("public/")) {
    path = path.slice("public/".length);
  }

  return path;
}

function isVideoType(mediaType = "") {
  const type = String(mediaType || "").toLowerCase();
  return type === "video" || type.startsWith("video/");
}

function isImageType(mediaType = "") {
  const type = String(mediaType || "").toLowerCase();
  return type === "image" || type.startsWith("image/");
}

function isGalleryType(mediaType = "") {
  return String(mediaType || "").toLowerCase() === "gallery";
}

function normalizeJobStatus(status = "") {
  const value = String(status || "").trim().toLowerCase();
  if (value === "success") return "completed";
  return value;
}

function compactErrorMessage(message = "") {
  return trimText(String(message || "").replace(/\s+/g, " "), 500);
}

function pickFirst(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  const parsed = safeJsonParse(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function parseScopes(account) {
  const set = new Set();

  if (Array.isArray(account?.scopes)) {
    for (const s of account.scopes) {
      const val = String(s || "").trim();
      if (val) set.add(val);
    }
  }

  if (typeof account?.scope === "string" && account.scope.trim()) {
    account.scope
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => set.add(s));
  }

  return [...set];
}

function getBestAccessToken(account) {
  return pickFirst(
    account?.long_lived_token,
    account?.access_token
  );
}

function getBestExpiry(account) {
  return pickFirst(
    account?.token_expires_at,
    account?.expires_at
  );
}

function getMetadata(account) {
  return parseJsonObject(account?.metadata);
}

function getTokenMeta(account) {
  return parseJsonObject(account?.token_meta);
}

function isAccountUsable(account) {
  if (!account) return false;

  const status = String(account.status || "").toLowerCase();
  const connected =
    status === "connected" ||
    account.connected === true ||
    account.is_connected === true;

  return connected && account.needs_reconnect !== true;
}

function resolveFacebookPageId(account) {
  const metadata = getMetadata(account);
  const tokenMeta = getTokenMeta(account);

  return pickFirst(
    account.external_page_id,
    metadata.page_id,
    metadata.facebook_page_id,
    tokenMeta.page_id
  );
}

function resolveInstagramUserId(account) {
  const metadata = getMetadata(account);
  const tokenMeta = getTokenMeta(account);

  return pickFirst(
    account.platform_user_id,
    account.external_user_id,
    account.external_id,
    account.account_id,
    metadata.instagram_user_id,
    metadata.ig_user_id,
    metadata.user_id,
    tokenMeta.instagram_user_id,
    tokenMeta.ig_user_id
  );
}

function resolveLinkedInAuthor(account) {
  const metadata = getMetadata(account);
  const tokenMeta = getTokenMeta(account);

  const direct = pickFirst(
    metadata.organization_urn,
    metadata.person_urn,
    tokenMeta.organization_urn,
    tokenMeta.person_urn,
    account.external_user_id,
    account.platform_user_id,
    account.account_id,
    account.external_id
  );

  if (!direct) return "";

  if (direct.startsWith("urn:li:")) return direct;

  const accountType = String(metadata.account_type || metadata.type || "").toLowerCase();
  if (accountType === "organization" || accountType === "company" || accountType === "page") {
    return `urn:li:organization:${direct}`;
  }

  return `urn:li:person:${direct}`;
}

function resolveTelegramChatId(account) {
  const metadata = getMetadata(account);
  const tokenMeta = getTokenMeta(account);

  return pickFirst(
    account.telegram_chat_id,
    metadata.telegram_chat_id,
    metadata.chat_id,
    metadata.channel_id,
    tokenMeta.telegram_chat_id,
    tokenMeta.chat_id,
    account.external_user_id,
    account.external_id
  );
}

function choosePrimaryMedia(post) {
  const rawMediaUrl = post?.media_url;

  if (isGalleryType(post?.media_type)) {
    const parsed = safeJsonParse(rawMediaUrl, []);
    if (Array.isArray(parsed) && parsed.length) {
      const first = parsed[0] || {};
      const url = typeof first === "string" ? first : first.url || "";
      const type = typeof first === "object" ? first.type || "" : "";
      return {
        mediaUrl: url || "",
        mediaType: type || "image",
        mediaName: post?.media_name || null,
        isGallery: true
      };
    }
  }

  return {
    mediaUrl: rawMediaUrl || "",
    mediaType: post?.media_type || "",
    mediaName: post?.media_name || null,
    isGallery: false
  };
}

async function updatePostSummary(supabase, postId) {
  const { data: jobs, error } = await supabase
    .from("post_publish_jobs")
    .select("status")
    .eq("post_id", postId);

  if (error) {
    throw new Error(`Post summary read failed: ${error.message}`);
  }

  if (!jobs || !jobs.length) return;

  const statuses = jobs.map((j) => normalizeJobStatus(j.status));

  let publishStatus = "queued";

  if (statuses.every((s) => s === "completed")) {
    publishStatus = "published";
  } else if (statuses.some((s) => s === "failed") && statuses.some((s) => s === "completed")) {
    publishStatus = "partial";
  } else if (statuses.every((s) => s === "failed")) {
    publishStatus = "failed";
  } else if (statuses.some((s) => s === "processing")) {
    publishStatus = "processing";
  } else if (statuses.some((s) => s === "retrying")) {
    publishStatus = "retrying";
  } else if (statuses.some((s) => s === "queued")) {
    publishStatus = "queued";
  }

  const payload = {
    publish_status: publishStatus,
    status: publishStatus,
    updated_at: nowIso()
  };

  if (publishStatus === "published") {
    payload.published_at = nowIso();
  }

  const { error: updateError } = await supabase
    .from("posts")
    .update(payload)
    .eq("id", postId);

  if (updateError) {
    throw new Error(`Post summary update failed: ${updateError.message}`);
  }
}

async function getConnectedAccount(supabase, userId, platform) {
  const normalizedPlatform = normalizePlatform(platform);

  const platformValues = normalizedPlatform === "x"
    ? ["x", "twitter"]
    : [normalizedPlatform];

  const { data, error } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .in("platform", platformValues)
    .order("connected_at", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);

  const usable = (data || []).find(isAccountUsable);
  if (!usable) {
    throw new Error(`${normalizedPlatform} account not connected`);
  }

  return usable;
}

async function refreshGoogleToken(supabase, account) {
  if (!account.refresh_token) {
    throw new Error("YouTube token expired. Reconnect YouTube because no refresh token was found.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment variables.");
  }

  const form = new URLSearchParams();
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("refresh_token", account.refresh_token);
  form.set("grant_type", "refresh_token");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${data.error_description || data.error || text || "Unknown error"}`);
  }

  const tokenExpiresAt = new Date(
    Date.now() + Number(data.expires_in || 3600) * 1000
  ).toISOString();

  const nextAccessToken = pickFirst(data.access_token, account.access_token);

  const { error } = await supabase
    .from("connected_accounts")
    .update({
      access_token: nextAccessToken,
      token_type: data.token_type || account.token_type || "Bearer",
      token_expires_at: tokenExpiresAt,
      expires_at: tokenExpiresAt,
      last_synced_at: nowIso(),
      last_refreshed_at: nowIso(),
      last_refresh_attempt_at: nowIso(),
      refresh_retry_count: 0,
      last_error: null,
      needs_reconnect: false,
      updated_at: nowIso()
    })
    .eq("id", account.id);

  if (error) throw new Error(error.message);

  return {
    ...account,
    access_token: nextAccessToken,
    token_type: data.token_type || account.token_type || "Bearer",
    token_expires_at: tokenExpiresAt,
    expires_at: tokenExpiresAt
  };
}

async function ensureValidToken(supabase, account) {
  const accessToken = getBestAccessToken(account);
  if (!accessToken) {
    throw new Error(`No access token found for ${account.platform}. Reconnect the account.`);
  }

  const expiry = getBestExpiry(account);
  if (!expiry) {
    return {
      ...account,
      access_token: accessToken
    };
  }

  const expiresAt = new Date(expiry).getTime();
  const soon = Date.now() + 60 * 1000;

  if (expiresAt > soon) {
    return {
      ...account,
      access_token: accessToken
    };
  }

  if (normalizePlatform(account.platform) === "youtube") {
    return await refreshGoogleToken(supabase, {
      ...account,
      access_token: accessToken
    });
  }

  return {
    ...account,
    access_token: accessToken
  };
}

async function getMediaFromPost(supabase, post) {
  const primaryMedia = choosePrimaryMedia(post);

  if (post.media_path) {
    const bucket = process.env.POST_MEDIA_BUCKET || "post-media";
    const path = normalizeStoragePath(post.media_path);

    if (!path) {
      throw new Error("The saved media_path is invalid.");
    }

    const { data, error } = await supabase.storage
      .from(bucket)
      .download(path);

    if (error || !data) {
      throw new Error(error?.message || "Could not download media from Supabase Storage.");
    }

    const arrayBuffer = await data.arrayBuffer();

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: primaryMedia.mediaType || post.media_type || data.type || "application/octet-stream",
      source: "storage",
      mediaUrl: primaryMedia.mediaUrl || null
    };
  }

  if (primaryMedia.mediaUrl) {
    const fileRes = await fetch(primaryMedia.mediaUrl);

    if (!fileRes.ok) {
      throw new Error(`Failed to fetch media_url. HTTP ${fileRes.status}`);
    }

    const arrayBuffer = await fileRes.arrayBuffer();

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: primaryMedia.mediaType || post.media_type || fileRes.headers.get("content-type") || "application/octet-stream",
      source: "url",
      mediaUrl: primaryMedia.mediaUrl
    };
  }

  throw new Error("This post has no media_path and no usable media_url.");
}

async function getYouTubeChannel(accessToken) {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const text = await res.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`YouTube channel check failed: ${text}`);
  }

  if (!data.items || !data.items.length) {
    throw new Error("No YouTube channel was returned for this account. Make sure the connected Google account has a YouTube channel.");
  }

  return data.items[0];
}

async function uploadToYouTube(supabase, post, account) {
  if (!post.media_url && !post.media_path) {
    throw new Error("No media file found for YouTube upload.");
  }

  const chosenMedia = choosePrimaryMedia(post);
  if (!isVideoType(chosenMedia.mediaType || post.media_type)) {
    throw new Error(`YouTube requires a video file. Current media_type: ${post.media_type || "unknown"}`);
  }

  if (!account?.access_token) {
    throw new Error("Missing YouTube access token.");
  }

  const { buffer, contentType, source } = await getMediaFromPost(supabase, post);
  const channel = await getYouTubeChannel(account.access_token);

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": contentType,
        "X-Upload-Content-Length": String(buffer.length)
      },
      body: JSON.stringify({
        snippet: {
          title: post.media_name || post.title || post.content || "View Upload",
          description: post.content || "",
          categoryId: "22"
        },
        status: {
          privacyStatus: post.privacy === "public" ? "public" : "private"
        }
      })
    }
  );

  const initText = await initRes.text();
  const uploadUrl = initRes.headers.get("location");

  if (!initRes.ok) {
    throw new Error(`YouTube upload session start failed. HTTP ${initRes.status}. Response: ${initText}`);
  }

  if (!uploadUrl) {
    throw new Error(`YouTube did not return an upload URL. Response: ${initText}`);
  }

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buffer.length)
    },
    body: buffer
  });

  const uploadText = await uploadRes.text();

  let result = {};
  try {
    result = uploadText ? JSON.parse(uploadText) : {};
  } catch {
    result = { raw: uploadText };
  }

  if (!uploadRes.ok) {
    throw new Error(`YouTube video upload failed. HTTP ${uploadRes.status}. Response: ${result?.error?.message || uploadText || "Unknown error"}`);
  }

  if (!result.id) {
    throw new Error(`YouTube upload finished but no video ID was returned. Response: ${uploadText}`);
  }

  return {
    platform_post_id: result.id,
    response_payload: {
      youtube_video_id: result.id,
      youtube_channel_id: channel.id,
      youtube_channel_title: channel?.snippet?.title || null,
      media_source: source,
      raw: result
    }
  };
}

async function publishToFacebook(post, account) {
  if (!account?.access_token) throw new Error("Missing Facebook access token.");

  const pageId = resolveFacebookPageId(account);
  if (!pageId) throw new Error("Missing Facebook page ID.");

  const chosenMedia = choosePrimaryMedia(post);
  const hasMedia = !!(chosenMedia.mediaUrl || post.media_path);

  let endpoint = "";
  let body = null;

  if (isVideoType(chosenMedia.mediaType || post.media_type) && hasMedia) {
    if (!chosenMedia.mediaUrl) {
      throw new Error("Facebook video publishing requires a public media_url.");
    }

    endpoint = `https://graph.facebook.com/v20.0/${pageId}/videos`;
    body = new URLSearchParams({
      access_token: account.access_token,
      file_url: chosenMedia.mediaUrl,
      description: post.content || ""
    });
  } else if (hasMedia) {
    if (!chosenMedia.mediaUrl) {
      throw new Error("Facebook image publishing requires a public media_url.");
    }

    endpoint = `https://graph.facebook.com/v20.0/${pageId}/photos`;
    body = new URLSearchParams({
      access_token: account.access_token,
      url: chosenMedia.mediaUrl,
      caption: post.content || "",
      published: "true"
    });
  } else {
    endpoint = `https://graph.facebook.com/v20.0/${pageId}/feed`;
    body = new URLSearchParams({
      access_token: account.access_token,
      message: post.content || ""
    });
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok || !data.id) {
    throw new Error(`Facebook publish failed: ${data?.error?.message || text || "Unknown error"}`);
  }

  return {
    platform_post_id: data.id,
    response_payload: data
  };
}

async function publishToInstagram(post, account) {
  if (!account?.access_token) throw new Error("Missing Instagram access token.");

  const igUserId = resolveInstagramUserId(account);
  if (!igUserId) throw new Error("Missing Instagram user ID.");

  const chosenMedia = choosePrimaryMedia(post);
  if (!chosenMedia.mediaUrl) {
    throw new Error("Instagram publishing requires a public media_url.");
  }

  const createContainerEndpoint = `https://graph.facebook.com/v20.0/${igUserId}/media`;
  const createBody = new URLSearchParams({
    access_token: account.access_token,
    caption: post.content || ""
  });

  if (isVideoType(chosenMedia.mediaType || post.media_type)) {
    createBody.set("media_type", "REELS");
    createBody.set("video_url", chosenMedia.mediaUrl);
  } else {
    createBody.set("image_url", chosenMedia.mediaUrl);
  }

  const createRes = await fetch(createContainerEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: createBody.toString()
  });

  const createText = await createRes.text();
  let createData = {};
  try {
    createData = createText ? JSON.parse(createText) : {};
  } catch {
    createData = { raw: createText };
  }

  if (!createRes.ok || !createData.id) {
    throw new Error(`Instagram media container failed: ${createData?.error?.message || createText || "Unknown error"}`);
  }

  const publishRes = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: account.access_token,
      creation_id: createData.id
    }).toString()
  });

  const publishText = await publishRes.text();
  let publishData = {};
  try {
    publishData = publishText ? JSON.parse(publishText) : {};
  } catch {
    publishData = { raw: publishText };
  }

  if (!publishRes.ok || !publishData.id) {
    throw new Error(`Instagram publish failed: ${publishData?.error?.message || publishText || "Unknown error"}`);
  }

  return {
    platform_post_id: publishData.id,
    response_payload: {
      container_id: createData.id,
      publish: publishData
    }
  };
}

async function publishToTelegram(post, account) {
  const botToken = pickFirst(account.access_token, process.env.TELEGRAM_BOT_TOKEN);
  const chatId = resolveTelegramChatId(account);

  if (!botToken) throw new Error("Missing Telegram bot token.");
  if (!chatId) throw new Error("Missing Telegram chat/channel ID.");

  const chosenMedia = choosePrimaryMedia(post);

  let method = "sendMessage";
  let payload = {
    chat_id: chatId,
    text: post.content || ""
  };

  if (chosenMedia.mediaUrl && isImageType(chosenMedia.mediaType || post.media_type)) {
    method = "sendPhoto";
    payload = {
      chat_id: chatId,
      photo: chosenMedia.mediaUrl,
      caption: post.content || ""
    };
  } else if (chosenMedia.mediaUrl && isVideoType(chosenMedia.mediaType || post.media_type)) {
    method = "sendVideo";
    payload = {
      chat_id: chatId,
      video: chosenMedia.mediaUrl,
      caption: post.content || ""
    };
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok) {
    throw new Error(`Telegram publish failed: ${data?.description || "Unknown error"}`);
  }

  return {
    platform_post_id: String(data?.result?.message_id || ""),
    response_payload: data
  };
}

async function publishToLinkedIn(post, account) {
  if (!account?.access_token) throw new Error("Missing LinkedIn access token.");

  const author = resolveLinkedInAuthor(account);
  if (!author) throw new Error("Missing LinkedIn author URN.");

  const body = {
    author,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: {
          text: post.content || ""
        },
        shareMediaCategory: "NONE"
      }
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
    }
  };

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0"
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`LinkedIn publish failed: ${data?.message || text || "Unknown error"}`);
  }

  const linkedInId = res.headers.get("x-restli-id") || data.id || null;

  return {
    platform_post_id: linkedInId,
    response_payload: data
  };
}

async function publishToX(post, account) {
  if (!account?.access_token) throw new Error("Missing X access token.");
  throw new Error("X publishing is not fully configured yet. It needs your exact OAuth/media posting setup.");
}

async function publishToTikTok(post, account) {
  if (!account?.access_token) throw new Error("Missing TikTok access token.");
  throw new Error("TikTok publishing is not fully configured yet. It needs your approved TikTok content posting setup.");
}

async function publishToWhatsApp(post, account) {
  if (!account?.access_token) throw new Error("Missing WhatsApp access token.");
  throw new Error("WhatsApp publishing is not configured in this worker.");
}

async function publishToPlatform(supabase, post, job) {
  const platform = normalizePlatform(job.platform);

  if (platform === "view") {
    return {
      platform_post_id: `view_${post.id}`,
      response_payload: {
        ok: true,
        platform: "view",
        local: true
      }
    };
  }

  if (platform === "youtube") {
    const account = await getConnectedAccount(supabase, job.user_id, "youtube");
    const validAccount = await ensureValidToken(supabase, account);
    return await uploadToYouTube(supabase, post, validAccount);
  }

  if (platform === "facebook") {
    const account = await getConnectedAccount(supabase, job.user_id, "facebook");
    const validAccount = await ensureValidToken(supabase, account);
    return await publishToFacebook(post, validAccount);
  }

  if (platform === "instagram") {
    const account = await getConnectedAccount(supabase, job.user_id, "instagram");
    const validAccount = await ensureValidToken(supabase, account);
    return await publishToInstagram(post, validAccount);
  }

  if (platform === "telegram") {
    const account = await getConnectedAccount(supabase, job.user_id, "telegram");
    const validAccount = await ensureValidToken(supabase, account);
    return await publishToTelegram(post, validAccount);
  }

  if (platform === "linkedin") {
    const account = await getConnectedAccount(supabase, job.user_id, "linkedin");
    const validAccount = await ensureValidToken(supabase, account);
    return await publishToLinkedIn(post, validAccount);
  }

  if (platform === "x") {
    const account = await getConnectedAccount(supabase, job.user_id, "x");
    const validAccount = await ensureValidToken(supabase, account);
    return await publishToX(post, validAccount);
  }

  if (platform === "tiktok") {
    const account = await getConnectedAccount(supabase, job.user_id, "tiktok");
    const validAccount = await ensureValidToken(supabase, account);
    return await publishToTikTok(post, validAccount);
  }

  if (platform === "whatsapp") {
    const account = await getConnectedAccount(supabase, job.user_id, "whatsapp");
    const validAccount = await ensureValidToken(supabase, account);
    return await publishToWhatsApp(post, validAccount);
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

async function writeLog(supabase, payload) {
  const { error } = await supabase
    .from("post_publish_logs")
    .insert(payload);

  if (error) {
    throw new Error(`Publish log insert failed: ${error.message}`);
  }
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized"
    });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL_VALUE;

    const SUPABASE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({
        success: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const body =
      req.method === "POST" && req.body
        ? typeof req.body === "string"
          ? safeJsonParse(req.body, {})
          : req.body
        : {};

    const requestedPostId = body?.post_id || req.query?.post_id || null;
    const requestedUserId = body?.user_id || req.query?.user_id || null;
    const requestedLimit = Number(body?.limit || req.query?.limit || 20);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, requestedLimit))
      : 20;

    let jobsQuery = supabase
      .from("post_publish_jobs")
      .select("*")
      .in("status", ["queued", "retrying"])
      .order("created_at", { ascending: true })
      .limit(limit);

    if (requestedPostId) {
      jobsQuery = jobsQuery.eq("post_id", requestedPostId);
    }

    if (requestedUserId) {
      jobsQuery = jobsQuery.eq("user_id", requestedUserId);
    }

    const { data: jobs, error } = await jobsQuery;
    if (error) throw error;

    const now = nowIso();
    const runnableJobs = (jobs || []).filter((job) => {
      if (normalizeJobStatus(job.status) !== "retrying") return true;
      if (!job.next_retry_at) return true;
      return job.next_retry_at <= now;
    });

    if (!runnableJobs.length) {
      return res.status(200).json({
        success: true,
        processed: 0,
        details: [],
        message: "No pending publish jobs found."
      });
    }

    const processed = [];
    const touchedPostIds = new Set();

    for (const job of runnableJobs) {
      touchedPostIds.add(job.post_id);

      try {
        const { data: post, error: postError } = await supabase
          .from("posts")
          .select("*")
          .eq("id", job.post_id)
          .single();

        if (postError) throw postError;
        if (!post) throw new Error("Post not found.");

        const processingAt = nowIso();

        const { error: markProcessingError } = await supabase
          .from("post_publish_jobs")
          .update({
            status: "processing",
            started_at: processingAt,
            updated_at: processingAt
          })
          .eq("id", job.id);

        if (markProcessingError) throw markProcessingError;

        const result = await publishToPlatform(supabase, post, job);
        const deliveredAt = nowIso();
        const attempts = Number(job.attempts || 0) + 1;

        const { error: updateJobError } = await supabase
          .from("post_publish_jobs")
          .update({
            status: "completed",
            attempts,
            delivered_at: deliveredAt,
            finished_at: deliveredAt,
            platform_post_id: result.platform_post_id || null,
            response_payload: result.response_payload || null,
            last_error: null,
            next_retry_at: null,
            updated_at: deliveredAt
          })
          .eq("id", job.id);

        if (updateJobError) throw updateJobError;

        await writeLog(supabase, {
          post_id: job.post_id,
          job_id: job.id,
          user_id: job.user_id,
          platform: normalizePlatform(job.platform),
          status: "completed",
          platform_post_id: result.platform_post_id || null,
          response_payload: result.response_payload || null,
          attempts
        });

        await updatePostSummary(supabase, job.post_id);

        processed.push({
          job: job.id,
          platform: normalizePlatform(job.platform),
          status: "completed",
          platform_post_id: result.platform_post_id || null
        });
      } catch (err) {
        const failedAt = nowIso();
        const message = compactErrorMessage(err?.message || "Unknown error");
        const attempts = Number(job.attempts || 0) + 1;
        const retryable = attempts < 3;
        const nextRetryAt = retryable
          ? new Date(Date.now() + attempts * 2 * 60 * 1000).toISOString()
          : null;

        await supabase
          .from("post_publish_jobs")
          .update({
            status: retryable ? "retrying" : "failed",
            last_error: message,
            attempts,
            next_retry_at: nextRetryAt,
            finished_at: retryable ? null : failedAt,
            updated_at: failedAt
          })
          .eq("id", job.id);

        await writeLog(supabase, {
          post_id: job.post_id,
          job_id: job.id,
          user_id: job.user_id,
          platform: normalizePlatform(job.platform),
          status: retryable ? "retrying" : "failed",
          error_message: message,
          attempts
        });

        try {
          await updatePostSummary(supabase, job.post_id);
        } catch (_) {}

        processed.push({
          job: job.id,
          platform: normalizePlatform(job.platform),
          status: retryable ? "retrying" : "failed",
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
      error: compactErrorMessage(err?.message || "Unknown server error")
    });
  }
};
