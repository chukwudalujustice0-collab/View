let deferredPrompt;
const installBtn = document.getElementById("installAppBtn");

// Hide button by default
if (installBtn) {
  installBtn.style.display = "none";
}

// Listen for install prompt
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;

  // Show install button
  if (installBtn) {
    installBtn.style.display = "block";
  }
});

// Install function
function installViewApp() {
  if (!deferredPrompt) {
    alert("Install not available yet. Use browser menu ➜ Add to Home Screen");
    return;
  }

  deferredPrompt.prompt();

  deferredPrompt.userChoice.then((choiceResult) => {
    if (choiceResult.outcome === "accepted") {
      console.log("User installed the app");
    } else {
      console.log("User dismissed install");
    }

    deferredPrompt = null;
  });
}

// When app is installed
window.addEventListener("appinstalled", () => {
  console.log("View installed successfully");

  if (installBtn) {
    installBtn.style.display = "none";
  }
});
