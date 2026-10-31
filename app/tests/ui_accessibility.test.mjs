import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const accountUi = readFileSync(new URL("../js/account_ui.mjs", import.meta.url), "utf8");
const budgetUi = readFileSync(new URL("../js/budget_ui.mjs", import.meta.url), "utf8");


test("account and budget forms keep keyboard and error feedback hooks", () => {
  assert.match(html, /class="skip-link" href="#main-content"/);
  assert.match(html, /id="signup-form"[^>]*novalidate/);
  assert.match(html, /id="login-form"[^>]*novalidate/);
  assert.match(html, /name="email" type="email"[^>]*required/);
  assert.match(html, /name="password" type="password"[^>]*required/);
  assert.match(html, /id="transaction-amount"[^>]*type="number"[^>]*required/);
  assert.match(html, /id="transaction-errors"[^>]*role="alert"[^>]*tabindex="-1"/);
  assert.match(accountUi, /loginForm\.reportValidity\(\)/);
  assert.match(accountUi, /signupForm\.reportValidity\(\)/);
  assert.match(accountUi, /resetRequestForm\.reportValidity\(\)/);
  assert.match(accountUi, /resetForm\.reportValidity\(\)/);
  assert.match(accountUi, /The passwords do not match\./);
  assert.match(budgetUi, /errorBox\.focus\(\)/);
});


test("layout has tablet and phone breakpoints that stack the planner and header", () => {
  assert.match(styles, /@media\s*\(max-width:\s*900px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*600px\)/);
  assert.match(styles, /scroll-padding-top:\s*6rem/);
  assert.match(styles, /scroll-padding-top:\s*10rem/);
  assert.match(styles, /\.form-layout\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(styles, /\.header-inner\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(styles, /\.transaction-form\s*\{/);
});


class TextNode {
  constructor(value, parentElement) {
    this.nodeType = 3;
    this.nodeValue = value;
    this.parentElement = parentElement;
  }
}


class Element {
  constructor() {
    this.nodeType = 1;
    this.attributes = new Map();
    this.childNodes = [];
  }

  set textContent(value) {
    this.childNodes = [new TextNode(String(value), this)];
  }

  get textContent() {
    return this.childNodes.map((node) => node.nodeValue ?? "").join("");
  }

  append(node) {
    node.parentElement = this;
    this.childNodes.push(node);
  }

  closest() {
    return null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener() {}

  querySelectorAll() {
    const descendants = [];
    const visit = (element) => {
      for (const child of element.childNodes) {
        if (child.nodeType === 1) {
          descendants.push(child);
          visit(child);
        }
      }
    };
    visit(this);
    return descendants;
  }
}


test("language switch returns translated text to English, including later text changes", async () => {
  const body = new Element();
  const headline = new Element();
  headline.textContent = "Your money, your plan";
  body.append(headline);
  const button = new Element();
  button.textContent = "हिंदी";
  button.setAttribute("aria-label", "Switch language");

  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.CustomEvent = class {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };
  globalThis.MutationObserver = class {
    observe() {}
  };
  globalThis.document = {
    body,
    documentElement: { lang: "en" },
    querySelector: (selector) => selector === "#language-toggle" ? button : null,
    createTreeWalker(root) {
      const nodes = [];
      const visit = (element) => {
        for (const child of element.childNodes) {
          if (child.nodeType === 3) nodes.push(child);
          else visit(child);
        }
      };
      visit(root);
      return { nextNode: () => nodes.shift() ?? null };
    },
  };
  globalThis.window = {
    localStorage: {
      getItem: () => null,
      setItem() {},
    },
    dispatchEvent() {},
  };

  await import("../js/i18n.mjs?ui-test=" + Date.now());
  assert.equal(window.financeLanguage(), "en");

  window.setFinanceLanguage("hi");
  assert.equal(document.documentElement.lang, "hi");
  assert.equal(headline.textContent, "आपका पैसा, आपकी योजना");
  assert.equal(button.textContent, "English");

  window.setFinanceLanguage("en");
  assert.equal(document.documentElement.lang, "en");
  assert.equal(headline.textContent, "Your money, your plan");
  assert.equal(button.textContent, "हिंदी");

  headline.childNodes[0].nodeValue = "Build a little breathing room";
  window.setFinanceLanguage("hi");
  assert.equal(headline.textContent, "थोड़ी आर्थिक राहत बनाएँ");
  window.setFinanceLanguage("en");
  assert.equal(headline.textContent, "Build a little breathing room");
});
