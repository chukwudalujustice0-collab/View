const FollowersPage = {
  init() {
    ViewAuth.requireAuth();

    this.searchInput = document.getElementById("followersSearch");
    this.searchButton = document.getElementById("followersSearchBtn");
    this.followButtons = document.querySelectorAll("[data-follower-follow]");
    this.removeButtons = document.querySelectorAll("[data-remove-follower]");
    this.messageButtons = document.querySelectorAll("[data-message-follower]");
    this.filterButtons = document.querySelectorAll("[data-followers-filter]");

    this.bindEvents();
  },

  bindEvents() {
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

    this.followButtons.forEach((button) => {
      button.addEventListener("click", () => this.toggleFollow(button));
    });

    this.removeButtons.forEach((button) => {
      button.addEventListener("click", () => this.removeFollower(button));
    });

    this.messageButtons.forEach((button) => {
      button.addEventListener("click", () => ViewUtils.redirect("chat"));
    });

    this.filterButtons.forEach((button) => {
      button.addEventListener("click", () => this.setActiveFilter(button));
    });
  },

  handleSearch() {
    const query = this.searchInput?.value.trim() || "";
    if (!query) {
      alert("Enter a name or username to search followers.");
      return;
    }

    alert(`Searching followers for "${query}" will be connected to live data later.`);
  },

  toggleFollow(button) {
    const following = button.dataset.following === "true";
    button.dataset.following = String(!following);
    button.textContent = following ? "Follow Back" : "Following";
  },

  removeFollower(button) {
    const confirmed = confirm("Remove this follower?");
    if (!confirmed) return;

    const card = button.closest("[data-follower-card]");
    if (card) {
      card.remove();
    }
  },

  setActiveFilter(activeButton) {
    this.filterButtons.forEach((button) => button.classList.remove("active"));
    activeButton.classList.add("active");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  FollowersPage.init();
});