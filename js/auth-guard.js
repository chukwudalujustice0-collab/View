const SUPABASE_URL = "https://ezarjrxzkqqsbyirxttg.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6YXJqcnh6a3Fxc2J5aXJ4dHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzAzODcsImV4cCI6MjA4OTg0NjM4N30.ERyM_zVPU5jUx9ROrbLnY-jYsHzCD8O0lzAeuzEr0oI";

if (!window.supabase) {
  throw new Error("Supabase JS is required before loading auth-guard.js");
}

window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce"
  }
});

const supabase = window.supabaseClient;

window.currentUser = window.currentUser || null;
window.currentProfile = window.currentProfile || null;

function setAuthLoading(isLoading) {
  document.documentElement.classList.toggle("auth-loading", !!isLoading);
  document.body.classList.toggle("auth-loading", !!isLoading);
}

function safeText(value, fallback = "") {
  return value == null || value === "" ? fallback : String(value);
}

function applyUserBindings(user, profile) {
  const fullName =
    profile?.full_name ||
    profile?.username ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    "User";

  const username =
    profile?.username ||
    user?.user_metadata?.username ||
    (user?.email ? user.email.split("@")[0] : "user");

  const email = user?.email || "—";
  const avatar =
    profile?.avatar_url ||
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture ||
    "";

  document.querySelectorAll("[data-user-name]").forEach((el) => {
    el.textContent = fullName;
  });

  document.querySelectorAll("[data-user-username]").forEach((el) => {
    el.textContent = username;
  });

  document.querySelectorAll("[data-user-email]").forEach((el) => {
    el.textContent = email;
  });

  document.querySelectorAll("[data-user-avatar]").forEach((el) => {
    if (el.tagName === "IMG") {
      if (avatar) {
        el.src = avatar;
        el.alt = `${fullName} avatar`;
      }
    } else {
      if (avatar) {
        el.style.backgroundImage = `url("${avatar}")`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
      }
    }
  });
}

async function fetchProfile(userId) {
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Profile load failed:", error.message);
    return null;
  }

  return data || null;
}

function buildLoginRedirect(nextPage = "") {
  const target =
    nextPage ||
    window.location.pathname.split("/").pop() ||
    "home.html";

  return `/login.html?next=${encodeURIComponent(target)}`;
}

async function loadUserGlobals(session) {
  const user = session?.user || null;

  window.currentUser = user;
  window.currentProfile = user ? await fetchProfile(user.id) : null;

  applyUserBindings(window.currentUser, window.currentProfile);

  return {
    user: window.currentUser,
    profile: window.currentProfile
  };
}

async function requireSession(nextPage = "") {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error("Session check failed:", error.message);
  }

  const session = data?.session || null;

  if (!session) {
    window.currentUser = null;
    window.currentProfile = null;
    window.location.href = buildLoginRedirect(nextPage);
    return null;
  }

  return session;
}

async function protectPage(nextPage = "") {
  setAuthLoading(true);

  try {
    const session = await requireSession(nextPage);
    if (!session) return null;

    const result = await loadUserGlobals(session);
    setAuthLoading(false);
    return result;
  } catch (error) {
    console.error("protectPage failed:", error);
    window.location.href = buildLoginRedirect(nextPage);
    return null;
  }
}

async function initAuth(nextPage = "") {
  return await protectPage(nextPage);
}

supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === "SIGNED_OUT" || !session) {
    window.currentUser = null;
    window.currentProfile = null;

    const isPublicPage = ["/login.html", "/signup.html", "/index.html"].some((page) =>
      window.location.pathname.endsWith(page)
    );

    if (!isPublicPage) {
      window.location.href = buildLoginRedirect(
        window.location.pathname.split("/").pop() || "home.html"
      );
    }
    return;
  }

  if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
    await loadUserGlobals(session);
  }
});

window.initAuth = initAuth;
window.protectPage = protectPage;
window.loadUserGlobals = loadUserGlobals;
window.applyUserBindings = applyUserBindings;
