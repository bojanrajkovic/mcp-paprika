/**
 * Who a request is, and whether that's who owns a session.
 *
 * Under OAuth, `bearerAuth` verifies the access token and stashes its `AuthInfo`; the
 * identity this server issued lives in `extra` (`AuthInfoExtra`). Under
 * `MCP_DEV_AUTH_BYPASS` nothing is verified, so the subject is `undefined` on both
 * sides of every comparison. Compare subjects only through `subjectMatches`, so a
 * change to how subjects are represented has one place to land.
 */

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { AuthInfoExtraSchema } from "./types.js";

// Only `sub` is read, so an unrelated field that fails to parse (an odd `email`) can't
// blank the subject and make two tokens look alike.
const SubjectSchema = AuthInfoExtraSchema.pick({ sub: true });

/**
 * The OAuth `sub` bearerAuth verified for this request, or `undefined` when no token
 * was verified (dev-auth bypass). `bearerAuth` rejects a verified token this returns
 * `undefined` for, so under OAuth a request always has a subject.
 */
export function requestSubject(authInfo: AuthInfo | undefined): string | undefined {
  const extra = SubjectSchema.safeParse(authInfo?.extra);
  return extra.success ? extra.data.sub : undefined;
}

/**
 * Whether the request's subject may use a session owned by `owner`. Exact equality,
 * `undefined` included: a subjectless request never rides a subject-owned session,
 * and a subject-bearing one never rides a bypass session.
 */
export function subjectMatches(request: string | undefined, owner: string | undefined): boolean {
  return request === owner;
}
