export default async function handler(req, res) {
  const allowedOrigins = [
    "https://view.ceetice.com",
    "https://view-psi-lac.vercel.app"
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-view-user-id");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const redirectUri = req.query.redirect_uri || process.env.TIKTOK_REDIRECT_URI;

    if (!clientKey) {
      return res.status(500).json({ error: "Missing TIKTOK_CLIENT_KEY" });
    }

    if (!redirectUri) {
      return res.status(500).json({ error: "Missing TIKTOK_REDIRECT_URI" });
    }

    const state = "view_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const scope = "user.info.basic";

    const url =
      "https://www.tiktok.com/v2/auth/authorize/?" +
      new URLSearchParams({
        client_key: clientKey,
        response_type: "code",
        scope,
        redirect_uri: redirectUri,
        state
      }).toString();

    return res.status(200).json({ url, state });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to generate TikTok auth URL",
      message: error.message
    });
  }
}
