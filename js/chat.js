const ChatPage = {
  init() {
    ViewAuth.requireAuth();

    this.messageInput = document.getElementById("chatMessageInput");
    this.sendButton = document.getElementById("sendMessageBtn");
    this.voiceButton = document.getElementById("voiceNoteBtn");
    this.callButtons = document.querySelectorAll("[data-chat-call]");
    this.toolButtons = document.querySelectorAll("[data-chat-tool]");
    this.actionButtons = document.querySelectorAll("[data-message-action]");
    this.replyCloseButton = document.getElementById("closeReplyBox");
    this.replyBox = document.getElementById("replyingBox");

    this.bindEvents();
  },

  bindEvents() {
    if (this.sendButton) {
      this.sendButton.addEventListener("click", () => this.sendMessage());
    }

    if (this.messageInput) {
      this.messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          this.sendMessage();
        }
      });
    }

    if (this.voiceButton) {
      this.voiceButton.addEventListener("click", () => {
        alert("Voice note recording will be connected in the next stage.");
      });
    }

    this.callButtons.forEach((button) => {
      button.addEventListener("click", () => {