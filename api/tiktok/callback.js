export default async function handler(req, res) {
  try {
    const {
      code = "",
      error = "",
      error_description = "",
      state = ""
    } = req.query || {};

    const FRONTEND_CALLBACK =
      process.env.TIKTOK_FRONTEND_CALLBACK ||
      "https://view.ceetice.com/tiktok-connect.html";

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

    const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_ID;
    const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
    const TIKTOK_REDIRECT_URI =
      process.env.TIKTOK_REDIRECT_URI ||
      "https://view.ceetice.com/api/tiktok/callback";

    if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
      const failUrl =
        FRONTEND_CALLBACK +
        "?" +
        new URLSearchParams({
          error: "server_config_error",
          message: "TikTok client credentials are missing on the server"
        }).toString();

      return res.redirect(failUrl);
    }

    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: TIKTOK_REDIRECT_URI
      }).toString()
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error) {
      const failUrl =
        FRONTEND_CALLBACK +
        "?" +
        new URLSearchParams({
          error: tokenData.error || "token_exchange_failed",
          message: tokenData.error_description || tokenData.message || "Could not exchange TikTok auth code"
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
        "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username",
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
        code,
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
      process.env.TIKTOK_FRONTEND_CALLBACK ||
      "https://view.ceetice.com/tiktok-connect.html";

    const failUrl =
      FRONTEND_CALLBACK +
      "?" +
      new URLSearchParams({
        error: "server_error",
        message: error.message || "Unexpected TikTok callback error"
      }).toString();

    return res.redirect(failUrl);
  }
}
