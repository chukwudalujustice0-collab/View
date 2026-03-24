const AnalyticsPage = {
  init() {
    ViewAuth.requireAuth();

    this.rangeButtons = document.querySelectorAll("[data-analytics-range]");
    this.metricButtons = document.querySelectorAll("[data-analytics-metric]");
    this.exportButtons = document.querySelectorAll("[data-export-analytics]");
    this.aiExplainButton = document.getElementById("openAnalyticsAiBtn");

    this.bindEvents();
    this.renderSummary();
  },

  bindEvents() {
    this.rangeButtons.forEach((button) => {
      button.addEventListener("click", () => this.setActiveRange(button));
    });

    this.metricButtons.forEach((button) => {
      button.addEventListener("click", () => this.setActiveMetric(button));
    });

    this.exportButtons.forEach((button) => {
      button.addEventListener("click", () => this.exportAnalytics(button));
    });

    if (this.aiExplainButton) {
      this.aiExplainButton.addEventListener("click", () => {
        ViewUtils.redirect("aiHelp");
      });
    }
  },

  renderSummary() {
    const map = {
      "[data-analytics-reach]": "24.8K",
      "[data-analytics-engagement]": "8.6K",
      "[data-analytics-clicks]": "1.9K",
      "[data-analytics-growth]": "+18%"
    };

    Object.entries(map).forEach(([selector, value]) => {
      document.querySelectorAll(selector).forEach((element) => {
        element.textContent = value;
      });
    });
  },

  setActiveRange(activeButton) {
    this.rangeButtons.forEach((button) => button.classList.remove("active"));
    activeButton.classList.add("active");
  },

  setActiveMetric(activeButton) {
    this.metricButtons.forEach((button) => button.classList.remove("active"));
    activeButton.classList.add("active");
  },

  exportAnalytics(button) {
    const type = button.dataset.exportAnalytics || "report";
    alert(`${type} export will be connected in the next stage.`);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  AnalyticsPage.init();
});