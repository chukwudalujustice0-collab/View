const FAQPage = {
  init() {
    this.questions = document.querySelectorAll("[data-faq-question]");

    this.bindEvents();
  },

  bindEvents() {
    this.questions.forEach(q => {
      q.addEventListener("click", () => {
        const answer = q.nextElementSibling;
        if (!answer) return;

        answer.classList.toggle("open");
      });
    });
  }
};

document.addEventListener("DOMContentLoaded", () => {
  FAQPage.init();
});