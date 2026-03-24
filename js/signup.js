const SignupPage = {
  async init() {
    const canStay = await ViewAuth.requireGuest();
    if (!canStay) return;

    this.form = document.getElementById("signupForm");
    this.fullNameInput = document.getElementById("fullName");
    this.usernameInput = document.getElementById("username");
    this.emailInput = document.getElementById("email");
    this.phoneInput = document.getElementById("phone");
    this.accountTypeInput = document.getElementById("accountType");
    this.passwordInput = document.getElementById("password");
    this.confirmPasswordInput = document.getElementById("confirmPassword");
    this.agreeTermsInput = document.getElementById("agreeTerms");
    this.googleButton = document.getElementById("googleSignupBtn");
    this.messageBox = document.getElementById("signupMessage");
    this.passwordError = document.getElementById("passwordError");

    this.bindEvents();
  },

  bindEvents() {
    if (this.form) {
      this.form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await this.handleSignup();
      });
    }

    if (this.googleButton) {
      this.googleButton.addEventListener("click", async () => {
        await this.handleGoogleSignup();
      });
    }
  },

  showMessage(message, type = "error") {
    if (!this.messageBox) return;
    this.messageBox.style.display = "block";
    this.messageBox.style.color = type === "success" ? "#16a34a" : "#dc2626";
    this.messageBox.textContent = message;
  },

  clearMessage() {
    if (this.messageBox) {
      this.messageBox.style.display = "none";
      this.messageBox.textContent = "";
    }
    if (this.passwordError) {
      this.passwordError.style.display = "none";
    }
  },

  async handleSignup() {
    const fullName = this.fullNameInput?.value.trim() || "";
    const username = this.usernameInput?.value.trim().toLowerCase() || "";
    const email = this.emailInput?.value.trim() || "";
    const phone = this.phoneInput?.value.trim() || "";
    const accountType = this.accountTypeInput?.value || "personal";
    const password = this.passwordInput?.value || "";
    const confirmPassword = this.confirmPasswordInput?.value || "";
    const agreed = !!this.agreeTermsInput?.checked;

    this.clearMessage();

    if (!fullName || !username || !email || !phone || !password || !confirmPassword) {
      this.showMessage("Complete all required fields.");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      this.showMessage("Username can only contain letters, numbers, and underscore.");
      return;
    }

    if (password.length < 6) {
      this.showMessage("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      if (this.passwordError) this.passwordError.style.display = "block";
      this.showMessage("Passwords do not match.");
      return;
    }

    if (!agreed) {
      this.showMessage("You must agree to the terms and privacy policy.");
      return;
    }

    try {
      const exists = await ViewAuth.usernameExists(username);
      if (exists) {
        this.showMessage("Username already exists.");
        return;
      }

      await ViewAuth.signup({
        fullName,
        username,
        email,
        phone,
        accountType,
        password
      });

      this.showMessage("Signup successful. Check your email to confirm your account.", "success");
    } catch (error) {
      console.error("Signup error:", error);
      this.showMessage(error.message || "Signup failed.");
    }
  },

  async handleGoogleSignup() {
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
      console.error("Google signup error:", error);
      this.showMessage(error.message || "Google signup failed.");
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  SignupPage.init();
});