import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

export async function postThroughTunnel(
  targetUrl: URL,
  proxyUrl: URL,
  port: number,
  body: string,
  signal: AbortSignal,
): Promise<Response> {
  const socket = await createTunnelSocket(proxyUrl, targetUrl.hostname, port, signal);
  const requestModule = targetUrl.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = requestModule.request(
      {
        hostname: targetUrl.hostname,
        port,
        method: "POST",
        path: `${targetUrl.pathname}${targetUrl.search}`,
        headers: createHeaders(targetUrl, body),
        createConnection: () =>
          targetUrl.protocol === "https:"
            ? tls.connect({ socket, servername: targetUrl.hostname })
            : socket,
      },
      (response) => void toFetchResponse(response).then(resolve, reject),
    );

    bindAbort(signal, request, reject);
    request.on("error", reject);
    request.end(body);
  });
}

function createTunnelSocket(
  proxyUrl: URL,
  host: string,
  port: number,
  signal: AbortSignal,
): Promise<net.Socket> {
  if (proxyUrl.protocol === "socks5:") {
    return createSocks5Socket(proxyUrl, host, port, signal);
  }

  return createHttpProxySocket(proxyUrl, host, port, signal);
}

function createHttpProxySocket(
  proxyUrl: URL,
  host: string,
  port: number,
  signal: AbortSignal,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const requestModule = proxyUrl.protocol === "https:" ? https : http;
    const request = requestModule.request({
      protocol: proxyUrl.protocol,
      hostname: proxyUrl.hostname,
      port: proxyUrl.port || (proxyUrl.protocol === "https:" ? "443" : "80"),
      method: "CONNECT",
      path: `${host}:${port}`,
      headers: createProxyAuthorizationHeaders(proxyUrl),
    });

    bindAbort(signal, request, reject);
    request.on("connect", (response, socket) => {
      if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT returned HTTP ${response.statusCode ?? 500}`));
        return;
      }
      resolve(socket);
    });
    request.on("error", reject);
    request.end();
  });
}

function createSocks5Socket(
  proxyUrl: URL,
  host: string,
  port: number,
  signal: AbortSignal,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(proxyUrl.port || 1080), proxyUrl.hostname);
    const chunks: Buffer[] = [];
    let stage: "greeting" | "auth" | "connect" = "greeting";
    const credentials = getProxyCredentials(proxyUrl);

    const cleanup = () => socket.off("data", onData);
    const fail = (error: Error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const data = Buffer.concat(chunks);

      if (stage === "greeting") {
        if (data.length < 2) return;
        chunks.length = 0;
        if (data[1] === 0x00) {
          stage = "connect";
          socket.write(createSocks5ConnectRequest(host, port));
          return;
        }
        if (data[1] === 0x02 && credentials) {
          stage = "auth";
          socket.write(createSocks5AuthRequest(credentials.username, credentials.password));
          return;
        }
        fail(new Error("SOCKS5 proxy requires username/password authentication"));
        return;
      }

      if (stage === "auth") {
        if (data.length < 2) return;
        chunks.length = 0;
        if (data[1] !== 0x00) {
          fail(new Error("SOCKS5 proxy authentication failed"));
          return;
        }
        stage = "connect";
        socket.write(createSocks5ConnectRequest(host, port));
        return;
      }

      if (data.length < 5) return;
      if (data[1] !== 0x00) {
        fail(new Error(`SOCKS5 CONNECT failed with code ${data[1]}`));
        return;
      }
      cleanup();
      resolve(socket);
    };

    if (signal.aborted) {
      fail(new Error("Request aborted"));
      return;
    }

    signal.addEventListener(
      "abort",
      () => fail(new Error("Request aborted")),
      { once: true },
    );
    socket.on("connect", () => socket.write(createSocks5Greeting(credentials)));
    socket.on("data", onData);
    socket.on("error", reject);
  });
}

function getProxyCredentials(
  proxyUrl: URL,
): { username: string; password: string } | null {
  if (!proxyUrl.username && !proxyUrl.password) return null;
  return {
    username: decodeURIComponent(proxyUrl.username),
    password: decodeURIComponent(proxyUrl.password),
  };
}

function createProxyAuthorizationHeaders(proxyUrl: URL): Record<string, string> {
  const credentials = getProxyCredentials(proxyUrl);
  if (!credentials) return {};

  return {
    "Proxy-Authorization": `Basic ${Buffer.from(
      `${credentials.username}:${credentials.password}`,
    ).toString("base64")}`,
  };
}

function createSocks5Greeting(
  credentials: { username: string; password: string } | null,
): Buffer {
  return credentials
    ? Buffer.from([0x05, 0x02, 0x00, 0x02])
    : Buffer.from([0x05, 0x01, 0x00]);
}

function createSocks5AuthRequest(username: string, password: string): Buffer {
  const usernameBuffer = Buffer.from(username);
  const passwordBuffer = Buffer.from(password);
  if (usernameBuffer.length > 255 || passwordBuffer.length > 255) {
    throw new Error("SOCKS5 username and password must be 255 bytes or less");
  }

  return Buffer.concat([
    Buffer.from([0x01, usernameBuffer.length]),
    usernameBuffer,
    Buffer.from([passwordBuffer.length]),
    passwordBuffer,
  ]);
}

function createSocks5ConnectRequest(host: string, port: number): Buffer {
  const hostBuffer = Buffer.from(host);
  const request = Buffer.alloc(7 + hostBuffer.length);
  request[0] = 0x05;
  request[1] = 0x01;
  request[2] = 0x00;
  request[3] = 0x03;
  request[4] = hostBuffer.length;
  hostBuffer.copy(request, 5);
  request.writeUInt16BE(port, 5 + hostBuffer.length);
  return request;
}

function createHeaders(targetUrl: URL, body: string): Record<string, string> {
  return {
    Host: targetUrl.host,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body).toString(),
  };
}

function bindAbort(
  signal: AbortSignal,
  request: http.ClientRequest,
  reject: (reason?: unknown) => void,
): void {
  if (signal.aborted) {
    request.destroy();
    reject(new Error("Request aborted"));
    return;
  }

  signal.addEventListener(
    "abort",
    () => {
      request.destroy();
      reject(new Error("Request aborted"));
    },
    { once: true },
  );
}

async function toFetchResponse(response: http.IncomingMessage): Promise<Response> {
  const chunks: Buffer[] = [];
  for await (const chunk of response) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new Response(Buffer.concat(chunks), {
    status: response.statusCode ?? 500,
    statusText: response.statusMessage,
    headers: response.headers as HeadersInit,
  });
}
