const DraftsPage = {
  init() {
    ViewAuth.requireAuth();

    this.searchInput = document.getElementById("draftsSearch");
    this.searchButton = document.getElementById("draftsSearchBtn");
    this.openButtons = document.querySelectorAll("[data-open-draft]");
    this.deleteButtons = document.querySelectorAll("[data-delete-draft]");
    this.duplicateButtons = document.querySelectorAll("[data-duplicate-draft]");
    this.filterButtons = document.querySelectorAll("[data-draft-filter]");

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

    this.openButtons.forEach((button) => {
      button.addEventListener("click", () => this.openDraft(button));
    });

    this.deleteButtons.forEach((button) => {
      button.addEventListener("click", () => this.deleteDraft(button));
    });

    this.duplicateButtons.forEach((button) => {
      button.addEventListener("click", () => this.duplicateDraft(button));
    });

    this.filterButtons.forEach((button) => {
      button.addEventListener("click", () => this.setActiveFilter(button));
    });
  },

  handleSearch() {
    const query = this.searchInput?.value.trim() || "";
    if (!query) {
      alert("Enter something to search drafts.");
      return;
    }

    alert(`Searching drafts for "${query}" will be connected later.`);
  },

  openDraft(button) {
    const draftId = button.dataset.openDraft || "";
    if (draftId) {
      sessionStorage.setItem("view_open_draft_id", draftId);
    }
    ViewUtils.redirect("createPost");
  },

  deleteDraft(button) {
    const confirmed = confirm("Delete this draft?");
    if (!confirmed) return;

    const card = button.closest("[data-draft-card]");
    if (card) {
      card.remove();
    }
  },

  duplicateDraft(button) {
    const draftName = button.dataset.duplicateDraft || "draft";
    alert(`${draftName} duplicated.`);
  },

  setActiveFilter(activeButton) {
    this.filterButtons.forEach((button) => button.classList.remove("active"));
    activeButton.classList.add("active");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  DraftsPage.init();
});