import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { createEventStore, resolveScoutDataDir, SCOUT_STORE_FILE_NAME } from "@event-scout/db";
import { createLogger, loadRuntimeEnv, type AppEnv } from "@event-scout/shared";
import { renderDashboard, type DashboardDataSource } from "./views/dashboard.js";
import { isFeedbackType } from "./views/format.js";
import { renderLoginPage } from "./views/login.js";

const env = resolveDashboardEnv();
const store = createEventStore(env);
const logger = createLogger("admin");
const listenPort = resolveListenPort();
const listenHost = isProductionHost() ? "0.0.0.0" : "127.0.0.1";
const ADMIN_SESSION_COOKIE = "event_scout_admin";
const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const adminUsername = env.adminUsername ?? "admin";
// Mirrors createEventStore()'s own choice of backend in @event-scout/db, so the
// header always names the data the dashboard is actually showing.
const dataSource: DashboardDataSource = env.mockMode ? "mock" : env.databaseUrl ? "postgres" : "file";

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname === "/login") {
      if (request.method === "POST") {
        const form = await readFormBody(request);
        const username = form.get("username") ?? "";
        const password = form.get("password") ?? "";
        const next = safeRedirectPath(form.get("next"));
        if (isValidLogin(username, password)) {
          redirectWithSessionCookie(response, next);
          return;
        }
        writeHtml(response, renderLoginPage(adminUsername, "Username or password did not match.", next), 401);
        return;
      }
      writeHtml(response, renderLoginPage(adminUsername, "", safeRedirectPath(url.searchParams.get("next"))));
      return;
    }

    if (url.pathname === "/logout") {
      redirectWithClearedSession(response);
      return;
    }

    if (!isAuthorized(request)) {
      if (acceptsHtml(request) && !url.pathname.startsWith("/api/")) {
        writeHtml(response, renderLoginPage(adminUsername, "", `${url.pathname}${url.search}${url.hash}`), 401);
      } else {
        writeJson(response, { error: "Unauthorized" }, 401);
      }
      return;
    }

    if (url.pathname === "/health") {
      writeJson(response, { ok: true, mode: env.mockMode ? "mock" : "real" });
      return;
    }

    if (url.pathname === "/api/dashboard") {
      writeJson(response, await store.getDashboard());
      return;
    }

    if (url.pathname === "/api/runs") {
      writeJson(response, await store.listRuns(Number(url.searchParams.get("limit") ?? 25)));
      return;
    }

    if (url.pathname === "/api/events") {
      writeJson(response, await store.listEvents({ limit: Number(url.searchParams.get("limit") ?? 50) }));
      return;
    }

    if (url.pathname === "/api/recommendations") {
      writeJson(response, await store.listRecommendations({ limit: Number(url.searchParams.get("limit") ?? 25) }));
      return;
    }

    if (url.pathname === "/api/candidates/rejected") {
      writeJson(response, await store.listCandidateUrls({ status: "rejected", limit: Number(url.searchParams.get("limit") ?? 50) }));
      return;
    }

    if (url.pathname === "/api/feedback" && request.method === "POST") {
      const body = await readJsonBody(request);
      const eventId = typeof body.eventId === "string" ? body.eventId : undefined;
      const feedbackType = typeof body.feedbackType === "string" && isFeedbackType(body.feedbackType)
        ? body.feedbackType
        : undefined;
      if (!eventId || !feedbackType) {
        writeJson(response, { error: "eventId and valid feedbackType are required" }, 400);
        return;
      }
      await store.createFeedback({
        eventId,
        feedbackType,
        note: typeof body.note === "string" ? body.note : undefined
      });
      writeJson(response, { ok: true });
      return;
    }

    if (url.pathname === "/") {
      writeHtml(
        response,
        renderDashboard(await store.getDashboard(), {
          dataSource,
          canSignOut: hasAdminPassword()
        })
      );
      return;
    }

    writeText(response, 404, "Not found");
  } catch (error) {
    logger.error("request failed", { error: error instanceof Error ? error.message : String(error) });
    writeJson(response, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

server.listen(listenPort, listenHost, () => {
  logger.info("admin listening", {
    host: listenHost,
    port: listenPort,
    mode: env.mockMode ? "mock" : "real",
    auth: hasAdminPassword() ? "password" : "disabled"
  });
  console.log(`Admin UI: http://${listenHost}:${listenPort}`);
});

function resolveListenPort(): number {
  const portValue = process.env.PORT?.trim();
  if (!portValue) return env.adminPort;

  const port = Number(portValue);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer");
  }

  return port;
}

function isProductionHost(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);
}

function isAuthorized(request: IncomingMessage): boolean {
  if (!hasAdminPassword()) return true;

  return isValidSessionCookie(parseCookies(request.headers.cookie)[ADMIN_SESSION_COOKIE]);
}

function hasAdminPassword(): boolean {
  return Boolean(env.adminPassword);
}

function isValidLogin(username: string, password: string): boolean {
  if (!env.adminPassword) return true;
  return constantTimeEqual(username, adminUsername) && constantTimeEqual(password, env.adminPassword);
}

function redirectWithSessionCookie(response: ServerResponse, location: string): void {
  const secure = isProductionHost() ? "; Secure" : "";
  response.writeHead(302, {
    location,
    "set-cookie": `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(createSessionCookieValue())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}${secure}`
  });
  response.end();
}

function redirectWithClearedSession(response: ServerResponse): void {
  const secure = isProductionHost() ? "; Secure" : "";
  response.writeHead(302, {
    location: "/login",
    "set-cookie": `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  });
  response.end();
}

function safeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function acceptsHtml(request: IncomingMessage): boolean {
  return String(request.headers.accept ?? "").includes("text/html");
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf("=");
        if (separator === -1) return [item, ""];
        return [item.slice(0, separator), decodeURIComponent(item.slice(separator + 1))];
      })
  );
}

function createSessionCookieValue(): string {
  const expiresAt = Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ username: adminUsername, expiresAt })).toString("base64url");
  return `${payload}.${signSessionPayload(payload)}`;
}

function isValidSessionCookie(value: string | undefined): boolean {
  if (!value || !env.adminPassword) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !constantTimeEqual(signature, signSessionPayload(payload))) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      username?: unknown;
      expiresAt?: unknown;
    };
    return parsed.username === adminUsername && typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function signSessionPayload(payload: string): string {
  return createHmac("sha256", env.adminPassword ?? "").update(payload).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readTextBody(request);
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

async function readFormBody(request: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await readTextBody(request));
}

async function readTextBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response: ServerResponse, payload: unknown, statusCode = 200): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function writeHtml(response: ServerResponse, html: string, statusCode = 200): void {
  response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function writeText(response: ServerResponse, statusCode: number, text: string): void {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

/**
 * `pnpm scout:real` saves to .scout-data/ even when .env.local still says MOCK_MODE=true (the
 * scout:real script overrides it for that one run), so a dashboard that only read MOCK_MODE would
 * keep showing sample events next to a folder full of real results. Unless MOCK_MODE is set for
 * this process itself, real local results win over sample data. Postgres setups are unchanged.
 */
function resolveDashboardEnv(): AppEnv {
  const loaded = loadRuntimeEnv();
  if (!loaded.mockMode || process.env.MOCK_MODE !== undefined || loaded.databaseUrl) return loaded;
  const localStore = join(resolveScoutDataDir(loaded.scoutDataDir), SCOUT_STORE_FILE_NAME);
  return existsSync(localStore) ? { ...loaded, mockMode: false } : loaded;
}
