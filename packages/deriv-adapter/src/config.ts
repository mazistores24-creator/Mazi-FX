export interface DerivConfig {
  appId: string;
  endpoint: string;
}

/** Deriv documents app_id as a registered application identifier, not numeric-only. */
export function assertDerivAppId(appId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(appId)) {
    throw new Error("DERIV_APP_ID must be a non-empty application ID using letters, numbers, hyphens, or underscores");
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
