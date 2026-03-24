// Facebook Connect Edge Function (Supabase)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Get secrets from Supabase
const FACEBOOK_APP_ID = Deno.env.get("FACEBOOK_APP_ID")!;
const FACEBOOK_APP_SECRET = Deno.env.get("FACEBOOK_APP_SECRET")!;

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");

    // Step 1: Redirect user to Facebook login
    if (!code) {
      const redirectUri = "http://localhost:8080/connected-accounts.html";

      const facebookLoginUrl =
        `https://www.facebook.com/v19.0/dialog/oauth?` +
        `client_id=${FACEBOOK_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=public_profile,email,pages_manage_posts,pages_read_engagement` +
        `&response_type=code`;

      return Response.redirect(facebookLoginUrl);
    }

    // Step 2: Exchange code for access token
    const redirectUri = "http://localhost:8080/connected-accounts.html";

    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
        `client_id=${FACEBOOK_APP_ID}` +
        `&client_secret=${FACEBOOK_APP_SECRET}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&code=${code}`
    );

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return new Response(
        JSON.stringify({ error: "Failed to get access token", details: tokenData }),
        { status: 400 }
      );
    }

    const accessToken = tokenData.access_token;

    // Step 3: Get user profile
    const userRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
    );

    const userData = await userRes.json();

    return new Response(
      JSON.stringify({
        success: true,
        user: userData,
        access_token: accessToken,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    );
  }
});
