export default async function handler(req, res) {
  try {
    const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
    const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL_VALUE;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ error: "Missing environment variables." });
    }

    const code = req.query.code;
    const redirectUri = req.query.redirect_uri;

    if (!code || !redirectUri) {
      return res.status(400).json({ error: "Missing code or redirect_uri." });
    }

    const tokenRes = await fetch(
      `https://graph.facebook.com/v20.0/oauth/access_token?client_id=${encodeURIComponent(FACEBOOK_APP_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${encodeURIComponent(FACEBOOK_APP_SECRET)}&code=${encodeURIComponent(code)}`
    );

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(400).json({
        error: tokenData?.error?.message || "Could not exchange code for token."
      });
    }

    const userAccessToken = tokenData.access_token;

    const meRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(userAccessToken)}`
    );
    const meData = await meRes.json();

    if (!meRes.ok || !meData.id) {
      return res.status(400).json({
        error: meData?.error?.message || "Could not fetch Facebook profile."
      });
    }

    const pagesRes = await fetch(
      `https://graph.facebook.com/me/accounts?access_token=${encodeURIComponent(userAccessToken)}`
    );
    const pagesData = await pagesRes.json();

    return res.status(200).json({
      success: true,
      facebook_user: meData,
      facebook_pages: pagesData?.data || [],
      access_token: userAccessToken
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error."
    });
  }
}
