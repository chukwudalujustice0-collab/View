import { createClient } from "@supabase/supabase-js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const code = req.query.code || req.body?.code;
    const userId = req.query.state || req.body?.state;

    if (!code) {
      return res.status(400).send("Missing authorization code.");
    }

    if (!userId) {
      return res.status(400).send("Missing user ID in state.");
    }

    const supabase = createClient(
      process.env.SUPABASE_URL_VALUE,
      process.env.SUPABASE_SERVICE_KEY
    );

    const form = new URLSearchParams();
    form.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
    form.set("client_secret", process.env.GOOGLE_CLIENT_SECRET || "");
    form.set("code", code);
    form.set("grant_type", "authorization_code");
    form.set("redirect_uri", process.env.YOUTUBE_REDIRECT_URI || "");

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      return res.status(500).send(
        tokenData.error_description || tokenData.error || "Token exchange failed"
      );
    }

    const expiresAt = new Date(
      Date.now() + Number(tokenData.expires_in || 3600) * 1000
    ).toISOString();

    const basicAccountName = "YouTube Connected";
    const basicExternalId = `yt_${userId}`;

    const { data: existing, error: existingError } = await supabase
      .from("connected_accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .maybeSingle();

    if (existingError) {
      return res.status(500).send(existingError.message);
    }

    const payload = {
      platform: "youtube",
      status: "connected",
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      token_type: tokenData.token_type || "Bearer",
      token_expires_at: expiresAt,
      account_name: basicAccountName,
      external_user_id: basicExternalId,
      last_error: null,
      last_synced_at: new Date().toISOString()
    };

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from("connected_accounts")
        .update(payload)
        .eq("id", existing.id);

      if (updateError) {
        return res.status(500).send(updateError.message);
      }
    } else {
      const { error: insertError } = await supabase
        .from("connected_accounts")
        .insert({
          user_id: userId,
          ...payload
        });

      if (insertError) {
        return res.status(500).send(insertError.message);
      }
    }

    return res.redirect("https://view.ceetice.com/connected-accounts.html?youtube=connected");
  } catch (error) {
    return res.status(500).send(error.message || "Unknown error");
  }
}
