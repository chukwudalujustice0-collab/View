const DashboardPage = {
  async init() {
    this.noticeBox = document.getElementById("dashboardNotice");

    const session = await this.getSession();
    if (!session?.user) {
      window.location.href = "login.html";
      return;
    }

    this.userId = session.user.id;
    this.bindEvents();

    try {
      await this.loadAll();
    } catch (error) {
      console.error("Dashboard init error:", error);
      this.showNotice(error.message || "Could not load dashboard.", "error");
    }
  },

  bindEvents() {
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        const confirmLogout = window.confirm("Are you sure you want to logout?");
        if (!confirmLogout) return;

        const { error } = await supabaseClient.auth.signOut();
        if (error) {
          this.showNotice(error.message || "Logout failed.", "error");
          return;
        }

        window.location.href = "login.html";
      });
    }
  },

  async getSession() {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      throw error;
    }
    return data.session || null;
  },

  showNotice(message, type = "error") {
    if (!this.noticeBox) return;
    this.noticeBox.className = "notice " + type;
    this.noticeBox.textContent = message;
  },

  clearNotice() {
    if (!this.noticeBox) return;
    this.noticeBox.className = "notice";
    this.noticeBox.textContent = "";
  },

  setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  },

  formatCurrency(value) {
    const amount = Number(value || 0);
    return "₦" + amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  },

  formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (isNaN(date.getTime())) return "—";
    return date.toLocaleString();
  },

  escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  async loadAll() {
    this.clearNotice();

    const [
      profile,
      counts,
      wallet,
      subscription,
      recentPosts,
      recentNotifications,
      recentDrafts,
      recentScheduled,
      recentPublishHistory,
      connectedAccounts
    ] = await Promise.all([
      this.loadProfile(),
      this.loadCounts(),
      this.loadWallet(),
      this.loadSubscription(),
      this.loadRecentPosts(),
      this.loadRecentNotifications(),
      this.loadRecentDrafts(),
      this.loadRecentScheduled(),
      this.loadPublishHistory(),
      this.loadConnectedAccounts()
    ]);

    this.renderProfile(profile, counts);
    this.renderCounts(counts);
    this.renderWallet(wallet, subscription);
    this.renderRecentPosts(recentPosts);
    this.renderRecentNotifications(recentNotifications);
    this.renderRecentDrafts(recentDrafts);
    this.renderRecentScheduled(recentScheduled);
    this.renderPublishHistory(recentPublishHistory);
    this.renderConnectedAccounts(connectedAccounts);
  },

  async loadProfile() {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", this.userId)
      .single();

    if (error) throw error;
    return data;
  },

  async countQuery(table, column = "*", match = {}) {
    let query = supabaseClient
      .from(table)
      .select(column, { count: "exact", head: true });

    Object.entries(match).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  },

  async loadCounts() {
    const [
      posts,
      followers,
      following,
      drafts,
      scheduled,
      saved,
      unreadNotifications
    ] = await Promise.all([
      this.countQuery("posts", "*", { user_id: this.userId, status: "published" }),
      this.countQuery("followers", "*", { following_id: this.userId }),
      this.countQuery("followers", "*", { follower_id: this.userId }),
      this.countQuery("drafts", "*", { user_id: this.userId }),
      this.countQuery("scheduled_posts", "*", { user_id: this.userId, status: "scheduled" }),
      this.countQuery("saved_posts", "*", { user_id: this.userId }),
      this.countQuery("notifications", "*", { user_id: this.userId, is_read: false })
    ]);

    return {
      posts,
      followers,
      following,
      drafts,
      scheduled,
      saved,
      unreadNotifications
    };
  },

  async loadWallet() {
    const { data, error } = await supabaseClient
      .from("wallets")
      .select("*")
      .eq("user_id", this.userId)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  },

  async loadSubscription() {
    const { data, error } = await supabaseClient
      .from("subscriptions")
      .select("*")
      .eq("user_id", this.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  },

  async loadRecentPosts() {
    const { data, error } = await supabaseClient
      .from("posts")
      .select("id, content, media_type, created_at, published_at")
      .eq("user_id", this.userId)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(4);

    if (error) throw error;
    return data || [];
  },

  async loadRecentNotifications() {
    const { data, error } = await supabaseClient
      .from("notifications")
      .select("id, title, body, type, is_read, created_at")
      .eq("user_id", this.userId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) throw error;
    return data || [];
  },

  async loadRecentDrafts() {
    const { data, error } = await supabaseClient
      .from("drafts")
      .select("id, title, content, media_type, updated_at")
      .eq("user_id", this.userId)
      .order("updated_at", { ascending: false })
      .limit(4);

    if (error) throw error;
    return data || [];
  },

  async loadRecentScheduled() {
    const { data, error } = await supabaseClient
      .from("scheduled_posts")
      .select("id, title, content, media_type, scheduled_for, status")
      .eq("user_id", this.userId)
      .order("scheduled_for", { ascending: true })
      .limit(4);

    if (error) throw error;
    return data || [];
  },

  async loadPublishHistory() {
    const { data, error } = await supabaseClient
      .from("publish_history")
      .select("id, title, status, platforms, created_at, result_message")
      .eq("user_id", this.userId)
      .order("created_at", { ascending: false })
      .limit(4);

    if (error) throw error;
    return data || [];
  },

  async loadConnectedAccounts() {
    const { data, error } = await supabaseClient
      .from("connected_accounts")
      .select("id, platform, account_name, account_handle, status, updated_at")
      .eq("user_id", this.userId)
      .order("updated_at", { ascending: false })
      .limit(6);

    if (error) throw error;
    return data || [];
  },

  renderProfile(profile, counts) {
    this.setText("dashboardFullName", profile.full_name || "View User");
    this.setText("dashboardUsername", "@" + (profile.username || "view_user"));
    this.setText("dashboardBio", profile.bio || "No bio added yet.");

    this.setText("heroPostsCount", counts.posts);
    this.setText("heroFollowersCount", counts.followers);
    this.setText("heroFollowingCount", counts.following);
    this.setText("heroUnreadCount", counts.unreadNotifications);

    const avatar = document.getElementById("dashboardAvatar");
    if (avatar) {
      if (profile.avatar_url) {
        avatar.innerHTML = `<img src="${this.escapeHtml(profile.avatar_url)}" alt="Avatar" />`;
      } else {
        const name = profile.full_name || profile.username || "V";
        avatar.textContent = String(name).charAt(0).toUpperCase();
      }
    }
  },

  renderCounts(counts) {
    this.setText("statPosts", counts.posts);
    this.setText("statSaved", counts.saved);
    this.setText("statDrafts", counts.drafts);
    this.setText("statScheduled", counts.scheduled);
  },

  renderWallet(wallet, subscription) {
    this.setText("walletBalance", this.formatCurrency(wallet?.balance || 0));
    this.setText("currentPlan", subscription?.plan_name || "Starter");
    this.setText("planStatus", subscription?.status || "Active");
    this.setText("renewalDate", subscription?.renewal_date ? this.formatDate(subscription.renewal_date) : "—");
  },

  buildEmptyState(title, text, buttonText, href) {
    return `
      <div class="empty-state">
        <h4>${this.escapeHtml(title)}</h4>
        <p>${this.escapeHtml(text)}</p>
        <button class="primary-btn" onclick="window.location.href='${this.escapeHtml(href)}'">${this.escapeHtml(buttonText)}</button>
      </div>
    `;
  },

  renderRecentPosts(items) {
    const el = document.getElementById("recentPostsList");
    if (!el) return;

    if (!items.length) {
      el.innerHTML = this.buildEmptyState(
        "No posts yet",
        "You haven’t published any content yet.",
        "Create Post",
        "create-post.html"
      );
      return;
    }

    el.innerHTML = items.map(item => `
      <article class="list-card">
        <div class="list-main">
          <h4>${this.escapeHtml(item.content || "Untitled post")}</h4>
          <p>${this.escapeHtml(item.media_type || "text")} • ${this.escapeHtml(this.formatDate(item.published_at || item.created_at))}</p>
        </div>
        <div class="list-actions">
          <button class="mini-btn" onclick="window.location.href='profile.html'">Open</button>
        </div>
      </article>
    `).join("");
  },

  renderRecentNotifications(items) {
    const el = document.getElementById("recentNotificationsList");
    if (!el) return;

    if (!items.length) {
      el.innerHTML = this.buildEmptyState(
        "No notifications",
        "You don’t have any notifications yet.",
        "Open Notifications",
        "notifications.html"
      );
      return;
    }

    el.innerHTML = items.map(item => `
      <article class="list-card">
        <div class="list-main">
          <h4>${this.escapeHtml(item.title || "Notification")}</h4>
          <p>${this.escapeHtml(item.body || item.type || "Update")} • ${this.escapeHtml(this.formatDate(item.created_at))}</p>
        </div>
        <div class="list-actions">
          <span class="chip ${item.is_read ? "" : "connected"}">${item.is_read ? "Read" : "Unread"}</span>
        </div>
      </article>
    `).join("");
  },

  renderRecentDrafts(items) {
    const el = document.getElementById("recentDraftsList");
    if (!el) return;

    if (!items.length) {
      el.innerHTML = this.buildEmptyState(
        "No drafts",
        "You don’t have any saved drafts right now.",
        "Start Draft",
        "create-post.html"
      );
      return;
    }

    el.innerHTML = items.map(item => `
      <article class="list-card">
        <div class="list-main">
          <h4>${this.escapeHtml(item.title || item.content || "Untitled draft")}</h4>
          <p>${this.escapeHtml(item.media_type || "text")} • updated ${this.escapeHtml(this.formatDate(item.updated_at))}</p>
        </div>
        <div class="list-actions">
          <button class="mini-btn" onclick="window.location.href='drafts.html'">Open</button>
        </div>
      </article>
    `).join("");
  },

  renderRecentScheduled(items) {
    const el = document.getElementById("recentScheduledList");
    if (!el) return;

    if (!items.length) {
      el.innerHTML = this.buildEmptyState(
        "No scheduled posts",
        "You have nothing queued for later.",
        "Schedule Post",
        "create-post.html"
      );
      return;
    }

    el.innerHTML = items.map(item => `
      <article class="list-card">
        <div class="list-main">
          <h4>${this.escapeHtml(item.title || item.content || "Untitled scheduled post")}</h4>
          <p>${this.escapeHtml(item.media_type || "text")} • ${this.escapeHtml(this.formatDate(item.scheduled_for))}</p>
        </div>
        <div class="list-actions">
          <span class="chip ${item.status === "scheduled" ? "pending" : item.status === "published" ? "connected" : "failed"}">${this.escapeHtml(item.status || "scheduled")}</span>
        </div>
      </article>
    `).join("");
  },

  renderPublishHistory(items) {
    const el = document.getElementById("publishHistoryList");
    if (!el) return;

    if (!items.length) {
      el.innerHTML = this.buildEmptyState(
        "No publish history",
        "Your publishing activity will appear here.",
        "Create Post",
        "create-post.html"
      );
      return;
    }

    el.innerHTML = items.map(item => {
      const statusClass =
        item.status === "success" ? "connected" :
        item.status === "pending" ? "pending" :
        item.status === "partial" ? "pending" : "failed";

      return `
        <article class="list-card">
          <div class="list-main">
            <h4>${this.escapeHtml(item.title || "Publish Job")}</h4>
            <p>${this.escapeHtml((item.platforms || []).join(", ") || "No platforms")} • ${this.escapeHtml(this.formatDate(item.created_at))}</p>
          </div>
          <div class="list-actions">
            <span class="chip ${statusClass}">${this.escapeHtml(item.status || "pending")}</span>
          </div>
        </article>
      `;
    }).join("");
  },

  renderConnectedAccounts(items) {
    const el = document.getElementById("connectedAccountsList");
    if (!el) return;

    if (!items.length) {
      el.innerHTML = this.buildEmptyState(
        "No connected accounts",
        "Link your platforms to start cross-posting.",
        "Connect Accounts",
        "connected-accounts.html"
      );
      return;
    }

    el.innerHTML = items.map(item => {
      const statusClass =
        item.status === "connected" ? "connected" :
        item.status === "pending" ? "pending" : "failed";

      return `
        <article class="list-card">
          <div class="list-main">
            <h4>${this.escapeHtml(item.platform || "Platform")}</h4>
            <p>${this.escapeHtml(item.account_name || item.account_handle || "No account name")} • ${this.escapeHtml(this.formatDate(item.updated_at))}</p>
          </div>
          <div class="list-actions">
            <span class="chip ${statusClass}">${this.escapeHtml(item.status || "disconnected")}</span>
          </div>
        </article>
      `;
    }).join("");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  DashboardPage.init();
});