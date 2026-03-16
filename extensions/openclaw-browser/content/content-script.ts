// Content Script - Runs in each page
// Handles interactions with the page

import type {
  ActionMessage,
  ObserveMessage,
  OpenMessage,
  TabsMessage,
  ExtractMessage,
  ActionResult,
  PageSnapshot,
  AccessibilityNode,
} from "../shared/types.ts";

let port: chrome.runtime.Port | null = null;

// Connect to background script
function connect() {
  port = chrome.runtime.connect({ name: "content-script" });

  port.onMessage.addListener((message) => {
    handleMessage(message);
  });

  port.onDisconnect.addListener(() => {
    // Reconnect after delay
    setTimeout(connect, 1000);
  });
}

// Handle messages from background script
function handleMessage(message: { type: string; payload: unknown }) {
  switch (message.type) {
    case "observe":
      handleObserve(message.payload as { mode: "aria" | "snapshot" });
      break;
    case "act":
      handleAct(message.payload as { action: string; selector: unknown; value?: string });
      break;
    case "extract":
      handleExtract(
        message.payload as {
          fields: Array<{ name: string; selector: string; type: string; attribute?: string }>;
        },
      );
      break;
  }
}

// Get accessibility tree
function getAccessibilityTree(): AccessibilityNode {
  const snapshot = (
    window as unknown as { accessibility: { getAXTree?: () => AccessibilityNode } }
  ).accessibility?.getAXTree?.();

  if (snapshot) {
    return snapshot;
  }

  // Fallback: build basic tree from DOM
  return domToAccessibility(document.body);
}

// Convert DOM to accessibility tree
function domToAccessibility(element: Element): AccessibilityNode {
  const role = element.getAttribute("role") || getImplicitRole(element);
  const name =
    element.getAttribute("aria-label") ||
    element.getAttribute("aria-labelledby") ||
    (element as HTMLElement).innerText?.substring(0, 50) ||
    element.getAttribute("alt") ||
    "";

  const children: AccessibilityNode[] = [];

  for (const child of Array.from(element.children)) {
    try {
      children.push(domToAccessibility(child));
    } catch {
      // Skip elements that can't be accessed
    }
  }

  return {
    role,
    name,
    children: children.length > 0 ? children : undefined,
  };
}

// Get implicit role for element
function getImplicitRole(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const roleMap: Record<string, string> = {
    a: "link",
    button: "button",
    input: "textbox",
    select: "combobox",
    textarea: "textbox",
    nav: "navigation",
    main: "main",
    aside: "complementary",
    header: "banner",
    footer: "contentinfo",
    form: "form",
    table: "table",
    ul: "list",
    ol: "list",
    li: "listitem",
    h1: "heading",
    h2: "heading",
    h3: "heading",
    h4: "heading",
    h5: "heading",
    h6: "heading",
  };
  return roleMap[tag] || "region";
}

// Handle observe message
function handleObserve(payload: { mode: "aria" | "snapshot" }): void {
  const snapshot: PageSnapshot = {
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    urlHash: btoa(window.location.href).substring(0, 20),
    tree: getAccessibilityTree(),
  };

  port?.postMessage({
    type: "observe",
    payload: {
      success: true,
      snapshot,
    },
  });
}

// Find element by selector
function findElement(selector: { role?: string; text?: string; label?: string }): Element | null {
  // Try role + text
  if (selector.role && selector.text) {
    const elements = document.querySelectorAll(`[role="${selector.role}"]`);
    for (const el of elements) {
      const text = (el as HTMLElement).innerText || el.getAttribute("aria-label") || "";
      if (text.toLowerCase().includes(selector.text.toLowerCase())) {
        return el;
      }
    }
  }

  // Try role only
  if (selector.role) {
    const elements = document.querySelectorAll(`[role="${selector.role}"]`);
    if (elements.length === 1) {
      return elements[0];
    }
  }

  // Try text
  if (selector.text) {
    const elements = document.querySelectorAll('button, a, [role="button"], [role="link"]');
    for (const el of elements) {
      const text = (el as HTMLElement).innerText || el.getAttribute("aria-label") || "";
      if (text.toLowerCase().includes(selector.text.toLowerCase())) {
        return el;
      }
    }
  }

  // Try label
  if (selector.label) {
    const label = document.querySelector(`label:has-text("${selector.label}")`);
    if (label) {
      const input = label.querySelector("input, textarea, select");
      if (input) return input as Element;
    }
  }

  return null;
}

// Handle action message
function handleAct(payload: { action: string; selector: unknown; value?: string }): void {
  const selector = payload.selector as { role?: string; text?: string; label?: string };
  const element = findElement(selector);

  let result: ActionResult;

  if (!element) {
    result = {
      success: false,
      error: `Element not found: ${JSON.stringify(selector)}`,
    };
  } else {
    try {
      switch (payload.action) {
        case "click":
          (element as HTMLElement).click();
          break;
        case "type":
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            element.value = payload.value || "";
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
          }
          break;
        case "hover":
          element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          break;
        case "scroll":
          element.scrollIntoView();
          break;
        case "press":
          element.dispatchEvent(
            new KeyboardEvent("keydown", { key: payload.value || "Enter", bubbles: true }),
          );
          break;
      }
      result = { success: true };
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  port?.postMessage({
    type: "action",
    payload: result,
  });
}

// Handle extract message
function handleExtract(payload: {
  fields: Array<{ name: string; selector: string; type: string; attribute?: string }>;
}): void {
  const data: Record<string, unknown> = {};

  for (const field of payload.fields) {
    const element = findElement({ text: field.selector });
    if (!element) {
      data[field.name] = null;
      continue;
    }

    switch (field.type) {
      case "text":
        data[field.name] = (element as HTMLElement).innerText;
        break;
      case "attribute":
        data[field.name] = element.getAttribute(field.attribute || "value");
        break;
      case "href":
        data[field.name] = (element as HTMLAnchorElement).href;
        break;
      case "screenshot":
        // Would require html2canvas or similar
        data[field.name] = null;
        break;
    }
  }

  port?.postMessage({
    type: "extract",
    payload: {
      success: true,
      data,
    },
  });
}

// Initialize
connect();

// Expose for debugging
(window as unknown as { openclaw: { getTree: () => AccessibilityNode } }).openclaw = {
  getTree: getAccessibilityTree,
};
