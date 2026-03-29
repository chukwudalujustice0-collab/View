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
    const supabase = createClient(
      process.env.SUPABASE_URL_VALUE,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { code, user_id } = req.method === "POST" ? req.body : req.query;

    if (!code) {
      return res.status(400).json({ ok: false, error: "Missing authorization code" });
    }

    if (!user_id) {
      return res.status(400).json({ ok: false, error: "Missing user_id" });
    }

    const body = new URLSearchParams();
    body.set("client_id", process.env.GOOGLE_CLIENT_ID);
    body.set("client_secret", process.env.GOOGLE_CLIENT_SECRET);
    body.set("code", code);
    body.set("grant_type", "authorization_code");
    body.set("redirect_uri", process.env.YOUTUBE_REDIRECT_URI);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      return res.status(500).json({
        ok: false,
        step: "token_exchange",
        error: tokenData.error_description || tokenData.error || "Token exchange failed"
      });
    }

    const meRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });

    const meData = await meRes.json();

    if (!meRes.ok) {
      return res.status(500).json({
        ok: false,
        step: "channel_lookup",
        error: meData?.error?.message || "Could not fetch YouTube channel"
      });
    }

    const channel = meData?.items?.[0];
    const channelId = channel?.id || null;
    const channelName = channel?.snippet?.title || "YouTube Channel";

    const expiresAt = new Date(Date.now() + Number(tokenData.expires_in || 3600) * 1000).toISOString();

    const { data: existing } = await supabase
      .from("connected_accounts")
      .select("id")
      .eq("user_id", user_id)
      .eq("platform", "youtube")
      .maybeSingle();

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from("connected_accounts")
        .update({
          status: "connected",
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || null,
          token_type: tokenData.token_type || "Bearer",
          token_expires_at: expiresAt,
          account_name: channelName,
          external_user_id: channelId,
          last_error: null,
          last_synced_at: new Date().toISOString()
        })
        .eq("id", existing.id);

      if (updateError) {
        return res.status(500).json({ ok: false, error: updateError.message });
      }
    } else {
      const { error: insertError } = await supabase
        .from("connected_accounts")
        .insert({
          user_id,
          platform: "youtube",
          status: "connected",
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || null,
          token_type: tokenData.token_type || "Bearer",
          token_expires_at: expiresAt,
          account_name: channelName,
          external_user_id: channelId,
          last_error: null,
          last_synced_at: new Date().toISOString()
        });

      if (insertError) {
        return res.status(500).json({ ok: false, error: insertError.message });
      }
    }

    return res.status(200).json({
      ok: true,
      platform: "youtube",
      channel_id: channelId,
      channel_name: channelName
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Unknown error"
    });
  }
};
