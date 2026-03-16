/**
 * browser_ws_open - Tool for opening URLs in browser via extension
 */

export const browser_ws_open = {
  name: "browser_ws_open",
  description: "Open a URL in the browser",
  params: {
    url: { type: "string", required: true },
    target: { type: "string", enum: ["active", "new"], default: "active" },
  },
};
