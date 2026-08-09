import WebSocket from 'ws';

/**
 * Public Deriv market-data endpoint.
 *
 * The endpoint is configuration-driven: DERIV_PUBLIC_WS_URL may override it
 * per environment. No account credentials or App ID are required for public
 * market-data operations.
 */
const DEFAULT_PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';

export function getDerivPublicWebSocketUrl(): string {
  const configured = process.env.DERIV_PUBLIC_WS_URL?.trim();
  const url = configured || DEFAULT_PUBLIC_WS_URL;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') {
      throw new Error('DERIV_PUBLIC_WS_URL must use ws:// or wss://.');
    }
    return parsed.toString();
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Invalid DERIV_PUBLIC_WS_URL: ${error.message}`
        : 'Invalid DERIV_PUBLIC_WS_URL.',
    );
  }
}

export function openDerivPublicWebSocket(timeoutMs = 10_000): Promise<WebSocket> {
  const url = getDerivPublicWebSocketUrl();

  return new Promise((resolve, reject) => {
    let settled = false;
    let ws: WebSocket | null = null;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws?.close(); } catch {}
      reject(new Error('Deriv public WebSocket connection timed out.'));
    }, timeoutMs);

    try {
      ws = new WebSocket(url);

      ws.once('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(ws as WebSocket);
      });

      ws.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { ws?.close(); } catch {}
        reject(error instanceof Error ? error : new Error('Deriv public WebSocket connection failed.'));
      });

      ws.once('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error('Deriv public WebSocket closed before connection was established.'));
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error('Unable to create Deriv public WebSocket.'));
    }
  });
}
