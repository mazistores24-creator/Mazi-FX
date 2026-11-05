import { describe, expect, it } from "vitest";
import { DerivConnection } from "../src/connection";

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe("deriv connection skeleton", () => {
  it("reports IDLE before connect and STOPPED after disconnect without a socket", async () => {
    const conn = new DerivConnection({ appId: "1089", endpoint: "wss://ws.derivws.com/websockets/v3" }, silent);
    expect(conn.getStatus()).toBe("IDLE");
    await conn.disconnect();
    expect(conn.getStatus()).toBe("STOPPED");
  });

  it("rejects connect with an invalid app id before opening any socket", async () => {
    const conn = new DerivConnection({ appId: "bad", endpoint: "wss://ws.derivws.com/websockets/v3" }, silent);
    await expect(conn.connect()).rejects.toThrow("numeric");
  });

  it("returns an unsubscribe function for message listeners", () => {
    const conn = new DerivConnection({ appId: "1089", endpoint: "wss://ws.derivws.com/websockets/v3" }, silent);
    const off = conn.onMessage(() => undefined);
    expect(typeof off).toBe("function");
    off();
  });
});
