const { createClient } = require("@supabase/supabase-js");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
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

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const text = await res.text();
  const data = safeJsonParse(text, {});

  if (!res.ok || !data?.access_token) {
    throw new Error(extractApiErrorMessage(data, text || "Google token exchange failed"));
  }

  return data;
}

async function fetchYouTubeChannel(accessToken) {
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const text = await res.text();
  const data = safeJsonParse(text, {});

  if (!res.ok) {
    throw new Error(extractApiErrorMessage(data, text || "Failed to fetch YouTube channel"));
  }

  const item = Array.isArray(data?.items) ? data.items[0] : null;
  return {
    channelId: item?.id || null,
    title: item?.snippet?.title || null,
    thumbnail:
      item?.snippet?.thumbnails?.default?.url ||
      item?.snippet?.thumbnails?.medium?.url ||
      item?.snippet?.thumbnails?.high?.url ||
      null
  };
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(req);
    const supabase = getSupabaseAdmin();

    const body = typeof req.body === "string" ? safeJsonParse(req.body, {}) : (req.body || {});
    const code = String(body.code || "").trim();
    const redirectUri = String(body.redirect_uri || "").trim();

    if (!code) {
      return res.status(400).json({ ok: false, error: "Missing code" });
    }

    if (!redirectUri) {
      return res.status(400).json({ ok: false, error: "Missing redirect_uri" });
    }

    const tokenData = await exchangeGoogleCode(code, redirectUri);
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || null;
    const expiresAt = new Date(Date.now() + Number(tokenData.expires_in || 3600) * 1000).toISOString();
    const tokenType = tokenData.token_type || "Bearer";
    const scope = String(tokenData.scope || "");

    const channel = await fetchYouTubeChannel(accessToken);

    const record = {
      user_id: user.id,
      platform: "youtube",
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      token_type: tokenType,
      last_refreshed_at: new Date().toISOString(),
      needs_reconnect: false,
      reconnect_reason: null,
      is_connected: true,
      connected: true,
      status: "connected",
      platform_user_id: channel.channelId,
      external_id: channel.channelId,
      account_id: channel.channelId,
      account_name: channel.title,
      avatar_url: channel.thumbnail,
      token_meta: {
        scope,
        provider: "google",
        granted_at: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    };

    const { data: existing } = await supabase
      .from("connected_accounts")
      .select("id, refresh_token")
      .eq("user_id", user.id)
      .eq("platform", "youtube")
      .maybeSingle();

    if (existing?.id && !refreshToken && existing.refresh_token) {
      record.refresh_token = existing.refresh_token;
    }

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
        throw new Error(error.message || "Failed to save connected account");
      }
      saved = data;
    }

    return res.status(200).json({
      ok: true,
      platform: "youtube",
      account_id: saved?.account_id || channel.channelId,
      account_name: saved?.account_name || channel.title,
      expires_at: saved?.expires_at || expiresAt,
      has_refresh_token: !!saved?.refresh_token
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: trimText(error?.message || "Internal server error", 500)
    });
  }
};
