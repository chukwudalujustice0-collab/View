export default async function handler(req, res) {
  try {
    console.log("TikTok webhook event:", req.body || null);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Webhook error"
    });
  }
}
