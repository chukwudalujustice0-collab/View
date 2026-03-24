const FollowingPage = {
  init() {
    ViewAuth.requireAuth();

    this.searchInput = document.getElementById("followingSearch");
    this.searchButton = document.getElementById("followingSearchBtn");
    this.followButtons = document.querySelectorAll("[data-suggest-follow]");
    this.unfollowButtons = document.querySelectorAll("[data-unfollow-btn]");
    this.messageButtons = document.querySelectorAll("[data-message-following]");
    this.filterButtons = document.querySelectorAll("[data-following-filter]");

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
      button.addEventListener("click", () => this.toggleSuggestedFollow(button));
    });

    this.unfollowButtons.forEach((button) => {
      button.addEventListener("click", () => this.unfollow(button));
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
      alert("Enter a name or username to search who you follow.");
      return;
    }

    alert(`Searching following list for "${query}" will be connected to live data later.`);
  },

  toggleSuggestedFollow(button) {
    const following = button.dataset.following === "true";
    button.dataset.following = String(!following);
    button.textContent = following ? "Follow" : "Following";
  },

  unfollow(button) {
    const confirmed = confirm("Unfollow this account?");
    if (!confirmed) return;

    const card = button.closest("[data-following-card]");
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
  FollowingPage.init();
});