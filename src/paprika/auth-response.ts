import { z } from "zod";

// AuthResponseSchema — the Paprika Cloud Sync login response (email/password
// exchanged for a bearer token). Distinct from the OAuth runtime in src/auth/;
// this is the upstream Paprika account login that PaprikaClient performs.
export const AuthResponseSchema = z.object({
  result: z.object({
    token: z.string(),
  }),
});

export type AuthResponse = z.output<typeof AuthResponseSchema>;
