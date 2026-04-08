const SUPABASE_URL = "https://ezarjrxzkqqsbyirxttg.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6YXJqcnh6a3Fxc2J5aXJ4dHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzAzODcsImV4cCI6MjA4OTg0NjM4N30.ERyM_zVPU5jUx9ROrbLnY-jYsHzCD8O0lzAeuzEr0oI";

if (!window.supabase) {
  throw new Error("Supabase JS is required before loading auth-guard.js");
}

window.viewSupabase =
  window.viewSupabase ||
  window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce"
    }
  });

const supabase = window.viewSupabase;

window.currentUser = window.currentUser || null;
window.currentProfile = window.currentProfile || null;

function setAuthLoading(isLoading) {
  document.documentElement.classList.toggle("auth-loading", !!isLoading);
}

function applyUserBindings(user, profile) {
  const fullName =
    profile?.full_name ||
    profile?.username ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    (user?.email ? user.email.split("@")[0] : "User");

  const username =
    profile?.username ||
    user?.user_metadata?.username ||
    (user?.email ? user.email.split("@")[0] : "user");

  const email = user?.email || "";
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
    } else if (avatar) {
      el.style.backgroundImage = `url("${avatar}")`;
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
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

function buildLoginRedirect() {
  const next = encodeURIComponent(
    window.location.pathname + window.location.search + window.location.hash
  );
  return `/login.html?next=${next}`;
}

async function loadUserGlobals(user) {
  window.currentUser = user || null;
  window.currentProfile = user ? await fetchProfile(user.id) : null;

  applyUserBindings(window.currentUser, window.currentProfile);

  return {
    user: window.currentUser,
    profile: window.currentProfile
  };
}

async function protectPage() {
  setAuthLoading(true);

  try {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user) {
      window.currentUser = null;
      window.currentProfile = null;
      window.location.replace(buildLoginRedirect());
      return null;
    }

    const result = await loadUserGlobals(data.user);
    setAuthLoading(false);
    return result;
  } catch (error) {
    console.error("protectPage failed:", error);
    window.currentUser = null;
    window.currentProfile = null;
    window.location.replace(buildLoginRedirect());
    return null;
  }
}

async function initAuth() {
  return await protectPage();
}

supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === "SIGNED_OUT") {
    window.currentUser = null;
    window.currentProfile = null;

    const publicPages = ["/", "/index.html", "/login.html", "/signup.html"];
    const isPublicPage = publicPages.some((page) =>
      window.location.pathname === page || window.location.pathname.endsWith(page)
    );

    if (!isPublicPage) {
      window.location.replace(buildLoginRedirect());
    }
    return;
  }

  if (
    (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") &&
    session?.user
  ) {
    await loadUserGlobals(session.user);
  }
});

window.initAuth = initAuth;
window.protectPage = protectPage;
window.loadUserGlobals = loadUserGlobals;
window.applyUserBindings = applyUserBindings;
