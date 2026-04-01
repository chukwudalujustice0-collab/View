export default async function handler(req, res) {
  try {
    const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_ID;
    const TIKTOK_REDIRECT_URI =
      req.query.redirect_uri ||
      process.env.TIKTOK_REDIRECT_URI ||
      "https://view.ceetice.com/tiktok-connect.html";

    if (!TIKTOK_CLIENT_KEY) {
      return res.status(500).json({
        error: "Missing TikTok client key",
        message: "Set TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_ID in your environment variables."
      });
    }

    const state =
      "view_" +
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);

    const scopes = [
      "user.info.basic",
      "video.publish"
    ].join(",");

    const authUrl =
      "https://www.tiktok.com/v2/auth/authorize/?" +
      new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        scope: scopes,
        response_type: "code",
        redirect_uri: TIKTOK_REDIRECT_URI,
        state
      }).toString();

    return res.status(200).json({
      ok: true,
      url: authUrl,
      state,
      redirect_uri: TIKTOK_REDIRECT_URI
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to build TikTok auth URL",
      message: error.message
    });
  }
}
