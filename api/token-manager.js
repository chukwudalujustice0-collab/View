const { createClient } = require("@supabase/supabase-js");

function getEnv(name, fallbackNames = []) {
  return process.env[name] || fallbackNames.map((k) => process.env[k]).find(Boolean) || "";
}

function nowIso() {
  return new Date().toISOString();
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

function normalizePlatform(value) {
  return String(value || "").trim().toLowerCase();
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
      payload?.errorDetails ||
      fallback,
    500
  );
}

function isExpiringSoon(expiresAt, bufferSeconds = 300) {
  if (!expiresAt) return false;
  const ts = new Date(expiresAt).getTime();
  return Number.isFinite(ts) && ts <= Date.now() + bufferSeconds * 1000;
}

function hasUsableRefreshToken(account) {
  return !!String(account?.refresh_token || "").trim();
}

function getSupabaseAdmin() {
  const url = getEnv("SUPABASE_URL", ["SUPABASE_URL_VALUE", "NEXT_PUBLIC_SUPABASE_URL"]);
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY", ["SUPABASE_SERVICE_KEY"]);
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

async function saveRefreshedAccount(supabase, accountId, patch) {
  const { data, error } = await supabase
    .from("connected_accounts")
    .update({
      ...patch,
      needs_reconnect: false,
      reconnect_reason: null,
      last_refreshed_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", accountId)
    .select("*")
    .single();

  if (error) throw new Error(error.message || "Failed saving refreshed account");
  return data;
}

async function markReconnectRequired(supabase, accountId, reason) {
  await supabase
    .from("connected_accounts")
    .update({
      needs_reconnect: true,
      reconnect_reason: trimText(reason || "Reconnect required", 500),
      updated_at: nowIso()
    })
    .eq("id", accountId);
}

async function refreshGoogleToken(account) {
  const clientId = getEnv("GOOGLE_CLIENT_ID", ["YOUTUBE_CLIENT_ID"]);
  const clientSecret = getEnv("GOOGLE_CLIENT_SECRET", ["YOUTUBE_CLIENT_SECRET"]);

  if (!clientId || !clientSecret) throw new Error("Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET");
  if (!hasUsableRefreshToken(account)) throw new Error("Google reconnect required");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: account.refresh_token,
    grant_type: "refresh_token"
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const text = await res.text();
  const data = safeJsonParse(text, {});

  if (!res.ok || !data?.access_token) {
    throw new Error(extractApiErrorMessage(data, text || "Google token refresh failed"));
  }

  return {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString(),
    token_type: data.token_type || "Bearer"
  };
}

async function refreshTikTokToken(account) {
  const clientKey = getEnv("TIKTOK_CLIENT_KEY");
  const clientSecret = getEnv("TIKTOK_CLIENT_SECRET");

  if (!clientKey || !clientSecret) throw new Error("Missing TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET");
  if (!hasUsableRefreshToken(account)) throw new Error("TikTok reconnect required");

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: account.refresh_token
  });

  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const text = await res.text();
  const data = safeJsonParse(text, {});

  if (!res.ok || !data?.access_token) {
    throw new Error(extractApiErrorMessage(data, text || "TikTok token refresh failed"));
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || account.refresh_token,
    expires_at: new Date(Date.now() + Number(data.expires_in || 86400) * 1000).toISOString(),
    refresh_token_expires_at: data.refresh_expires_in
      ? new Date(Date.now() + Number(data.refresh_expires_in) * 1000).toISOString()
      : account.refresh_token_expires_at || null,
    token_type: data.token_type || "Bearer"
  };
}

async function refreshLinkedInToken(account) {
  const clientId = getEnv("LINKEDIN_CLIENT_ID");
  const clientSecret = getEnv("LINKEDIN_CLIENT_SECRET");

  if (!clientId || !clientSecret) throw new Error("Missing LINKEDIN_CLIENT_ID/LINKEDIN_CLIENT_SECRET");
  if (!hasUsableRefreshToken(account)) throw new Error("LinkedIn reconnect required");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.refresh_token,
    client_id: clientId,
    client_secret: clientSecret
  });

  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const text = await res.text();
  const data = safeJsonParse(text, {});

  if (!res.ok || !data?.access_token) {
    throw new Error(extractApiErrorMessage(data, text || "LinkedIn token refresh failed"));
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || account.refresh_token,
    expires_at: new Date(Date.now() + Number(data.expires_in || 5184000) * 1000).toISOString(),
    refresh_token_expires_at: data.refresh_token_expires_in
      ? new Date(Date.now() + Number(data.refresh_token_expires_in) * 1000).toISOString()
      : account.refresh_token_expires_at || null,
    token_type: "Bearer"
  };
}

async function refreshInstagramLongLivedToken(account) {
  const token = account.long_lived_token || account.access_token;
  if (!token) throw new Error("Instagram reconnect required");

  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);

  const res = await fetch(url.toString(), { method: "GET" });
  const text = await res.text();
  const data = safeJsonParse(text, {});

  if (!res.ok || !data?.access_token) {
    throw new Error(extractApiErrorMessage(data, text || "Instagram token refresh failed"));
  }

  return {
    access_token: data.access_token,
    long_lived_token: data.access_token,
    expires_at: new Date(Date.now() + Number(data.expires_in || 5184000) * 1000).toISOString(),
    token_type: "Bearer"
  };
}

async function ensureFreshAccountToken(supabase, account) {
  const platform = normalizePlatform(account?.platform);

  if (account?.needs_reconnect) {
    throw new Error(account?.reconnect_reason || `${platform} reconnect required`);
  }

  if (!isExpiringSoon(account?.expires_at)) {
    return account;
  }

  try {
    let patch = null;

    if (platform === "youtube" || platform === "google") {
      patch = await refreshGoogleToken(account);
    } else if (platform === "tiktok") {
      patch = await refreshTikTokToken(account);
    } else if (platform === "linkedin") {
      patch = await refreshLinkedInToken(account);
    } else if (platform === "instagram") {
      patch = await refreshInstagramLongLivedToken(account);
    } else {
      return account;
    }

    return await saveRefreshedAccount(supabase, account.id, patch);
  } catch (error) {
    await markReconnectRequired(supabase, account.id, error?.message || `${platform} reconnect required`);
    throw error;
  }
}

module.exports = {
  getSupabaseAdmin,
  ensureFreshAccountToken,
  markReconnectRequired,
  isExpiringSoon,
  normalizePlatform,
  extractApiErrorMessage,
  safeJsonParse,
  trimText
};
