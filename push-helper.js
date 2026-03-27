const VIEW_PUSH_CONFIG = {
  SUPABASE_URL: "https://ezarjrxzkqqsbyirxttg.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6YXJqcnh6a3Fxc2J5aXJ4dHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzAzODcsImV4cCI6MjA4OTg0NjM4N30.ERyM_zVPU5jUx9ROrbLnY-jYsHzCD8O0lzAeuzEr0oI",
  VAPID_PUBLIC_KEY: "BCXhu5fvFT6k4ukbLKxcFybuhRom6XV3ZXv35uysrK00AaDneBctaY7WeSkEb_DJSfxJ6uCamC2RARgD-vEYbgo",
  SERVICE_WORKER_PATH: "/service-worker.js"
};

(function attachViewPushHelper(global) {
  function ensureSupabaseClient() {
    if (!global.supabase || typeof global.supabase.createClient !== "function") {
      throw new Error("Supabase JS client is not loaded.");
    }

    return global.supabase.createClient(
      VIEW_PUSH_CONFIG.SUPABASE_URL,
      VIEW_PUSH_CONFIG.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );
  }

  function base64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; i += 1) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  }

  async function getSessionWithRetry(supabaseClient, maxWaitMs = 3000) {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (data.session?.user) return data.session;
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return null;
  }

  async function ensureServiceWorkerRegistered() {
    if (!("serviceWorker" in navigator)) {
      throw new Error("Service workers are not supported on this device.");
    }

    const registration = await navigator.serviceWorker.register(
      VIEW_PUSH_CONFIG.SERVICE_WORKER_PATH
    );

    await navigator.serviceWorker.ready;
    return registration;
  }

  async function ensureNotificationPermission() {
    if (!("Notification" in window)) {
      throw new Error("Notifications are not supported on this device.");
    }

    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") {
      throw new Error("Notification permission was denied. Please enable it in browser settings.");
    }

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      throw new Error("Notification permission was not granted.");
    }

    return permission;
  }

  async function getOrCreatePushSubscription(registration) {
    if (!("PushManager" in window)) {
      throw new Error("Push notifications are not supported on this device.");
    }

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8Array(VIEW_PUSH_CONFIG.VAPID_PUBLIC_KEY)
      });
    }

    return subscription;
  }

  async function saveSubscriptionToSupabase({ supabaseClient, userId, subscription }) {
    const endpoint = subscription.endpoint;
    const subscriptionJson = subscription.toJSON();

    const rpcPayload = {
      p_endpoint: endpoint,
      p_subscription: subscriptionJson,
      p_user_agent: navigator.userAgent || null,
      p_device_label: "Web Push Device"
    };

    const { data, error } = await supabaseClient.rpc("upsert_push_subscription", rpcPayload);

    if (error) {
      const fallback = await supabaseClient
        .from("push_subscriptions")
        .upsert({
          user_id: userId,
          endpoint,
          subscription: subscriptionJson,
          user_agent: navigator.userAgent || null,
          device_label: "Web Push Device",
          updated_at: new Date().toISOString()
        }, { onConflict: "endpoint" });

      if (fallback.error) {
        throw fallback.error;
      }

      return fallback.data || null;
    }

    return data;
  }

  async function initPushRegistration(options = {}) {
    const supabaseClient = ensureSupabaseClient();
    const session = await getSessionWithRetry(supabaseClient);

    if (!session?.user) {
      throw new Error("You must be logged in before enabling notifications.");
    }

    const permission = await ensureNotificationPermission();
    if (permission !== "granted") {
      throw new Error("Notification permission not granted.");
    }

    const registration = await ensureServiceWorkerRegistered();
    const subscription = await getOrCreatePushSubscription(registration);

    await saveSubscriptionToSupabase({
      supabaseClient,
      userId: session.user.id,
      subscription
    });

    return {
      ok: true,
      user: session.user,
      registration,
      subscription
    };
  }

  async function checkPushStatus() {
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        return {
          supported: false,
          permission: "unsupported",
          subscribed: false
        };
      }

      const registration = await navigator.serviceWorker.getRegistration(VIEW_PUSH_CONFIG.SERVICE_WORKER_PATH);
      if (!registration) {
        return {
          supported: true,
          permission: Notification.permission,
          subscribed: false
        };
      }

      const subscription = await registration.pushManager.getSubscription();

      return {
        supported: true,
        permission: Notification.permission,
        subscribed: !!subscription,
        subscription
      };
    } catch {
      return {
        supported: true,
        permission: Notification.permission || "default",
        subscribed: false
      };
    }
  }

  async function unsubscribePush() {
    if (!("serviceWorker" in navigator)) return { ok: false };

    const supabaseClient = ensureSupabaseClient();
    const session = await getSessionWithRetry(supabaseClient);
    const registration = await navigator.serviceWorker.getRegistration(VIEW_PUSH_CONFIG.SERVICE_WORKER_PATH);

    if (!registration) return { ok: true };

    const subscription = await registration.pushManager.getSubscription();

    if (!subscription) return { ok: true };

    const endpoint = subscription.endpoint;

    await subscription.unsubscribe();

    if (session?.user) {
      await supabaseClient
        .from("push_subscriptions")
        .delete()
        .eq("user_id", session.user.id)
        .eq("endpoint", endpoint);
    }

    return { ok: true };
  }

  async function showLocalSystemNotification(payload = {}) {
    const registration = await ensureServiceWorkerRegistered();

    if (Notification.permission !== "granted") {
      throw new Error("Notification permission is not granted.");
    }

    await registration.showNotification(payload.title || "View", {
      body: payload.body || "You have a new notification.",
      icon: payload.icon || "/icon-192x192.png",
      badge: payload.badge || "/icon-192x192.png",
      data: payload.data || { url: "/notifications.html" },
      tag: payload.tag || "view-local-notification",
      renotify: true
    });

    return { ok: true };
  }

  global.ViewPushHelper = {
    config: VIEW_PUSH_CONFIG,
    initPushRegistration,
    checkPushStatus,
    unsubscribePush,
    showLocalSystemNotification
  };
})(window);
