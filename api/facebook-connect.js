import { createClient } from "@supabase/supabase-js";

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Missing Supabase server credentials." });
    }

    const authHeader = req.headers.authorization || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!jwt) {
      return res.status(401).json({ error: "Missing bearer token." });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser(jwt);

    if (userError || !user) {
      return res.status(401).json({ error: "Invalid session." });
    }

    const body = parseBody(req);
    const message = String(body.message || "").trim();
    const link = String(body.link || "").trim();
    const imageUrl = String(body.imageUrl || "").trim();
    const postId = body.postId || null;

    if (!message && !link && !imageUrl) {
      return res.status(400).json({ error: "Nothing to publish." });
    }

    const { data: account, error: accountError } = await supabase
      .from("connected_accounts")
      .select("*")
      .eq("user_id", user.id)
      .eq("platform", "facebook")
      .eq("status", "connected")
      .maybeSingle();

    if (accountError || !account) {
      return res.status(400).json({ error: "Facebook account is not connected." });
    }

    const pageId = account.page_id || account.external_page_id;
    const pageToken = account.page_token;

    if (!pageId || !pageToken) {
      return res.status(400).json({ error: "No Facebook Page is linked for publishing." });
    }

    let fbResponse;
    let endpoint;
    let payload;

    if (imageUrl) {
      endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(pageId)}/photos`;
      payload = new URLSearchParams({
        url: imageUrl,
        caption: message || "",
        access_token: pageToken
      });

      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: payload.toString()
      });
      fbResponse = await r.json();

      if (!r.ok || fbResponse.error) {
        await supabase.from("publish_jobs").insert({
          user_id: user.id,
          platform: "facebook",
          post_id: postId,
          status: "failed",
          request_payload: { message, link, imageUrl, pageId },
          response_payload: fbResponse,
          error_message: fbResponse?.error?.message || "Facebook photo publish failed."
        });

        return res.status(400).json({
          error: fbResponse?.error?.message || "Facebook photo publish failed.",
          raw: fbResponse
        });
      }
    } else {
      endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(pageId)}/feed`;
      payload = new URLSearchParams({
        message: message || "",
        access_token: pageToken
      });

      if (link) payload.append("link", link);

      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: payload.toString()
      });
      fbResponse = await r.json();

      if (!r.ok || fbResponse.error) {
        await supabase.from("publish_jobs").insert({
          user_id: user.id,
          platform: "facebook",
          post_id: postId,
          status: "failed",
          request_payload: { message, link, imageUrl, pageId },
          response_payload: fbResponse,
          error_message: fbResponse?.error?.message || "Facebook post publish failed."
        });

        return res.status(400).json({
          error: fbResponse?.error?.message || "Facebook post publish failed.",
          raw: fbResponse
        });
      }
    }

    await supabase.from("publish_jobs").insert({
      user_id: user.id,
      platform: "facebook",
      post_id: postId,
      status: "success",
      external_post_id: fbResponse.id || null,
      request_payload: { message, link, imageUrl, pageId },
      response_payload: fbResponse
    });

    return res.status(200).json({
      success: true,
      platform: "facebook",
      page_id: pageId,
      external_post_id: fbResponse.id || null,
      raw: fbResponse
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown server error."
    });
  }
}
