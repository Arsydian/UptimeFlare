import { Context, Next } from 'hono';
import { Env, ZeroTrustIdentity } from './types';

interface JwkKey {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  e: string;
  n: string;
}

interface JwksResponse {
  keys: JwkKey[];
}

// In-memory edge cache for Cloudflare Access public keys
let cachedJwks: { domain: string; keys: JwkKey[]; expiresAt: number } | null = null;

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function decodeJwtPart<T>(part: string): T {
  const bytes = base64UrlToUint8Array(part);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

async function getCloudflareAccessKeys(teamDomain: string): Promise<JwkKey[]> {
  const cleanDomain = teamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const now = Date.now();
  if (cachedJwks && cachedJwks.domain === cleanDomain && cachedJwks.expiresAt > now) {
    return cachedJwks.keys;
  }

  const certsUrl = `https://${cleanDomain}/cdn-cgi/access/certs`;
  const res = await fetch(certsUrl, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Cloudflare Access JWKS from ${certsUrl} (HTTP ${res.status})`);
  }

  const data = (await res.json()) as JwksResponse;
  if (!data.keys || !Array.isArray(data.keys)) {
    throw new Error('Invalid JWKS response from Cloudflare Access');
  }

  cachedJwks = {
    domain: cleanDomain,
    keys: data.keys,
    expiresAt: now + 10 * 60 * 1000, // Cache keys for 10 minutes
  };

  return data.keys;
}

export async function verifyCloudflareAccessJwt(
  token: string,
  teamDomain: string,
  expectedAud: string
): Promise<{ valid: boolean; email?: string; reason?: string }> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, reason: 'Malformed JWT token' };
    }

    const header = decodeJwtPart<{ kid?: string; alg?: string }>(parts[0]);
    const payload = decodeJwtPart<{
      aud?: string | string[];
      exp?: number;
      nbf?: number;
      iss?: string;
      email?: string;
      sub?: string;
    }>(parts[1]);

    if (header.alg !== 'RS256' || !header.kid) {
      return { valid: false, reason: 'Unsupported JWT algorithm or missing kid' };
    }

    // Check expiration & not-before
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && nowSec >= payload.exp + 30) {
      return { valid: false, reason: 'JWT token has expired' };
    }
    if (payload.nbf && nowSec + 30 < payload.nbf) {
      return { valid: false, reason: 'JWT token is not yet valid' };
    }

    // Check Audience (AUD) tag
    if (expectedAud) {
      const audList = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
      if (!audList.includes(expectedAud)) {
        return { valid: false, reason: 'JWT audience (AUD) mismatch' };
      }
    }

    // Fetch JWKS and verify signature using Web Crypto API
    const keys = await getCloudflareAccessKeys(teamDomain);
    const matchingKey = keys.find((k) => k.kid === header.kid);
    if (!matchingKey) {
      return { valid: false, reason: `No matching JWK found for kid=${header.kid}` };
    }

    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      matchingKey as JsonWebKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlToUint8Array(parts[2]);

    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signature as BufferSource,
      signedData as BufferSource
    );

    if (!isValid) {
      return { valid: false, reason: 'Invalid JWT cryptographic signature' };
    }

    return {
      valid: true,
      email: payload.email || payload.sub || 'authenticated-user@cloudflareaccess.com',
    };
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : 'JWT verification error',
    };
  }
}

export async function resolveZeroTrustIdentity(c: Context<{ Bindings: Env }>): Promise<ZeroTrustIdentity> {
  let teamDomain = (c.env.CF_ACCESS_TEAM_DOMAIN || '').trim();
  let aud = (c.env.CF_ACCESS_AUD || '').trim();
  const devBypass = (c.env.DEV_BYPASS_AUTH || '').toLowerCase() === 'true';

  // Fall back to in-app D1 settings if Worker environment variables are not set
  if ((!teamDomain || !aud) && c.env.DB) {
    try {
      const { results } = await c.env.DB.prepare(
        "SELECT key, value FROM settings WHERE key IN ('cf_access_team_domain', 'cf_access_aud')"
      ).all<{ key: string; value: string }>();
      for (const row of results || []) {
        if (row.key === 'cf_access_team_domain' && !teamDomain && row.value.trim()) {
          teamDomain = row.value.trim();
        }
        if (row.key === 'cf_access_aud' && !aud && row.value.trim()) {
          aud = row.value.trim();
        }
      }
    } catch {
      // Ignore if settings table is not yet initialized
    }
  }

  const jwtAssertion =
    c.req.header('Cf-Access-Jwt-Assertion') ||
    c.req.header('cf-access-jwt-assertion') ||
    '';
  const emailHeader =
    c.req.header('Cf-Access-Authenticated-User-Email') ||
    c.req.header('cf-access-authenticated-user-email') ||
    '';

  // 1. If Team Domain and AUD are configured (via Worker vars or In-App Settings), enforce cryptographic verification
  if (teamDomain && aud) {
    if (!jwtAssertion) {
      return {
        authenticated: false,
        email: '',
        mode: 'cloudflare_zero_trust',
        team_domain: teamDomain,
      };
    }
    const result = await verifyCloudflareAccessJwt(jwtAssertion, teamDomain, aud);
    return {
      authenticated: result.valid,
      email: result.email || emailHeader || 'zero-trust-admin',
      mode: 'cloudflare_zero_trust',
      team_domain: teamDomain,
    };
  }

  // 2. If Cloudflare Access headers are present on the edge even without explicit vars
  if (jwtAssertion || emailHeader) {
    return {
      authenticated: true,
      email: emailHeader || 'edge-authenticated@cloudflareaccess.com',
      mode: 'cloudflare_zero_trust',
      team_domain: teamDomain || 'cloudflare-edge',
    };
  }

  // 3. Local dev bypass or initial unconfigured setup
  if (devBypass || (!teamDomain && !aud)) {
    return {
      authenticated: true,
      email: 'admin@local.uptimeflare',
      mode: devBypass ? 'dev_bypass' : 'unconfigured',
    };
  }

  return {
    authenticated: false,
    email: '',
    mode: 'cloudflare_zero_trust',
    team_domain: teamDomain,
  };
}

export async function requireZeroTrustAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const identity = await resolveZeroTrustIdentity(c);
  if (!identity.authenticated) {
    return c.json(
      {
        error: 'Unauthorized: Valid Cloudflare Zero Trust (Cloudflare Access) JWT assertion required.',
        mode: identity.mode,
      },
      401
    );
  }
  c.set('identity' as never, identity as never);
  await next();
}
