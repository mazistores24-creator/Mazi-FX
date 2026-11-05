import { WebSocket } from "ws";
import type { ProviderConnectionStatus } from "@mazzi/core";
import { assertDerivAppId, assertDerivEndpoint, type DerivConfig } from "./config";
import { computeBackoffMs } from "./backoff";

export type ConnectionStatus = ProviderConnectionStatus;

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export type MessageListener = (message: Record<string, unknown>) => void;
export type StatusListener = (status: ConnectionStatus) => void;
export type ReconnectListener = () => void;

/** The subset of a WebSocket the connection uses. Tests inject a fake; production uses ws. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  terminate(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface ConnectionOptions {
  socketFactory?: (url: string) => SocketLike;
  /** Returns a value in [0, 1). Injected so backoff is deterministic in tests. */
  random?: () => number;
  keepaliveMs?: number;
  pongTimeoutMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

const WS_OPEN = 1;

/**
 * Deriv WebSocket connection. Responsibilities:
 * - connect with the numeric app id, refusing non-Deriv hosts and non-wss endpoints;
 * - keepalive: sends {ping:1} every keepaliveMs; if nothing arrives within pongTimeoutMs
 *   the socket is terminated, which triggers a reconnect;
 * - reconnect with exponential backoff and jitter after an unexpected close;
 * - notify reconnect listeners after each successful reconnect so subscriptions are restored.
 * Tokens are not used in Phase 2 market data and are never logged.
 */
export class DerivConnection {
  private socket: SocketLike | undefined;
  private status: ConnectionStatus = "IDLE";
  private attempt = 0;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly reconnectListeners = new Set<ReconnectListener>();
  private readonly factory: (url: string) => SocketLike;
  private readonly random: () => number;
  private readonly keepaliveMs: number;
  private readonly pongTimeoutMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;

  constructor(
    private readonly config: DerivConfig,
    private readonly log: Logger,
    options: ConnectionOptions = {},
  ) {
    this.factory = options.socketFactory ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.random = options.random ?? Math.random;
    this.keepaliveMs = options.keepaliveMs ?? 20_000;
    this.pongTimeoutMs = options.pongTimeoutMs ?? 10_000;
    this.backoffBaseMs = options.backoffBaseMs ?? 1_000;
    this.backoffMaxMs = options.backoffMaxMs ?? 60_000;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onReconnected(listener: ReconnectListener): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  /** Sends a JSON payload. Returns false when no open socket exists; nothing is queued. */
  send(payload: Record<string, unknown>): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WS_OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }

  async connect(): Promise<void> {
    assertDerivAppId(this.config.appId);
    assertDerivEndpoint(this.config.endpoint);
    if (this.status === "CONNECTED" || this.status === "CONNECTING") return;
    this.stopped = false;
    await this.open(true);
  }

  private open(initial: boolean): Promise<void> {
    const url = `${this.config.endpoint}?app_id=${encodeURIComponent(this.config.appId)}`;
    this.setStatus(initial ? "CONNECTING" : "RECONNECTING");
    return new Promise<void>((resolve, reject) => {
      let opened = false;
      const socket = this.factory(url);
      this.socket = socket;
      const fail = (err: Error): void => {
        if (initial && !opened) reject(err);
      };
      socket.on("open", () => {
        opened = true;
        this.attempt = 0;
        this.setStatus("CONNECTED");
        this.startKeepalive(socket);
        this.log.info("deriv socket open", { reconnect: !initial });
        if (!initial) for (const l of this.reconnectListeners) l();
        resolve();
      });
      socket.on("error", (err) => {
        this.log.warn("deriv socket error");
        fail(err instanceof Error ? err : new Error("deriv socket error"));
      });
      socket.on("message", (data) => {
        this.clearPong();
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(data));
        } catch {
          this.log.warn("deriv non-json frame dropped");
          return;
        }
        if (typeof parsed !== "object" || parsed === null) return;
        for (const l of this.messageListeners) l(parsed as Record<string, unknown>);
      });
      socket.on("close", () => {
        this.stopKeepalive();
        if (this.socket === socket) this.socket = undefined;
        if (this.stopped) return;
        if (initial && !opened) {
          this.setStatus("STOPPED");
          fail(new Error("deriv socket closed before open"));
          return;
        }
        this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.setStatus("RECONNECTING");
    const delayMs = computeBackoffMs(this.attempt, this.backoffBaseMs, this.backoffMaxMs, () => 0.5 + this.random() * 0.5);
    this.attempt++;
    this.log.warn("deriv reconnect scheduled", { delayMs, attempt: this.attempt });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.stopped) return;
      this.open(false).catch(() => undefined);
    }, delayMs);
  }

  private startKeepalive(socket: SocketLike): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (socket.readyState !== WS_OPEN) return;
      socket.send(JSON.stringify({ ping: 1 }));
      if (!this.pongTimer) {
        this.pongTimer = setTimeout(() => {
          this.pongTimer = undefined;
          this.log.warn("deriv keepalive timeout; forcing reconnect");
          socket.terminate();
        }, this.pongTimeoutMs);
      }
    }, this.keepaliveMs);
  }

  private clearPong(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = undefined;
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = undefined;
    this.clearPong();
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const l of this.statusListeners) l(next);
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.stopKeepalive();
    const socket = this.socket;
    this.socket = undefined;
    this.setStatus("STOPPED");
    if (socket && socket.readyState === WS_OPEN) socket.close();
  }
}
