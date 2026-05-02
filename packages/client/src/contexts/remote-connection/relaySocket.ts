import {
  isRelayClientConnected,
  isRelayClientError,
} from "@yep-anywhere/shared";

export async function connectRelaySocket(
  relayUrl: string,
  relayUsername: string,
  onRelayOpen?: () => void,
): Promise<WebSocket> {
  const ws = new WebSocket(relayUrl);
  ws.binaryType = "arraybuffer";

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Relay connection timeout"));
    }, 15000);

    ws.onopen = () => {
      clearTimeout(timeout);
      resolve();
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Failed to connect to relay server"));
    };
  });

  onRelayOpen?.();
  ws.send(JSON.stringify({ type: "client_connect", username: relayUsername }));

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Waiting for server timed out"));
    }, 30000);

    ws.onmessage = (event) => {
      clearTimeout(timeout);
      try {
        const msg = JSON.parse(event.data as string);
        if (isRelayClientConnected(msg)) {
          resolve();
        } else if (isRelayClientError(msg)) {
          ws.close();
          reject(new Error(msg.reason));
        } else {
          resolve();
        }
      } catch {
        ws.close();
        reject(new Error("Invalid relay response"));
      }
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      reject(new Error("Relay connection closed"));
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Relay connection error"));
    };
  });

  return ws;
}
