# Workshop 17 — OAuth 2.0 with PKCE

SSE-Forum secured with OAuth Authorization Code flow using Google as Identity Provider, plus PKCE for code interception mitigation.

## Prerequisites

- Node.js
- OpenSSL (for self-signed certificates)
- A Google Cloud project with OAuth 2.0 credentials ([console.cloud.google.com](https://console.cloud.google.com))

## Setup

```bash
npm install

# Generate self-signed SSL certificate (if not already present)
openssl req -x509 -newkey rsa:2048 -keyout private.key -out server.crt -days 365 -nodes -subj "/CN=localhost"
```

Add your Google OAuth credentials to `.env`:

```
PORT_WS=8888
PORT_OAUTH=3000
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=https://localhost:3000/auth/google/callback
```

## How to Run

Each server variant can be run by updating the `start` script in `package.json` or running directly:

```bash
# Step 3 — Basic OAuth Authorization Code flow
node oserver-ws.js

# Step 4 — OAuth with PKCE
node oserver-pkce-ws.js

# Challenge 3 — Refresh token extension
node oserver-refresh-ws.js

# Challenge 4 — GitHub as IdP (requires GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_REDIRECT_URI in .env)
node oserver-github-ws.js

# Challenge 5 — Passport.js middleware
node oserver-passport-ws.js
```

Open `https://localhost:3000` in your browser (accept the self-signed certificate warning).

## Structure

```
oserver-ws.js                  Step 3 — OAuth Authorization Code server
oserver-pkce-ws.js             Step 4 — PKCE-enhanced server
oserver-refresh-ws.js          Challenge 3 — Refresh token server
oserver-github-ws.js           Challenge 4 — GitHub IdP server
oserver-passport-ws.js         Challenge 5 — Passport.js server

helper-oauth-url.js            Google OAuth URL generator
helper-oauth-handler.js        Google token exchange + user profile
helper-oauth-pkce-url.js       Google OAuth URL with PKCE params
helper-oauth-pkce-handler.js   Token exchange with code_verifier
helper-pkce.js                 Code verifier/challenge generation
helper-refresh-token.js        Refresh token exchange
helper-github-oauth-url.js     GitHub OAuth URL generator
helper-github-oauth-handler.js GitHub token exchange + user profile

login.html                     Login page (Google)
login-github.html              Login page (GitHub)
eindex-oauth.html              Forum UI with WebSocket chat
public/css/style.css           Stylesheet

CHALLENGE-TASK-1-ANSWERS.md    Written answers for discussion questions
```

## Challenge Task 1 — Discussion

### (1) Observability, Autonomy, Adaptability vs. Security Delegation

In the OAuth implementation, SSE-Forum delegates authentication entirely to Google as a third-party IdP. This creates tension with three properties of modern software ecosystems:

- **Observability** is reduced — SSE-Forum receives tokens and profiles but cannot inspect how Google validates credentials, detects suspicious logins, or enforces MFA. The forum must trust Google's security posture without auditing it.
- **Autonomy** is constrained — if Google's OAuth service goes down, the forum becomes inaccessible. However, this is a deliberate trade-off: maintaining a secure credential store (password hashing, breach detection, account recovery) is complex and error-prone. Delegating to a specialist with dedicated security teams is often more secure.
- **Adaptability** is mixed — the OAuth standard lets SSE-Forum switch providers (Google → GitHub) with modest code changes, but customising authentication behaviour (MFA policies, geo-restrictions) depends on what the IdP supports.

The balance is pragmatic: security gains from a mature IdP outweigh the losses in observability and autonomy, provided residual risk is mitigated through token management, PKCE, and session validation.

### (2) Token Management, Secure Storage, and Flow Selection

- **Token management** — Access tokens are short-lived (15-minute `maxAge`) to limit damage if intercepted. Refresh tokens enable session continuity but need stronger protection due to longer lifetimes. Both are stored as `httpOnly`, `Secure`, `sameSite: 'strict'` cookies — preventing JavaScript access (XSS), requiring HTTPS (eavesdropping), and blocking cross-site attachment (CSRF).
- **Secure storage** — Cookies with `httpOnly` are preferable to `localStorage` because they're inaccessible to client-side scripts. A single XSS vulnerability would expose everything in `localStorage`, but cannot read `httpOnly` cookies. The trade-off: cookies are auto-attached to requests, requiring CSRF protections (the `state` parameter and `sameSite` attribute).
- **Flow selection** — The Authorization Code flow (Step 3) keeps the client secret server-side. PKCE (Step 4) protects against code interception by binding the authorization code to a cryptographic verifier only the legitimate client holds. The Implicit flow (deprecated in OAuth 2.1) exposes tokens in the URL fragment — far less secure.

### (3) Refresh Token: Advantages, Disadvantages, and Implementation

Currently, when the access token expires, the user must re-authenticate via Google. This is simple but disruptive.

**Current approach (no refresh):**
- Simpler, fewer attack surfaces
- Periodic identity re-verification
- No long-lived tokens to protect
- But: poor UX (frequent redirects), network overhead, lost forum continuity

**Refresh token extension:**
- Seamless session continuity — middleware silently obtains new access tokens
- Reduced IdP load (fewer full OAuth flows)
- Configurable lifetimes for security/UX balance
- But: longer-lived credentials increase theft impact, require secure storage, and need revocation handling

**Implementation** (`oserver-refresh-ws.js` + `helper-refresh-token.js`):

1. `helper-refresh-token.js` calls Google's token endpoint with `grant_type: 'refresh_token'` to get a new access token without user interaction
2. Modified `authenticateTokenPkce` middleware checks for a refresh token cookie before redirecting to Google — if present, silently refreshes and sets a new cookie
3. Explicit `/auth/refresh` endpoint lets the client proactively refresh before expiry

### (4) GitHub as Identity Provider

Files: `oserver-github-ws.js`, `helper-github-oauth-url.js`, `helper-github-oauth-handler.js`, `login-github.html`

Same Authorization Code flow, different endpoints:

| Step | Google | GitHub |
|------|--------|--------|
| Consent screen | `accounts.google.com/o/oauth2/v2/auth` | `github.com/login/oauth/authorize` |
| Token exchange | `oauth2.googleapis.com/token` | `github.com/login/oauth/access_token` |
| User profile | JWT decode of `id_token` | `api.github.com/user` |
| Email | Included in profile | `api.github.com/user/emails` (separate call) |
| Scopes | `userinfo.profile userinfo.email` | `read:user user:email` |

Key differences: GitHub has no `id_token` (requires a separate API call), and emails need a dedicated endpoint since GitHub profiles may have email set to private.

To use: add `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_REDIRECT_URI` to `.env`.

### (5) Passport.js with Google OAuth 2.0

File: `oserver-passport-ws.js`

Replaces the manual OAuth handling with the `passport-google-oauth20` strategy. Passport abstracts the entire flow — redirect, callback, token exchange — into middleware configuration. The verify callback receives the access token, refresh token, and profile directly, eliminating the need for `helper-oauth-url.js` and `helper-oauth-handler.js`.

Trade-off: ~80 lines of OAuth code reduced to a single strategy config, but the flow is obscured. Understanding the manual implementation first (Steps 3–4) is essential for debugging and reasoning about security properties.
