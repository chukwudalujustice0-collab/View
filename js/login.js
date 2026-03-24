const LoginPage = {
  async init() {
    const canStay = await ViewAuth.requireGuest();
    if (!canStay) return;

    this.form = document.getElementById("loginForm");
    this.emailInput = document.getElementById("email");
    this.passwordInput = document.getElementById("password");
    this.googleButton = document.getElementById("googleLoginBtn");
    this.messageBox = document.getElementById("loginMessage");

    this.bindEvents();

    window.togglePassword = (inputId, toggleElement) => {
      const input = document.getElementById(inputId);
      if (!input) return;

      const show = input.type === "password";
      input.type = show ? "text" : "password";

      if (toggleElement) {
        toggleElement.textContent = show ? "Hide" : "Show";
      }
    };
  },

  bindEvents() {
    if (this.form) {
      this.form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await this.handleLogin();
      });
    }

    if (this.googleButton) {
      this.googleButton.addEventListener("click", async () => {
        await this.handleGoogleLogin();
      });
    }
  },

  showMessage(message, type = "error") {
    if (!this.messageBox) return;
    this.messageBox.style.display = "block";
    this.messageBox.textContent = message;
    this.messageBox.style.color = type === "success" ? "#16a34a" : "#dc2626";
  },

  clearMessage() {
    if (!this.messageBox) return;
    this.messageBox.style.display = "none";
    this.messageBox.textContent = "";
  },

  async handleLogin() {
    const loginValue = this.emailInput?.value.trim() || "";
    const password = this.passwordInput?.value || "";

    this.clearMessage();

    if (!loginValue || !password) {
      this.showMessage("Enter your email or username and password.");
      return;
    }

    try {
      await ViewAuth.login(loginValue, password);
      this.showMessage("Login successful. Redirecting...", "success");

      setTimeout(() => {
        window.location.href = VIEW_CONFIG.pages.dashboard;
      }, 500);
    } catch (error) {
      console.error(error);
      this.showMessage(error.message || "Login failed.");
    }
  },

  async handleGoogleLogin() {
    this.clearMessage();

    try {
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + "/" + VIEW_CONFIG.pages.dashboard
        }
      });

      if (error) throw error;
    } catch (error) {
      console.error(error);
      this.showMessage(error.message || "Google login failed.");
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  LoginPage.init();
});