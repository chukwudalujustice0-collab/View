function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return "";
  return auth.slice(7).trim();
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function getSupabaseUser(SUPABASE_URL, token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: token
    }
  });

  const data = await r.json();
  return { ok: r.ok, data };
}

async function selectConnectedAccount(SUPABASE_URL, SERVICE_KEY, userId) {
  const url =
    `${SUPABASE_URL}/rest/v1/connected_accounts` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&platform=eq.facebook` +
    `&status=eq.connected` +
    `&select=*` +
    `&limit=1`;

  const r = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`
    }
  });

  const data = await r.json();
  return { ok: r.ok, data };
}

async function insertPublishLog(SUPABASE_URL, SERVICE_KEY, payload) {
  await fetch(`${SUPABASE_URL}/rest/v1/publish_jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`
    },
    body: JSON.stringify(payload)
  });
}

async function fbPost(url, params) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params).toString()
  });

  const data = await r.json();
  return { ok: r.ok, data };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(res, 500, { error: "Missing Supabase environment variables" });
    }

    const token = getBearerToken(req);
    if (!token) {
      return json(res, 401, { error: "Missing bearer token" });
    }

    const userResult = await getSupabaseUser(SUPABASE_URL, token);
    if (!userResult.ok || !userResult.data?.id) {
      return json(res, 401, { error: "Invalid session" });
    }

    const userId = userResult.data.id;
    const body = await parseBody(req);

    const message = String(body.message || "").trim();
    const imageUrl = String(body.imageUrl || "").trim();
    const link = String(body.link || "").trim();
    const postId = body.postId || null;

    if (!message && !imageUrl && !link) {
      return json(res, 400, { error: "Nothing to publish" });
    }

    const accountResult = await selectConnectedAccount(SUPABASE_URL, SERVICE_KEY, userId);
    if (!accountResult.ok || !Array.isArray(accountResult.data) || !accountResult.data.length) {
      return json(res, 400, { error: "Facebook account is not connected" });
    }

    const account = accountResult.data[0];
    const pageId = account.page_id || account.external_page_id;
    const pageToken = account.page_token;

    if (!pageId || !pageToken) {
      return json(res, 400, { error: "Missing Facebook page_id or page_token" });
    }

    let fbResult;

    if (imageUrl) {
      fbResult = await fbPost(
        `https://graph.facebook.com/v20.0/${encodeURIComponent(pageId)}/photos`,
        {
          url: imageUrl,
          caption: message || "",
          access_token: pageToken
        }
      );
    } else {
      const params = {
        message: message || "",
        access_token: pageToken
      };

      if (link) params.link = link;

      fbResult = await fbPost(
        `https://graph.facebook.com/v20.0/${encodeURIComponent(pageId)}/feed`,
        params
      );
    }

    if (!fbResult.ok || fbResult.data?.error) {
      await insertPublishLog(SUPABASE_URL, SERVICE_KEY, {
        user_id: userId,
        platform: "facebook",
        post_id: postId,
        status: "failed",
        external_post_id: null,
        request_payload: { message, imageUrl, link, pageId },
        response_payload: fbResult.data,
        error_message: fbResult.data?.error?.message || "Facebook publish failed",
        updated_at: new Date().toISOString()
      });

      return json(res, 400, {
        error: fbResult.data?.error?.message || "Facebook publish failed",
        raw: fbResult.data
      });
    }

    await insertPublishLog(SUPABASE_URL, SERVICE_KEY, {
      user_id: userId,
      platform: "facebook",
      post_id: postId,
      status: "success",
      external_post_id: fbResult.data?.id || null,
      request_payload: { message, imageUrl, link, pageId },
      response_payload: fbResult.data,
      error_message: null,
      updated_at: new Date().toISOString()
    });

    return json(res, 200, {
      success: true,
      post_id: fbResult.data?.id || null,
      raw: fbResult.data
    });
  } catch (error) {
    return json(res, 500, {
      error: error instanceof Error ? error.message : "Unknown server error"
    });
  }
}
