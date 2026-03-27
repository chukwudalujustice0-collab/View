const VIEW_PUSH = (() => {
  const SUPABASE_URL = "https://ezarjrxzkqqsbyirxttg.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6YXJqcnh6a3Fxc2J5aXJ4dHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzAzODcsImV4cCI6MjA4OTg0NjM4N30.ERyM_zVPU5jUx9ROrbLnY-jYsHzCD8O0lzAeuzEr0oI";

  const VAPID_PUBLIC_KEY = "BCXhu5fvFT6k4ukbLKxcFybuhRom6XV3ZXv35uysrK00AaDneBctaY7WeSkEb_DJSfxJ6uCamC2RARgD-vEYbgo";

  const STORAGE_KEYS = {
    PROMPTED: "view_push_prompted",
    ENABLED: "view_push_enabled",
    LAST_SUB_ENDPOINT: "view_push_last_endpoint"
  };

  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  async function getCurrentUser() {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    return data.session?.user || null;
  }

  async function ensureNotificationSettingsRow(userId) {
    if (!userId) return;

    const { error } = await supabaseClient
      .from("notification_settings")
      .upsert({
        user_id: userId,
        allow_push: true,
        allow_chat: true,
        allow_posts: true,
        allow_follows: true,
        allow_calls: true
      }, { onConflict: "user_id" });

    if (error) {
      console.warn("Could not ensure notification settings row:", error.message);
    }
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return null;
    }

    const reg = await navigator.serviceWorker.register("/service-worker.js");

    if (reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          window.location.reload();
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });

    return reg;
  }

  async function getExistingSubscription() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function saveSubscription(subscription) {
    const user = await getCurrentUser();
    if (!user || !subscription) return { ok: false, reason: "no-user-or-subscription" };

    const json = subscription.toJSON();
    if (!json?.endpoint || !json?.keys?.p256dh || !json?.keys?.auth) {
      return { ok: false, reason: "invalid-subscription" };
    }

    await ensureNotificationSettingsRow(user.id);

    const payload = {
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
      platform: navigator.platform || "web",
      is_active: true
    };

    const { error } = await supabaseClient
      .from("push_subscriptions")
      .upsert(payload, { onConflict: "endpoint" });

    if (error) throw error;

    localStorage.setItem(STORAGE_KEYS.ENABLED, "true");
    localStorage.setItem(STORAGE_KEYS.LAST_SUB_ENDPOINT, json.endpoint);

    return { ok: true, endpoint: json.endpoint };
  }

  async function subscribeUser() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return { ok: false, reason: "unsupported" };
    }

    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();

    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    return saveSubscription(subscription);
  }

  async function unsubscribeUser() {
    try {
      const user = await getCurrentUser();
      const sub = await getExistingSubscription();

      if (sub) {
        const json = sub.toJSON();
        await sub.unsubscribe();

        if (json?.endpoint) {
          await supabaseClient
            .from("push_subscriptions")
            .update({ is_active: false })
            .eq("endpoint", json.endpoint);
        }
      }

      if (user?.id) {
        await supabaseClient
          .from("notification_settings")
          .update({ allow_push: false })
          .eq("user_id", user.id);
      }

      localStorage.removeItem(STORAGE_KEYS.ENABLED);
      localStorage.removeItem(STORAGE_KEYS.LAST_SUB_ENDPOINT);

      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function requestPermissionAndSubscribe() {
    if (!("Notification" in window)) {
      return { ok: false, reason: "unsupported" };
    }

    if (Notification.permission === "granted") {
      return subscribeUser();
    }

    if (Notification.permission === "denied") {
      return { ok: false, reason: "denied" };
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { ok: false, reason: permission };
    }

    return subscribeUser();
  }

  async function syncExistingSubscription() {
    try {
      if (Notification.permission !== "granted") return { ok: false, reason: "not-granted" };

      const subscription = await getExistingSubscription();
      if (!subscription) return { ok: false, reason: "no-existing-subscription" };

      return saveSubscription(subscription);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function autoSetupPush(options = {}) {
    const {
      promptOnFirstLoad = true,
      requireUserGesture = false,
      delayMs = 1200
    } = options;

    await registerServiceWorker();

    const user = await getCurrentUser();
    if (!user) {
      return { ok: false, reason: "no-user" };
    }

    await ensureNotificationSettingsRow(user.id);

    if (Notification.permission === "granted") {
      return syncExistingSubscription();
    }

    if (Notification.permission === "denied") {
      return { ok: false, reason: "denied" };
    }

    const alreadyPrompted = localStorage.getItem(STORAGE_KEYS.PROMPTED) === "true";
    if (alreadyPrompted || !promptOnFirstLoad) {
      return { ok: false, reason: "prompt-skipped" };
    }

    localStorage.setItem(STORAGE_KEYS.PROMPTED, "true");

    if (requireUserGesture) {
      return { ok: false, reason: "gesture-required" };
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));
    return requestPermissionAndSubscribe();
  }

  async function enablePushFromButton() {
    try {
      await registerServiceWorker();
      const result = await requestPermissionAndSubscribe();

      if (result.ok) {
        const user = await getCurrentUser();
        if (user?.id) {
          await supabaseClient
            .from("notification_settings")
            .update({ allow_push: true })
            .eq("user_id", user.id);
        }
      }

      return result;
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function getPermissionState() {
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
  }

  async function getSubscriptionState() {
    const sub = await getExistingSubscription();
    return !!sub;
  }

  async function markNotificationRead(notificationId) {
    if (!notificationId) return { ok: false, reason: "missing-id" };

    const { error } = await supabaseClient
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId);

    if (error) throw error;
    return { ok: true };
  }

  async function markAllNotificationsRead() {
    const user = await getCurrentUser();
    if (!user) return { ok: false, reason: "no-user" };

    const { error } = await supabaseClient
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false);

    if (error) throw error;
    return { ok: true };
  }

  async function getUnreadNotificationsCount() {
    const user = await getCurrentUser();
    if (!user) return 0;

    const { count, error } = await supabaseClient
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_read", false);

    if (error) {
      console.warn("Could not get unread count:", error.message);
      return 0;
    }

    return count || 0;
  }

  function listenForRealtimeNotifications(onInsert) {
    getCurrentUser().then((user) => {
      if (!user) return;

      supabaseClient
        .channel("view-live-notifications-" + user.id)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`
        }, (payload) => {
          if (typeof onInsert === "function") {
            onInsert(payload.new);
          }
        })
        .subscribe();
    });
  }

  function attachEnableButton(buttonSelector, onSuccess, onError) {
    const btn = document.querySelector(buttonSelector);
    if (!btn) return;

    btn.addEventListener("click", async () => {
      try {
        const result = await enablePushFromButton();
        if (result.ok) {
          if (typeof onSuccess === "function") onSuccess(result);
        } else {
          if (typeof onError === "function") onError(result);
        }
      } catch (error) {
        if (typeof onError === "function") onError({ ok: false, error: error.message });
      }
    });
  }

  return {
    supabaseClient,
    registerServiceWorker,
    getExistingSubscription,
    saveSubscription,
    subscribeUser,
    unsubscribeUser,
    requestPermissionAndSubscribe,
    syncExistingSubscription,
    autoSetupPush,
    enablePushFromButton,
    getPermissionState,
    getSubscriptionState,
    markNotificationRead,
    markAllNotificationsRead,
    getUnreadNotificationsCount,
    listenForRealtimeNotifications,
    attachEnableButton
  };
})();

window.VIEW_PUSH = VIEW_PUSH;
