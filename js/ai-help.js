const AiHelpPage = {
  init() {
    ViewAuth.requireAuth();

    this.input = document.getElementById("aiInput");
    this.sendBtn = document.getElementById("sendAiBtn");
    this.quickBtns = document.querySelectorAll("[data-ai-quick]");
    this.chatContainer = document.getElementById("aiChatBox");

    this.bindEvents();
  },

  bindEvents() {
    if (this.sendBtn) {
      this.sendBtn.addEventListener("click", () => this.sendMessage());
    }

    if (this.input) {
      this.input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.sendMessage();
        }
      });
    }

    this.quickBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        this.input.value = btn.dataset.aiQuick;
        this.sendMessage();
      });
    });
  },

  sendMessage() {
    const text = this.input?.value.trim();
    if (!text) return;

    this.addMessage("user", text);
    this.input.value = "";

    setTimeout(() => {
      this.addMessage("ai", this.generateResponse(text));
    }, 600);
  },

  addMessage(type, text) {
    if (!this.chatContainer) return;

    const div = document.createElement("div");
    div.className = `ai-msg ${type}`;
    div.textContent = text;

    this.chatContainer.appendChild(div);
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  },

  generateResponse(text) {
    return "AI response will be connected to real intelligence later. For now, this is a smart placeholder.";
  }
};

document.addEventListener("DOMContentLoaded", () => {
  AiHelpPage.init();
});settingss.ht