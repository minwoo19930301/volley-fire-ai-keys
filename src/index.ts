export interface Env {
  DB: D1Database;
  ENCRYPTION_KEY_B64: string;
  SESSION_SECRET: string;
  SETUP_CODE?: string;
  TOKEN_PEPPER: string;
}

type User = {
  id: number;
  email: string;
};

type ApiKeyRow = {
  id: number;
  platform: string;
  label: string | null;
  last_requested_at: string | null;
  created_at: string;
};

type AccessTokenRow = {
  id: number;
  name: string;
  created_at: string;
};

type RotateRow = {
  id: number;
  encrypted_api_key: string;
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
};

const SESSION_COOKIE = "vf_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_ITERATIONS = 210000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return Response.redirect(new URL("/admin", url).toString(), 302);
    }

    if (url.pathname.startsWith("/admin")) {
      return admin(request, env, url);
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

async function admin(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const userCount = await countUsers(env);

  if (userCount === 0) {
    if (request.method === "POST" && url.pathname === "/admin/setup") {
      return createFirstUser(request, env);
    }

    if (request.method === "GET" && url.pathname === "/admin") {
      return html(setupPage());
    }

    return redirect("/admin");
  }

  if (request.method === "POST" && url.pathname === "/admin/login") {
    return login(request, env);
  }

  if (request.method === "POST" && url.pathname === "/admin/logout") {
    return redirect("/admin", clearSessionCookie());
  }

  const user = await requireUser(request, env);
  if (!user) {
    if (request.method === "GET" && url.pathname === "/admin") {
      return html(loginPage());
    }

    return redirect("/admin");
  }

  if (request.method === "POST" && url.pathname === "/admin/api-keys") {
    return createApiKey(request, env, user);
  }

  if (request.method === "POST" && url.pathname === "/admin/api-keys/delete") {
    return deleteApiKey(request, env, user);
  }

  if (request.method === "POST" && url.pathname === "/admin/access-tokens") {
    return createAccessToken(request, env, user);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/admin/access-tokens/delete"
  ) {
    return deleteAccessToken(request, env, user);
  }

  if (request.method === "GET" && url.pathname === "/admin") {
    return renderDashboard(env, user);
  }

  return redirect("/admin");
}

async function createFirstUser(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const email = formText(form, "email").toLowerCase();
  const password = formRawText(form, "password");
  const setupCode = formRawText(form, "setupCode").trim();

  if (!env.SETUP_CODE) {
    return html(
      setupPage("Set the SETUP_CODE Worker secret before creating the first admin."),
      500
    );
  }

  if (!timingSafeStringEqual(setupCode, env.SETUP_CODE)) {
    return html(setupPage("Invalid setup code."), 401);
  }

  if (!isValidEmail(email) || password.length < MIN_PASSWORD_LENGTH) {
    return html(
      setupPage(
        `Use an email address and a password with at least ${MIN_PASSWORD_LENGTH} characters.`
      ),
      400
    );
  }

  const passwordHash = await hashPassword(password);
  await env.DB.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
    .bind(email, passwordHash)
    .run();

  const user = await env.DB.prepare(
    "SELECT id, email FROM users WHERE email = ? LIMIT 1"
  )
    .bind(email)
    .first<User>();

  if (!user) return html(setupPage("Could not create the first user."), 500);

  return redirect("/admin", await createSessionCookie(user.id, env));
}

async function login(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const email = formText(form, "email").toLowerCase();
  const password = formRawText(form, "password");

  const row = await env.DB.prepare(
    "SELECT id, email, password_hash FROM users WHERE email = ? LIMIT 1"
  )
    .bind(email)
    .first<User & { password_hash: string }>();

  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return html(loginPage("Invalid email or password."), 401);
  }

  return redirect("/admin", await createSessionCookie(row.id, env));
}

async function createApiKey(
  request: Request,
  env: Env,
  user: User
): Promise<Response> {
  const form = await request.formData();
  const platform = formText(form, "platform").toLowerCase();
  const label = formText(form, "label") || null;
  const apiKey = formRawText(form, "apiKey").trim();

  if (!/^[a-z0-9._-]{1,64}$/.test(platform) || apiKey.length < 8) {
    return renderDashboard(env, user, {
      kind: "error",
      message: "Use a platform label and a provider API key."
    });
  }

  const encryptedApiKey = await encryptApiKey(apiKey, env);
  await env.DB.prepare(
    `INSERT INTO api_keys (user_id, platform, label, encrypted_api_key)
     VALUES (?, ?, ?, ?)`
  )
    .bind(user.id, platform, label, encryptedApiKey)
    .run();

  return redirect("/admin");
}

async function deleteApiKey(
  request: Request,
  env: Env,
  user: User
): Promise<Response> {
  const form = await request.formData();
  const id = Number.parseInt(formText(form, "id"), 10);

  if (Number.isFinite(id)) {
    await env.DB.prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?")
      .bind(id, user.id)
      .run();
  }

  return redirect("/admin");
}

async function createAccessToken(
  request: Request,
  env: Env,
  user: User
): Promise<Response> {
  const form = await request.formData();
  const name = formText(form, "name");

  if (!name) {
    return renderDashboard(env, user, {
      kind: "error",
      message: "Use a token name."
    });
  }

  const token = `vf_live_${randomBase64Url(32)}`;
  const tokenHash = await sha256Hex(`${env.TOKEN_PEPPER}:${token}`);

  await env.DB.prepare(
    "INSERT INTO access_tokens (user_id, name, token_hash) VALUES (?, ?, ?)"
  )
    .bind(user.id, name, tokenHash)
    .run();

  return renderDashboard(
    env,
    user,
    { kind: "success", message: "Access token created." },
    token
  );
}

async function deleteAccessToken(
  request: Request,
  env: Env,
  user: User
): Promise<Response> {
  const form = await request.formData();
  const id = Number.parseInt(formText(form, "id"), 10);

  if (Number.isFinite(id)) {
    await env.DB.prepare("DELETE FROM access_tokens WHERE id = ? AND user_id = ?")
      .bind(id, user.id)
      .run();
  }

  return redirect("/admin");
}

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

  const apiKey = await decryptApiKey(row.encrypted_api_key, env);
  const requestedAt = new Date().toISOString();
  await env.DB.prepare("UPDATE api_keys SET last_requested_at = ? WHERE id = ?")
    .bind(requestedAt, row.id)
    .run();

  return json({ platform, apiKey, requestedAt });
}

async function renderDashboard(
  env: Env,
  user: User,
  alert?: { kind: "error" | "success"; message: string },
  newToken?: string
): Promise<Response> {
  const keys = await env.DB.prepare(
    `SELECT id, platform, label, last_requested_at, created_at
       FROM api_keys
      WHERE user_id = ?
      ORDER BY platform ASC, created_at DESC`
  )
    .bind(user.id)
    .all<ApiKeyRow>();

  const tokens = await env.DB.prepare(
    `SELECT id, name, created_at
       FROM access_tokens
      WHERE user_id = ?
      ORDER BY created_at DESC`
  )
    .bind(user.id)
    .all<AccessTokenRow>();

  return html(
    dashboardPage({
      user,
      keys: keys.results ?? [],
      tokens: tokens.results ?? [],
      alert,
      newToken
    })
  );
}

async function requireUser(request: Request, env: Env): Promise<User | null> {
  const session = await readSession(request, env);
  if (!session) return null;

  const user = await env.DB.prepare(
    "SELECT id, email FROM users WHERE id = ? LIMIT 1"
  )
    .bind(session.userId)
    .first<User>();

  return user ?? null;
}

async function countUsers(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{
    count: number;
  }>();
  return row?.count ?? 0;
}

function readBearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value) return null;
  const [scheme, token] = value.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PASSWORD_ITERATIONS);
  return [
    "pbkdf2-sha256",
    PASSWORD_ITERATIONS.toString(),
    bytesToBase64(salt),
    bytesToBase64(hash)
  ].join("$");
}

async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  const parts = passwordHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;

  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations)) return false;

  const salt = base64ToBytes(parts[2]);
  const expected = base64ToBytes(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);

  return timingSafeEqual(actual, expected);
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    256
  );
  return new Uint8Array(bits);
}

async function createSessionCookie(userId: number, env: Env): Promise<string> {
  const payload = bytesToBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        userId,
        exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
      })
    )
  );
  const signature = await hmacSha256Base64Url(payload, env.SESSION_SECRET);

  return [
    `${SESSION_COOKIE}=${payload}.${signature}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_SECONDS}`
  ].join("; ");
}

async function readSession(
  request: Request,
  env: Env
): Promise<{ userId: number } | null> {
  const value = readCookie(request, SESSION_COOKIE);
  if (!value) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = await hmacSha256Base64Url(payload, env.SESSION_SECRET);
  if (!timingSafeStringEqual(signature, expected)) return null;

  const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as {
    userId?: unknown;
    exp?: unknown;
  };

  if (
    typeof parsed.userId !== "number" ||
    typeof parsed.exp !== "number" ||
    parsed.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return { userId: parsed.userId };
}

function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0"
  ].join("; ");
}

async function hmacSha256Base64Url(
  value: string,
  secret: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function encryptApiKey(value: string, env: Env): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(env);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value)
  );

  return JSON.stringify({
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  });
}

async function decryptApiKey(payload: string, env: Env): Promise<string> {
  const parsed = JSON.parse(payload) as { iv: string; ciphertext: string };
  const key = await importEncryptionKey(env);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(parsed.iv) },
    key,
    base64ToBytes(parsed.ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

async function importEncryptionKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(env.ENCRYPTION_KEY_B64),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomBase64Url(byteLength: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;

  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }

  return null;
}

function formText(form: FormData, name: string): string {
  return formRawText(form, name).trim();
}

function formRawText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return base64ToBytes(base64);
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  return timingSafeEqual(
    new TextEncoder().encode(left),
    new TextEncoder().encode(right)
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: HTML_HEADERS
  });
}

function redirect(path: string, setCookie?: string): Response {
  const headers = new Headers({
    location: path,
    "cache-control": "no-store"
  });
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(null, { status: 303, headers });
}

function setupPage(error?: string): string {
  return layout({
    title: "Set Up Admin",
    body: `
      ${alertHtml(error, "error")}
      <form class="panel auth" method="post" action="/admin/setup">
        <label>
          Email
          <input name="email" type="email" autocomplete="email" required>
        </label>
        <label>
          Password
          <input name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
        </label>
        <label>
          Setup code
          <input name="setupCode" type="password" autocomplete="one-time-code" required>
        </label>
        <button type="submit">Create admin</button>
      </form>
    `
  });
}

function loginPage(error?: string): string {
  return layout({
    title: "Admin Login",
    body: `
      ${alertHtml(error, "error")}
      <form class="panel auth" method="post" action="/admin/login">
        <label>
          Email
          <input name="email" type="email" autocomplete="email" required>
        </label>
        <label>
          Password
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <button type="submit">Log in</button>
      </form>
    `
  });
}

function dashboardPage(input: {
  user: User;
  keys: ApiKeyRow[];
  tokens: AccessTokenRow[];
  alert?: { kind: "error" | "success"; message: string };
  newToken?: string;
}): string {
  return layout({
    title: "Volley Fire AI Keys",
    userEmail: input.user.email,
    body: `
      ${alertHtml(input.alert?.message, input.alert?.kind)}
      ${newTokenHtml(input.newToken)}
      <section class="panel">
        <h2>Add Provider Key</h2>
        <form class="grid-form" method="post" action="/admin/api-keys">
          <label>
            Platform
            <input name="platform" placeholder="openai" pattern="[A-Za-z0-9._-]{1,64}" required>
          </label>
          <label>
            Label
            <input name="label" placeholder="personal-free">
          </label>
          <label class="span-2">
            API key
            <textarea name="apiKey" rows="3" spellcheck="false" required></textarea>
          </label>
          <button type="submit">Add key</button>
        </form>
      </section>

      <section class="panel">
        <h2>Provider Keys</h2>
        ${keysTable(input.keys)}
      </section>

      <section class="panel">
        <h2>Create Agent Token</h2>
        <form class="inline-form" method="post" action="/admin/access-tokens">
          <label>
            Name
            <input name="name" placeholder="local-agent" required>
          </label>
          <button type="submit">Create token</button>
        </form>
      </section>

      <section class="panel">
        <h2>Access Tokens</h2>
        ${tokensTable(input.tokens)}
      </section>
    `
  });
}

function keysTable(keys: ApiKeyRow[]): string {
  if (keys.length === 0) return `<p class="empty">No keys yet.</p>`;

  return `
    <table>
      <thead>
        <tr>
          <th>Platform</th>
          <th>Label</th>
          <th>Last requested</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${keys
          .map(
            (key) => `
              <tr>
                <td><code>${escapeHtml(key.platform)}</code></td>
                <td>${escapeHtml(key.label ?? "")}</td>
                <td>${escapeHtml(formatTimestamp(key.last_requested_at))}</td>
                <td class="actions">
                  <form method="post" action="/admin/api-keys/delete">
                    <input type="hidden" name="id" value="${key.id}">
                    <button class="secondary danger" type="submit">Delete</button>
                  </form>
                </td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function tokensTable(tokens: AccessTokenRow[]): string {
  if (tokens.length === 0) return `<p class="empty">No tokens yet.</p>`;

  return `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Created</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${tokens
          .map(
            (token) => `
              <tr>
                <td>${escapeHtml(token.name)}</td>
                <td>${escapeHtml(formatTimestamp(token.created_at))}</td>
                <td class="actions">
                  <form method="post" action="/admin/access-tokens/delete">
                    <input type="hidden" name="id" value="${token.id}">
                    <button class="secondary danger" type="submit">Delete</button>
                  </form>
                </td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function newTokenHtml(token?: string): string {
  if (!token) return "";

  return `
    <section class="panel token-output">
      <h2>New Access Token</h2>
      <input readonly value="${escapeHtml(token)}">
      <p>Copy this token now. It will not be shown again.</p>
    </section>
  `;
}

function alertHtml(
  message?: string,
  kind: "error" | "success" = "success"
): string {
  if (!message) return "";
  return `<div class="alert ${kind}">${escapeHtml(message)}</div>`;
}

function layout(input: {
  title: string;
  body: string;
  userEmail?: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f7f9;
        color: #19212a;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
      }

      main {
        margin: 0 auto;
        max-width: 1040px;
        padding: 32px 20px 56px;
      }

      header {
        align-items: center;
        border-bottom: 1px solid #d8dee8;
        display: flex;
        gap: 16px;
        justify-content: space-between;
        margin-bottom: 20px;
        padding-bottom: 16px;
      }

      h1 {
        font-size: 24px;
        line-height: 1.2;
        margin: 0;
      }

      h2 {
        font-size: 15px;
        margin: 0 0 14px;
      }

      p {
        color: #596779;
        line-height: 1.5;
        margin: 10px 0 0;
      }

      code {
        background: #eef1f5;
        border-radius: 4px;
        padding: 2px 5px;
      }

      .userbar {
        align-items: center;
        display: flex;
        gap: 12px;
      }

      .userbar span {
        color: #596779;
        font-size: 13px;
      }

      .panel {
        background: #ffffff;
        border: 1px solid #d8dee8;
        border-radius: 8px;
        margin-top: 16px;
        padding: 18px;
      }

      .auth {
        max-width: 420px;
      }

      label {
        color: #3b4652;
        display: grid;
        font-size: 13px;
        font-weight: 600;
        gap: 7px;
      }

      input,
      textarea {
        border: 1px solid #c8d0dc;
        border-radius: 6px;
        color: #19212a;
        font: inherit;
        font-size: 14px;
        padding: 10px 11px;
        width: 100%;
      }

      textarea {
        resize: vertical;
      }

      button {
        background: #174ea6;
        border: 0;
        border-radius: 6px;
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        min-height: 40px;
        padding: 9px 13px;
      }

      .secondary {
        background: #eef1f5;
        color: #26313d;
      }

      .danger {
        color: #9f1f1f;
      }

      .grid-form {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .grid-form button {
        justify-self: start;
      }

      .span-2 {
        grid-column: 1 / -1;
      }

      .inline-form {
        align-items: end;
        display: grid;
        gap: 12px;
        grid-template-columns: minmax(220px, 360px) auto;
        justify-content: start;
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
        vertical-align: middle;
      }

      th {
        color: #596779;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
      }

      .actions {
        text-align: right;
        width: 1%;
      }

      .actions form,
      .userbar form {
        margin: 0;
      }

      .empty {
        margin: 0;
      }

      .alert {
        border-radius: 6px;
        font-size: 14px;
        font-weight: 700;
        margin-top: 16px;
        padding: 12px;
      }

      .alert.error {
        background: #fff1f1;
        color: #a51d2d;
      }

      .alert.success {
        background: #ecfdf3;
        color: #1f6f43;
      }

      .token-output input {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }

      @media (max-width: 720px) {
        header,
        .userbar,
        .inline-form,
        .grid-form {
          align-items: stretch;
          grid-template-columns: 1fr;
        }

        header,
        .userbar {
          display: grid;
        }

        .span-2 {
          grid-column: auto;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>${escapeHtml(input.title)}</h1>
        ${headerControls(input.userEmail)}
      </header>
      ${input.body}
    </main>
  </body>
</html>`;
}

function headerControls(userEmail?: string): string {
  if (!userEmail) return `<code>/api/rotate/:platform</code>`;

  return `
    <div class="userbar">
      <span>${escapeHtml(userEmail)}</span>
      <form method="post" action="/admin/logout">
        <button class="secondary" type="submit">Sign out</button>
      </form>
    </div>
  `;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Never";
  return value.replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
