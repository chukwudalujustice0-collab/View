export default async function handler(req, res) {
  try {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI;

    const state = Math.random().toString(36).substring(2);

    const url = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&response_type=code&scope=user.info.basic&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    return res.status(200).json({ url });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to generate TikTok auth URL",
      message: error.message
    });
  }
}
