import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const facebookAppId = Deno.env.get("FACEBOOK_APP_ID")!;
    const facebookAppSecret = Deno.env.get("FACEBOOK_APP_SECRET")!;
    const callbackUrl = Deno.env.get("FACEBOOK_CALLBACK_URL")!;

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errorReason = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    const fallbackRedirect = "https://view.ceetice.com/facebook-connect.html";

    if (errorReason) {
      return Response.redirect(
        `${fallbackRedirect}?status=error&message=${encodeURIComponent(errorDescription || "Facebook denied access")}`,
        302
      );
    }

    if (!code || !state) {
      return Response.redirect(
        `${fallbackRedirect}?status=error&message=${encodeURIComponent("Missing code or state")}`,
        302
      );
    }

    let parsedState: { user_id: string; redirect_to: string; ts: number };
    try {
      parsedState = JSON.parse(atob(state));
    } catch {
      return Response.redirect(
        `${fallbackRedirect}?status=error&message=${encodeURIComponent("Invalid state")}`,
        302
      );
    }

    const userId = parsedState.user_id;
    const redirectTo = parsedState.redirect_to || fallbackRedirect;

    if (!userId) {
      return Response.redirect(
        `${redirectTo}?status=error&message=${encodeURIComponent("Missing user id in state")}`,
        302
      );
    }

    const tokenParams = new URLSearchParams({
      client_id: facebookAppId,
      client_secret: facebookAppSecret,
      redirect_uri: callbackUrl,
      code,
    });

    const tokenRes = await fetch(`https://graph.facebook.com/v23.0/oauth/access_token?${tokenParams.toString()}`);
    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok || !tokenJson.access_token) {
      return Response.redirect(
        `${redirectTo}?status=error&message=${encodeURIComponent(tokenJson?.error?.message || "Failed to get access token")}`,
        302
      );
    }

    const shortToken = tokenJson.access_token;

    const longTokenParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: facebookAppId,
      client_secret: facebookAppSecret,
      fb_exchange_token: shortToken,
    });

    const longTokenRes = await fetch(`https://graph.facebook.com/v23.0/oauth/access_token?${longTokenParams.toString()}`);
    const longTokenJson = await longTokenRes.json();

    const finalToken = longTokenJson?.access_token || shortToken;
    const expiresIn = longTokenJson?.expires_in || tokenJson?.expires_in || null;

    const meParams = new URLSearchParams({
      fields: "id,name,email,picture.type(large)",
      access_token: finalToken,
    });

    const meRes = await fetch(`https://graph.facebook.com/me?${meParams.toString()}`);
    const meJson = await meRes.json();

    if (!meRes.ok || !meJson?.id) {
      return Response.redirect(
        `${redirectTo}?status=error&message=${encodeURIComponent(meJson?.error?.message || "Failed to fetch profile")}`,
        302
      );
    }

    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString()
      : null;

    const accountName = meJson?.name || null;
    const accountHandle = meJson?.email || null;
    const externalUserId = meJson?.id || null;
    const avatarUrl = meJson?.picture?.data?.url || null;
    const scope = "public_profile,email";

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const existingRes = await admin
      .from("connected_accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("platform", "facebook")
      .order("updated_at", { ascending: false })
      .limit(1);

    const existingRows = existingRes.data || [];
    const keepId = existingRows[0]?.id || null;

    if (existingRows.length > 1) {
      const deleteIds = existingRows.slice(1).map(row => row.id);
      if (deleteIds.length) {
        await admin
          .from("connected_accounts")
          .delete()
          .in("id", deleteIds);
      }
    }

    const payload = {
      user_id: userId,
      platform: "facebook",
      account_name: accountName,
      account_handle: accountHandle,
      status: "connected",
      access_token: finalToken,
      refresh_token: null,
      token_expires_at: tokenExpiresAt,
      external_user_id: externalUserId,
      external_page_id: null,
      avatar_url: avatarUrl,
      token_type: "Bearer",
      scope,
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    };

    let saveError = null;

    if (keepId) {
      const { error } = await admin
        .from("connected_accounts")
        .update(payload)
        .eq("id", keepId);

      saveError = error;
    } else {
      const { error } = await admin
        .from("connected_accounts")
        .insert({
          ...payload,
          created_at: new Date().toISOString(),
        });

      saveError = error;
    }

    if (saveError) {
      return Response.redirect(
        `${redirectTo}?status=error&message=${encodeURIComponent(saveError.message || "Failed to save connection")}`,
        302
      );
    }

    return Response.redirect(
      `${redirectTo}?status=success&message=${encodeURIComponent("Facebook connected successfully")}`,
      302
    );
  } catch (error) {
    return Response.redirect(
      `https://view.ceetice.com/facebook-connect.html?status=error&message=${encodeURIComponent(error.message || "Unexpected callback error")}`,
      302
    );
  }
});
