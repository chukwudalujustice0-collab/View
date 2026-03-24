const MessagesPage = {
  init() {
    ViewAuth.requireAuth();

    this.searchInput = document.getElementById("messagesSearch");
    this.searchButton = document.getElementById("messagesSearchBtn");
    this.filterButtons = document.querySelectorAll("[data-message-filter]");
    this.chatOpenButtons = document.querySelectorAll("[data-open-chat]");
    this.callButtons = document.querySelectorAll("[data-open-call]");
    this.archiveButtons = document.querySelectorAll("[data-archive-chat]");
    this.pinButtons = document.querySelectorAll("[data-pin-chat]");
    this.markUnreadButtons = document.querySelectorAll("[data-mark-unread]");

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

    this.chatOpenButtons.forEach((button) => {
      button.addEventListener("click", () => ViewUtils.redirect("chat"));
    });

    this.callButtons.forEach((button) => {
      button.addEventListener("click", () => ViewUtils.redirect("call"));
    });

    this.archiveButtons.forEach((button) => {
      button.addEventListener("click", () => this.toggleArchive(button));
    });

    this.pinButtons.forEach((button) => {
      button.addEventListener("click", () => this.togglePin(button));
    });

    this.markUnreadButtons.forEach((button) => {
      button.addEventListener("click", () => this.markUnread(button));
    });
  },

  handleSearch() {
    const query = this.searchInput?.value.trim() || "";
    if (!query) {
      alert("Enter something to search in messages.");
      return;
    }

    alert(`Searching chats for "${query}" will be connected to live data later.`);
  },

  setActiveFilter(activeButton) {
    this.filterButtons.forEach((button) => button.classList.remove("active"));
    activeButton.classList.add("active");
  },

  toggleArchive(button) {
    const archived = button.dataset.archived === "true";
    button.dataset.archived = archived ? "false" : "true";
    button.textContent = archived ? "Archive" : "Archived";
  },

  togglePin(button) {
    const pinned = button.dataset.pinned === "true";
    button.dataset.pinned = pinned ? "false" : "true";
    button.textContent = pinned ? "Pin" : "Pinned";
  },

  markUnread(button) {
    button.textContent = "Unread";
    const card = button.closest("[data-chat-card]");
    if (card) {
      card.classList.add("unread");
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  MessagesPage.init();
});