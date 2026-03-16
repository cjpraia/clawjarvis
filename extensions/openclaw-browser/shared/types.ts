// Shared types between background script and content script

export interface AccessibilityNode {
  role: string;
  name: string;
  value?: string;
  children?: AccessibilityNode[];
}

export interface PageSnapshot {
  url: string;
  title: string;
  timestamp: number;
  tree: AccessibilityNode;
  urlHash: string;
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

export type ActionType = "click" | "type" | "hover" | "scroll" | "press" | "select";

export interface ElementSelector {
  ref?: string;
  role?: string;
  text?: string;
  label?: string;
}

export interface ActionMessage {
  type: "act";
  payload: {
    action: ActionType;
    selector: ElementSelector;
    value?: string;
  };
}

export interface ObserveMessage {
  type: "observe";
  payload: {
    mode: "aria" | "snapshot";
  };
}

export interface OpenMessage {
  type: "open";
  payload: {
    url: string;
    target: "active" | "new";
  };
}

export interface TabsMessage {
  type: "tabs";
  payload: {
    action: "list" | "create" | "close" | "activate";
    tabId?: number;
    url?: string;
  };
}

export interface ExtractMessage {
  type: "extract";
  payload: {
    fields: Array<{
      name: string;
      selector: string;
      type: "text" | "attribute" | "href" | "screenshot";
      attribute?: string;
    }>;
  };
}

export type OutgoingMessage =
  | ActionMessage
  | ObserveMessage
  | OpenMessage
  | TabsMessage
  | ExtractMessage;

export interface ObserveResponse {
  type: "observe";
  payload: {
    success: boolean;
    snapshot?: PageSnapshot;
    error?: string;
  };
}

export interface ActionResponse {
  type: "action";
  payload: ActionResult;
}

export interface TabsResponse {
  type: "tabs";
  payload: {
    success: boolean;
    tabs?: Array<{ id: number; url: string; title: string; active: boolean }>;
    error?: string;
  };
}

export interface ExtractResponse {
  type: "extract";
  payload: {
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  };
}

export type IncomingMessage = ObserveResponse | ActionResponse | TabsResponse | ExtractResponse;
