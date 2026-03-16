// Background Service Worker - WebSocket Client
// Manages connection to OpenClaw and communication with content scripts

import type { OutgoingMessage, IncomingMessage, PageSnapshot } from "../shared/types.ts";

interface TabConnection {
  tabId: number;
  port: chrome.runtime.Port;
  snapshot?: PageSnapshot;
}

// WebSocket connection to OpenClaw
let ws: WebSocket | null = null;
let wsUrl = "ws://localhost:18789/browser";
let reconnectInterval: number | null = null;
let isConnected = false;

// Active tab connections
const tabConnections = new Map<number, TabConnection>();

// Connect to OpenClaw WebSocket server
function connectWs() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("[OpenClaw] WebSocket connected");
      isConnected = true;
      if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMessage(message);
      } catch (err) {
        console.error("[OpenClaw] Failed to parse message:", err);
      }
    };

    ws.onclose = () => {
      console.log("[OpenClaw] WebSocket disconnected");
      isConnected = false;
      // Reconnect after 3 seconds
      if (!reconnectInterval) {
        reconnectInterval = window.setInterval(connectWs, 3000);
      }
    };

    ws.onerror = (err) => {
      console.error("[OpenClaw] WebSocket error:", err);
    };
  } catch (err) {
    console.error("[OpenClaw] Failed to connect:", err);
  }
}

// Handle message from OpenClaw
function handleMessage(message: OutgoingMessage) {
  // Get active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    const tabId = tabs[0].id;

    switch (message.type) {
      case "observe":
        // Send observe to content script
        sendToContent(tabId, message);
        break;

      case "act":
        sendToContent(tabId, message);
        break;

      case "open":
        // Navigate to URL
        if (message.payload.target === "new") {
          chrome.tabs.create({ url: message.payload.url });
        } else {
          chrome.tabs.update(tabId, { url: message.payload.url });
        }
        break;

      case "tabs":
        handleTabsMessage(tabId, message);
        break;

      case "extract":
        sendToContent(tabId, message);
        break;
    }
  });
}

// Handle tabs-specific messages
function handleTabsMessage(
  tabId: number,
  message: { payload: { action: string; tabId?: number; url?: string } },
) {
  const { action, tabId: targetTabId, url } = message.payload;

  switch (action) {
    case "list":
      chrome.tabs.query({}, (tabs) => {
        const tabList = tabs.map((t) => ({
          id: t.id,
          url: t.url || "",
          title: t.title || "",
          active: t.active,
        }));
        ws?.send(
          JSON.stringify({
            type: "tabs",
            payload: { success: true, tabs: tabList },
          }),
        );
      });
      break;

    case "create":
      chrome.tabs.create({ url }, (tab) => {
        ws?.send(
          JSON.stringify({
            type: "tabs",
            payload: {
              success: true,
              tabs: [{ id: tab.id, url: tab.url, title: tab.title, active: true }],
            },
          }),
        );
      });
      break;

    case "close":
      if (targetTabId) {
        chrome.tabs.remove(targetTabId, () => {
          ws?.send(
            JSON.stringify({
              type: "tabs",
              payload: { success: true },
            }),
          );
        });
      }
      break;

    case "activate":
      if (targetTabId) {
        chrome.tabs.update(targetTabId, { active: true }, () => {
          ws?.send(
            JSON.stringify({
              type: "tabs",
              payload: { success: true },
            }),
          );
        });
      }
      break;
  }
}

// Send message to content script in tab
function sendToContent(tabId: number, message: OutgoingMessage) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError) {
      ws?.send(
        JSON.stringify({
          type: message.type,
          payload: { success: false, error: chrome.runtime.lastError.message },
        }),
      );
      return;
    }

    // Forward response to OpenClaw
    if (response) {
      ws?.send(
        JSON.stringify({
          type: message.type,
          payload: response,
        }),
      );
    }
  });
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return;

  const tabId = sender.tab.id!;

  // Forward to WebSocket if connected
  if (isConnected && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: message.type,
        payload: message.payload,
        tabId,
      }),
    );
  }

  sendResponse({ received: true });
  return true;
});

// Handle installation
chrome.runtime.onInstalled.addListener(() => {
  console.log("[OpenClaw] Extension installed");
  connectWs();
});

// Handle startup
chrome.runtime.onStartup.addListener(() => {
  console.log("[OpenClaw] Browser started");
  connectWs();
});

// Initial connection
connectWs();
