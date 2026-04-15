const { createClient } = require("@supabase/supabase-js");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function getEnv(name, fallbackNames = []) {
  return process.env[name] || fallbackNames.map((k) => process.env[k]).find(Boolean) || "";
}

function safeJsonParse(text, fallback = {}) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function trimText(value, max = 500) {
  return String(value || "").slice(0, max);
}

function extractApiErrorMessage(payload, fallback = "Request failed") {
  if (!payload) return fallback;

  if (typeof payload === "string") {
    const clean = payload.replace(/\s+/g, " ").trim();
    return trimText(clean || fallback, 500);
  }

  return trimText(
    payload?.error?.message ||
      payload?.error ||
      payload?.message ||
      payload?.error_description ||
      payload?.description ||
      payload?.detail ||
      payload?.title ||
      fallback,
    500
  );
}

function getSupabaseAdmin() {
  const url = getEnv("SUPABASE_URL", ["SUPABASE_URL_VALUE", "NEXT_PUBLIC_SUPABASE_URL"]);
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY", ["SUPABASE_SERVICE_KEY"]);
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

async function getAuthenticatedUser(req) {
  const supabaseUrl = getEnv("SUPABASE_URL", ["SUPABASE_URL_VALUE", "NEXT_PUBLIC_SUPABASE_URL"]);
  const anonKey = getEnv("SUPABASE_ANON_KEY", ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);

  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }

  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    throw new Error("Missing user session token");
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    throw new Error("Invalid session");
  }

  return data.user;
}

function buildRedirectUri() {
  return "https://view.ceetice.com/api/youtube?action=exchange";
}

function buildFutureIso(expiresInSeconds) {
  const seconds = Number(expiresInSeconds || 3600);
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function safeFetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  const data = safeJsonParse(text, {});
  return { ok: res.ok, status: res.status, data, raw: text };
}

async function exchangeGoogleCode(code, redirectUri) {
  const clientId = getEnv("GOOGLE_CLIENT_ID", ["YOUTUBE_CLIENT_ID"]);
  const clientSecret = getEnv("GOOGLE_CLIENT_SECRET", ["YOUTUBE_CLIENT_SECRET"]);

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET");
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });

  const result = await safeFetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!result.ok || !result.data?.access_token) {
    throw new Error(extractApiErrorMessage(result.data, result.raw || "Google token exchange failed"));
  }

  return result.data;
}

async function refreshGoogleToken(refreshToken) {
  const clientId = getEnv("GOOGLE_CLIENT_ID", ["YOUTUBE_CLIENT_ID"]);
  const clientSecret = getEnv("GOOGLE_CLIENT_SECRET", ["YOUTUBE_CLIENT_SECRET"]);

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET");
  }

  if (!refreshToken) {
    throw new Error("Missing refresh token");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  const result = await safeFetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!result.ok || !result.data?.access_token) {
    throw new Error(extractApiErrorMessage(result.data, result.raw || "Google token refresh failed"));
  }

  return result.data;
}

async function fetchGoogleUser(accessToken) {
  const result = await safeFetchJson("https://www.googleapis.com/oauth2/v2/userinfo", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!result.ok) {
    throw new Error(extractApiErrorMessage(result.data, result.raw || "Failed to fetch Google user"));
  }

  return result.data || {};
}

async function fetchYouTubeChannels(accessToken) {
  const result = await safeFetchJson(
    "https://www.googleapis.com/youtube/v3/channels?part=id,snippet,statistics&mine=true",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!result.ok) {
    throw new Error(extractApiErrorMessage(result.data, result.raw || "Failed to fetch YouTube channels"));
  }

  const items = Array.isArray(result.data?.items) ? result.data.items : [];

  return items.map((item) => ({
    id: item?.id || null,
    name: item?.snippet?.title || null,
    title: item?.snippet?.title || null,
    handle: item?.snippet?.customUrl || null,
    custom_url: item?.snippet?.customUrl || null,
    thumbnail:
      item?.snippet?.thumbnails?.default?.url ||
      item?.snippet?.thumbnails?.medium?.url ||
      item?.snippet?.thumbnails?.high?.url ||
      null,
    subscriber_count: item?.statistics?.subscriberCount || null
  }));
}

function buildGoogleAuthUrl({ clientId, redirectUri, state }) {
  const scope = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/userinfo.email"
  ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope,
    state
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function getExistingAccount(supabase, userId) {
  const { data, error } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "youtube")
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load existing connected account");
  }

  return data || null;
}

async function saveYouTubeAccount(supabase, userId, payload) {
  const existing = await getExistingAccount(supabase, userId);

  const refreshTokenToSave = payload.refresh_token || existing?.refresh_token || null;

  const record = {
    user_id: userId,
    provider: "youtube",
    account_name: payload.account_name || existing?.account_name || null,
    account_handle: payload.account_handle || existing?.account_handle || null,
    external_user_id: payload.external_user_id || existing?.external_user_id || null,
    external_page_id: payload.external_page_id || existing?.external_page_id || null,
    access_token: payload.access_token || existing?.access_token || null,
    refresh_token: refreshTokenToSave,
    token_expires_at: payload.token_expires_at || existing?.token_expires_at || null,
    status: payload.status || "connected",
    updated_at: new Date().toISOString()
  };

  let saved;
  if (existing?.id) {
    const { data, error } = await supabase
      .from("connected_accounts")
      .update(record)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message || "Failed to update connected account");
    }
    saved = data;
  } else {
    const { data, error } = await supabase
      .from("connected_accounts")
      .insert(record)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message || "Failed to create connected account");
    }
    saved = data;
  }

  return saved;
}

async function ensureFreshYouTubeToken(supabase, account) {
  if (!account) return null;

  const now = Date.now();
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  const isExpired = !expiresAt || Number.isNaN(expiresAt) || expiresAt <= now;

  if (!isExpired) return account;

  if (!account.refresh_token) {
    return account;
  }

  const refreshed = await refreshGoogleToken(account.refresh_token);
  const updated = await saveYouTubeAccount(supabase, account.user_id, {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || account.refresh_token,
    token_expires_at: buildFutureIso(refreshed.expires_in),
    status: "connected",
    account_name: account.account_name,
    account_handle: account.account_handle,
    external_user_id: account.external_user_id,
    external_page_id: account.external_page_id
  });

  return updated;
}

async function handleStart(req, res) {
  const user = await getAuthenticatedUser(req);
  const clientId = getEnv("GOOGLE_CLIENT_ID", ["YOUTUBE_CLIENT_ID"]);
  if (!clientId) {
    throw new Error("Missing GOOGLE_CLIENT_ID/YOUTUBE_CLIENT_ID");
  }

  const body = typeof req.body === "string" ? safeJsonParse(req.body, {}) : (req.body || {});
  const redirectTo = trimText(body.redirect_to || `${req.headers.origin || ""}/youtube-connect.html`, 1000);
  const redirectUri = trimText(body.redirect_uri || buildRedirectUri(req), 1000);

  const state = Buffer.from(
    JSON.stringify({
      user_id: user.id,
      redirect_to: redirectTo,
      redirect_uri: redirectUri
    })
  ).toString("base64url");

  const authUrl = buildGoogleAuthUrl({
    clientId,
    redirectUri,
    state
  });

  return json(res, 200, {
    ok: true,
    auth_url: authUrl,
    redirect_uri: redirectUri
  });
}

async function handleExchange(req, res) {
  const user = await getAuthenticatedUser(req);
  const supabase = getSupabaseAdmin();

  const body = typeof req.body === "string" ? safeJsonParse(req.body, {}) : (req.body || {});
  const code =
    trimText(body.code || req.body?.code || req.query.code || "", 2000);
  const redirectUri =
    trimText(body.redirect_uri || req.query.redirect_uri || buildRedirectUri(req), 1000);

  if (!code) {
    return json(res, 400, { ok: false, error: "Missing code" });
  }

  if (!redirectUri) {
    return json(res, 400, { ok: false, error: "Missing redirect_uri" });
  }

  const tokenData = await exchangeGoogleCode(code, redirectUri);
  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token || null;
  const tokenExpiresAt = buildFutureIso(tokenData.expires_in);

  const googleUser = await fetchGoogleUser(accessToken);
  const channels = await fetchYouTubeChannels(accessToken);
  const firstChannel = channels[0] || null;

  if (!firstChannel?.id) {
    return json(res, 400, {
      ok: false,
      error: "No YouTube channel found for this Google account"
    });
  }

  const saved = await saveYouTubeAccount(supabase, user.id, {
    account_name: firstChannel.name || googleUser.name || "YouTube Channel",
    account_handle:
      firstChannel.handle ||
      googleUser.email ||
      googleUser.name ||
      firstChannel.name ||
      "YouTube",
    external_user_id: googleUser.id || firstChannel.id,
    external_page_id: firstChannel.id,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expires_at: tokenExpiresAt,
    status: "connected"
  });

  return json(res, 200, {
    ok: true,
    platform: "youtube",
    provider: "youtube",
    account_id: saved?.external_page_id || firstChannel.id,
    account_name: saved?.account_name || firstChannel.name,
    token_expires_at: saved?.token_expires_at || tokenExpiresAt,
    has_refresh_token: !!saved?.refresh_token
  });
}

async function handleStatus(req, res) {
  const user = await getAuthenticatedUser(req);
  const supabase = getSupabaseAdmin();

  let account = await getExistingAccount(supabase, user.id);

  if (!account) {
    return json(res, 200, {
      ok: true,
      connected: false,
      account: null
    });
  }

  account = await ensureFreshYouTubeToken(supabase, account);

  const expiresAt = account?.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  const isExpired = !expiresAt || Number.isNaN(expiresAt) || expiresAt <= Date.now();

  return json(res, 200, {
    ok: true,
    connected: !!account && !isExpired,
    expired: !!account && isExpired,
    account
  });
}

async function handleChannels(req, res) {
  const user = await getAuthenticatedUser(req);
  const supabase = getSupabaseAdmin();

  let account = await getExistingAccount(supabase, user.id);

  if (!account) {
    return json(res, 200, {
      ok: true,
      channels: []
    });
  }

  account = await ensureFreshYouTubeToken(supabase, account);

  if (!account?.access_token) {
    return json(res, 400, {
      ok: false,
      error: "No YouTube access token found"
    });
  }

  const channels = await fetchYouTubeChannels(account.access_token);

  return json(res, 200, {
    ok: true,
    channels
  });
}

async function handleSelectChannel(req, res) {
  const user = await getAuthenticatedUser(req);
  const supabase = getSupabaseAdmin();

  const body = typeof req.body === "string" ? safeJsonParse(req.body, {}) : (req.body || {});
  const channelId = trimText(body.channel_id || "", 255);
  const channelName = trimText(body.channel_name || "", 255);
  const channelHandle = trimText(body.channel_handle || "", 255);

  if (!channelId) {
    return json(res, 400, { ok: false, error: "Missing channel_id" });
  }

  const existing = await getExistingAccount(supabase, user.id);
  if (!existing) {
    return json(res, 404, { ok: false, error: "No connected YouTube account found" });
  }

  const saved = await saveYouTubeAccount(supabase, user.id, {
    account_name: channelName || existing.account_name,
    account_handle: channelHandle || existing.account_handle,
    external_user_id: existing.external_user_id,
    external_page_id: channelId,
    access_token: existing.access_token,
    refresh_token: existing.refresh_token,
    token_expires_at: existing.token_expires_at,
    status: "connected"
  });

  return json(res, 200, {
    ok: true,
    message: "YouTube channel selected successfully",
    account: saved
  });
}

async function handleDisconnect(req, res) {
  const user = await getAuthenticatedUser(req);
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("connected_accounts")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", "youtube");

  if (error) {
    throw new Error(error.message || "Failed to disconnect YouTube");
  }

  return json(res, 200, {
    ok: true,
    message: "YouTube disconnected successfully"
  });
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const action = String(req.query.action || "").trim().toLowerCase();

    if (req.method === "POST") {
      if (action === "start") return await handleStart(req, res);
      if (action === "exchange") return await handleExchange(req, res);
      if (action === "select_channel") return await handleSelectChannel(req, res);
      if (action === "disconnect") return await handleDisconnect(req, res);
    }

    if (req.method === "GET") {
      if (action === "status") return await handleStatus(req, res);
      if (action === "channels") return await handleChannels(req, res);
    }

    return json(res, 405, {
      ok: false,
      error: "Invalid method or action"
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: trimText(error?.message || "Internal server error", 500)
    });
  }
};
