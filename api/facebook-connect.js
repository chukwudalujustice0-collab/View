function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

async function fbGet(url) {
  const r = await fetch(url);
  const data = await r.json();
  return { ok: r.ok, data };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const APP_ID = process.env.FACEBOOK_APP_ID;
    const APP_SECRET = process.env.FACEBOOK_APP_SECRET;

    if (!APP_ID || !APP_SECRET) {
      return json(res, 500, { error: "Missing Facebook environment variables" });
    }

    const code = req.query.code;
    const redirectUri = req.query.redirect_uri;

    if (!code || !redirectUri) {
      return json(res, 400, { error: "Missing code or redirect_uri" });
    }

    const tokenUrl =
      "https://graph.facebook.com/v20.0/oauth/access_token" +
      `?client_id=${encodeURIComponent(APP_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&client_secret=${encodeURIComponent(APP_SECRET)}` +
      `&code=${encodeURIComponent(code)}`;

    const tokenResult = await fbGet(tokenUrl);

    if (!tokenResult.ok || !tokenResult.data.access_token) {
      return json(res, 400, {
        error:
          tokenResult.data?.error?.message ||
          "Could not exchange Facebook code for access token",
        raw: tokenResult.data
      });
    }

    const userAccessToken = tokenResult.data.access_token;

    const meResult = await fbGet(
      `https://graph.facebook.com/v20.0/me?fields=id,name&access_token=${encodeURIComponent(userAccessToken)}`
    );

    if (!meResult.ok || !meResult.data.id) {
      return json(res, 400, {
        error:
          meResult.data?.error?.message ||
          "Could not fetch Facebook user profile",
        raw: meResult.data
      });
    }

    const pagesResult = await fbGet(
      `https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userAccessToken)}`
    );

    const pages = Array.isArray(pagesResult.data?.data) ? pagesResult.data.data : [];

    return json(res, 200, {
      success: true,
      access_token: userAccessToken,
      facebook_user: meResult.data,
      facebook_pages: pages
    });
  } catch (error) {
    return json(res, 500, {
      error: error instanceof Error ? error.message : "Unknown server error"
    });
  }
}
