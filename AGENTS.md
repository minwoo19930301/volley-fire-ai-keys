# Agent Instructions

This repository builds Volley Fire AI Keys: an API key rotation gateway for AI
agents and services.

## Product Rules

- Keep the public description: "An API key rotation gateway for AI agents and
  services."
- Rotate provider keys by least-recently-requested order.
- Use `last_requested_at` as the only v1 rotation state.
- Treat `NULL last_requested_at` as older than any timestamp.
- Do not expose provider key database ids in the agent API.
- Do not add `cooldown_until`, cycle state, `disabled_at`, or `revoked_at` in v1.
- Use `access_tokens` for the service's own bearer tokens.
- Give each user exactly one active AI Connection token.
- In user-facing UI, present the token as an AI Connection, not as a list of
  agent tokens or access tokens.
- Reissuing an AI Connection token deletes or replaces prior access token rows,
  and the UI must warn that previous AI integrations may stop working.
- Delete keys and access tokens in v1 instead of soft-disabling them.

## Security Rules

- Never commit real provider API keys, Cloudflare API tokens, access tokens, or
  session secrets.
- Never log decrypted provider API keys.
- Encrypt provider API keys before storage.
- Hash access tokens before storage.
- Return secret-bearing responses with `Cache-Control: no-store`.
- Keep examples fake and obviously non-production.

## Cloudflare Defaults

- Target Cloudflare Workers + D1.
- Use Workers secrets for encryption, signing, and token-pepper material.
- Use D1 for users, encrypted provider keys, access token hashes, and request
  timestamps.
- Keep the Worker deployable on Cloudflare's free tier for small personal use.

## API Shape

```http
GET /api/rotate/:platform
Authorization: Bearer vf_live_xxxxx
```

```json
{
  "platform": "openai",
  "apiKey": "sk-...",
  "requestedAt": "2026-05-05T00:00:00.000Z"
}
```

## Development Notes

- Prefer small, focused commits.
- Keep docs and implementation in sync when changing API behavior.
- Do not stage `.venv-oci/` or other unrelated local files.
- If a tool is missing locally, document the missing tool instead of weakening
  the implementation.
