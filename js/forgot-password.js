const ForgotPasswordPage = {
  init() {
    this.form = document.getElementById("forgotPasswordForm");
    this.emailInput = document.getElementById("resetEmail");
    this.successMessage = document.getElementById("successMessage");
    this.messageBox = document.getElementById("forgotPasswordMessage");

    this.bindEvents();
  },

  bindEvents() {
    if (this.form) {
      this.form.addEventListener("submit", (event) => {
        event.preventDefault();
        this.handleSubmit();
      });
    }
  },

  handleSubmit() {
    const email = this.emailInput?.value.trim() || "";

    ViewUtils.clearMessage(this.messageBox);
    if (this.successMessage) this.successMessage.style.display = "none";

    if (!email) {
      ViewUtils.showMessage(this.messageBox, "Enter your email address.", "error");
      return;
    }

    if (!ViewUtils.isEmail(email)) {
      ViewUtils.showMessage(this.messageBox, "Enter a valid email address.", "error");
      return;
    }

    if (this.successMessage) {
      this.successMessage.style.display = "block";
    }

    ViewUtils.showMessage(
      this.messageBox,
      "Reset link request accepted. Check your email.",
      "success"
    );
  }
};

document.addEventListener("DOMContentLoaded", () => {
  ForgotPasswordPage.init();
});