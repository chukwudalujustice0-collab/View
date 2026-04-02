import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const POSTS_TABLE = process.env.POSTS_TABLE || "posts";
const JOBS_TABLE = process.env.JOBS_TABLE || "post_publish_jobs";
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connected_accounts";

const LINKEDIN_VERSION = process.env.LINKEDIN_VERSION || "202603";
const DEFAULT_BATCH_SIZE = Number(process.env.PUBLISH_JOB_BATCH_SIZE || 10);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const limit = clampInt(req.query.limit, 1, 50, DEFAULT_BATCH_SIZE);
    const result = await processQueuedJobs(limit);

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("process-publish-jobs fatal error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Unexpected error"
    });
  }
}

async function processQueuedJobs(limit) {
  const { data: jobs, error } = await supabase
    .from(JOBS_TABLE)
    .select("id, post_id, user_id, platform, status, attempts")
    .in("status", ["queued", "retry"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;

  const processed = [];
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of jobs || []) {
    const jobId = job.id;

    try {
      await markJob(jobId, {
        status: "processing",
        started_at: new Date().toISOString(),
        attempts: (job.attempts || 0) + 1,
        error_message: null
      });

      const post = await getPost(job.post_id);
      if (!post) {
        throw new Error(`Post ${job.post_id} not found`);
      }

      const platform = normalizePlatformKey(job.platform);
      const connection = platform === "view"
        ? null
        : await getConnection(job.user_id, platform);

      const publishResult = await publishToPlatform({
        platform,
        post,
        connection
      });

      await markJob(jobId, {
        status: publishResult.status || "success",
        completed_at: new Date().toISOString(),
        provider_post_id: publishResult.providerPostId || null,
        provider_response: safeJson(publishResult.raw || publishResult),
        published_url: publishResult.url || null,
        error_message: publishResult.errorMessage || null
      });

      processed.push({
        job_id: jobId,
        platform,
        result: publishResult.status || "success"
      });

      if (publishResult.status === "skipped") skipped += 1;
      else success += 1;
    } catch (error) {
      console.error(`Job ${jobId} failed:`, error);

      await markJob(jobId, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: truncate(error.message || "Publishing failed", 1800),
        provider_response: safeJson({
          stack: error.stack || null
        })
      });

      processed.push({
        job_id: jobId,
        platform: normalizePlatformKey(job.platform),
        result: "failed",
        error: error.message || "Publishing failed"
      });

      failed += 1;
    }
  }

  return {
    scanned: jobs?.length || 0,
    success,
    failed,
    skipped,
    processed
  };
}

async function publishToPlatform({ platform, post, connection }) {
  switch (platform) {
    case "view":
      return await publishToView(post);
    case "facebook":
      return await publishToFacebook(post, connection);
    case "instagram":
      return await publishToInstagram(post, connection);
    case "telegram":
      return await publishToTelegram(post, connection);
    case "linkedin":
      return await publishToLinkedIn(post, connection);
    case "x":
      return await publishToX(post, connection);
    case "tiktok":
      return await publishToTikTok(post, connection);
    case "youtube":
      return await publishToYouTube(post, connection);
    case "whatsapp":
      return await publishToWhatsApp(post, connection);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function publishToView(post) {
  await supabase
    .from(POSTS_TABLE)
    .update({
      status: "published",
      publish_status: "published",
      published_at: new Date().toISOString()
    })
    .eq("id", post.id);

  return {
    status: "success",
    providerPostId: String(post.id),
    raw: { local: true }
  };
}

async function publishToFacebook(post, connection) {
  requireConnection(connection, "facebook");

  const token = getConnectionConfig(connection).accessToken;
  const pageId = getConnectionConfig(connection).targetId;

  if (!token) throw new Error("Facebook access token missing");
  if (!pageId) throw new Error("Facebook page id missing");

  const message = buildMessage(post);

  if (post.media_url && isVideo(post.media_type)) {
    const data = await fetchJson(`https://graph.facebook.com/v23.0/${encodeURIComponent(pageId)}/videos`, {
      method: "POST",
      body: toFormData({
        access_token: token,
        file_url: post.media_url,
        description: message || ""
      })
    });

    return {
      status: "success",
      providerPostId: data.id || null,
      raw: data,
      url: null
    };
  }

  if (post.media_url) {
    const data = await fetchJson(`https://graph.facebook.com/v23.0/${encodeURIComponent(pageId)}/photos`, {
      method: "POST",
      body: toFormData({
        access_token: token,
        url: post.media_url,
        caption: message || ""
      })
    });

    return {
      status: "success",
      providerPostId: data.post_id || data.id || null,
      raw: data,
      url: null
    };
  }

  const data = await fetchJson(`https://graph.facebook.com/v23.0/${encodeURIComponent(pageId)}/feed`, {
    method: "POST",
    body: toFormData({
      access_token: token,
      message: message || ""
    })
  });

  return {
    status: "success",
    providerPostId: data.id || null,
    raw: data,
    url: null
  };
}

async function publishToInstagram(post, connection) {
  requireConnection(connection, "instagram");

  const cfg = getConnectionConfig(connection);
  const token = cfg.accessToken;
  const igUserId = cfg.targetId;

  if (!token) throw new Error("Instagram access token missing");
  if (!igUserId) throw new Error("Instagram user id missing");
  if (!post.media_url) {
    throw new Error("Instagram publishing requires image or video media_url");
  }

  const caption = buildMessage(post);
  let container;

  if (isVideo(post.media_type)) {
    container = await fetchJson(`https://graph.facebook.com/v23.0/${encodeURIComponent(igUserId)}/media`, {
      method: "POST",
      body: toFormData({
        access_token: token,
        media_type: "REELS",
        video_url: post.media_url,
        caption: caption || ""
      })
    });
  } else {
    container = await fetchJson(`https://graph.facebook.com/v23.0/${encodeURIComponent(igUserId)}/media`, {
      method: "POST",
      body: toFormData({
        access_token: token,
        image_url: post.media_url,
        caption: caption || ""
      })
    });
  }

  if (!container?.id) {
    throw new Error("Instagram media container creation failed");
  }

  await wait(3500);

  const published = await fetchJson(`https://graph.facebook.com/v23.0/${encodeURIComponent(igUserId)}/media_publish`, {
    method: "POST",
    body: toFormData({
      access_token: token,
      creation_id: container.id
    })
  });

  return {
    status: "success",
    providerPostId: published.id || container.id,
    raw: {
      container,
      publish: published
    }
  };
}

async function publishToTelegram(post, connection) {
  requireConnection(connection, "telegram");

  const cfg = getConnectionConfig(connection);
  const botToken = cfg.accessToken;
  const chatId = cfg.targetId;

  if (!botToken) throw new Error("Telegram bot token missing");
  if (!chatId) throw new Error("Telegram chat_id missing");

  const base = `https://api.telegram.org/bot${botToken}`;
  const caption = buildMessage(post);

  if (post.media_url && isVideo(post.media_type)) {
    const data = await fetchJson(`${base}/sendVideo`, {
      method: "POST",
      body: toFormData({
        chat_id: chatId,
        video: post.media_url,
        caption: caption || "",
        parse_mode: "HTML"
      })
    });

    return {
      status: "success",
      providerPostId: data?.result?.message_id || null,
      raw: data
    };
  }

  if (post.media_url) {
    const data = await fetchJson(`${base}/sendPhoto`, {
      method: "POST",
      body: toFormData({
        chat_id: chatId,
        photo: post.media_url,
        caption: caption || "",
        parse_mode: "HTML"
      })
    });

    return {
      status: "success",
      providerPostId: data?.result?.message_id || null,
      raw: data
    };
  }

  const data = await fetchJson(`${base}/sendMessage`, {
    method: "POST",
    body: toFormData({
      chat_id: chatId,
      text: caption || "",
      parse_mode: "HTML",
      disable_web_page_preview: "false"
    })
  });

  return {
    status: "success",
    providerPostId: data?.result?.message_id || null,
    raw: data
  };
}

async function publishToLinkedIn(post, connection) {
  requireConnection(connection, "linkedin");

  const cfg = getConnectionConfig(connection);
  const token = cfg.accessToken;
  const authorUrn = cfg.targetId;

  if (!token) throw new Error("LinkedIn access token missing");
  if (!authorUrn) throw new Error("LinkedIn author URN missing");

  let content = null;

  if (post.media_url) {
    const upload = await uploadMediaToLinkedIn({
      mediaUrl: post.media_url,
      mediaType: post.media_type,
      accessToken: token,
      ownerUrn: authorUrn
    });

    content = {
      media: {
        title: post.media_name || inferMediaTitle(post),
        id: upload.assetUrn
      }
    };
  }

  const payload = {
    author: authorUrn,
    commentary: buildMessage(post),
    visibility: mapLinkedInVisibility(post.privacy),
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: []
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false
  };

  if (content) payload.content = content;

  const response = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "Linkedin-Version": LINKEDIN_VERSION
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  const restliId = response.headers.get("x-restli-id");

  if (!response.ok) {
    throw new Error(`LinkedIn post failed: ${text}`);
  }

  return {
    status: "success",
    providerPostId: restliId || null,
    raw: parseMaybeJson(text) || { body: text }
  };
}

async function publishToX(post, connection) {
  requireConnection(connection, "x");

  const cfg = getConnectionConfig(connection);
  const token = cfg.accessToken;

  if (!token) throw new Error("X access token missing");

  let mediaIds = [];

  if (post.media_url) {
    try {
      const mediaId = await uploadMediaToX({
        mediaUrl: post.media_url,
        mediaType: post.media_type,
        accessToken: token
      });
      mediaIds = mediaId ? [mediaId] : [];
    } catch (error) {
      if (!buildMessage(post)) {
        throw new Error(`X media upload failed and no text fallback exists: ${error.message}`);
      }
      console.warn("X media upload failed; falling back to text-only post:", error.message);
    }
  }

  const payload = {
    text: buildMessage(post)
  };

  if (mediaIds.length) {
    payload.media = { media_ids: mediaIds };
  }

  const data = await fetchJson("https://api.x.com/2/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return {
    status: "success",
    providerPostId: data?.data?.id || null,
    raw: data,
    url: data?.data?.id ? `https://x.com/i/web/status/${data.data.id}` : null
  };
}

async function publishToTikTok(post, connection) {
  requireConnection(connection, "tiktok");

  const cfg = getConnectionConfig(connection);
  const token = cfg.accessToken;

  if (!token) throw new Error("TikTok access token missing");
  if (!post.media_url) throw new Error("TikTok publishing requires media_url");
  if (!isVideo(post.media_type) && !isImage(post.media_type)) {
    throw new Error("TikTok publishing requires image/* or video/* media");
  }

  if (isImage(post.media_type)) {
    const init = await fetchJson("https://open.tiktokapis.com/v2/post/publish/content/init/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8"
      },
      body: JSON.stringify({
        post_info: {
          title: buildMessage(post),
          privacy_level: mapTikTokPrivacy(post.privacy)
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_images: [post.media_url]
        }
      })
    });

    return {
      status: "success",
      providerPostId: init?.data?.publish_id || init?.data?.post_id || null,
      raw: init
    };
  }

  const init = await fetchJson("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8"
    },
    body: JSON.stringify({
      post_info: {
        title: buildMessage(post),
        privacy_level: mapTikTokPrivacy(post.privacy),
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: post.media_url
      }
    })
  });

  return {
    status: "success",
    providerPostId: init?.data?.publish_id || init?.data?.post_id || null,
    raw: init
  };
}

async function publishToYouTube(post, connection) {
  requireConnection(connection, "youtube");

  const cfg = getConnectionConfig(connection);
  const token = cfg.accessToken;

  if (!token) throw new Error("YouTube access token missing");
  if (!post.media_url) throw new Error("YouTube publishing requires a video media_url");
  if (!isVideo(post.media_type)) throw new Error("YouTube only accepts video uploads here");

  const media = await fetchBinary(post.media_url);
  const metadata = {
    snippet: {
      title: deriveYouTubeTitle(post),
      description: buildMessage(post) || ""
    },
    status: {
      privacyStatus: mapYouTubePrivacy(post.privacy)
    }
  };

  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=resumable", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": post.media_type || "video/mp4",
      "X-Upload-Content-Length": String(media.length)
    },
    body: JSON.stringify(metadata)
  });

  const startText = await start.text();
  if (!start.ok) {
    throw new Error(`YouTube upload init failed: ${startText}`);
  }

  const uploadUrl = start.headers.get("location");
  if (!uploadUrl) {
    throw new Error("YouTube resumable upload location missing");
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": post.media_type || "video/mp4",
      "Content-Length": String(media.length)
    },
    body: media
  });

  const uploadText = await uploadResponse.text();
  if (!uploadResponse.ok) {
    throw new Error(`YouTube upload failed: ${uploadText}`);
  }

  const data = parseMaybeJson(uploadText) || {};

  return {
    status: "success",
    providerPostId: data.id || null,
    raw: data,
    url: data.id ? `https://www.youtube.com/watch?v=${data.id}` : null
  };
}

async function publishToWhatsApp(post, connection) {
  requireConnection(connection, "whatsapp");

  const cfg = getConnectionConfig(connection);
  const token = cfg.accessToken;
  const phoneNumberId = cfg.phoneNumberId;
  const recipient = cfg.targetId;

  if (!token) throw new Error("WhatsApp access token missing");
  if (!phoneNumberId) throw new Error("WhatsApp phone_number_id missing");
  if (!recipient) throw new Error("WhatsApp recipient phone missing");

  const url = `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}/messages`;

  if (post.media_url && isVideo(post.media_type)) {
    const payload = {
      messaging_product: "whatsapp",
      to: recipient,
      type: "video",
      video: {
        link: post.media_url,
        caption: buildMessage(post) || ""
      }
    };

    const data = await fetchJson(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    return {
      status: "success",
      providerPostId: data?.messages?.[0]?.id || null,
      raw: data
    };
  }

  if (post.media_url) {
    const payload = {
      messaging_product: "whatsapp",
      to: recipient,
      type: "image",
      image: {
        link: post.media_url,
        caption: buildMessage(post) || ""
      }
    };

    const data = await fetchJson(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    return {
      status: "success",
      providerPostId: data?.messages?.[0]?.id || null,
      raw: data
    };
  }

  const payload = {
    messaging_product: "whatsapp",
    to: recipient,
    type: "text",
    text: {
      body: buildMessage(post) || ""
    }
  };

  const data = await fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return {
    status: "success",
    providerPostId: data?.messages?.[0]?.id || null,
    raw: data
  };
}

async function uploadMediaToLinkedIn({ mediaUrl, mediaType, accessToken, ownerUrn }) {
  const binary = await fetchBinary(mediaUrl);
  const isVid = isVideo(mediaType);
  const recipe = isVid
    ? "urn:li:digitalmediaRecipe:feedshare-video"
    : "urn:li:digitalmediaRecipe:feedshare-image";

  const register = await fetchJson("https://api.linkedin.com/rest/assets?action=registerUpload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "Linkedin-Version": LINKEDIN_VERSION
    },
    body: JSON.stringify({
      registerUploadRequest: {
        owner: ownerUrn,
        recipes: [recipe],
        serviceRelationships: [
          {
            identifier: "urn:li:userGeneratedContent",
            relationshipType: "OWNER"
          }
        ],
        ...(isVid ? {} : { supportedUploadMechanism: ["SYNCHRONOUS_UPLOAD"] })
      }
    })
  });

  const uploadUrl = register?.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]?.uploadUrl;
  const asset = register?.value?.asset;

  if (!uploadUrl || !asset) {
    throw new Error("LinkedIn asset registration failed");
  }

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": mediaType || (isVid ? "video/mp4" : "image/jpeg")
    },
    body: binary
  });

  if (!put.ok) {
    const text = await put.text();
    throw new Error(`LinkedIn asset upload failed: ${text}`);
  }

  const assetId = asset.split(":").pop();
  const assetUrn = isVid ? `urn:li:video:${assetId}` : `urn:li:image:${assetId}`;

  return { assetUrn, asset };
}

async function uploadMediaToX({ mediaUrl, mediaType, accessToken }) {
  const binary = await fetchBinary(mediaUrl);

  const form = new FormData();
  form.append("media", new Blob([binary], { type: mediaType || "application/octet-stream" }), "upload");

  const response = await fetch("https://api.x.com/2/media/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    body: form
  });

  const text = await response.text();
  const data = parseMaybeJson(text) || {};

  if (!response.ok) {
    throw new Error(`X media upload failed: ${text}`);
  }

  return data?.data?.id || data?.id || null;
}

async function getPost(postId) {
  const { data, error } = await supabase
    .from(POSTS_TABLE)
    .select("*")
    .eq("id", postId)
    .single();

  if (error) throw error;
  return data;
}

async function getConnection(userId, platform) {
  const { data, error } = await supabase
    .from(CONNECTIONS_TABLE)
    .select("*")
    .eq("user_id", userId)
    .eq("platform", platform)
    .eq("status", "connected")
    .maybeSingle();

  if (!error && data) return data;

  const aliases = reverseAliases(platform);
  if (!aliases.length) return null;

  const { data: aliasRow, error: aliasError } = await supabase
    .from(CONNECTIONS_TABLE)
    .select("*")
    .eq("user_id", userId)
    .in("platform", aliases)
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();

  if (aliasError) throw aliasError;
  return aliasRow || null;
}

async function markJob(jobId, patch) {
  const { error } = await supabase
    .from(JOBS_TABLE)
    .update(patch)
    .eq("id", jobId);

  if (error) throw error;
}

function getConnectionConfig(connection) {
  const meta = parseMeta(connection?.metadata);

  const accessToken = pickFirst(connection, meta, [
    "access_token",
    "token",
    "page_access_token",
    "bot_token"
  ]);

  const targetId = pickFirst(connection, meta, [
    "target_id",
    "page_id",
    "instagram_user_id",
    "ig_user_id",
    "telegram_chat_id",
    "chat_id",
    "linkedin_author_urn",
    "author_urn",
    "person_urn",
    "organization_urn",
    "recipient_phone",
    "to",
    "phone",
    "phone_number",
    "channel_id",
    "external_user_id",
    "account_handle"
  ]);

  const phoneNumberId = pickFirst(connection, meta, [
    "phone_number_id",
    "whatsapp_phone_number_id"
  ]);

  return {
    accessToken,
    targetId,
    phoneNumberId
  };
}

function requireConnection(connection, platform) {
  if (!connection) {
    throw new Error(`No connected account found for ${platform}`);
  }
}

function normalizePlatformKey(value) {
  const key = String(value || "").trim().toLowerCase();
  const map = {
    twitter: "x",
    linkedln: "linkedin",
    linked_in: "linkedin"
  };
  return map[key] || key;
}

function reverseAliases(platform) {
  const aliases = {
    x: ["twitter", "x"],
    linkedin: ["linkedin", "linkedln", "linked_in"]
  };
  return aliases[platform] || [];
}

function buildMessage(post) {
  const text = String(post?.content || "").trim();
  return truncate(text, 2200);
}

function deriveYouTubeTitle(post) {
  const text = String(post?.content || "").trim();
  if (!text) return post?.media_name || "View upload";
  return truncate(text.split("\n")[0], 100);
}

function inferMediaTitle(post) {
  if (post?.media_name) return truncate(post.media_name, 100);
  if (post?.content) return truncate(post.content, 100);
  return "View media";
}

function mapTikTokPrivacy(privacy) {
  const value = String(privacy || "public").toLowerCase();
  if (value === "private") return "SELF_ONLY";
  if (value === "friends") return "FOLLOWER_OF_CREATOR";
  return "PUBLIC_TO_EVERYONE";
}

function mapYouTubePrivacy(privacy) {
  const value = String(privacy || "public").toLowerCase();
  if (value === "private") return "private";
  if (value === "friends") return "unlisted";
  return "public";
}

function mapLinkedInVisibility(privacy) {
  const value = String(privacy || "public").toLowerCase();
  if (value === "private") return "LOGGED_IN";
  if (value === "friends") return "CONNECTIONS";
  return "PUBLIC";
}

function isVideo(mediaType) {
  return String(mediaType || "").toLowerCase().startsWith("video/");
}

function isImage(mediaType) {
  return String(mediaType || "").toLowerCase().startsWith("image/");
}

async function fetchBinary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch media from ${url}`);
  }
  const ab = await response.arrayBuffer();
  return Buffer.from(ab);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = parseMaybeJson(text);

  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}: ${text}`);
  }

  return data ?? { raw: text };
}

function parseMaybeJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return { value: String(value) };
  }
}

function toFormData(obj) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === undefined || value === null) continue;
    fd.append(key, String(value));
  }
  return fd;
}

function parseMeta(metadata) {
  if (!metadata) return {};
  if (typeof metadata === "object") return metadata;
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

function pickFirst(connection, meta, keys) {
  for (const key of keys) {
    if (connection && connection[key] !== undefined && connection[key] !== null && connection[key] !== "") {
      return connection[key];
    }
    if (meta && meta[key] !== undefined && meta[key] !== null && meta[key] !== "") {
      return meta[key];
    }
  }
  return null;
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
