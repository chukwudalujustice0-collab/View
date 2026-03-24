const ViewUtils = {
  getElement(selector, parent = document) {
    return parent.querySelector(selector);
  },

  getElements(selector, parent = document) {
    return Array.from(parent.querySelectorAll(selector));
  },

  on(element, eventName, handler) {
    if (!element) return;
    element.addEventListener(eventName, handler);
  },

  safeJsonParse(value, fallback = null) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  },

  saveToStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error("Storage save failed:", error);
      return false;
    }
  },

  getFromStorage(key, fallback = null) {
    try {
      const rawValue = localStorage.getItem(key);
      if (rawValue === null) return fallback;
      return this.safeJsonParse(rawValue, fallback);
    } catch (error) {
      console.error("Storage read failed:", error);
      return fallback;
    }
  },

  removeFromStorage(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error("Storage remove failed:", error);
      return false;
    }
  },

  redirect(pageKey) {
    if (!VIEW_CONFIG?.pages?.[pageKey]) {
      console.warn(`Unknown page key: ${pageKey}`);
      return;
    }
    window.location.href = VIEW_CONFIG.pages[pageKey];
  },

  setText(selector, value) {
    const element = this.getElement(selector);
    if (element) {
      element.textContent = value;
    }
  },

  show(element) {
    if (!element) return;
    element.style.display = "";
  },

  hide(element) {
    if (!element) return;
    element.style.display = "none";
  },

  togglePassword(inputId, toggleElement) {
    const input = document.getElementById(inputId);
    if (!input || !toggleElement) return;

    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    toggleElement.textContent = isPassword ? "Hide" : "Show";
  },

  generateSession() {
    return {
      id: `session_${Date.now()}`,
      createdAt: new Date().toISOString(),
      isAuthenticated: true
    };
  },

  formatCurrency(amount) {
    const safeAmount = Number(amount) || 0;
    return `${VIEW_CONFIG.ui.currency}${safeAmount.toLocaleString("en-NG")}`;
  },

  isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
  },

  showMessage(container, message, type = "info") {
    if (!container) return;

    const colors = {
      info: "#0b5ed7",
      success: "#16a34a",
      error: "#dc2626",
      warning: "#f59e0b"
    };

    container.textContent = message;
    container.style.display = "block";
    container.style.color = colors[type] || colors.info;
  },

  clearMessage(container) {
    if (!container) return;
    container.textContent = "";
    container.style.display = "none";
  }
};