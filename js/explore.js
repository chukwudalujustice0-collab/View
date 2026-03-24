const ExplorePage = {
  init() {
    ViewAuth.requireAuth();

    this.searchInput = document.getElementById("exploreSearch");
    this.searchButton = document.getElementById("exploreSearchBtn");
    this.filterButtons = document.querySelectorAll("[data-explore-filter]");
    this.followButtons = document.querySelectorAll("[data-follow-btn]");
    this.aiButton = document.getElementById("openExploreAiBtn");

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

    this.filterButtons.forEach((button) => {
      button.addEventListener("click", () => this.setActiveFilter(button));
    });

    this.followButtons.forEach((button) => {
      button.addEventListener("click", () => this.toggleFollow(button));
    });

    if (this.aiButton) {
      this.aiButton.addEventListener("click", () => {
        ViewUtils.redirect("aiHelp");
      });
    }
  },

  handleSearch() {
    const query = this.searchInput?.value.trim() || "";
    if (!query) {
      alert("Enter something to explore.");
      return;
    }

    alert(`Search for "${query}" will be connected to live results in the backend stage.`);
  },

  setActiveFilter(activeButton) {
    this.filterButtons.forEach((button) => button.classList.remove("active"));
    activeButton.classList.add("active");
  },

  toggleFollow(button) {
    const isFollowing = button.dataset.following === "true";
    button.dataset.following = isFollowing ? "