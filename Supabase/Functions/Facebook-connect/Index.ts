import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const facebookAppId = Deno.env.get("FACEBOOK_APP_ID");
    const callbackUrl = Deno.env.get("FACEBOOK_CALLBACK_URL");

    if (!supabaseUrl || !supabaseAnonKey || !facebookAppId || !callbackUrl) {
      return new Response(
        JSON.stringify({
          error: "Missing required environment variables",
          missing: {
            SUPABASE_URL: !supabaseUrl,
            SUPABASE_ANON_KEY: !supabaseAnonKey,
            FACEBOOK_APP_ID: !facebookAppId,
            FACEBOOK_CALLBACK_URL: !callbackUrl,
          },
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized user" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const body = await req.json().catch(() => ({}));
    const redirect_to =
      body?.redirect_to ||
      `${new URL(req.url).origin.replace(".supabase.co", "")}/facebook-connect.html`;

    const statePayload = {
      user_id: user.id,
      redirect_to,
      ts: Date.now(),
    };

    const state = btoa(JSON.stringify(statePayload));

    const params = new URLSearchParams({
      client_id: facebookAppId,
      redirect_uri: callbackUrl,
      response_type: "code",
      state,
      scope: "public_profile,email",
    });

    const auth_url = `https://www.facebook.com/v23.0/dialog/oauth?${params.toString()}`;

    return new Response(JSON.stringify({ auth_url }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unexpected error",
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});
