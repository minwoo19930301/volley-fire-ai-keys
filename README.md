# Volley Fire AI Keys

An API key rotation gateway for AI agents and services.

[Live service](https://volley-fire.ai-keys.workers.dev) ·
[Create an account](https://volley-fire.ai-keys.workers.dev/signup)

## Provider Key Links

Start with the free-tier or trial-friendly providers before paid-first APIs.
Use only accounts and keys you are authorized to manage. Provider quotas,
free tiers, and billing rules change often, so verify each provider's current
terms before relying on it.

| Priority | Platform slug | Provider | Key link | Access note |
| --- | --- | --- | --- | --- |
| 1 | `google` | Google Gemini | [Get key](https://aistudio.google.com/apikey) | Free tier |
| 2 | `groq` | Groq | [Get key](https://console.groq.com/keys) | Free tier |
| 3 | `openrouter` | OpenRouter | [Get key](https://openrouter.ai/settings/keys) | Free models available |
| 4 | `mistral` | Mistral | [Get key](https://console.mistral.ai/api-keys) | Free Experiment / paid |
| 5 | `cohere` | Cohere | [Get key](https://dashboard.cohere.com/api-keys) | Trial / paid |
| 6 | `github-models` | GitHub Models | [Open playground](https://github.com/marketplace/models) | GitHub PAT with `models` scope |
| 7 | `cerebras` | Cerebras | [Get key](https://cloud.cerebras.ai/) | Cloud console |
| 8 | `cloudflare` | Cloudflare Workers AI | [Create API token](https://dash.cloudflare.com/profile/api-tokens) | Free allocation / paid |
| 9 | `huggingface` | Hugging Face | [Create token](https://huggingface.co/settings/tokens) | Limited / paid |
| 10 | `sambanova` | SambaNova | [Get key](https://cloud.sambanova.ai/apis) | Cloud console |
| 11 | `nvidia` | NVIDIA NIM | [Get key](https://build.nvidia.com/) | Free dev APIs |
| 12 | `qwen` | Qwen Cloud | [Get key](https://home.qwencloud.com/api-keys) | Pay-as-you-go / plans |
| 13 | `meta` | Meta Llama API | [Open console](https://llama.developer.meta.com/) | Preview |
| 14 | `fireworks` | Fireworks AI | [Get key](https://app.fireworks.ai/settings/users/api-keys) | Trial / paid |
| 15 | `siliconflow` | SiliconFlow | [Get key](https://cloud.siliconflow.com/account/ak) | Free / paid |
| 16 | `deepseek` | DeepSeek | [Get key](https://platform.deepseek.com/api_keys) | Paid |
| 17 | `openai` | OpenAI | [Get key](https://platform.openai.com/api-keys) | Billing / credits |
| 18 | `anthropic` | Anthropic | [Get key](https://console.anthropic.com/settings/keys) | Billing / credits |
| 19 | `xai` | xAI | [Open console](https://console.x.ai/) | Billing / credits |
| 20 | `perplexity` | Perplexity | [Open console](https://console.perplexity.ai/) | Billing / credits |

![Volley Fire AI Keys three-rank rotation diagram](assets/volley-fire-rotation.png)

Volley Fire AI Keys gives agents one stable AI Connection token. When an
external app or AI agent asks for a provider key, the Worker returns one
least-recently-requested key for that platform and updates its request
timestamp. The gateway does not call providers; it only hands out the next key
for the caller to use.

## How It Works

Add several free or low-quota provider API keys to the dashboard under the same
platform. Your third-party app or AI agent keeps one AI Connection token for
Volley Fire AI Keys, asks the gateway for a provider key, then uses that key
with the real AI service.

When that provider key is blocked, exhausted, or no longer useful, the app asks
Volley Fire AI Keys again. The gateway returns the next least-recently-requested
key, and the app repeats the same provider call with a fresh key.

## Rotation Rule

- Return one provider key per rotate request.
- Rotate keys by `last_requested_at`.
- Treat `NULL last_requested_at` as the oldest state.
- Keep v1 state simple: no cooldowns, cycles, disabled flags, or soft revokes.
- Delete provider keys and AI Connection tokens when removing them.

## Agent API

Add a provider key:

```http
POST /api/keys/openai
Authorization: Bearer vf_live_xxxxx
Content-Type: application/json
```

```json
{
  "apiKey": "sk-fake-example",
  "label": "optional-label"
}
```

The response confirms creation without returning the stored provider key.

Rotate and retrieve the next provider key:

```http
GET /api/rotate/openai
Authorization: Bearer vf_live_xxxxx
```

```json
{
  "platform": "openai",
  "apiKey": "sk-fake-example",
  "requestedAt": "2026-05-05T00:00:00.000Z"
}
```

Use the platform slugs from the provider key table, such as `google`, `groq`,
`openrouter`, `openai`, `anthropic`, `xai`, or `perplexity`.

## Dashboard

The dashboard is for:

- adding encrypted provider keys
- deleting provider keys
- copying the user's AI Connection prompt
- reissuing the single active AI Connection token

Reissuing an AI Connection token replaces the previous token. Existing AI
integrations may stop working until they use the new prompt.

## Email Verification

The Worker sends 6-digit signup and password reset codes through one of these
providers:

- A simple HTTPS mail relay configured with `MAIL_WEBHOOK_URL` and
  `MAIL_WEBHOOK_SECRET`, for example with Google Apps Script `MailApp`.
- Cloudflare's `send_email` binding. This is useful for verified Email Routing
  destinations; it is not the easiest path for public signup to arbitrary
  user emails.
- Mailjet Send API configured with `MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, and
  `MAIL_FROM`.

Signup requires email verification. If email delivery is not configured, account
creation is blocked until a verification code can be sent. Password reset also
requires email delivery.

If multiple providers are configured, the HTTPS mail relay is tried first.

`workers.dev` is not a usable sender domain.

Mailjet setup:

```sh
printf '%s' 'mailjet-api-key' | wrangler secret put MAILJET_API_KEY
printf '%s' 'mailjet-secret-key' | wrangler secret put MAILJET_SECRET_KEY
printf '%s' 'noreply@example.com' | wrangler secret put MAIL_FROM
wrangler deploy
```

Google Apps Script relay example:

```js
function doPost(e) {
  const data = JSON.parse(e.postData.contents || "{}");
  const expected = PropertiesService.getScriptProperties()
    .getProperty("MAIL_WEBHOOK_SECRET");

  if (!expected || data.secret !== expected) {
    return json({ ok: false, error: "unauthorized" });
  }

  MailApp.sendEmail({
    to: data.to,
    subject: data.subject,
    body: data.text,
    name: data.from || "Volley Fire AI Keys"
  });

  return json({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Deploy the script as a web app, set the script property
`MAIL_WEBHOOK_SECRET`, then set the Worker secrets `MAIL_WEBHOOK_URL` and
`MAIL_WEBHOOK_SECRET` to the web app URL and matching secret.

```sh
printf '%s' 'https://script.google.com/macros/s/your-script-id/exec' \
  | wrangler secret put MAIL_WEBHOOK_URL
printf '%s' 'replace-with-a-long-random-secret' \
  | wrangler secret put MAIL_WEBHOOK_SECRET
wrangler deploy
```

Cloudflare reference:
[Send emails from Workers](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/)

## Local Setup

Install dependencies:

```sh
npm install
```

Create local secrets:

```sh
cp .dev.vars.example .dev.vars
```

Set real local values for:

- `ENCRYPTION_KEY_B64`
- `MAIL_FROM`
- `SESSION_SECRET`
- `TOKEN_PEPPER`

Run D1 migrations locally:

```sh
npm run db:migrate:local
```

Start the Worker:

```sh
npm run dev
```

## Deploy

Apply remote migrations:

```sh
npm run db:migrate:remote
```

Deploy to Cloudflare Workers:

```sh
npm run deploy
```

Production secrets should be stored as Workers secrets, not committed files.

## Security

- Never commit real provider API keys, Cloudflare API tokens, access tokens, or
  session secrets.
- Encrypt provider API keys before storage.
- Hash AI Connection tokens for lookup and encrypt their display copy.
- Never log decrypted provider API keys.
- Return secret-bearing responses with `Cache-Control: no-store`.
- Keep examples fake and obviously non-production.
