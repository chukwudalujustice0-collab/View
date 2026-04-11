const { createClient } = require("@supabase/supabase-js");
const runDueRulesHandler = require("./run-due-rules");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTO_POST_CRON_SECRET = process.env.AUTO_POST_CRON_SECRET;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const ruleId =
      req.query?.rule_id ||
      req.body?.rule_id ||
      req.query?.id ||
      req.body?.id;

    if (!ruleId) {
      return res.status(400).json({
        ok: false,
        error: "Missing rule_id"
      });
    }

    const { data: rule, error: ruleError } = await supabase
      .from("auto_post_rules")
      .select("*")
      .eq("id", ruleId)
      .single();

    if (ruleError || !rule) {
      return res.status(404).json({
        ok: false,
        error: "Rule not found"
      });
    }

    const fakeReq = {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTO_POST_CRON_SECRET || ""}`,
        "x-force-rule-id": String(ruleId)
      },
      query: { rule_id: String(ruleId) },
      body: { rule_id: String(ruleId), force: true }
    };

    const captured = {
      statusCode: 200,
      body: null
    };

    const fakeRes = {
      status(code) {
        captured.statusCode = code;
        return this;
      },
      json(payload) {
        captured.body = payload;
        return this;
      }
    };

    await runDueRulesHandler(fakeReq, fakeRes);

    return res.status(captured.statusCode || 200).json({
      ok: captured.statusCode >= 200 && captured.statusCode < 300,
      triggered_rule_id: ruleId,
      result: captured.body
    });
  } catch (error) {
    console.error("test-run-rule fatal error:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Internal server error"
    });
  }
};

function isAuthorized(req) {
  const authHeader = req.headers.authorization || "";
  const xCronSecret = req.headers["x-cron-secret"] || "";

  if (!AUTO_POST_CRON_SECRET) return true;
  if (xCronSecret && xCronSecret === AUTO_POST_CRON_SECRET) return true;
  if (authHeader === AUTO_POST_CRON_SECRET) return true;

  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim() === AUTO_POST_CRON_SECRET;
  }

  return false;
}
