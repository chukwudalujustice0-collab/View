const ResetPasswordPage = {
  init() {
    this.form = document.getElementById("resetPasswordForm");
    this.newPasswordInput = document.getElementById("newPassword");
    this.confirmPasswordInput = document.getElementById("confirmNewPassword");
    this.passwordError = document.getElementById("passwordError");
    this.messageBox = document.getElementById("resetPasswordMessage");
    this.successMessage = document.getElementById("successMessage");

    window.togglePassword = (inputId, toggleElement) => {
      const input = document.getElementById(inputId);
      if (!input) return;

      const show = input.type === "password";
      input.type = show ? "text" : "password";

      if (toggleElement) {
        toggleElement.textContent = show ? "Hide" : "Show";
      }
    };

    if (this.form) {
      this.form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await this.handleSubmit();
      });
    }
  },

  showMessage(message, type = "error") {
    if (this.messageBox) {
      this.messageBox.style.display = "block";
      this.messageBox.textContent = message;
      this.messageBox.style.color = type === "success" ? "#16a34a" : "#dc2626";
    }
    if (this.successMessage) {
      this.successMessage.style.display = "none";
    }
  },

  showSuccess() {
    if (this.messageBox) {
      this.messageBox.style.display = "none";
      this.messageBox.textContent = "";
    }
    if (this.successMessage) {
      this.successMessage.style.display = "block";
    }
  },

  clearPasswordError() {
    if (this.passwordError) {
      this.passwordError.style.display = "none";
    }
  },

  async handleSubmit() {
    const newPassword = this.newPasswordInput?.value || "";
    const confirmPassword = this.confirmPasswordInput?.value || "";

    this.clearPasswordError();

    if (!newPassword || !confirmPassword) {
      this.showMessage("Complete both password fields.");
      return;
    }

    if (newPassword.length < 6) {
      this.showMessage("Password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      if (this.passwordError) this.passwordError.style.display = "block";
      this.showMessage("Passwords do not match.");
      return;
    }

    try {
      const { error } = await supabaseClient.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      this.showSuccess();
      if (this.form) this.form.reset();

      setTimeout(() => {
        window.location.href = "login.html";
      }, 1500);
    } catch (error) {
      console.error(error);
      this.showMessage(error.message || "Could not reset password.");
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  ResetPasswordPage.init();
});