import { describe, expect, it } from "vitest";
import { DerivConnection, type SocketLike } from "../src/connection";

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe("deriv connection skeleton", () => {
  it("reports IDLE before connect and STOPPED after disconnect without a socket", async () => {
    const conn = new DerivConnection({ appId: "1089", endpoint: "wss://ws.derivws.com/websockets/v3" }, silent);
    expect(conn.getStatus()).toBe("IDLE");
    await conn.disconnect();
    expect(conn.getStatus()).toBe("STOPPED");
  });

  it("rejects connect with an invalid app id before opening any socket", async () => {
    const conn = new DerivConnection({ appId: "bad id", endpoint: "wss://ws.derivws.com/websockets/v3" }, silent, { socketFactory: () => { throw new Error("SOCKET_SHOULD_NOT_OPEN"); } });
    await expect(conn.connect()).rejects.toThrow("application ID");
  });

  it("passes an alphanumeric app id through to the WebSocket URL", async () => {
    const socket = {
      readyState: 0,
      send: () => undefined,
      close: () => undefined,
      terminate: () => undefined,
      on: (event: string, listener: (...args: unknown[]) => void) => { if (event === "open") queueMicrotask(() => listener()); },
    } as SocketLike;
    let openedUrl = "";
    const conn = new DerivConnection({ appId: "app-42A", endpoint: "wss://ws.derivws.com/websockets/v3" }, silent, { socketFactory: url => { openedUrl = url; return socket; } });
    await conn.connect();
    expect(openedUrl).toBe("wss://ws.derivws.com/websockets/v3?app_id=app-42A");
    await conn.disconnect();
  });

  it("returns an unsubscribe function for message listeners", () => {
    const conn = new DerivConnection({ appId: "1089", endpoint: "wss://ws.derivws.com/websockets/v3" }, silent);
    const off = conn.onMessage(() => undefined);
    expect(typeof off).toBe("function");
    off();
  });
});
