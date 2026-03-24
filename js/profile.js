const CallPage = {
  init() {
    ViewAuth.requireAuth();

    this.acceptButton = document.getElementById("acceptCallBtn");
    this.declineButton = document.getElementById("declineCallBtn");
    this.endCallButton = document.getElementById("endCallBtn");
    this.holdButton = document.getElementById("holdCallBtn");
    this.timerElement = document.getElementById("callTimer");
    this.statusElement = document.getElementById("callStatusText");
    this.controlButtons = document.querySelectorAll("[data-call-control]");

    this.callSeconds = 138;
    this.timerInterval = null;

    this.bindEvents();
    this.startTimer();
  },

  bindEvents() {
    if (this.acceptButton) {
      this.acceptButton.addEventListener("click", () => {
        this.setStatus("Call connected");
      });
    }

    if (this.declineButton) {
      this.declineButton.addEventListener("click", () => {
        this.endCall("Call declined");
      });
    }

    if (this.endCallButton) {
      this.endCallButton.addEventListener("click", () => {
        this.endCall("Call ended");
      });
    }

    if (this.holdButton) {
      this.holdButton.addEventListener("click", () => {
        this.toggleHold();
      });
    }

    this.controlButtons.forEach((button) => {
      button.addEventListener("click", () => this.toggleControl(button));
    });
  },

  startTimer() {
    this.renderTimer();

    this.timerInterval = setInterval(() => {
      this.callSeconds += 1;
      this.renderTimer();
    }, 1000);
  },

  renderTimer() {
    if (!this.timerElement) return;

    const minutes = String(Math.floor(this.callSeconds / 60)).padStart(2, "0");
    const seconds = String(this.callSeconds % 60).padStart(2, "0");
    this.timerElement.textContent = `${minutes}:${seconds}`;
  },

  setStatus(text) {
    if (this.statusElement) {
      this.statusElement.textContent = text;
    }
  },

  toggleHold() {
    const isOnHold = this.holdButton?.dataset.hold === "true";
    const nextState = !isOnHold;

    if (this.holdButton) {
      this.holdButton.dataset.hold = String(nextState);
      this.holdButton.textContent = nextState ? "▶ Resume" : "⏳ Hold";
    }

    this.setStatus(nextState ? "Call on hold" : "Call connected");
  },

  toggleControl(button) {
    const active = button.dataset.active === "true";
    button.dataset.active = String(!active);
    button.classList.toggle("active", !active);
  },

  endCall(statusText) {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }

    this.setStatus(statusText);

    setTimeout(() => {
      ViewUtils.redirect("chat");
    }, 800);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  CallPage.init();
});