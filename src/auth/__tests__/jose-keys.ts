/**
 * Test fixture helper for generating JWTs with jose.
 *
 * Exported for use in tests that need to mint JWTs with controlled claims,
 * algorithms, and key IDs. Generates RSA and ECDSA keypairs with public JWKs
 * suitable for mocking JWKS endpoints.
 */

import { generateKeyPair, exportJWK, SignJWT, type JWK, type JWTPayload } from "jose";

/**
 * Generates an RSA or ECDSA JWT with specified claims.
 *
 * Returns both the signed token and the public JWK (for mocking JWKS endpoints).
 *
 * @param claims - JWT payload claims to include
 * @param opts.alg - Algorithm: "RS256", "RS384", "RS512", "ES256", "ES384", "ES512" (default: "RS256")
 * @param opts.kid - Key ID to include in JWT header (default: "test-kid")
 * @returns Object with signed token and public JWK
 */
export async function makeRsaJwt(
  claims: JWTPayload,
  opts?: {
    alg?: string;
    kid?: string;
  },
): Promise<{ token: string; jwk: JWK }> {
  const alg = opts?.alg ?? "RS256";
  const kid = opts?.kid ?? "test-kid";

  const { publicKey, privateKey } = await generateKeyPair(alg);
  const jwk: JWK = {
    ...(await exportJWK(publicKey)),
    kid,
    alg,
  };

  const token = await new SignJWT(claims).setProtectedHeader({ alg, kid }).sign(privateKey);

  return { token, jwk };
}

/**
 * Generates an ECDSA JWT with specified claims.
 *
 * Convenience wrapper for makeRsaJwt with ES256 as default algorithm.
 * See makeRsaJwt for full documentation.
 */
export async function makeEs256Jwt(
  claims: JWTPayload,
  opts?: {
    kid?: string;
  },
): Promise<{ token: string; jwk: JWK }> {
  return makeRsaJwt(claims, { alg: "ES256", ...opts });
}
