import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const POSTS_TABLE = process.env.POSTS_TABLE || "posts";
const JOBS_TABLE = process.env.JOBS_TABLE || "post_publish_jobs";
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connected_accounts";
const BATCH_SIZE = Number(process.env.PUBLISH_BATCH_SIZE || 10);
const FACEBOOK_GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || "v23.0";
const LINKEDIN_VERSION = process.env.LINKEDIN_VERSION || "202603";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || BATCH_SIZE)));
    const result = await processJobs(limit);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("Worker fatal error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Unexpected error"
    });
  }
}

async function processJobs(limit) {
  const { data: jobs, error } = await supabase
    .from(JOBS_TABLE)
    .select("*")
    .in("status", ["queued", "retry"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;

  const processed = [];
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of jobs || []) {
    try {
      await updateJob(job.id, {
        status: "processing",
        started_at: new Date().toISOString(),
        attempts: (job.attempts || 0) + 1,
        error_message: null
      });

      const post = await getPost(job.post_id);
      if (!post) throw new Error(`Post ${job.post_id} not found`);

      const platform = normalizePlatform(job.platform);
      const connection = platform === "view" ? null : await getConnection(job.user_id, platform);

      const result = await publishToPlatform({
        platform,
        post,
        connection
      });

      await updateJob(job.id, {
        status: result.status || "success",
        completed_at: new Date().toISOString(),
        provider_post_id: result.providerPostId || null,
        published_url: result.url || null,
        provider_response: safeJson(result.raw || result),
        error_message: result.errorMessage || null
      });

      await updatePostAfterJob(post.id);

      processed.push({
        job_id: job.id,
        platform,
        status: result.status || "success"
      });

      if (result.status === "skipped") skipped += 1;
      else success += 1;
    } catch (error) {
      console.error(`Job ${job.id} failed:`, error);

      await updateJob(job.id, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: truncate(error.message || "Publishing failed", 1800),
        provider_response: safeJson({
          message: error.message || "Publishing failed",
          stack: error.stack || null
        })
      });

      processed.push({
        job_id: job.id,
        platform: normalizePlatform(job.platform),
        status: "failed",
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
      return {
        status: "skipped",
        errorMessage: `Unsupported platform: ${platform}`,
        raw: { unsupported: platform }
      };
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

  const token = connection.access_token;
  const pageId =
    connection.external_page_id ||
    connection.metadata?.page_id ||
    connection.metadata?.target_id ||
    null;

  if (!token) throw new Error("Facebook access token missing");
  if (!pageId) throw new Error("Facebook page id missing");

  const message = buildMessage(post);

  if (post.media_url && isVideo(post.media_type)) {
    const data = await fetchJson(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(pageId)}/videos`, {
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
      raw: data
    };
  }

  if (post.media_url) {
    const data = await fetchJson(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(pageId)}/photos`, {
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
      raw: data
    };
  }

  const data = await fetchJson(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(pageId)}/feed`, {
    method: "POST",
    body: toFormData({
      access_token: token,
      message: message || ""
    })
  });

  return {
    status: "success",
    providerPostId: data.id || null,
    raw: data
  };
}

async function publishToInstagram(post, connection) {
  requireConnection(connection, "instagram");

  const token = connection.access_token;
  const igUserId =
    connection.external_page_id ||
    connection.external_user_id ||
    connection.metadata?.instagram_user_id ||
    connection.metadata?.ig_user_id ||
    null;

  if (!token) throw new Error("Instagram access token missing");
  if (!igUserId) throw new Error("Instagram user id missing");
  if (!post.media_url) throw new Error("Instagram publishing requires media");
  const caption = buildMessage(post);

  let container;

  if (isVideo(post.media_type)) {
    container = await fetchJson(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(igUserId)}/media`, {
      method: "POST",
      body: toFormData({
        access_token: token,
        media_type: "REELS",
        video_url: post.media_url,
        caption: caption || ""
      })
    });
  } else {
    container = await fetchJson(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(igUserId)}/media`, {
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

  const published = await fetchJson(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(igUserId)}/media_publish`, {
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

  const token =
    connection.access_token ||
    connection.metadata?.access_token ||
    null;

  const chatId =
    connection.telegram_chat_id ||
    connection.metadata?.telegram_chat_id ||
    connection.metadata?.chat_id ||
    null;

  if (!token) throw new Error("Telegram bot token missing");
  if (!chatId) throw new Error("Telegram chat id missing");

  const base = `https://api.telegram.org/bot${token}`;
  const caption = buildMessage(post);

  if (post.media_url && isVideo(post.media_type)) {
    const data = await fetchJson(`${base}/sendVideo`, {
      method: "POST",
      body: toFormData({
        chat_id: chatId,
        video: post.media_url,
        caption: caption || ""
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
        caption: caption || ""
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
      text: caption || "New post from View"
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

  const token = connection.access_token;
  const ownerUrn =
    connection.external_page_id ||
    connection.external_user_id ||
    connection.metadata?.author_urn ||
    connection.metadata?.owner_urn ||
    connection.metadata?.linkedin_author_urn ||
    null;

  if (!token) throw new Error("LinkedIn access token missing");
  if (!ownerUrn) throw new Error("LinkedIn owner URN missing");

  let content = null;

  if (post.media_url) {
    const upload = await uploadMediaToLinkedIn({
      mediaUrl: post.media_url,
      mediaType: post.media_type,
      accessToken: token,
      ownerUrn
    });

    content = {
      media: {
        title: post.media_name || inferMediaTitle(post),
        id: upload.assetUrn
      }
    };
  }

  const payload = {
    author: ownerUrn,
    commentary: buildMessage(post),
    visibility: "PUBLIC",
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

  const token = connection.access_token;
  if (!token) throw new Error("X access token missing");

  let mediaIds = [];

  if (post.media_url) {
    const mediaId = await uploadMediaToX({
      mediaUrl: post.media_url,
      mediaType: post.media_type,
      accessToken: token
    });
    if (mediaId) mediaIds.push(mediaId);
  }

  const payload = {
    text: buildMessage(post) || ""
  };

  if (mediaIds.length) {
    payload.media = { media_ids: mediaIds };
  }

  const data = await fetchJson("https://api.x.com/2/tweets", {
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

  const token = connection.access_token;
  if (!token) throw new Error("TikTok access token missing");
  if (!post.media_url) throw new Error("TikTok publishing requires media_url");

  const title = buildMessage(post);

  if (isImage(post.media_type)) {
    const data = await fetchJson("https://open.tiktokapis.com/v2/post/publish/content/init/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8"
      },
      body: JSON.stringify({
        post_info: {
          title: title,
          privacy_level: "PUBLIC_TO_EVERYONE"
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_images: [post.media_url]
        }
      })
    });

    return {
      status: "success",
      providerPostId: data?.data?.publish_id || data?.data?.post_id || null,
      raw: data
    };
  }

  const data = await fetchJson("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8"
    },
    body: JSON.stringify({
      post_info: {
        title: title,
        privacy_level: "PUBLIC_TO_EVERYONE",
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
    providerPostId: data?.data?.publish_id || data?.data?.post_id || null,
    raw: data
  };
}

async function publishToYouTube(post, connection) {
  requireConnection(connection, "youtube");

  const token = connection.access_token;
  if (!token) throw new Error("YouTube access token missing");
  if (!post.media_url) throw new Error("YouTube publishing requires media_url");
  if (!isVideo(post.media_type)) throw new Error("YouTube requires video media");

  const media = await fetchBinary(post.media_url);
  const metadata = {
    snippet: {
      title: deriveYouTubeTitle(post),
      description: buildMessage(post) || ""
    },
    status: {
      privacyStatus: "public"
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
    throw new Error("YouTube resumable upload URL missing");
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

  const token = connection.access_token;
  const phoneNumberId =
    connection.external_page_id ||
    connection.metadata?.phone_number_id ||
    connection.metadata?.whatsapp_phone_number_id ||
    null;

  const recipient =
    connection.external_user_id ||
    connection.metadata?.recipient_phone ||
    connection.metadata?.to ||
    null;

  if (!token) throw new Error("WhatsApp access token missing");
  if (!phoneNumberId) throw new Error("WhatsApp phone_number_id missing");
  if (!recipient) throw new Error("WhatsApp recipient number missing");

  const url = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`;

  if (post.media_url && isVideo(post.media_type)) {
    const data = await fetchJson(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "video",
        video: {
          link: post.media_url,
          caption: buildMessage(post) || ""
        }
      })
    });

    return {
      status: "success",
      providerPostId: data?.messages?.[0]?.id || null,
      raw: data
    };
  }

  if (post.media_url) {
    const data = await fetchJson(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "image",
        image: {
          link: post.media_url,
          caption: buildMessage(post) || ""
        }
      })
    });

    return {
      status: "success",
      providerPostId: data?.messages?.[0]?.id || null,
      raw: data
    };
  }

  const data = await fetchJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: recipient,
      type: "text",
      text: {
        body: buildMessage(post) || "New message from View"
      }
    })
  });

  return {
    status: "success",
    providerPostId: data?.messages?.[0]?.id || null,
    raw: data
  };
}

/* ----------------------------- DB HELPERS ----------------------------- */

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

  if (error) throw error;
  return normalizeConnection(data);
}

async function updateJob(jobId, patch) {
  const { error } = await supabase
    .from(JOBS_TABLE)
    .update(patch)
    .eq("id", jobId);

  if (error) throw error;
}

async function updatePostAfterJob(postId) {
  const { data: jobs, error } = await supabase
    .from(JOBS_TABLE)
    .select("status")
    .eq("post_id", postId);

  if (error) throw error;

  const statuses = (jobs || []).map(j => j.status);
  if (!statuses.length) return;

  let publishStatus = "queued";
  if (statuses.every(s => s === "success" || s === "skipped")) {
    publishStatus = "published";
  } else if (statuses.some(s => s === "failed")) {
    publishStatus = "partial_failed";
  } else if (statuses.some(s => s === "processing")) {
    publishStatus = "processing";
  }

  await supabase
    .from(POSTS_TABLE)
    .update({
      publish_status: publishStatus,
      status: publishStatus === "published" ? "published" : "queued",
      published_at: publishStatus === "published" ? new Date().toISOString() : null
    })
    .eq("id", postId);
}

/* -------------------------- PLATFORM HELPERS -------------------------- */

function normalizeConnection(connection) {
  if (!connection) return null;

  let metadata = connection.metadata || {};
  if (typeof metadata === "string") {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = {};
    }
  }

  return {
    ...connection,
    metadata
  };
}

function normalizePlatform(value) {
  const platform = String(value || "").trim().toLowerCase();
  const aliases = {
    twitter: "x",
    linkedln: "linkedin",
    linked_in: "linkedin"
  };
  return aliases[platform] || platform;
}

function requireConnection(connection, platform) {
  if (!connection) {
    throw new Error(`No connected account found for ${platform}`);
  }
}

function buildMessage(post) {
  return truncate(String(post?.content || "").trim(), 2200);
}

function deriveYouTubeTitle(post) {
  const content = String(post?.content || "").trim();
  if (!content) return post?.media_name || "View upload";
  return truncate(content.split("\n")[0], 100);
}

function inferMediaTitle(post) {
  if (post?.media_name) return truncate(post.media_name, 100);
  if (post?.content) return truncate(post.content, 100);
  return "View media";
}

function isVideo(mediaType) {
  return String(mediaType || "").toLowerCase().startsWith("video/");
}

function isImage(mediaType) {
  return String(mediaType || "").toLowerCase().startsWith("image/");
}

/* ---------------------------- API HELPERS ----------------------------- */

async function uploadMediaToLinkedIn({ mediaUrl, mediaType, accessToken, ownerUrn }) {
  const binary = await fetchBinary(mediaUrl);
  const isVid = isVideo(mediaType);

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
        recipes: [
          isVid
            ? "urn:li:digitalmediaRecipe:feedshare-video"
            : "urn:li:digitalmediaRecipe:feedshare-image"
        ],
        serviceRelationships: [
          {
            identifier: "urn:li:userGeneratedContent",
            relationshipType: "OWNER"
          }
        ]
      }
    })
  });

  const uploadUrl =
    register?.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]?.uploadUrl;
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
  return {
    assetUrn: isVid ? `urn:li:video:${assetId}` : `urn:li:image:${assetId}`,
    rawAsset: asset
  };
}

async function uploadMediaToX({ mediaUrl, mediaType, accessToken }) {
  const binary = await fetchBinary(mediaUrl);
  const base64 = binary.toString("base64");

  const category = isVideo(mediaType)
    ? "tweet_video"
    : isImage(mediaType)
      ? "tweet_image"
      : "tweet_image";

  const data = await fetchJson("https://api.x.com/2/media/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      media: base64,
      media_category: category,
      media_type: mediaType || "application/octet-stream",
      shared: false
    })
  });

  return data?.data?.id || data?.id || null;
}

async function fetchBinary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch media: ${url}`);
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer);
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

function toFormData(obj) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === undefined || value === null) continue;
    fd.append(key, String(value));
  }
  return fd;
}

function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return { value: String(value) };
  }
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
