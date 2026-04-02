export default async function handler(req, res) {
  try {
    const FRONTEND_CALLBACK =
      process.env.TIKTOK_FRONTEND_CALLBACK || "https://view.ceetice.com/tiktok-connect.html";

    const {
      code = "",
      error = "",
      error_description = "",
      state = ""
    } = req.query || {};

    if (error) {
      const failUrl =
        FRONTEND_CALLBACK +
        "?" +
        new URLSearchParams({
          error,
          message: error_description || "TikTok authorization failed"
        }).toString();

      return res.redirect(failUrl);
    }

    if (!code) {
      const failUrl =
        FRONTEND_CALLBACK +
        "?" +
        new URLSearchParams({
          error: "missing_code",
          message: "No authorization code returned from TikTok"
        }).toString();

      return res.redirect(failUrl);
    }

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI;

    if (!clientKey || !clientSecret || !redirectUri) {
      const failUrl =
        FRONTEND_CALLBACK +
        "?" +
        new URLSearchParams({
          error: "server_config_error",
          message: "TikTok server configuration is incomplete"
        }).toString();

      return res.redirect(failUrl);
    }

    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      }).toString()
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error) {
      const failUrl =
        FRONTEND_CALLBACK +
        "?" +
        new URLSearchParams({
          error: tokenData.error || "token_exchange_failed",
          message: tokenData.error_description || tokenData.message || "Could not exchange auth code"
        }).toString();

      return res.redirect(failUrl);
    }

    const accessToken = tokenData.access_token || "";
    const refreshToken = tokenData.refresh_token || "";
    const openId = tokenData.open_id || "";
    const expiresIn = tokenData.expires_in ? String(tokenData.expires_in) : "";

    let username = "";
    let displayName = "";
    let avatarUrl = "";

    if (accessToken) {
      const profileRes = await fetch(
        "https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      const profileData = await profileRes.json().catch(() => ({}));
      const user = profileData?.data?.user || {};

      username = user.username || "";
      displayName = user.display_name || "";
      avatarUrl = user.avatar_url || "";
    }

    const successUrl =
      FRONTEND_CALLBACK +
      "?" +
      new URLSearchParams({
        status: "success",
        state,
        open_id: openId,
        username,
        account_name: displayName || username || "TikTok Account",
        avatar_url: avatarUrl,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: expiresIn
      }).toString();

    return res.redirect(successUrl);
  } catch (error) {
    const FRONTEND_CALLBACK =
      process.env.TIKTOK_FRONTEND_CALLBACK || "https://view.ceetice.com/tiktok-connect.html";

    const failUrl =
      FRONTEND_CALLBACK +
      "?" +
      new URLSearchParams({
        error: "server_error",
        message: error.message || "Unexpected callback error"
      }).toString();

    return res.redirect(failUrl);
  }
}
