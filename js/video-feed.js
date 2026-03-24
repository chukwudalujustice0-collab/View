const VideoFeedPage = {
  init() {
    ViewAuth.requireAuth();

    this.feedTabs = document.querySelectorAll("[data-video-tab]");
    this.actionButtons = document.querySelectorAll("[data-video-action]");
    this.followButtons = document.querySelectorAll("[data-video-follow]");
    this.bindEvents();
  },

  bindEvents() {
    this.feedTabs.forEach((button) => {
      button.addEventListener("click", () => this.setActiveTab(button));
    });

    this.actionButtons.forEach((button) => {
      button.addEventListener("click", () => this.handleAction(button));
    });

    this.followButtons.forEach((button) => {
      button.addEventListener("click", () => this.toggleFollow(button));
    });
  },

  setActiveTab(activeButton) {
    this.feedTabs.forEach((button) => button.classList.remove("active"));
    activeButton.classList.add("active");
  },

  handleAction(button) {
    const action = button.dataset.videoAction;

    switch (action) {
      case "like":
        this.toggleLike(button);
        break;
      case "comment":
        ViewUtils.redirect("comments");
        break;
      case "share":
        alert("Share options will be connected in the next stage.");
        break;
      case "save":
        this.toggleSave(button);
        break;
      case "report":
        alert("Report flow will be connected in the moderation stage.");
        break;
      default:
        break;
    }
  },

  toggleLike(button) {
    const liked = button.dataset.liked === "true";
    button.dataset.liked = liked ? "false" : "true";
    const count = Number(button.dataset.count || 0);
    const newCount = liked ? Math.max(count - 1, 0) : count + 1;
    button.dataset.count = String(newCount);

    const countTarget = button.querySelector("[data-video-count]");
    if (countTarget) {
      countTarget.textContent = newCount.toLocaleString();
    }
  },

  toggleSave(button) {
    const saved = button.dataset.saved === "true";
    button.dataset.saved = saved ? "false" : "true";
    const label = button.querySelector("[data-video-save-label]");
    if (label) {
      label.textContent = saved ? "Save" : "Saved";
    }
  },

  toggleFollow(button) {
    const isFollowing = button.dataset.following === "true";
    button.dataset.following = isFollowing ? "false" : "true";
    button.textContent = isFollowing ? "Follow" : "Following";
  }
};

document.addEventListener("DOMContentLoaded", () => {
  VideoFeedPage.init();
});