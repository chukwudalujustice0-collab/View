const SUPABASE_URL = "https://ezarjrxzkqqsbyirxttg.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

const state = {
  currentUser: null,
  currentFilter: "suggested",
  allProfiles: [],
  followingIds: new Set(),
  followerIds: new Set(),
  mutualIds: new Set(),
  unreadNotifications: 0
};

const el = {
  pageNotice: document.getElementById("pageNotice"),
  notificationBadge: document.getElementById("notificationBadge"),
  drawerToggleBtn: document.getElementById("drawerToggleBtn"),
  drawerCloseBtn: document.getElementById("drawerCloseBtn"),
  drawerBackdrop: document.getElementById("drawerBackdrop"),
  exploreDrawer: document.getElementById("exploreDrawer"),
  globalSearchInput: document.getElementById("globalSearchInput"),
  voiceSearchBtn: document.getElementById("voiceSearchBtn"),
  mainTabs: document.getElementById("mainTabs"),
  peopleTabs: document.getElementById("peopleTabs"),
  peopleGrid: document.getElementById("peopleGrid"),
  statusStrip: document.getElementById("statusStrip"),
  statusLoadingCards: document.getElementById("statusLoadingCards"),
  heroProfilesCount: document.getElementById("heroProfilesCount"),
  heroOnlineCount: document.getElementById("heroOnlineCount"),
  heroSuggestedCount: document.getElementById("heroSuggestedCount")
};

function showNotice(message, type = "info") {
  if (!el.pageNotice) return;
  el.pageNotice.textContent = message || "";
  el.pageNotice.className = `page-notice show ${type}`;
}

function clearNotice() {
  if (!el.pageNotice) return;
  el.pageNotice.textContent = "";
  el.pageNotice.className = "page-notice";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function getProfileName(profile) {
  return (
    safeText(profile.full_name) ||
    safeText(profile.username) ||
    safeText(profile.email, "User")
  );
}

function getProfileHandle(profile) {
  if (safeText(profile.username)) return `@${profile.username}`;
  if (safeText(profile.email)) return profile.email;
  return "View user";
}

function getProfileAvatar(profile) {
  return safeText(profile.avatar_url) || safeText(profile.avatar_path);
}

function getInitials(name) {
  const clean = safeText(name, "U").split(/\s+/).filter(Boolean);
  if (!clean.length) return "U";
  if (clean.length === 1) return clean[0].slice(0, 1).toUpperCase();
  return `${clean[0][0]}${clean[1][0]}`.toUpperCase();
}

function formatCount(value) {
  const num = Number(value || 0);
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}m`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return `${num}`;
}

function formatTimeAgo(value) {
  if (!value) return "now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function getStatusText(status) {
  return (
    safeText(status.text_content) ||
    safeText(status.content) ||
    (safeText(status.status_type) === "image" ? "Photo update" : "View status")
  );
}

function getStatusMedia(status) {
  return safeText(status.thumbnail_url) || safeText(status.media_url) || safeText(status.media_path);
}

function isProfileOnline(profile) {
  if (profile.is_online === true) return true;

  const lastSeen = profile.last_seen_at || profile.last_seen;
  if (!lastSeen) return false;

  const time = new Date(lastSeen).getTime();
  if (Number.isNaN(time)) return false;

  return Date.now() - time <= 5 * 60 * 1000;
}

function openDrawer() {
  if (!el.exploreDrawer || !el.drawerBackdrop || !el.drawerToggleBtn) return;
  el.exploreDrawer.classList.add("show");
  el.drawerBackdrop.classList.add("show");
  el.exploreDrawer.setAttribute("aria-hidden", "false");
  el.drawerToggleBtn.setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden";
}

function closeDrawer() {
  if (!el.exploreDrawer || !el.drawerBackdrop || !el.drawerToggleBtn) return;
  el.exploreDrawer.classList.remove("show");
  el.drawerBackdrop.classList.remove("show");
  el.exploreDrawer.setAttribute("aria-hidden", "true");
  el.drawerToggleBtn.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
}

function bindDrawer() {
  if (el.drawerToggleBtn) {
    el.drawerToggleBtn.addEventListener("click", openDrawer);
  }
  if (el.drawerCloseBtn) {
    el.drawerCloseBtn.addEventListener("click", closeDrawer);
  }
  if (el.drawerBackdrop) {
    el.drawerBackdrop.addEventListener("click", closeDrawer);
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });
}

function bindMainTabs() {
  if (!el.mainTabs) return;

  el.mainTabs.addEventListener("click", (event) => {
    const button = event.target.closest(".main-tab");
    if (!button) return;

    [...el.mainTabs.querySelectorAll(".main-tab")].forEach(tab => tab.classList.remove("active"));
    button.classList.add("active");

    const targetId = button.dataset.target;
    if (!targetId) return;

    const target = document.getElementById(targetId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

function bindPeopleTabs() {
  if (!el.peopleTabs) return;

  el.peopleTabs.addEventListener("click", (event) => {
    const button = event.target.closest(".sub-tab");
    if (!button) return;

    [...el.peopleTabs.querySelectorAll(".sub-tab")].forEach(tab => tab.classList.remove("active"));
    button.classList.add("active");

    state.currentFilter = button.dataset.filter || "suggested";
    renderPeople();
  });
}

function bindSearch() {
  if (!el.globalSearchInput) return;

  el.globalSearchInput.addEventListener("input", () => {
    renderPeople();
  });

  if (el.voiceSearchBtn) {
    el.voiceSearchBtn.addEventListener("click", () => {
      showNotice("Voice search can be connected later.", "info");
    });
  }
}

function bindDelegatedActions() {
  if (el.peopleGrid) {
    el.peopleGrid.addEventListener("click", async (event) => {
      const followBtn = event.target.closest("[data-follow-user-id]");
      const profileLink = event.target.closest("[data-profile-id]");

      if (profileLink) {
        const userId = profileLink.dataset.profileId;
        if (userId) {
          window.location.href = `public-profile.html?id=${encodeURIComponent(userId)}`;
          return;
        }
      }

      if (!followBtn) return;

      const userId = followBtn.dataset.followUserId;
      if (!userId || !state.currentUser?.id) return;

      await toggleFollow(userId);
    });
  }

  if (el.statusStrip) {
    el.statusStrip.addEventListener("click", (event) => {
      const profile = event.target.closest("[data-status-user-id]");
      if (!profile) return;
      const userId = profile.dataset.statusUserId;
      if (!userId) return;
      window.location.href = `public-profile.html?id=${encodeURIComponent(userId)}`;
    });
  }
}

async function requireSession() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;

  if (!data.session?.user) {
    window.location.href = "login.html?next=explore.html";
    throw new Error("Not authenticated");
  }

  state.currentUser = data.session.user;
  return data.session.user;
}

async function loadProfiles() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select(`
      id,
      username,
      full_name,
      avatar_url,
      avatar_path,
      bio,
      phone,
      is_online,
      last_seen,
      last_seen_at,
      created_at,
      updated_at,
      email,
      status,
      role,
      account_type,
      website
    `)
    .order("created_at", { ascending: false });

  if (error) throw error;

  state.allProfiles = Array.isArray(data) ? data : [];
}

async function loadFollowGraph() {
  if (!state.currentUser?.id) return;

  const myId = state.currentUser.id;

  const [{ data: followingRows, error: followingError }, { data: followerRows, error: followerError }] = await Promise.all([
    supabaseClient
      .from("followers")
      .select("following_id, status")
      .eq("follower_id", myId),
    supabaseClient
      .from("followers")
      .select("follower_id, status")
      .eq("following_id", myId)
  ]);

  if (followingError) throw followingError;
  if (followerError) throw followerError;

  state.followingIds = new Set(
    (followingRows || [])
      .filter(row => safeText(row.status, "accepted") === "accepted")
      .map(row => row.following_id)
      .filter(Boolean)
  );

  state.followerIds = new Set(
    (followerRows || [])
      .filter(row => safeText(row.status, "accepted") === "accepted")
      .map(row => row.follower_id)
      .filter(Boolean)
  );

  state.mutualIds = new Set(
    [...state.followingIds].filter(id => state.followerIds.has(id))
  );
}

async function loadNotificationBadge() {
  if (!state.currentUser?.id || !el.notificationBadge) return;

  const { count, error } = await supabaseClient
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", state.currentUser.id)
    .eq("is_read", false);

  if (error) {
    console.error(error);
    return;
  }

  state.unreadNotifications = Number(count || 0);

  if (state.unreadNotifications > 0) {
    el.notificationBadge.textContent = state.unreadNotifications > 99 ? "99+" : String(state.unreadNotifications);
    el.notificationBadge.classList.remove("hidden");
  } else {
    el.notificationBadge.classList.add("hidden");
  }
}

async function loadStatuses() {
  if (!el.statusStrip) return;

  const { data, error } = await supabaseClient
    .from("statuses")
    .select(`
      id,
      user_id,
      status_type,
      text_content,
      content,
      media_url,
      media_path,
      thumbnail_url,
      bg_style,
      expires_at,
      created_at,
      updated_at
    `)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error(error);
    if (el.statusLoadingCards) el.statusLoadingCards.remove();
    return;
  }

  const profileMap = new Map(state.allProfiles.map(profile => [profile.id, profile]));
  const grouped = new Map();

  for (const row of data || []) {
    if (!row.user_id) continue;
    if (grouped.has(row.user_id)) continue;
    grouped.set(row.user_id, row);
  }

  if (el.statusLoadingCards) {
    el.statusLoadingCards.remove();
  }

  const existingDynamic = el.statusStrip.querySelectorAll(".status-item.dynamic-status");
  existingDynamic.forEach(node => node.remove());

  const fragment = document.createDocumentFragment();

  for (const [, status] of grouped) {
    const profile = profileMap.get(status.user_id);
    if (!profile) continue;

    const name = getProfileName(profile);
    const avatar = getProfileAvatar(profile);
    const card = document.createElement("a");
    card.href = `status.html?user_id=${encodeURIComponent(status.user_id)}`;
    card.className = "status-item dynamic-status";
    card.dataset.statusUserId = status.user_id;

    card.innerHTML = `
      <div class="status-ring">
        <div class="status-avatar">
          ${
            avatar
              ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(name)}" />`
              : `<span>${escapeHtml(getInitials(name))}</span>`
          }
        </div>
      </div>
      <div class="status-name">${escapeHtml(name)}</div>
      <div class="status-sub">${escapeHtml(formatTimeAgo(status.created_at))}</div>
    `;

    fragment.appendChild(card);
  }

  el.statusStrip.appendChild(fragment);
}

function getFilteredPeople() {
  const searchTerm = safeText(el.globalSearchInput?.value).toLowerCase();

  let profiles = state.allProfiles.filter(profile => profile.id !== state.currentUser?.id);

  if (searchTerm) {
    profiles = profiles.filter(profile => {
      const name = getProfileName(profile).toLowerCase();
      const username = safeText(profile.username).toLowerCase();
      const email = safeText(profile.email).toLowerCase();
      return name.includes(searchTerm) || username.includes(searchTerm) || email.includes(searchTerm);
    });
  }

  if (state.currentFilter === "following") {
    profiles = profiles.filter(profile => state.followingIds.has(profile.id));
  } else if (state.currentFilter === "followers") {
    profiles = profiles.filter(profile => state.followerIds.has(profile.id));
  } else if (state.currentFilter === "friends") {
    profiles = profiles.filter(profile => state.mutualIds.has(profile.id));
  } else {
    profiles = profiles.filter(profile => !state.followingIds.has(profile.id));
  }

  profiles.sort((a, b) => {
    const aOnline = isProfileOnline(a) ? 1 : 0;
    const bOnline = isProfileOnline(b) ? 1 : 0;
    if (bOnline !== aOnline) return bOnline - aOnline;

    const aTime = new Date(a.created_at || 0).getTime();
    const bTime = new Date(b.created_at || 0).getTime();
    return bTime - aTime;
  });

  return profiles.slice(0, 12);
}

function renderHeroStats() {
  if (el.heroProfilesCount) {
    el.heroProfilesCount.textContent = `Profiles: ${formatCount(state.allProfiles.length)}`;
  }

  if (el.heroOnlineCount) {
    const onlineCount = state.allProfiles.filter(isProfileOnline).length;
    el.heroOnlineCount.textContent = `Online: ${formatCount(onlineCount)}`;
  }

  if (el.heroSuggestedCount) {
    const suggestedCount = state.allProfiles.filter(
      profile => profile.id !== state.currentUser?.id && !state.followingIds.has(profile.id)
    ).length;
    el.heroSuggestedCount.textContent = `Suggested: ${formatCount(suggestedCount)}`;
  }
}

function renderPeople() {
  if (!el.peopleGrid) return;

  const people = getFilteredPeople();

  if (!people.length) {
    el.peopleGrid.innerHTML = `
      <div class="empty-state-card">
        <strong>No people found</strong>
        <span>Try another filter or search keyword.</span>
      </div>
    `;
    return;
  }

  el.peopleGrid.innerHTML = people.map(profile => {
    const name = getProfileName(profile);
    const handle = getProfileHandle(profile);
    const avatar = getProfileAvatar(profile);
    const bio = safeText(profile.bio, handle);
    const isFollowing = state.followingIds.has(profile.id);

    return `
      <div class="person-card">
        <a
          href="public-profile.html?id=${encodeURIComponent(profile.id)}"
          class="person-cover-link"
          data-profile-id="${escapeHtml(profile.id)}"
          aria-label="Open ${escapeHtml(name)} profile"
        >
          ${
            avatar
              ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(name)}" />`
              : `<div class="person-cover-fallback">${escapeHtml(getInitials(name))}</div>`
          }
        </a>

        <div class="person-body">
          <div class="person-title">${escapeHtml(name)}</div>
          <div class="person-subline">${escapeHtml(bio)}</div>

          <div class="person-actions">
            <button
              type="button"
              class="follow-btn"
              data-follow-user-id="${escapeHtml(profile.id)}"
            >
              ${isFollowing ? "Following" : "Follow"}
            </button>

            <a
              href="public-profile.html?id=${encodeURIComponent(profile.id)}"
              class="mini-btn"
              data-profile-id="${escapeHtml(profile.id)}"
              aria-label="Open ${escapeHtml(name)} profile"
            >
              +
            </a>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

async function toggleFollow(targetUserId) {
  if (!state.currentUser?.id || !targetUserId) return;
  if (targetUserId === state.currentUser.id) return;

  try {
    const alreadyFollowing = state.followingIds.has(targetUserId);

    if (alreadyFollowing) {
      const { error } = await supabaseClient
        .from("followers")
        .delete()
        .eq("follower_id", state.currentUser.id)
        .eq("following_id", targetUserId);

      if (error) throw error;
    } else {
      const { error } = await supabaseClient
        .from("followers")
        .upsert({
          follower_id: state.currentUser.id,
          following_id: targetUserId,
          status: "accepted"
        }, {
          onConflict: "follower_id,following_id"
        });

      if (error) throw error;
    }

    await loadFollowGraph();
    renderHeroStats();
    renderPeople();
  } catch (error) {
    console.error(error);
    showNotice(error.message || "Could not update follow status.", "error");
  }
}

function activateVisibleSectionTab() {
  const sections = [...document.querySelectorAll(".content-section")];
  const tabs = [...document.querySelectorAll(".main-tab")];
  if (!sections.length || !tabs.length) return;

  const fromTop = window.scrollY + 120;
  let activeId = sections[0].id;

  for (const section of sections) {
    if (section.offsetTop <= fromTop) {
      activeId = section.id;
    }
  }

  tabs.forEach(tab => {
    tab.classList.toggle("active", tab.dataset.target === activeId);
  });
}

function bindScrollWatcher() {
  window.addEventListener("scroll", activateVisibleSectionTab, { passive: true });
}

async function initRealtime() {
  if (!state.currentUser?.id) return;

  supabaseClient
    .channel("explore-notifications")
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "notifications",
      filter: `user_id=eq.${state.currentUser.id}`
    }, async () => {
      await loadNotificationBadge();
    })
    .subscribe();

  supabaseClient
    .channel("explore-profiles")
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "profiles"
    }, async () => {
      await loadProfiles();
      renderHeroStats();
      renderPeople();
    })
    .subscribe();

  supabaseClient
    .channel("explore-statuses")
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "statuses"
    }, async () => {
      await loadStatuses();
    })
    .subscribe();
}

async function init() {
  try {
    bindDrawer();
    bindMainTabs();
    bindPeopleTabs();
    bindSearch();
    bindDelegatedActions();
    bindScrollWatcher();

    await requireSession();
    await Promise.all([
      loadProfiles(),
      loadFollowGraph(),
      loadNotificationBadge()
    ]);

    renderHeroStats();
    renderPeople();
    await loadStatuses();
    await initRealtime();
    activateVisibleSectionTab();
    clearNotice();
  } catch (error) {
    console.error(error);
    showNotice(error.message || "Could not load Explore.", "error");
  }
}

init();
