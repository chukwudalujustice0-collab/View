const ScheduledPostsPage = {
  init() {
    ViewAuth.requireAuth();

    this.filterButtons = document.querySelectorAll("[data-scheduled-filter]");
    this.editButtons = document.querySelectorAll("[data-edit-scheduled]");
    this.cancelButtons = document.querySelectorAll("[data-cancel-scheduled]");
    this.publishNowButtons = document.querySelectorAll("[data-publish-now]");
    this.searchInput = document.getElementById("scheduledSearch");
    this.searchButton = document.getElementById("scheduledSearchBtn");

    this.bindEvents();
  },

  bindEvents() {
    this.filterButtons.forEach((button) => {
      button.addEventListener("click", () => this.setActiveFilter(button));
    });

    this.editButtons.forEach((button) => {
      button.addEventListener("click", () => this.editScheduled(button));
    });

    this.cancelButtons.forEach((button) => {
      button.addEventListener("click", () => this.cancelScheduled(button));
    });

    this.publishNowButtons.forEach((button) => {
      button.addEventListener("click", () => this.publishNow(button));
    });

    if (this.searchButton) {
      this.searchButton.addEventListener("click", () => this.handleSearch());
    }

    if (this.searchInput) {
      this.searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.handleSearch();
        }
      });
    }
  },

  setActiveFilter(activeButton) {
    this.filterButtons.forEach((button) => button.classList.remove("active"));
    activeButton.classList.add("active");
  },

  editScheduled(button) {
    const scheduledId = button.dataset.editScheduled || "";
    if (scheduledId) {
      sessionStorage.setItem("view_edit_scheduled_id", scheduledId);
    }
    ViewUtils.redirect("createPost");
  },

  cancelScheduled(button) {
    const confirmed = confirm("Cancel this scheduled post?");
    if (!confirmed) return;

    const card = button.closest("[data-scheduled-card]");
    if (card) {
      card.remove();
    }
  },

  publishNow(button) {
    const postName = button.dataset.publishNow || "scheduled post";
    alert(`${postName} has been sent to publish queue.`);
    ViewUtils.redirect("publishHistory");
  },

  handleSearch() {
    const query = this.searchInput?.value.trim() || "";
    if (!query) {
      alert("Enter something to search scheduled posts.");
      return;
    }

    alert(`Searching scheduled posts for "${query}" will be connected later.`);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  ScheduledPostsPage.init();
});