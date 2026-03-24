const WalletPage = {
  init() {
    ViewAuth.requireAuth();

    this.balanceElements = document.querySelectorAll("[data-wallet-balance]");
    this.fundButtons = document.querySelectorAll("[data-fund-wallet]");
    this.withdrawButtons = document.querySelectorAll("[data-withdraw-wallet]");
    this.transactionButtons = document.querySelectorAll("[data-wallet-transaction-action]");
    this.quickAmountButtons = document.querySelectorAll("[data-quick-amount]");
    this.amountInput = document.getElementById("walletAmountInput");

    this.currentBalance = 12450;

    this.bindEvents();
    this.renderBalance();
  },

  bindEvents() {
    this.fundButtons.forEach((button) => {
      button.addEventListener("click", () => this.fundWallet());
    });

    this.withdrawButtons.forEach((button) => {
      button.addEventListener("click", () => this.withdrawWallet());
    });

    this.transactionButtons.forEach((button) => {
      button.addEventListener("click", () => this.handleTransactionAction(button));
    });

    this.quickAmountButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const amount = button.dataset.quickAmount || "";
        if (this.amountInput) {
          this.amountInput.value = amount;
        }
      });
    });
  },

  renderBalance() {
    this.balanceElements.forEach((element) => {
      element.textContent = ViewUtils.formatCurrency(this.currentBalance);
    });
  },

  getInputAmount() {
    return Number(this.amountInput?.value || 0);
  },

  fundWallet() {
    const amount = this.getInputAmount();

    if (!amount || amount <= 0) {
      alert("Enter a valid amount to fund wallet.");
      return;
    }

    this.currentBalance += amount;
    this.renderBalance();
    alert(`Wallet funded with ${ViewUtils.formatCurrency(amount)}.`);
    if (this.amountInput) this.amountInput.value = "";
  },

  withdrawWallet() {
    const amount = this.getInputAmount();

    if (!amount || amount <= 0) {
      alert("Enter a valid amount to withdraw.");
      return;
    }

    if (amount > this.currentBalance) {
      alert("Insufficient wallet balance.");
      return;
    }

    this.currentBalance -= amount;
    this.renderBalance();
    alert(`Withdrawal request created for ${ViewUtils.formatCurrency(amount)}.`);
    if (this.amountInput) this.amountInput.value = "";
  },

  handleTransactionAction(button) {
    const action = button.dataset.walletTransactionAction;

    switch (action) {
      case "receipt":
        alert("Receipt view will be connected in the next stage.");
        break;
      case "details":
        alert("Transaction details will be connected in the next stage.");
        break;
      default:
        break;
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  WalletPage.init();
});