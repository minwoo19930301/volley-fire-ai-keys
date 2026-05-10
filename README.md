# Volley Fire AI Keys

An API key rotation gateway for AI agents and services.

[Live service](https://volley-fire.ai-keys.workers.dev) ·
[Create an account](https://volley-fire.ai-keys.workers.dev/signup)

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

## Live Service Guide

1. Create an account at
   [volley-fire.ai-keys.workers.dev/signup](https://volley-fire.ai-keys.workers.dev/signup).
2. Verify your email with the 6-digit code.
3. Add provider API keys in the dashboard. Start with providers that have free
   tiers or trial-friendly access.
4. Copy the AI Connection prompt from the dashboard.
5. Paste that prompt into the agent or external app that needs provider keys.

The copied prompt gives the agent the base URL, your bearer token, and the
rotate endpoint. It looks like this, with your real token filled in by the
dashboard:

```text
Use this AI Connection whenever you need an AI provider API key.

Base URL: https://volley-fire.ai-keys.workers.dev
Authorization: Bearer vf_live_xxxxx

To get a provider key, call:
GET https://volley-fire.ai-keys.workers.dev/api/rotate/{platform}

Read the JSON response and use only the apiKey value. Do not print, log, or
expose the bearer token or returned apiKey.
```

For normal use, you do not need to hand-write API calls. Sign up, add keys,
copy the AI Connection prompt, and give that prompt to the AI agent.

## Provider Key Links

Use only accounts and keys you are authorized to manage. Provider quotas, free
tiers, and billing rules change often, so verify each provider's current terms
before relying on it.

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

## API Quick Reference

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

## More Docs

- [Technical notes](docs/technical-notes.md): rotation details, email delivery,
  local setup, deployment, and security rules.
- [Agent instructions](AGENTS.md): development rules for agents working on this
  repository.
