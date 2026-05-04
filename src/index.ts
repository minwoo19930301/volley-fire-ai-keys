export interface Env {
  DB: D1Database;
  ENCRYPTION_KEY_B64: string;
  SESSION_SECRET: string;
  TOKEN_PEPPER: string;
}

type RotateRow = {
  id: number;
  encrypted_api_key: string;
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return Response.redirect(new URL("/admin", url), 302);
    }

    if (request.method === "GET" && url.pathname === "/admin") {
      return html(adminShell());
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, service: "volley-fire-ai-keys" });
    }

    const rotateMatch = url.pathname.match(/^\/api\/rotate\/([a-z0-9._-]+)$/i);
    if (request.method === "GET" && rotateMatch) {
      return rotate(request, env, rotateMatch[1].toLowerCase());
    }

    return json({ error: "not_found" }, 404);
  }
};

async function rotate(
  request: Request,
  env: Env,
  platform: string
): Promise<Response> {
  const token = readBearerToken(request);
  if (!token) {
    return json({ error: "missing_bearer_token" }, 401);
  }

  const tokenHash = await sha256Hex(`${env.TOKEN_PEPPER}:${token}`);
  const access = await env.DB.prepare(
    "SELECT user_id FROM access_tokens WHERE token_hash = ? LIMIT 1"
  )
    .bind(tokenHash)
    .first<{ user_id: number }>();

  if (!access) {
    return json({ error: "invalid_bearer_token" }, 401);
  }

  const row = await env.DB.prepare(
    `SELECT id, encrypted_api_key
       FROM api_keys
      WHERE user_id = ? AND lower(platform) = lower(?)
      ORDER BY last_requested_at IS NOT NULL ASC,
               last_requested_at ASC,
               created_at ASC,
               id ASC
      LIMIT 1`
  )
    .bind(access.user_id, platform)
    .first<RotateRow>();

  if (!row) {
    return json({ error: "no_key_for_platform", platform }, 404);
  }

  const requestedAt = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE api_keys SET last_requested_at = ? WHERE id = ?"
  )
    .bind(requestedAt, row.id)
    .run();

  const apiKey = await decryptApiKey(row.encrypted_api_key, env);
  return json({ platform, apiKey, requestedAt });
}

function readBearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value) return null;
  const [scheme, token] = value.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function decryptApiKey(payload: string, env: Env): Promise<string> {
  const parsed = JSON.parse(payload) as { iv: string; ciphertext: string };
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(env.ENCRYPTION_KEY_B64),
    "AES-GCM",
    false,
    ["decrypt"]
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(parsed.iv) },
    key,
    base64ToBytes(parsed.ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function adminShell(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Volley Fire AI Keys</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f8fa;
        color: #1f2933;
      }

      body {
        margin: 0;
      }

      main {
        margin: 0 auto;
        max-width: 960px;
        padding: 40px 24px;
      }

      header {
        align-items: baseline;
        border-bottom: 1px solid #d9dee7;
        display: flex;
        justify-content: space-between;
        padding-bottom: 16px;
      }

      h1 {
        font-size: 24px;
        line-height: 1.2;
        margin: 0;
      }

      p {
        color: #52616f;
        line-height: 1.5;
      }

      .toolbar {
        align-items: center;
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        padding: 20px 0;
      }

      button {
        background: #1d4ed8;
        border: 0;
        border-radius: 6px;
        color: #ffffff;
        font: inherit;
        font-weight: 600;
        padding: 9px 12px;
      }

      section {
        border-bottom: 1px solid #d9dee7;
        padding: 22px 0;
      }

      h2 {
        font-size: 15px;
        margin: 0 0 12px;
      }

      code {
        background: #ebeef3;
        border-radius: 4px;
        padding: 2px 5px;
      }

      table {
        border-collapse: collapse;
        width: 100%;
      }

      th,
      td {
        border-top: 1px solid #e3e7ee;
        font-size: 14px;
        padding: 12px 8px;
        text-align: left;
      }

      th {
        color: #52616f;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Volley Fire AI Keys</h1>
        <code>/api/health</code>
      </header>
      <div class="toolbar">
        <button type="button">Add key</button>
        <button type="button">Create token</button>
      </div>
      <section>
        <h2>Provider Keys</h2>
        <table>
          <thead>
            <tr>
              <th>Platform</th>
              <th>Label</th>
              <th>Last requested</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="3">No keys yet</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section>
        <h2>Access Tokens</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="2">No tokens yet</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  </body>
</html>`;
}
