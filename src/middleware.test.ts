import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — what getUser() resolves to (a refreshed session ⇒ user,
//                      or null for the logged-out path).
// `refreshedCookies` — cookies Supabase writes via setAll() during getUser(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the middleware returns — including redirects.
let mockUser: { id: string } | null = null;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];
let createServerClientCalls = 0;
let getUserCalls = 0;

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    },
  ) => ({
    ...(() => {
      createServerClientCalls++;
      return {};
    })(),
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed inside getUser(), which rotates the refresh token and
      // pushes the new cookies through setAll() before resolving.
      getUser: async () => {
        getUserCalls++;
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return { data: { user: mockUser } };
      },
    },
  }),
}));

// Imported after the mock is registered.
const { middleware } = await import("./middleware");

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockUser = null;
  refreshedCookies = [];
  createServerClientCalls = 0;
  getUserCalls = 0;
});

afterEach(() => vi.clearAllMocks());

const ROTATED = {
  name: "sb-test-auth-token",
  value: "rotated-refresh-token",
  options: { path: "/", httpOnly: true },
};

describe("middleware — refreshed auth cookies survive redirects", () => {
  it.each([
    '/api/whatsapp/evolution/events/cron',
    '/api/whatsapp/evolution/flow/cron',
  ])('lets the protected cron route verify its own bearer: %s', async (path) => {
    const res = await middleware(new NextRequest(`https://app.test${path}`));
    expect(res.status).toBe(200);
    expect(getUserCalls).toBe(0);
  });

  it("carries the rotated token when redirecting a signed-in user off /login", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login"),
    );

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("carries the rotated token when redirecting an unauth user to /login", async () => {
    mockUser = null;
    // Even on the logged-out path getUser() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: "cleared" }];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.cookies.get(ROTATED.name)?.value).toBe("cleared");
  });

  it("redirects a signed-in user with an invite token to /join/<token>", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login?invite=abc123"),
    );

    expect(res.headers.get("location")).toContain("/join/abc123");
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("passes through (no redirect) for a signed-in user on a protected page", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });
});

describe("middleware — every dashboard route requires a session", () => {
  // Read the route group rather than hard-coding a list, so a new page added
  // under src/app/(dashboard)/ fails here until it is added to
  // protectedPaths. /flows, /agents and /notifications were missed that way
  // and rendered a broken page to signed-out visitors instead of redirecting.
  const dashboardRoutes = readdirSync(join(__dirname, "app", "(dashboard)"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `/${entry.name}`);

  it("finds the dashboard route group", () => {
    expect(dashboardRoutes).toContain("/dashboard");
  });

  it.each(dashboardRoutes)("redirects a signed-out visitor from %s to /login", async (route) => {
    mockUser = null;

    const res = await middleware(new NextRequest(`https://app.test${route}`));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});

describe("middleware — retired Meta registration route", () => {
  it("forwards the exact retired route without a session so its handler can return 410", async () => {
    mockUser = null;

    const res = await middleware(
      new NextRequest("https://app.test/api/whatsapp/config/verify-registration"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    { method: "GET", path: "/api/whatsapp/config" },
    { method: "GET", path: "/api/whatsapp/evolution/connect" },
    { method: "GET", path: "/api/whatsapp/evolution/status" },
    { method: "GET", path: "/api/whatsapp/config/verify-registration/child" },
    { method: "POST", path: "/api/whatsapp/config/verify-registration" },
  ])("keeps authentication required for $method $path", async ({ method, path }) => {
    mockUser = null;

    const res = await middleware(new NextRequest(`https://app.test${path}`, { method }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});

describe("middleware — Evolution events cron exception", () => {
  it("passes only the exact GET cron path without creating a Supabase client or calling getUser", async () => {
    mockUser = null;

    const res = await middleware(
      new NextRequest("https://app.test/api/whatsapp/evolution/events/cron?ignored=query"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(createServerClientCalls).toBe(0);
    expect(getUserCalls).toBe(0);
  });

  it.each([
    { method: "POST", path: "/api/whatsapp/evolution/events/cron" },
    { method: "GET", path: "/api/whatsapp/evolution/events/cron/child" },
    { method: "GET", path: "/api/whatsapp/evolution/events/cron-extra" },
  ])("keeps $method $path behind the existing auth guard", async ({ method, path }) => {
    mockUser = null;

    const res = await middleware(new NextRequest(`https://app.test${path}`, { method }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(createServerClientCalls).toBe(1);
    expect(getUserCalls).toBe(1);
  });
});
