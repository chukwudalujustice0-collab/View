const ViewApp = {
  deferredInstallPrompt: null,

  init() {
    this.setAppTitle();
    this.registerServiceWorker();
    this.handleInstallPrompt();
    this.bindInstallButtons();
    this.highlightCurrentNav();
  },

  setAppTitle() {
    const brandElements = document.querySelectorAll("[data-view-brand]");
    brandElements.forEach((element) => {
      element.textContent = VIEW_CONFIG.app.name;
    });

    const taglineElements = document.querySelectorAll("[data-view-tagline]");
    taglineElements.forEach((element) => {
      element.textContent = VIEW_CONFIG.app.tagline;
    });
  },

  registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/service-worker.js")
        .then((registration) => {
          console.log("Service Worker registered:", registration.scope);
        })
        .catch((error) => {
          console.error("Service Worker registration failed:", error);
        });
    });
  },

  handleInstallPrompt() {
    if (!VIEW_CONFIG.features.pwaInstall) return;

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.deferredInstallPrompt = event;
      this.showInstallButtons();
    });

    window.addEventListener("appinstalled", () => {
      this.deferredInstallPrompt = null;
      this.hideInstallButtons();
      ViewUtils.saveToStorage(
        VIEW_CONFIG.storageKeys.installPromptDismissed,
        true
      );
      console.log("View app installed successfully.");
    });
  },

  bindInstallButtons() {
    const installButtons = document.querySelectorAll("[data-install-app]");
    installButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        if (!this.deferredInstallPrompt) {
          alert("Install option is not available yet on this device/browser.");
          return;
        }

        this.deferredInstallPrompt.prompt();
        const choiceResult = await this.deferredInstallPrompt.userChoice;
        console.log("Install prompt result:", choiceResult.outcome);
        this.deferredInstallPrompt = null;
        this.hideInstallButtons();
      });
    });
  },

  showInstallButtons() {
    document.querySelectorAll("[data-install-app]").forEach((button) => {
      button.style.display = "";
    });
  },

  hideInstallButtons() {
    document.querySelectorAll("[data-install-app]").forEach((button) => {
      button.style.display = "none";
    });
  },

  highlightCurrentNav() {
    const currentPath = window.location.pathname.split("/").pop() || "index.html";
    const navLinks = document.querySelectorAll("[data-page-link]");

    navLinks.forEach((link) => {
      const targetPage = link.getAttribute("data-page-link");
      if (targetPage === currentPath) {
        link.classList.add("active");
      } else {
        link.classList.remove("active");
      }
    });
  }
};

document.addEventListener("DOMContentLoaded", () => {
  ViewApp.init();
});