# Technical Notes

These notes are for people running or modifying Volley Fire AI Keys. The
public README stays focused on the live service flow.

## Rotation Rule

- Return one provider key per rotate request.
- Rotate keys by `last_requested_at`.
- Treat `NULL last_requested_at` as the oldest state.
- Keep v1 state simple: no cooldowns, cycles, disabled flags, or soft revokes.
- Delete provider keys and AI Connection tokens when removing them.

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
