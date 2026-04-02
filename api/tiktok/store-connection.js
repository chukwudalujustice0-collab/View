import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing Supabase server environment variables" });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = req.body || {};
    const userId = body.user_id || req.headers["x-view-user-id"] || null;

    if (!userId) {
      return res.status(400).json({ error: "Missing user_id" });
    }

    const payload = {
      user_id: userId,
      platform: "tiktok",
      provider: "tiktok",
      account_name: body.account_name || "",
      username: body.username || "",
      open_id: body.open_id || "",
      avatar_url: body.avatar_url || "",
      access_token: body.access_token || "",
      refresh_token: body.refresh_token || "",
      expires_at: body.expires_at || null,
      connected_at: body.connected_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("connected_accounts")
      .upsert(payload, { onConflict: "user_id,platform" })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ ok: true, data });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
