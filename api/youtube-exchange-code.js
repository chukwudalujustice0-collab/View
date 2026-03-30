const { createClient } = require("@supabase/supabase-js");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const body = req.method === "POST" ? req.body : req.query;

    const code = body?.code;
    const state = body?.state;
    const redirectUri = body?.redirect_uri;

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: "Missing Google authorization code."
      });
    }

    if (!state) {
      return res.status(400).json({
        ok: false,
        error: "Missing state/user id."
      });
    }

    if (!redirectUri) {
      return res.status(400).json({
        ok: false,
        error: "Missing redirect_uri."
      });
    }

    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL_VALUE;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({
        ok: false,
        error: "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in Vercel."
      });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing SUPABASE_URL_VALUE or SUPABASE_SERVICE_KEY in Vercel."
      });
    }

    const tokenForm = new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    });

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: tokenForm.toString()
    });

    const tokenText = await tokenRes.text();

    let tokenData = {};
    try {
      tokenData = tokenText ? JSON.parse(tokenText) : {};
    } catch {
      tokenData = { raw: tokenText };
    }

    if (!tokenRes.ok) {
      return res.status(400).json({
        ok: false,
        error: `Google token exchange failed: ${tokenData.error_description || tokenData.error || tokenText}`
      });
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || null;
    const expiresIn = Number(tokenData.expires_in || 3600);
    const tokenType = tokenData.token_type || "Bearer";
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    if (!accessToken) {
      return res.status(400).json({
        ok: false,
        error: "Google did not return an access token."
      });
    }

    const channelRes = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const channelText = await channelRes.text();

    let channelData = {};
    try {
      channelData = channelText ? JSON.parse(channelText) : {};
    } catch {
      channelData = { raw: channelText };
    }

    if (!channelRes.ok) {
      return res.status(400).json({
        ok: false,
        error: `YouTube channel fetch failed: ${channelText}`
      });
    }

    const channel = channelData.items?.[0];
    if (!channel) {
      return res.status(400).json({
        ok: false,
        error: "No YouTube channel was found for this Google account."
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const upsertPayload = {
      user_id: state,
      platform: "youtube",
      account_name: channel?.snippet?.title || "YouTube Connected",
      account_handle: channel?.snippet?.customUrl || null,
      external_user_id: channel?.id || null,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: tokenType,
      token_expires_at: tokenExpiresAt,
      status: "connected",
      last_synced_at: new Date().toISOString(),
      last_error: null
    };

    const { error: upsertError } = await supabase
      .from("connected_accounts")
      .upsert(upsertPayload, {
        onConflict: "user_id,platform"
      });

    if (upsertError) {
      return res.status(500).json({
        ok: false,
        error: `Failed to save YouTube connection: ${upsertError.message}`
      });
    }

    return res.status(200).json({
      ok: true,
      message: "YouTube connected successfully.",
      channel_id: channel.id,
      channel_title: channel?.snippet?.title || null
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || "Unknown server error"
    });
  }
};
