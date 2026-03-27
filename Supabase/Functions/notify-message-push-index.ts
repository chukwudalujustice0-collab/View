import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push";

type NotificationRow = {
  id: string;
  user_id: string;
  type: string | null;
  title: string | null;
  body: string | null;
  message: string | null;
  url: string | null;
  data: any;
  is_read: boolean | null;
  sender_id: string | null;
  conversation_id: string | null;
  group_id: string | null;
  post_id: string | null;
  created_at: string | null;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  subscription: any;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")!;
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://view.ceetice.com";
const WEBHOOK_SECRET = Deno.env.get("PUSH_WEBHOOK_SECRET") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function parseData(raw: unknown) {
  try {
    if (!raw) return {};
    if (typeof raw === "string") return JSON.parse(raw);
    return raw as Record<string, unknown>;
  } catch {
    return {};
  }
}

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function buildPayload(notification: NotificationRow) {
  const data = parseData(notification.data);
  const type = safeText(notification.type, "general");

  let url =
    safeText(notification.url) ||
    safeText((data as any).url) ||
    "/notifications.html";

  const conversationId =
    safeText((data as any).conversationId) ||
    safeText((data as any).conversation_id) ||
    safeText(notification.conversation_id);

  const userId =
    safeText((data as any).userId) ||
    safeText((data as any).user_id) ||
    "";

  const groupId =
    safeText((data as any).groupId) ||
    safeText((data as any).group_id) ||
    safeText(notification.group_id);

  if ((type.includes("message") || type.includes("chat")) && conversationId) {
    url = `/chat-room.html?id=${encodeURIComponent(conversationId)}`;
  }

  if (type.includes("group") && groupId) {
    url = `/groups.html?id=${encodeURIComponent(groupId)}`;
  }

  if (type.includes("call")) {
    const params = new URLSearchParams();
    if (conversationId) params.set("conversation_id", conversationId);
    if (userId) params.set("user_id", userId);
    url = `/calls.html${params.toString() ? `?${params.toString()}` : ""}`;
  }

  if ((type.includes("follow") || type.includes("profile")) && userId) {
    url = `/public-profile.html?id=${encodeURIComponent(userId)}`;
  }

  const title = safeText(notification.title, "View");
  const body =
    safeText(notification.body) ||
    safeText(notification.message, "You have a new notification.");

  return {
    title,
    body,
    icon: `${APP_ORIGIN}/icon-192x192.png`,
    badge: `${APP_ORIGIN}/icon-192x192.png`,
    tag: `view-${type}-${notification.id}`,
    data: {
      url: `${APP_ORIGIN}${url}`,
      notificationId: notification.id,
      conversationId,
      userId,
      groupId,
      type
    }
  };
}

async function loadSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, subscription")
    .eq("user_id", userId);

  if (error) throw error;
  return (data || []) as PushSubscriptionRow[];
}

async function removeExpiredSubscription(endpoint: string) {
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (WEBHOOK_SECRET) {
      const incoming = req.headers.get("x-webhook-secret") || "";
      if (incoming !== WEBHOOK_SECRET) {
        return json({ error: "Unauthorized" }, 401);
      }
    }

    const body = await req.json();

    const record = (body?.record || body?.new || body) as NotificationRow | undefined;
    if (!record?.id || !record?.user_id) {
      return json({ error: "Missing notification record" }, 400);
    }

    const subscriptions = await loadSubscriptions(record.user_id);
    if (!subscriptions.length) {
      return json({ success: true, sent: 0, removed: 0, reason: "No subscriptions" });
    }

    const payload = JSON.stringify(buildPayload(record));

    let sent = 0;
    let removed = 0;

    for (const row of subscriptions) {
      try {
        await webpush.sendNotification(row.subscription, payload);
        sent += 1;
      } catch (error: any) {
        const status = error?.statusCode || error?.status || 0;

        if (status === 404 || status === 410) {
          await removeExpiredSubscription(row.endpoint);
          removed += 1;
        } else {
          console.error("Push send error:", status, error?.body || error?.message || error);
        }
      }
    }

    return json({ success: true, sent, removed });
  } catch (error: any) {
    console.error("notify-message-push error:", error);
    return json({ error: error?.message || "Unexpected error" }, 500);
  }
});
