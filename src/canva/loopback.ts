import { createServer, type Server } from "node:http";
import { AxiError } from "axi-sdk-js";

/**
 * Loopback redirect listener for the OAuth authorization-code flow
 * (RFC 8252). Binds 127.0.0.1 on an ephemeral port; the port is known
 * before the authorize URL is built so the redirect_uri can be registered
 * exactly.
 */

const CALLBACK_PAGE = `<!doctype html>
<html><head><title>canva-axi</title></head>
<body style="font-family: system-ui; padding: 3rem; text-align: center;">
<h1>Canva connected</h1>
<p>You can close this tab and return to your terminal.</p>
</body></html>`;

export interface LoopbackListener {
  port: number;
  redirectUri: string;
  waitForCode(options: { state: string; timeoutMs: number }): Promise<string>;
  close(): void;
}

export function startLoopbackListener(): Promise<LoopbackListener> {
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname !== "/callback") {
      response.statusCode = 404;
      response.end("<h1>Not found</h1>");
      return;
    }
    const error = url.searchParams.get("error");
    const state = url.searchParams.get("state") ?? "";
    if (error) {
      response.statusCode = 200;
      response.end(`<h1>Authorization failed</h1><p>${escapeHtml(error)}</p>`);
      pendingReject?.(
        new AxiError(`Canva authorization was denied: ${error}`, "AUTH", [
          "run `canva-axi auth login` again and approve the request",
        ]),
      );
      pendingResolve = undefined;
      pendingReject = undefined;
      return;
    }
    if (state !== expectedState) {
      response.statusCode = 400;
      response.end("<h1>Invalid state</h1>");
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      response.statusCode = 400;
      response.end("<h1>Missing code</h1>");
      return;
    }
    response.statusCode = 200;
    response.end(CALLBACK_PAGE);
    pendingResolve?.(code);
    pendingResolve = undefined;
    pendingReject = undefined;
  });

  let pendingResolve: ((code: string) => void) | undefined;
  let pendingReject: ((error: AxiError) => void) | undefined;
  let expectedState = "";

  // `server.address()` is null until the 'listening' event fires, so the
  // bind must complete (callback) before the port is readable. Reading it
  // synchronously after listen() always fails and breaks every login.
  return new Promise((resolve, reject) => {
    server.once("error", (error: Error) => {
      reject(
        new AxiError(`could not bind a loopback listener: ${error.message}`, "UPSTREAM", [
          "retry `canva-axi auth login`",
        ]),
      );
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(
          new AxiError("could not bind a loopback listener", "UPSTREAM", [
            "retry `canva-axi auth login`",
          ]),
        );
        return;
      }
      resolve({
        port: address.port,
        redirectUri: `http://127.0.0.1:${address.port}/callback`,
        waitForCode({ state, timeoutMs }) {
          expectedState = state;
          return new Promise<string>((resolveCode, rejectCode) => {
            pendingResolve = resolveCode;
            pendingReject = rejectCode;
            const timer = setTimeout(() => {
              pendingResolve = undefined;
              pendingReject = undefined;
              rejectCode(
                new AxiError(
                  `timed out after ${Math.round(timeoutMs / 1000)}s waiting for browser approval`,
                  "AUTH",
                  ["run `canva-axi auth login` again and complete the approval in the browser"],
                ),
              );
            }, timeoutMs);
            timer.unref?.();
          });
        },
        close() {
          server.close();
          // Destroy browser keep-alive sockets so a finished login cannot
          // leave the process (or a stale listener) hanging around.
          server.closeAllConnections?.();
        },
      });
    });
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
