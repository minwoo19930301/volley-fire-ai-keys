# Volley Fire AI Keys

An API key rotation gateway for AI agents and services.

Volley Fire AI Keys keeps a per-user pool of provider API keys and returns the
least-recently-requested key for a requested platform. One key fires while the
others reload.

## Why

AI agents often need a simple, HTML-free way to retrieve a provider key for a
specific platform. This project provides both surfaces:

- a small web admin for managing provider keys and access tokens
- an agent API that returns one key at a time

The rotation rule is intentionally simple: select the enabled key with the
oldest `last_requested_at`, with keys that have never been requested first.
There is no public `keyId`, no `cooldown_until`, and no cycle state in v1.

## API Preview

```http
GET /api/rotate/openai
Authorization: Bearer vf_live_xxxxx
```

```json
{
  "platform": "openai",
  "apiKey": "sk-...",
  "requestedAt": "2026-05-05T00:00:00.000Z"
}
```

Supported platforms are stored as strings, so the service can work with
`openai`, `google`, `anthropic`, `xai`, or any other provider label.

## Deployment Target

The default deployment target is Cloudflare Workers + D1.

- Live Worker: <https://volley-fire.ai-keys.workers.dev>
- `workers.dev` URLs use `<worker-name>.<account-subdomain>.workers.dev`.
- Workers hosts the admin UI and agent API.
- D1 stores users, encrypted provider keys, access token hashes, and request
  timestamps.
- Workers secrets store encryption, signing, token-pepper, and first-admin setup
  material.

Cloudflare's official free-tier references:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

## Security Notes

- Only store API keys and accounts you are authorized to manage.
- Never commit real provider API keys, Cloudflare deployment tokens, or app
  access tokens.
- Store provider keys encrypted at rest.
- Store access tokens as hashes.
- Protect first-admin creation with a `SETUP_CODE` Worker secret.
- Do not log returned provider API keys.
- Use HTTPS and `Cache-Control: no-store` for secret-returning responses.

Cloudflare API tokens are only for deploying and managing Cloudflare resources.
Agent access tokens are created inside the Volley Fire admin UI and use the
`vf_live_...` prefix.

## Status

Early but usable scaffold. The Worker includes first-user setup, admin login,
provider key creation, access token creation, and least-recently-requested key
rotation.
