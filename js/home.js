const HomePage = {
  init() {
    ViewAuth.requireAuth();
    this.bindEvents();
    this.loadFeed();
  },

  bindEvents() {
    const createBox = document.querySelector("[data-open-create]");
    if (createBox) {
      createBox.addEventListener("click", () => {
        ViewUtils.redirect("createPost");
      });
    }

    const likeButtons = document.querySelectorAll("[data-like-btn]");
    likeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.toggleLike(button);
      });
    });

    const saveButtons = document.querySelectorAll("[data-save-btn]");
    saveButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.toggleSave(button);
      });
    });

    const commentButtons = document.querySelectorAll("[data-comment-btn]");
    commentButtons.forEach((button) => {
      button.addEventListener("click", () => {
        ViewUtils.redirect("comments");
      });
    });

    const shareButtons = document.querySelectorAll("[data-share-btn]");
    shareButtons.forEach((button) => {
      button.addEventListener("click", () => {
        alert("Share options will be connected in the next stage.");
      });
    });
  },

  loadFeed() {
    console.log("Feed loaded.");
  },

  toggleLike(button) {
    const liked = button.dataset.liked === "true";
    button.dataset.liked = liked ? "false" : "true";
    button.textContent = liked ? "❤️ Like" : "💙 Liked";
  },

  toggleSave(button) {
    const saved = button.dataset.saved === "true";
    button.dataset.saved = saved ? "false" : "true";
    button.textContent = saved ? "🔖 Save" : "✅ Saved";
  }
};

document.addEventListener("DOMContentLoaded", () => {
  HomePage.init();
});