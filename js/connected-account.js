const PublishHistoryPage = {
  init() {
    ViewAuth.requireAuth();

    this.filterButtons = document.querySelectorAll("[data-publish-filter]");
    this.retryButtons = document.querySelectorAll("[data-retry-publish]");
    this.detailsButtons = document.querySelectorAll("[data-publish-details]");
    this.searchInput = document.getElementById("publishHistorySearch");
    this.searchButton = document.getElementById("publishHistorySearchBtn");

    this.bindEvents();
  },

  bindEvents() {
    this.filterButtons.forEach((button) => {
      button.addEventListener("click", () => this.setActiveFilter(button));
    });

    this.retryButtons.forEach((button) => {
      button.addEventListener("click", () => this.retryPublish(button));
    });

    this.detailsButtons.forEach((button) => {
      button.addEventListener("click", () => this.openDetails(button));
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

  retryPublish(button) {
    const jobName = button.dataset.retryPublish || "publish job";
    alert(`Retry requested for ${jobName}.`);
  },

  openDetails(button) {
    const jobName = button.dataset.publishDetails || "publish job";
    alert(`Details for ${jobName} will be shown in the next stage.`);
  },

  handleSearch() {
    const query = this.searchInput?.value.trim() || "";
    if (!query) {
      alert("Enter something to search publish history.");
      return;
    }

    alert(`Searching publish history for "${query}" will be connected later.`);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  PublishHistoryPage.init();
});