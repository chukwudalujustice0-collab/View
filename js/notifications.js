const NotificationsPage = {
  init() {
    ViewAuth.requireAuth();

    this.filterButtons = document.querySelectorAll("[data-notification-filter]");
    this.markAllReadButton = document.getElementById("markAllReadBtn");
    this.notificationActionButtons = document.querySelectorAll("[data-notification-action]");
    this.notificationCards = document.querySelectorAll("[data-notification-card]");

    this.bindEvents();
  },

  bindEvents() {
    this.filterButtons.forEach((button) => {
      button.addEventListener("click", () => this.setActiveFilter(button));
    });

    if (this.markAllReadButton) {
      this.markAllReadButton.addEventListener("click", () => this.markAllAsRead());
    }

    this.notificationActionButtons.forEach((button) => {
      button.addEventListener("click", () => this.handleNotificationAction(button));
    });
  },

  setActiveFilter(activeButton) {
    this.filterButtons.forEach((button) => button.classList.remove("active"));
    activeButton.classList.add("active");
  },

  markAllAsRead() {
    this.notificationCards.forEach((card) => {
      card.classList.remove("unread");
      card.dataset.read = "true";
    });

    alert("All notifications marked as read.");
  },

  handleNotificationAction(button) {
    const action = button.dataset.notificationAction;
    const target = button.dataset.notificationTarget || "";

    switch (action) {
      case "open-post":
        ViewUtils.redirect("comments");
        break;
      case "open-chat":
        ViewUtils.redirect("chat");
        break;
      case "open-profile":
        ViewUtils.redirect("profile");
        break;
      case "open-call":
        ViewUtils.redirect("call");
        break;
      case "open-wallet":
        ViewUtils.redirect("wallet");
        break;
      case "dismiss":
        this.dismissNotification(button);
        break;
      default:
        alert(`Notification action ready: ${target || action}`);
        break;
    }
  },

  dismissNotification(button) {
    const card = button.closest("[data-notification-card]");
    if (card) {
      card.remove();
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  NotificationsPage.init();
});