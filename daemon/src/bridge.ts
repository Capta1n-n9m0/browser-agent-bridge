import { BridgeError, ErrorCodes } from "@bridge/shared";
import { ExtensionConnection, type CallOptions } from "./connection.js";

const NOT_CONNECTED =
  "Extension not connected — is Chrome open and the Browser Agent Bridge extension enabled?";

export interface HostState {
  listening: boolean;
  port: number | null;
}

export class Bridge {
  private connection: ExtensionConnection | null = null;
  private reason: string | null = null;

  /** Diagnostic state of the WebSocket host, for `browser_status`. Set by the entry point. */
  hostState: HostState = { listening: false, port: null };

  setConnection(connection: ExtensionConnection | null): void {
    this.connection = connection;
  }

  isConnected(): boolean {
    return this.connection !== null;
  }

  currentConnection(): ExtensionConnection | null {
    return this.connection;
  }

  /**
   * Why the bridge can't work right now, when it's something more specific than "Chrome isn't
   * connected" — e.g. the WebSocket port is held by an orphaned instance. Surfaced through every
   * tool error so the agent sees the actual cause instead of a generic message. `null` clears it.
   */
  setUnavailableReason(reason: string | null): void {
    this.reason = reason;
  }

  unavailableReason(): string | null {
    return this.reason;
  }

  /** The NOT_CONNECTED error a call gets when no extension is connected (Step 6 text). */
  notConnectedError(): BridgeError {
    return new BridgeError(ErrorCodes.NOT_CONNECTED, this.reason ?? NOT_CONNECTED);
  }

  async call(method: string, params?: Record<string, unknown>, options?: CallOptions): Promise<unknown> {
    if (!this.connection) throw this.notConnectedError();
    return this.connection.call(method, params, options);
  }
}
