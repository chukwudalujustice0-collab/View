const CommentsPage = {
  init() {
    ViewAuth.requireAuth();

    this.commentInput = document.getElementById("commentInput");
    this.postCommentButton = document.getElementById("postCommentBtn");
    this.replyBox = document.getElementById("replyingBox");
    this.closeReplyButton = document.getElementById("closeReplyCommentBtn");
    this.sortButton = document.getElementById("commentsSortBtn");

    this.commentLikeButtons = document.querySelectorAll("[data-comment-like]");
    this.commentReplyButtons = document.querySelectorAll("[data-comment-reply]");
    this.commentCopyButtons = document.querySelectorAll("[data-comment-copy]");
    this.commentReportButtons = document.querySelectorAll("[data-comment-report]");
    this.postActionButtons = document.querySelectorAll("[data-post-action]");
    this.toolButtons = document.querySelectorAll("[data-comment-tool]");

    this.bindEvents();
  },

  bindEvents() {
    if (this.postCommentButton) {
      this.postCommentButton.addEventListener("click", () => this.postComment());
    }

    if (this.commentInput) {
      this.commentInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          this.postComment();
        }
      });
    }

    if (this.closeReplyButton && this.replyBox) {
      this.closeReplyButton.addEventListener("click", () => {
        this.replyBox.style.display = "none";
      });
    }

    if (this.sortButton) {
      this.sortButton.addEventListener("click", () => this.toggleSort());
    }

    this.commentLikeButtons.forEach((button) => {
      button.addEventListener("click", () => this.toggleCommentLike(button));
    });

    this.commentReplyButtons.forEach((button) => {
      button.addEventListener("click", () => this.openReplyBox(button));
    });

    this.commentCopyButtons.forEach((button) => {
      button.addEventListener("click", () => this.copyComment(button));
    });

    this.commentReportButtons.forEach((button) => {
      button.addEventListener("click", () => this.reportComment(button));
    });

    this.postActionButtons.forEach((button) => {
      button.addEventListener("click", () => this.handlePostAction(button));
    });

    this.toolButtons.forEach((button) => {
      button.addEventListener("click", () => this.handleTool(button));
    });
  },

  postComment() {
    const text = this.commentInput?.value.trim() || "";

    if (!text) {
      alert("Write a comment first.");
      return;
    }

    alert(`Comment posted: ${text}`);
    this.commentInput.value = "";

    if (this.replyBox) {
      this.replyBox.style.display = "none";
    }
  },

  toggleSort() {
    const current = this.sortButton?.dataset.sort || "newest";
    const next = current === "newest" ? "top" : "newest";

    if (this.sortButton) {
      this.sortButton.dataset.sort = next;
      this.sortButton.textContent = next === "newest" ? "Newest first" : "Top comments";
    }
  },

  toggleCommentLike(button) {
    const liked = button.dataset.liked === "true";
    const currentCount = Number(button.dataset.count || 0);
    const nextCount = liked ? Math.max(currentCount - 1, 0) : currentCount + 1;

    button.dataset.liked = String(!liked);
    button.dataset.count = String(nextCount);

    const labelTarget = button.querySelector("[data-comment-like-label]");
    if (labelTarget) {
      labelTarget.textContent = nextCount > 0 ? `❤️ ${nextCount}` : "❤️ Like";
    } else {
      button.textContent = nextCount > 0 ? `❤️ ${nextCount}` : "❤️ Like";
    }
  },

  openReplyBox(button) {
    if (this.replyBox) {
      this.replyBox.style.display = "flex";
    }

    const replyTarget = button.dataset.replyTo || "@user";
    const replyTargetElement = document.getElementById("replyingToName");

    if (replyTargetElement) {
      replyTargetElement.textContent = replyTarget;
    }

    this.commentInput?.focus();
  },

  copyComment(button) {
    const text = button.dataset.commentText || "Comment text";
    navigator.clipboard.writeText(text)
      .then(() => alert("Comment copied."))
      .catch(() => alert("Copy action ready."));
  },

  reportComment() {
    alert("Report flow will be connected in moderation stage.");
  },

  handlePostAction(button) {
    const action = button.dataset.postAction;

    switch (action) {
      case "like":
        this.togglePostLike(button);
        break;
      case "share":
        alert("Share options will be connected later.");
        break;
      case "save":
        this.togglePostSave(button);
        break;
      case "copy":
        navigator.clipboard.writeText(window.location.href)
          .then(() => alert("Post link copied."))
          .catch(() => alert("Link ready to copy."));
        break;
      default:
        break;
    }
  },

  togglePostLike(button) {
    const liked = button.dataset.liked === "true";
    button.dataset.liked = String(!liked);
    button.textContent = liked ? "❤️ Like" : "💙 Liked";
  },

  togglePostSave(button) {
    const saved = button.dataset.saved === "true";
    button.dataset.saved = String(!saved);
    button.textContent = saved ? "🔖 Save" : "✅ Saved";
  },

  handleTool(button) {
    const tool = button.dataset.commentTool;

    switch (tool) {
      case "emoji":
        alert("Emoji picker will be connected later.");
        break;
      case "gif":
        alert("GIF picker will be connected later.");
        break;
      case "sticker":
        alert("Sticker picker will be connected later.");
        break;
      case "hashtag":
        alert("Hashtag suggestions will be connected later.");
        break;
      case "mention":
        alert("Mention suggestions will be connected later.");
        break;
      default:
        break;
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  CommentsPage.init();
});