const CreatePostPage = {
  async init() {
    this.form = document.getElementById("createPostForm");
    this.messageBox = document.getElementById("createPostMessage");

    this.postTitle = document.getElementById("postTitle");
    this.postContent = document.getElementById("postContent");
    this.mediaType = document.getElementById("mediaType");
    this.visibility = document.getElementById("visibility");
    this.mediaUrl = document.getElementById("mediaUrl");
    this.hashtags = document.getElementById("hashtags");
    this.location = document.getElementById("location");

    this.publishBtn = document.getElementById("publishBtn");
    this.saveDraftBtn = document.getElementById("saveDraftBtn");
    this.scheduleBtn = document.getElementById("scheduleBtn");
    this.clearBtn = document.getElementById("clearPostBtn");

    this.previewName = document.getElementById("previewName");
    this.previewUsername = document.getElementById("previewUsername");
    this.previewAvatar = document.getElementById("previewAvatar");
    this.previewContent = document.getElementById("previewContent");
    this.previewMediaType = document.getElementById("previewMediaType");
    this.previewVisibility = document.getElementById("previewVisibility");
    this.previewLocation = document.getElementById("previewLocation");

    this.selectedPlatformsText = document.getElementById("selectedPlatformsText");
    this.contentLengthText = document.getElementById("contentLengthText");
    this.summaryMediaType = document.getElementById("summaryMediaType");
    this.summaryStatus = document.getElementById("summaryStatus");

    this.platformButtons = Array.from(document.querySelectorAll("[data-platform]"));
    this.selectedPlatforms = new Set(["view"]);

    const session = await this.getSession();
    if (!session?.user) {
      window.location.href = "login.html";
      return;
    }

    this.userId = session.user.id;
    await this.loadProfile();
    this.bindEvents();
    this.updatePreview();
  },

  async getSession() {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    return data.session || null;
  },

  async loadProfile() {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("full_name, username, avatar_url")
      .eq("id", this.userId)
      .single();

    if (error) throw error;

    this.profile = data;

    this.previewName.textContent = data.full_name || "View User";
    this.previewUsername.textContent = "@" + (data.username || "view_user");

    if (data.avatar_url) {
      this.previewAvatar.innerHTML = `<img src="${this.escapeHtml(data.avatar_url)}" alt="Avatar" />`;
    } else {
      const seed = data.full_name || data.username || "V";
      this.previewAvatar.textContent = seed.charAt(0).toUpperCase();
    }
  },

  bindEvents() {
    this.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await this.publishPost();
    });

    this.saveDraftBtn.addEventListener("click", async () => {
      await this.saveDraft();
    });

    this.scheduleBtn.addEventListener("click", async () => {
      await this.schedulePost();
    });

    this.clearBtn.addEventListener("click", () => {
      this.clearForm();
    });

    [
      this.postTitle,
      this.postContent,
      this.mediaType,
      this.visibility,
      this.mediaUrl,
      this.hashtags,
      this.location
    ].forEach((el) => {
      el.addEventListener("input", () => this.updatePreview());
      el.addEventListener("change", () => this.updatePreview());
    });

    this.platformButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const platform = btn.getAttribute("data-platform");
        if (!platform) return;

        if (this.selectedPlatforms.has(platform)) {
          if (this.selectedPlatforms.size === 1) return;
          this.selectedPlatforms.delete(platform);
          btn.classList.remove("active");
        } else {
          this.selectedPlatforms.add(platform);
          btn.classList.add("active");
        }

        this.updatePreview();
      });
    });

    document.querySelectorAll("[data-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tool = btn.getAttribute("data-tool");
        this.showMessage(tool + " tool placeholder clicked.", "info");
      });
    });
  },

  escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  showMessage(message, type = "error") {
    this.messageBox.className = "notice " + type;
    this.messageBox.textContent = message;
  },

  clearMessage() {
    this.messageBox.className = "notice";
    this.messageBox.textContent = "";
  },

  getFormData() {
    return {
      title: this.postTitle.value.trim(),
      content: this.postContent.value.trim(),
      media_type: this.mediaType.value,
      visibility: this.visibility.value,
      media_url: this.mediaUrl.value.trim(),
      hashtags: this.hashtags.value.trim(),
      location: this.location.value.trim(),
      platforms: Array.from(this.selectedPlatforms)
    };
  },

  validatePost(data) {
    if (!data.content) {
      throw new Error("Write something before publishing.");
    }
  },

  updatePreview() {
    const data = this.getFormData();

    this.previewContent.textContent = data.content || "Your post preview will appear here.";
    this.previewMediaType.textContent = data.media_type || "text";
    this.previewVisibility.textContent = data.visibility || "public";
    this.previewLocation.textContent = data.location || "No location";

    this.selectedPlatformsText.textContent = data.platforms.join(", ");
    this.contentLengthText.textContent = `${data.content.length} chars`;
    this.summaryMediaType.textContent = data.media_type || "text";
    this.summaryStatus.textContent = data.content ? "Ready" : "Waiting";
  },

  async publishPost() {
    this.clearMessage();
    const data = this.getFormData();

    try {
      this.validatePost(data);
      this.publishBtn.disabled = true;
      this.publishBtn.textContent = "Publishing...";

      const { data: postRow, error } = await supabaseClient
        .from("posts")
        .insert({
          user_id: this.userId,
          content: data.content,
          media_url: data.media_url,
          media_type: data.media_type,
          hashtags: data.hashtags,
          location: data.location,
          visibility: data.visibility,
          status: "published",
          published_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      await this.safeInsertPublishHistory({
        source_type: "post",
        source_id: postRow.id,
        title: data.title || data.content.slice(0, 40) || "Post",
        platforms: data.platforms,
        status: "success",
        charge_amount: 0,
        result_message: "Post published successfully."
      });

      this.showMessage("Post published successfully.", "success");
      this.clearForm(false);
    } catch (error) {
      console.error("Publish error:", error);
      this.showMessage(error.message || "Could not publish post.", "error");
    } finally {
      this.publishBtn.disabled = false;
      this.publishBtn.textContent = "Publish Now";
    }
  },

  async saveDraft() {
    this.clearMessage();
    const data = this.getFormData();

    try {
      this.saveDraftBtn.disabled = true;
      this.saveDraftBtn.textContent = "Saving...";

      const { error } = await supabaseClient
        .from("drafts")
        .insert({
          user_id: this.userId,
          title: data.title,
          content: data.content,
          media_url: data.media_url,
          media_type: data.media_type,
          hashtags: data.hashtags,
          location: data.location,
          platforms: data.platforms
        });

      if (error) throw error;

      this.showMessage("Draft saved successfully.", "success");
    } catch (error) {
      console.error("Draft error:", error);
      this.showMessage(error.message || "Could not save draft.", "error");
    } finally {
      this.saveDraftBtn.disabled = false;
      this.saveDraftBtn.textContent = "Save Draft";
    }
  },

  async schedulePost() {
    this.clearMessage();
    const data = this.getFormData();

    try {
      this.validatePost(data);
      this.scheduleBtn.disabled = true;
      this.scheduleBtn.textContent = "Scheduling...";

      const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const { error } = await supabaseClient
        .from("scheduled_posts")
        .insert({
          user_id: this.userId,
          title: data.title,
          content: data.content,
          media_url: data.media_url,
          media_type: data.media_type,
          hashtags: data.hashtags,
          location: data.location,
          platforms: data.platforms,
          scheduled_for: scheduledFor,
          status: "scheduled"
        });

      if (error) throw error;

      this.showMessage("Post scheduled successfully.", "success");
    } catch (error) {
      console.error("Schedule error:", error);
      this.showMessage(error.message || "Could not schedule post.", "error");
    } finally {
      this.scheduleBtn.disabled = false;
      this.scheduleBtn.textContent = "Schedule";
    }
  },

  async safeInsertPublishHistory(payload) {
    try {
      await supabaseClient.from("publish_history").insert(payload);
    } catch (error) {
      console.error("Publish history insert failed:", error);
    }
  },

  clearForm(showMessage = true) {
    this.form.reset();
    this.selectedPlatforms = new Set(["view"]);

    this.platformButtons.forEach((btn) => {
      const platform = btn.getAttribute("data-platform");
      if (platform === "view") {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    this.updatePreview();

    if (showMessage) {
      this.showMessage("Form cleared.", "info");
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  CreatePostPage.init();
});