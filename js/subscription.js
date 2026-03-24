const SubscriptionsPage = {
  init() {
    ViewAuth.requireAuth();

    this.planButtons = document.querySelectorAll("[data-select-plan]");
    this.currentPlanElements = document.querySelectorAll("[data-current-plan]");
    this.billingToggleButtons = document.querySelectorAll("[data-billing-toggle]");
    this.cancelButtons = document.querySelectorAll("[data-cancel-plan]");
    this.currentPlan = "Pro Monthly";

    this.bindEvents();
    this.renderCurrentPlan();
  },

  bindEvents() {
    this.planButtons.forEach((button) => {
      button.addEventListener("click", () => this.selectPlan(button));
    });

    this.billingToggleButtons.forEach((button) => {
      button.addEventListener("click", () => this.setBillingCycle(button));
    });

    this.cancelButtons.forEach((button) => {
      button.addEventListener("click", () => this.cancelPlan());
    });
  },

  renderCurrentPlan() {
    this.currentPlanElements.forEach((element) => {
      element.textContent = this.currentPlan;
    });
  },

  selectPlan(button) {
    const planName = button.dataset.selectPlan || "Plan";
    const confirmed = confirm(`Switch to ${planName}?`);

    if (!confirmed) return;

    this.currentPlan = planName;
    this.renderCurrentPlan();
    alert(`Subscription updated to ${planName}.`);
  },

  setBillingCycle(activeButton) {
    this.billingToggleButtons.forEach((button) => button.classList.remove("active"));
    activeButton.classList.add("active");

    const cycle = activeButton.dataset.billingToggle || "monthly";
    alert(`Billing cycle set to ${cycle}.`);
  },

  cancelPlan() {
    const confirmed = confirm("Cancel your current subscription?");
    if (!confirmed) return;

    this.currentPlan = "Starter";
    this.renderCurrentPlan();
    alert("Subscription cancelled. You are now on Starter plan.");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  SubscriptionsPage.init();
});