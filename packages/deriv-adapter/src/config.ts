export interface DerivConfig {
  appId: string;
  endpoint: string;
}

/** Deriv app ids are numeric. The owner supplies DERIV_APP_ID. Demo only. */
export function assertDerivAppId(appId: string): void {
  if (!/^\d+$/.test(appId)) {
    throw new Error("DERIV_APP_ID must be numeric");
  }
}

/** Only the public, unauthenticated market-data endpoint family is allowed in Phase 2. */
export function assertDerivEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("DERIV_WS_ENDPOINT must be a valid URL");
  }
  if (url.protocol !== "wss:") throw new Error("DERIV_WS_ENDPOINT must use wss://");
  if (url.hostname !== "ws.derivws.com") throw new Error("DERIV_WS_ENDPOINT host must be ws.derivws.com");
}
