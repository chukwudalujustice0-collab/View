import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const body = req.body || {};
    const userId = body.user_id || req.headers["x-view-user-id"] || null;

    if (!userId) {
      return res.status(400).json({ error: "Missing user_id" });
    }

    const { error } = await supabase
      .from("connected_accounts")
      .delete()
      .eq("user_id", userId)
      .eq("platform", "tiktok");

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Server error" });
  }
}
