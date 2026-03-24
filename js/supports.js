const SupportPage = {
  init() {
    this.form = document.getElementById("supportForm");
    this.input = document.getElementById("supportMessage");

    this.bindEvents();
  },

  bindEvents() {
    if (this.form) {
      this.form.addEventListener("submit", (e) => {
        e.preventDefault();
        this.submitMessage();
      });
    }
  },

  submitMessage() {
    const msg = this.input?.value.trim();
    if (!msg) {
      alert("Enter your message.");
      return;
    }

    alert("Support request sent successfully.");
    this.input.value = "";
  }
};

document.addEventListener("DOMContentLoaded", () => {
  SupportPage.init();
});