// Shared MSW handlers for the Paprika Cloud Sync API, used by any test that
// boots a server through `startHttp` / `buildAppContext` — which runs a full
// `sync.syncOnce()` at startup, fetching EVERY entity type. An endpoint left
// unmocked falls through `onUnhandledRequest` to the real paprikaapp.com; under
// the `"bypass"` policy that silently stalls the fetch and hangs startup, which
// is exactly how the menus/meals/grocery sync endpoints rotted undetected as
// they were added. Keep this list complete as new sync entities land, and use
// `failLoudOnUpstream` so a future gap fails loudly instead of hanging.
import { http, HttpResponse, type HttpHandler } from "msw";

export const PAPRIKA_AUTH_URL = "https://paprikaapp.com/api/v1/account/login/";
export const PAPRIKA_API_BASE = "https://paprikaapp.com/api/v2/sync";

/**
 * Every Paprika endpoint the initial `sync.syncOnce()` touches, each returning
 * an empty result. Callers that need data on a specific endpoint prepend their
 * own handler — MSW resolves the first matching handler, so a `/recipes/`
 * override placed ahead of these wins.
 */
export function paprikaSyncMockHandlers(): Array<HttpHandler> {
  const emptyList = `${PAPRIKA_API_BASE}/`;
  const entities = [
    "recipes",
    "categories",
    "pantry",
    "groceryaisles",
    "grocerylists",
    "groceries",
    "groceryingredients",
    "mealtypes",
    "meals",
    "menus",
    "menuitems",
    "photos",
  ];
  return [
    http.post(PAPRIKA_AUTH_URL, () => HttpResponse.json({ result: { token: "test-token" } })),
    ...entities.map((e) => http.get(`${emptyList}${e}/`, () => HttpResponse.json({ result: [] }))),
  ];
}

/**
 * `onUnhandledRequest` policy that fails loudly for any non-loopback (upstream)
 * request while bypassing localhost — the in-process server the tests actually
 * drive over `127.0.0.1`. This turns a missing upstream mock into an immediate,
 * obvious test failure instead of a silent real-network call that stalls.
 */
export function failLoudOnUpstream(request: Request, print: { warning: () => void; error: () => void }): void {
  const { hostname } = new URL(request.url);
  if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]") {
    return;
  }
  print.error();
}
