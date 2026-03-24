const SettingsPage = {
  init() {
    ViewAuth.requireAuth();

    this.toggleSwitches = document.querySelectorAll("[data-setting-toggle]");
    this.saveBtn = document.getElementById("saveSettingsBtn");
    this.logoutBtn = document.getElementById("logoutBtn");

    this.bindEvents();
  },

  bindEvents() {
    this.toggleSwitches.forEach(toggle => {
      toggle.addEventListener("click", () => {
        toggle.classList.toggle("active");
        toggle.dataset.enabled = toggle.classList.contains("active");
      });
    });

    if (this.saveBtn) {
      this.saveBtn.addEventListener("click", () => this.saveSettings());
    }

    if (this.logoutBtn) {
      this.logoutBtn.addEventListener("click", () => ViewAuth.logout());
    }
  },

  saveSettings() {
    alert("Settings saved successfully.");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  SettingsPage.init();
});