export interface Env {
  DB: D1Database;
  EMAIL?: SendEmail;
  ENCRYPTION_KEY_B64: string;
  MAIL_FROM?: string;
  SESSION_SECRET: string;
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
  encrypted_token: string | null;
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
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
};

const SESSION_COOKIE = "vf_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const MIN_PASSWORD_LENGTH = 8;
const AUTH_CODE_SECONDS = 10 * 60;
const PUBLIC_BASE_URL = "https://volley-fire.ai-keys.workers.dev";
const PLATFORM_OPTIONS = [
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["google", "Google Gemini"],
  ["openrouter", "OpenRouter"],
  ["xai", "xAI"],
  ["deepseek", "DeepSeek"],
  ["groq", "Groq"],
  ["mistral", "Mistral"],
  ["perplexity", "Perplexity"],
  ["cohere", "Cohere"]
] as const;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "HEAD" && url.pathname === "/") {
      return redirect("/dashboard");
    }

    if (request.method === "HEAD" && isWebAppRoute(url.pathname)) {
      const response = await webApp(
        new Request(request, { method: "GET" }),
        env,
        url
      );
      return new Response(null, {
        status: response.status,
        headers: response.headers
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return redirect("/dashboard");
    }

    if (isWebAppRoute(url.pathname)) {
      return webApp(request, env, url);
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, service: "volley-fire-ai-keys" });
    }

    if (request.method === "HEAD" && url.pathname === "/api/health") {
      return new Response(null, {
        status: 200,
        headers: JSON_HEADERS
      });
    }

    const keysMatch = url.pathname.match(/^\/api\/keys\/([a-z0-9._-]+)$/i);
    if (request.method === "POST" && keysMatch) {
      return createProviderKeyFromApi(
        request,
        env,
        keysMatch[1].toLowerCase()
      );
    }

    const rotateMatch = url.pathname.match(/^\/api\/rotate\/([a-z0-9._-]+)$/i);
    if (request.method === "GET" && rotateMatch) {
      return rotate(request, env, rotateMatch[1].toLowerCase());
    }

    return json({ error: "not_found" }, 404);
  }
};

function isWebAppRoute(pathname: string): boolean {
  return (
    pathname === "/signup" ||
    pathname === "/signup/verify" ||
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/logout" ||
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  );
}

async function webApp(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    return redirect("/dashboard");
  }

  if (request.method === "GET" && url.pathname === "/signup") {
    return html(signupPage());
  }

  if (request.method === "POST" && url.pathname === "/signup") {
    return createUser(request, env);
  }

  if (request.method === "GET" && url.pathname === "/signup/verify") {
    return html(verifySignupPage(""));
  }

  if (request.method === "POST" && url.pathname === "/signup/verify") {
    return verifySignup(request, env);
  }

  if (request.method === "GET" && url.pathname === "/login") {
    const user = await requireUser(request, env);
    return user ? redirect("/dashboard") : html(loginPage());
  }

  if (request.method === "POST" && url.pathname === "/login") {
    return login(request, env);
  }

  if (request.method === "GET" && url.pathname === "/forgot-password") {
    return html(forgotPasswordPage());
  }

  if (request.method === "POST" && url.pathname === "/forgot-password") {
    return startPasswordReset(request, env);
  }

  if (request.method === "GET" && url.pathname === "/reset-password") {
    return html(resetPasswordPage(""));
  }

  if (request.method === "POST" && url.pathname === "/reset-password") {
    return resetPassword(request, env);
  }

  if (request.method === "POST" && url.pathname === "/logout") {
    return redirect("/login", clearSessionCookie());
  }

  const user = await requireUser(request, env);
  if (!user) {
    return redirect("/login");
  }

  if (request.method === "POST" && url.pathname === "/dashboard/api-keys") {
    return createApiKey(request, env, user);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/dashboard/api-keys/delete"
  ) {
    return deleteApiKey(request, env, user);
  }

  if (
    request.method === "POST" &&
    (url.pathname === "/dashboard/connection/reissue" ||
      url.pathname === "/dashboard/access-tokens")
  ) {
    return reissueConnectionToken(env, user);
  }

  if (request.method === "GET" && url.pathname === "/dashboard") {
    return renderDashboard(env, user);
  }

  return redirect("/dashboard");
}

async function createUser(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const email = formText(form, "email").toLowerCase();
  const password = formRawText(form, "password");

  if (!isValidEmail(email) || password.length < MIN_PASSWORD_LENGTH) {
    return html(
      signupPage(
        `Use an email address and a password with at least ${MIN_PASSWORD_LENGTH} characters.`
      ),
      400
    );
  }

  const existingUser = await env.DB.prepare(
    "SELECT id FROM users WHERE email = ? LIMIT 1"
  )
    .bind(email)
    .first<{ id: number }>();

  if (existingUser) {
    return html(signupPage("An account with that email already exists."), 409);
  }

  const passwordHash = await hashPassword(password, env);

  if (!isEmailDeliveryConfigured(env)) {
    return html(
      signupPage(
        "Email verification is not ready yet. A sender email needs to be connected first."
      ),
      503
    );
  }

  const code = randomSixDigitCode();
  const codeHash = await hashAuthCode("signup", email, code, env);
  const expiresAt = authCodeExpiry();

  await env.DB.prepare("DELETE FROM signup_verifications WHERE email = ?")
    .bind(email)
    .run();
  await env.DB.prepare(
    `INSERT INTO signup_verifications
       (email, password_hash, code_hash, expires_at)
     VALUES (?, ?, ?, ?)`
  )
    .bind(email, passwordHash, codeHash, expiresAt)
    .run();

  const sent = await sendAuthCodeEmail(env, {
    to: email,
    code,
    purpose: "signup"
  });

  if (!sent) {
    await env.DB.prepare("DELETE FROM signup_verifications WHERE email = ?")
      .bind(email)
      .run();
    return html(
      signupPage("Could not send a verification code. Try again later."),
      500
    );
  }

  return html(
    verifySignupPage(email, {
      kind: "success",
      message: "A 6-digit verification code was sent to your email."
    })
  );
}

async function createUserWithPasswordHash(
  env: Env,
  email: string,
  passwordHash: string
): Promise<Response> {
  await env.DB.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
    .bind(email, passwordHash)
    .run();

  const user = await env.DB.prepare(
    "SELECT id, email FROM users WHERE email = ? LIMIT 1"
  )
    .bind(email)
    .first<User>();

  if (!user) return html(signupPage("Could not create your account."), 500);

  const token = await replaceConnectionToken(env, user);
  const response = await renderDashboard(
    env,
    user,
    { kind: "success", message: "Account created. Your AI Connection is ready." },
    token
  );
  response.headers.set("set-cookie", await createSessionCookie(user.id, env));
  return response;
}

async function verifySignup(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const email = formText(form, "email").toLowerCase();
  const code = formText(form, "code");

  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return html(verifySignupPage(email, "Use the 6-digit code from email."), 400);
  }

  const row = await env.DB.prepare(
    `SELECT email, password_hash, code_hash, expires_at
       FROM signup_verifications
      WHERE email = ?
      LIMIT 1`
  )
    .bind(email)
    .first<{
      email: string;
      password_hash: string;
      code_hash: string;
      expires_at: string;
    }>();

  if (!row || row.expires_at < new Date().toISOString()) {
    return html(
      verifySignupPage(email, "That code expired. Create the account again."),
      400
    );
  }

  const expected = await hashAuthCode("signup", email, code, env);
  if (!timingSafeStringEqual(row.code_hash, expected)) {
    return html(verifySignupPage(email, "Invalid verification code."), 401);
  }

  const existingUser = await env.DB.prepare(
    "SELECT id FROM users WHERE email = ? LIMIT 1"
  )
    .bind(email)
    .first<{ id: number }>();

  if (existingUser) {
    await env.DB.prepare("DELETE FROM signup_verifications WHERE email = ?")
      .bind(email)
      .run();
    return html(signupPage("An account with that email already exists."), 409);
  }

  await env.DB.prepare("DELETE FROM signup_verifications WHERE email = ?")
    .bind(email)
    .run();
  return createUserWithPasswordHash(env, email, row.password_hash);
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

  if (!row || !(await verifyPassword(password, row.password_hash, env))) {
    return html(loginPage("Invalid email or password."), 401);
  }

  return redirect("/dashboard", await createSessionCookie(row.id, env));
}

async function startPasswordReset(
  request: Request,
  env: Env
): Promise<Response> {
  const form = await request.formData();
  const email = formText(form, "email").toLowerCase();

  if (!isValidEmail(email)) {
    return html(forgotPasswordPage("Use your account email address."), 400);
  }

  if (!isEmailDeliveryConfigured(env)) {
    return html(
      forgotPasswordPage(
        "Email sending is not connected yet, so reset codes cannot be sent."
      ),
      503
    );
  }

  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ id: number }>();

  if (user) {
    const code = randomSixDigitCode();
    const codeHash = await hashAuthCode("password-reset", email, code, env);
    const expiresAt = authCodeExpiry();

    await env.DB.prepare("DELETE FROM password_resets WHERE email = ?")
      .bind(email)
      .run();
    await env.DB.prepare(
      `INSERT INTO password_resets (email, code_hash, expires_at)
       VALUES (?, ?, ?)`
    )
      .bind(email, codeHash, expiresAt)
      .run();

    const sent = await sendAuthCodeEmail(env, {
      to: email,
      code,
      purpose: "password-reset"
    });

    if (!sent) {
      return html(
        forgotPasswordPage("Could not send a reset code. Try again later."),
        500
      );
    }
  }

  return html(
    resetPasswordPage(email, {
      kind: "success",
      message: "If that account exists, a 6-digit reset code was sent."
    })
  );
}

async function resetPassword(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const email = formText(form, "email").toLowerCase();
  const code = formText(form, "code");
  const password = formRawText(form, "password");
  const confirmPassword = formRawText(form, "confirmPassword");

  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return html(resetPasswordPage(email, "Use your email and 6-digit code."), 400);
  }

  if (password.length < MIN_PASSWORD_LENGTH || password !== confirmPassword) {
    return html(
      resetPasswordPage(
        email,
        `New passwords must match and be at least ${MIN_PASSWORD_LENGTH} characters.`
      ),
      400
    );
  }

  const row = await env.DB.prepare(
    `SELECT code_hash, expires_at
       FROM password_resets
      WHERE email = ?
      LIMIT 1`
  )
    .bind(email)
    .first<{ code_hash: string; expires_at: string }>();

  if (!row || row.expires_at < new Date().toISOString()) {
    return html(resetPasswordPage(email, "That code expired."), 400);
  }

  const expected = await hashAuthCode("password-reset", email, code, env);
  if (!timingSafeStringEqual(row.code_hash, expected)) {
    return html(resetPasswordPage(email, "Invalid reset code."), 401);
  }

  const passwordHash = await hashPassword(password, env);
  await env.DB.prepare("UPDATE users SET password_hash = ? WHERE email = ?")
    .bind(passwordHash, email)
    .run();
  await env.DB.prepare("DELETE FROM password_resets WHERE email = ?")
    .bind(email)
    .run();

  return html(
    loginPage({
      kind: "success",
      message: "Password changed. Log in with the new password."
    })
  );
}

async function createApiKey(
  request: Request,
  env: Env,
  user: User
): Promise<Response> {
  const form = await request.formData();
  const platformPreset = formText(form, "platform").toLowerCase();
  const platform =
    platformPreset === "custom"
      ? formText(form, "customPlatform").toLowerCase()
      : platformPreset;
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

  return redirect("/dashboard");
}

async function createProviderKeyFromApi(
  request: Request,
  env: Env,
  platform: string
): Promise<Response> {
  const access = await authenticateAccessToken(request, env);
  if (!access && !readBearerToken(request)) {
    return json({ error: "missing_bearer_token" }, 401);
  }

  if (!access) {
    return json({ error: "invalid_bearer_token" }, 401);
  }

  const input = await readProviderKeyInput(request);
  const apiKey = input.apiKey.trim();
  const label = input.label.trim() || null;

  if (!/^[a-z0-9._-]{1,64}$/.test(platform) || apiKey.length < 8) {
    return json({ error: "invalid_provider_key_input" }, 400);
  }

  const encryptedApiKey = await encryptApiKey(apiKey, env);
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO api_keys
       (user_id, platform, label, encrypted_api_key, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(access.user_id, platform, label, encryptedApiKey, createdAt)
    .run();

  return json({ platform, label, createdAt }, 201);
}

async function readProviderKeyInput(
  request: Request
): Promise<{ apiKey: string; label: string }> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return {
      apiKey:
        typeof body.apiKey === "string"
          ? body.apiKey
          : typeof body.key === "string"
            ? body.key
            : "",
      label: typeof body.label === "string" ? body.label : ""
    };
  }

  const form = await request.formData().catch(() => new FormData());
  return {
    apiKey: formText(form, "apiKey") || formText(form, "key"),
    label: formText(form, "label")
  };
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

  return redirect("/dashboard");
}

async function reissueConnectionToken(env: Env, user: User): Promise<Response> {
  const token = await replaceConnectionToken(env, user);
  return renderDashboard(
    env,
    user,
    {
      kind: "success",
      message: "AI Connection token reissued. Older AI integrations may need the new prompt."
    },
    token
  );
}

async function replaceConnectionToken(env: Env, user: User): Promise<string> {
  const token = `vf_live_${randomBase64Url(32)}`;
  const tokenHash = await sha256Hex(`${env.TOKEN_PEPPER}:${token}`);
  const encryptedToken = await encryptSecret(token, env);

  await env.DB.prepare("DELETE FROM access_tokens WHERE user_id = ?")
    .bind(user.id)
    .run();

  await env.DB.prepare(
    `INSERT INTO access_tokens (user_id, name, token_hash, encrypted_token)
     VALUES (?, ?, ?, ?)`
  )
    .bind(user.id, "AI Connection", tokenHash, encryptedToken)
    .run();

  return token;
}

async function rotate(
  request: Request,
  env: Env,
  platform: string
): Promise<Response> {
  const access = await authenticateAccessToken(request, env);
  if (!access && !readBearerToken(request)) {
    return json({ error: "missing_bearer_token" }, 401);
  }

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

async function authenticateAccessToken(
  request: Request,
  env: Env
): Promise<{ user_id: number } | null> {
  const token = readBearerToken(request);
  if (!token) return null;

  const tokenHash = await sha256Hex(`${env.TOKEN_PEPPER}:${token}`);
  const access = await env.DB.prepare(
    `SELECT token.user_id
       FROM access_tokens token
      WHERE token.token_hash = ?
        AND token.id = (
          SELECT latest.id
            FROM access_tokens latest
           WHERE latest.user_id = token.user_id
           ORDER BY latest.created_at DESC, latest.id DESC
           LIMIT 1
        )
      LIMIT 1`
  )
    .bind(tokenHash)
    .first<{ user_id: number }>();

  return access ?? null;
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

  const connection = await env.DB.prepare(
    `SELECT id, name, encrypted_token, created_at
       FROM access_tokens
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1`
  )
    .bind(user.id)
    .first<AccessTokenRow>();
  const connectionToken =
    newToken ??
    (connection?.encrypted_token
      ? await decryptSecret(connection.encrypted_token, env)
      : undefined);

  return html(
    dashboardPage({
      user,
      keys: keys.results ?? [],
      connection,
      alert,
      connectionToken
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

function readBearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value) return null;
  const [scheme, token] = value.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

async function hashPassword(password: string, env: Env): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltText = bytesToBase64Url(salt);
  const hash = await hmacSha256Base64Url(
    `${saltText}.${password}`,
    env.SESSION_SECRET
  );
  return [
    "hmac-sha256",
    saltText,
    hash
  ].join("$");
}

async function verifyPassword(
  password: string,
  passwordHash: string,
  env: Env
): Promise<boolean> {
  const parts = passwordHash.split("$");
  if (parts[0] === "hmac-sha256" && parts.length === 3) {
    const expected = await hmacSha256Base64Url(
      `${parts[1]}.${password}`,
      env.SESSION_SECRET
    );
    return timingSafeStringEqual(parts[2], expected);
  }

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

function isEmailDeliveryConfigured(
  env: Env
): env is Env & { EMAIL: SendEmail; MAIL_FROM: string } {
  return Boolean(env.EMAIL && env.MAIL_FROM);
}

function randomSixDigitCode(): string {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return String(value % 1_000_000).padStart(6, "0");
}

function authCodeExpiry(): string {
  return new Date(Date.now() + AUTH_CODE_SECONDS * 1000).toISOString();
}

async function hashAuthCode(
  purpose: "signup" | "password-reset",
  email: string,
  code: string,
  env: Env
): Promise<string> {
  return hmacSha256Base64Url(
    `${purpose}:${email.toLowerCase()}:${code}`,
    env.TOKEN_PEPPER
  );
}

async function sendAuthCodeEmail(
  env: Env & { EMAIL?: SendEmail; MAIL_FROM?: string },
  input: {
    to: string;
    code: string;
    purpose: "signup" | "password-reset";
  }
): Promise<boolean> {
  if (!isEmailDeliveryConfigured(env)) return false;

  const subject =
    input.purpose === "signup"
      ? "Your Volley Fire verification code"
      : "Your Volley Fire password reset code";
  const text = [
    `Your Volley Fire AI Keys code is ${input.code}.`,
    "",
    `It expires in ${AUTH_CODE_SECONDS / 60} minutes.`,
    "If you did not request this, ignore this email."
  ].join("\n");

  try {
    await env.EMAIL.send({
      from: env.MAIL_FROM,
      to: input.to,
      subject,
      text
    });
    return true;
  } catch {
    return false;
  }
}

async function encryptApiKey(value: string, env: Env): Promise<string> {
  return encryptSecret(value, env);
}

async function decryptApiKey(payload: string, env: Env): Promise<string> {
  return decryptSecret(payload, env);
}

async function encryptSecret(value: string, env: Env): Promise<string> {
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

async function decryptSecret(payload: string, env: Env): Promise<string> {
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

function signupPage(error?: string): string {
  return layout({
    title: "Create Account",
    body: `
      ${alertHtml(error, "error")}
      <form class="panel auth" method="post" action="/signup">
        <label>
          Email
          <input name="email" type="email" autocomplete="email" required>
        </label>
        <label>
          Password
          <input name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
        </label>
        <div class="auth-actions">
          <button type="submit">Create account</button>
        </div>
        <p class="auth-links">Already have an account? <a href="/login">Log in</a>.</p>
      </form>
    `
  });
}

function verifySignupPage(
  email: string,
  alert?: string | { kind: "error" | "success"; message: string }
): string {
  const alertMessage = typeof alert === "string" ? alert : alert?.message;
  const alertKind = typeof alert === "string" ? "error" : alert?.kind;

  return layout({
    title: "Verify Email",
    body: `
      ${alertHtml(alertMessage, alertKind ?? "error")}
      <form class="panel auth" method="post" action="/signup/verify">
        <label>
          Email
          <input name="email" type="email" autocomplete="email" value="${escapeHtml(email)}" required>
        </label>
        <label>
          Verification code
          <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required>
        </label>
        <div class="auth-actions">
          <button type="submit">Verify code</button>
        </div>
        <p class="auth-links"><a href="/signup">Back to create account</a></p>
      </form>
    `
  });
}

function loginPage(
  alert?: string | { kind: "error" | "success"; message: string }
): string {
  const alertMessage = typeof alert === "string" ? alert : alert?.message;
  const alertKind = typeof alert === "string" ? "error" : alert?.kind;

  return layout({
    title: "Log In",
    body: `
      ${alertHtml(alertMessage, alertKind ?? "error")}
      <form class="panel auth" method="post" action="/login">
        <label>
          Email
          <input name="email" type="email" autocomplete="email" required>
        </label>
        <label>
          Password
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <div class="auth-actions">
          <a class="button-link secondary" href="/forgot-password">Find Pw</a>
          <button type="submit">Log in</button>
        </div>
        <p class="auth-links">No account yet? <a href="/signup">Create one</a>.</p>
      </form>
    `
  });
}

function forgotPasswordPage(error?: string): string {
  return layout({
    title: "Find Password",
    body: `
      ${alertHtml(error, "error")}
      <form class="panel auth" method="post" action="/forgot-password">
        <label>
          Email
          <input name="email" type="email" autocomplete="email" required>
        </label>
        <div class="auth-actions">
          <button type="submit">Send code</button>
        </div>
        <p class="auth-links"><a href="/login">Back to log in</a></p>
      </form>
    `
  });
}

function resetPasswordPage(
  email: string,
  alert?: string | { kind: "error" | "success"; message: string }
): string {
  const alertMessage = typeof alert === "string" ? alert : alert?.message;
  const alertKind = typeof alert === "string" ? "error" : alert?.kind;

  return layout({
    title: "Reset Password",
    body: `
      ${alertHtml(alertMessage, alertKind ?? "error")}
      <form class="panel auth" method="post" action="/reset-password">
        <label>
          Email
          <input name="email" type="email" autocomplete="email" value="${escapeHtml(email)}" required>
        </label>
        <label>
          Reset code
          <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required>
        </label>
        <label>
          New password
          <input name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
        </label>
        <label>
          New password again
          <input name="confirmPassword" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
        </label>
        <div class="auth-actions">
          <button type="submit">Change password</button>
        </div>
        <p class="auth-links"><a href="/forgot-password">Send a new code</a></p>
      </form>
    `
  });
}

function dashboardPage(input: {
  user: User;
  keys: ApiKeyRow[];
  connection: AccessTokenRow | null;
  alert?: { kind: "error" | "success"; message: string };
  connectionToken?: string;
}): string {
  return layout({
    title: "Volley Fire AI Keys",
    userEmail: input.user.email,
    body: `
      ${alertHtml(input.alert?.message, input.alert?.kind)}
      ${connectionPromptHtml(input.connectionToken)}
      <section class="panel">
        <h2>AI Connection</h2>
        ${connectionStatusHtml(input.connection, Boolean(input.connectionToken))}
        ${reissueModalHtml()}
      </section>

      <section class="panel">
        <h2>Add Provider Key</h2>
        <form class="grid-form" method="post" action="/dashboard/api-keys">
          <label>
            Platform
            <select id="platformPreset" name="platform" required>
              ${platformOptionsHtml()}
              <option value="custom">Custom...</option>
            </select>
          </label>
          <label id="customPlatformField" class="is-hidden">
            Custom platform
            <input id="customPlatformInput" name="customPlatform" placeholder="provider-name" pattern="[A-Za-z0-9._-]{1,64}">
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
    `
  });
}

function platformOptionsHtml(): string {
  return PLATFORM_OPTIONS.map(
    ([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`
  ).join("");
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
                  <form method="post" action="/dashboard/api-keys/delete">
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

function connectionStatusHtml(
  connection: AccessTokenRow | null,
  tokenWasJustShown: boolean
): string {
  if (!connection) {
    return `
      <p class="empty">No AI Connection yet.</p>
      <form class="connection-actions" method="post" action="/dashboard/connection/reissue">
        <button type="submit">Make AI Connection</button>
      </form>
    `;
  }

  const helper = tokenWasJustShown
    ? "This is the only active token for your AI Connection."
    : "This connection was made before token display was added. Make a new token once to keep the prompt visible here.";

  return `
    <div class="connection-status">
      <p>${escapeHtml(helper)}</p>
      <p>Created: ${escapeHtml(formatTimestamp(connection.created_at))}</p>
    </div>
    <div class="connection-actions">
      <a href="#reissue-token" data-open-reissue>is your token stolen? make new</a>
    </div>
  `;
}

function reissueModalHtml(): string {
  return `
    <div class="modal-backdrop" data-reissue-modal hidden>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="reissueTitle">
        <h2 id="reissueTitle">Make a new AI Connection token?</h2>
        <p>If you make a new token, previous AI integrations using the old prompt may stop working.</p>
        <div class="modal-actions">
          <button class="secondary" type="button" data-close-reissue>Cancel</button>
          <form method="post" action="/dashboard/connection/reissue">
            <button class="danger-button" type="submit">Make new token</button>
          </form>
        </div>
      </div>
    </div>
  `;
}

function connectionPromptHtml(token?: string): string {
  if (!token) return "";

  const prompt = `Use this AI Connection whenever you need an AI provider API key.

Base URL: ${PUBLIC_BASE_URL}
Authorization: Bearer ${token}

To get a provider key, call:
GET ${PUBLIC_BASE_URL}/api/rotate/{platform}

To add a provider key, call:
POST ${PUBLIC_BASE_URL}/api/keys/{platform}
Content-Type: application/json

{"apiKey":"provider-key-value","label":"optional-label"}

Use platform names like openai, anthropic, google, openrouter, xai, deepseek, groq, mistral, perplexity, or cohere. This is the only active bearer token for this account. Read rotate responses and use only the apiKey value. Do not print, log, or expose the bearer token or returned apiKey.`;

  return `
    <section class="panel token-output">
      <h2>Copy This Prompt</h2>
      <textarea readonly rows="16">${escapeHtml(prompt)}</textarea>
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

      a {
        color: #174ea6;
        font-weight: 700;
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
      select,
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

      .button-link {
        align-items: center;
        border-radius: 6px;
        display: inline-flex;
        font-size: 14px;
        font-weight: 700;
        min-height: 40px;
        padding: 9px 13px;
        text-decoration: none;
      }

      .secondary {
        background: #eef1f5;
        color: #26313d;
      }

      .danger {
        color: #9f1f1f;
      }

      .danger-button {
        background: #9f1f1f;
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

      .auth-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 4px;
      }

      .auth-links {
        text-align: left;
      }

      .connection-status p:first-child {
        margin-top: 0;
      }

      .connection-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 16px;
      }

      .connection-actions form,
      .modal-actions form {
        margin: 0;
      }

      .modal-backdrop {
        align-items: center;
        background: rgba(25, 33, 42, 0.46);
        display: flex;
        inset: 0;
        justify-content: center;
        padding: 20px;
        position: fixed;
        z-index: 10;
      }

      .modal-backdrop[hidden] {
        display: none;
      }

      .modal {
        background: #ffffff;
        border-radius: 8px;
        box-shadow: 0 18px 48px rgba(25, 33, 42, 0.24);
        max-width: 460px;
        padding: 20px;
        width: 100%;
      }

      .modal-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 18px;
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

      .is-hidden {
        display: none;
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

      .token-output textarea {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }

      @media (max-width: 720px) {
        header,
        .userbar,
        .auth-actions,
        .modal-actions,
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
    <script>
      const platformPreset = document.getElementById("platformPreset");
      const customPlatformField = document.getElementById("customPlatformField");
      const customPlatformInput = document.getElementById("customPlatformInput");

      function syncPlatformInput() {
        if (!platformPreset || !customPlatformField || !customPlatformInput) return;
        const isCustom = platformPreset.value === "custom";
        customPlatformField.classList.toggle("is-hidden", !isCustom);
        customPlatformInput.required = isCustom;
        if (isCustom) customPlatformInput.focus();
      }

      if (platformPreset) {
        platformPreset.addEventListener("change", syncPlatformInput);
        syncPlatformInput();
      }

      const reissueModal = document.querySelector("[data-reissue-modal]");
      const openReissue = document.querySelector("[data-open-reissue]");
      const closeReissue = document.querySelector("[data-close-reissue]");

      function setReissueModalOpen(isOpen) {
        if (!reissueModal) return;
        reissueModal.hidden = !isOpen;
      }

      if (openReissue) {
        openReissue.addEventListener("click", (event) => {
          event.preventDefault();
          setReissueModalOpen(true);
        });
      }

      if (closeReissue) {
        closeReissue.addEventListener("click", () => setReissueModalOpen(false));
      }

      if (reissueModal) {
        reissueModal.addEventListener("click", (event) => {
          if (event.target === reissueModal) setReissueModalOpen(false);
        });
      }
    </script>
  </body>
</html>`;
}

function headerControls(userEmail?: string): string {
  if (!userEmail) return "";

  return `
    <div class="userbar">
      <span>${escapeHtml(userEmail)}</span>
      <form method="post" action="/logout">
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
