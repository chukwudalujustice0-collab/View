const AboutPage = {
  init() {
    this.shareBtn = document.getElementById("shareAppBtn");

    this.bindEvents();
  },

  bindEvents() {
    if (this.shareBtn) {
      this.shareBtn.addEventListener("click", () => this.shareApp());
    }
  },

  shareApp() {
    const text = "Check out View — powered by Ceetify. A premium social and publishing platform.";

    if (navigator.share) {
      navigator.share({
        title: "View App",
        text,
        url: window.location.origin
      }).catch(() => {});
      return;
    }

    navigator.clipboard.writeText(text)
      .then(() => alert("App link copied."))
      .catch(() => alert("Share ready."));
  }
};

document.addEventListener("DOMContentLoaded", () => {
  AboutPage.init();
});