const EditProfilePage = {
  init() {
    ViewAuth.requireAuth();

    this.user = ViewAuth.getCurrentUser();

    this.fullNameInput = document.getElementById("fullName");
    this.usernameInput = document.getElementById("username");
    this.emailInput = document.getElementById("email");
    this.phoneInput = document.getElementById("phone");
    this.accountTypeInput = document.getElementById("accountType");
    this.locationInput = document.getElementById("location");
    this.bioInput = document.getElementById("bio");
    this.websiteInput = document.getElementById("website");

    this.saveButtons = document.querySelectorAll("[data-save-profile]");
    this.resetButton = document.getElementById("resetProfileBtn");
    this.deleteButton = document.getElementById("deleteAccountBtn");

    this.defaultProfile = {
      fullName: this.user?.fullName || "Justice",
      username: this.user?.username || "justice.view",
      email: this.user?.email || "justice@example.com",
      phone: this.user?.phone || "+234 806 493 4480",
      accountType: this.user?.accountType || "creator",
      location: "Owerri, Imo State",
      bio: "Building View step by step under Ceetify. Social, publishing, AI, chat, creator tools, and smart cross-posting all in one premium ecosystem.",
      website: "https://tech.ceetice.com"
    };

    this.fillForm();
    this.bindEvents();
  },

  bindEvents() {
    this.saveButtons.forEach((button) => {
      button.addEventListener("click", () => this.saveProfile());
    });

    if (this.resetButton) {
      this.resetButton.addEventListener("click", () => this.resetForm());
    }

    if (this.deleteButton) {
      this.deleteButton.addEventListener("click", () => this.deleteAccount());
    }
  },

  fillForm() {
    if (this.fullNameInput) this.fullNameInput.value = this.defaultProfile.fullName;
    if (this.usernameInput) this.usernameInput.value = this.defaultProfile.username;
    if (this.emailInput) this.emailInput.value = this.defaultProfile.email;
    if (this.phoneInput) this.phoneInput.value = this.defaultProfile.phone;
    if (this.accountTypeInput) this.accountTypeInput.value = this.defaultProfile.accountType;
    if (this.locationInput) this.locationInput.value = this.defaultProfile.location;
    if (this.bioInput) this.bioInput.value = this.defaultProfile.bio;
    if (this.websiteInput) this.websiteInput.value = this.defaultProfile.website;
  },

  collectFormData() {
    return {
      ...this.user,
      fullName: this.fullNameInput?.value.trim() || "",
      username: this.usernameInput?.value.trim() || "",
      email: this.emailInput?.value.trim() || "",
      phone: this.phoneInput?.value.trim() || "",
      accountType: this.accountTypeInput?.value || "creator"
    };
  },

  saveProfile() {
    const updatedUser = this.collectFormData();

    if (!updatedUser.fullName || !updatedUser.username || !updatedUser.email) {
      alert("Full name, username, and email are required.");
      return;
    }

    if (!ViewUtils.isEmail(updatedUser.email)) {
      alert("Enter a valid email address.");
      return;
    }

    ViewUtils.saveToStorage(VIEW_CONFIG.storageKeys.user, updatedUser);
    alert("Profile updated successfully.");
    ViewUtils.redirect("profile");
  },

  resetForm() {
    this.fillForm();
    alert("Profile form reset.");
  },

  deleteAccount() {
    const confirmed = confirm("Are you sure you want to delete this account?");
    if (!confirmed) return;

    ViewAuth.logout();
  }
};

document.addEventListener("DOMContentLoaded", () => {
  EditProfilePage.init();
});followers