# Challenge Task 1 — Discussion Answers

## (1) Observability, Autonomy, Adaptability vs. Security Delegation (300 words)

Modern software ecosystems are characterised by high observability, autonomy, and adaptability — properties that enable microservices, API-driven architectures, and loosely coupled components to evolve independently. In the OAuth implementation explored in this exercise, SSE-Forum delegates its authentication function entirely to Google as a third-party Identity Provider (IdP). This delegation creates an inherent tension with the properties above.

**Observability** is partially reduced: SSE-Forum cannot inspect the internal mechanics of Google's authentication process. It receives tokens and user profiles but has no visibility into how Google validates credentials, detects suspicious logins, or enforces multi-factor authentication. The forum must trust Google's security posture without being able to audit it directly.

**Autonomy** is constrained by design. SSE-Forum cannot authenticate users independently — if Google's OAuth service is unavailable, the forum becomes inaccessible. This introduces a single point of failure in the authentication pathway. However, this loss of autonomy is a deliberate trade-off: building and maintaining a secure credential store (password hashing, breach detection, account recovery) is complex and error-prone. Delegating to a specialist provider with dedicated security teams is often the more secure choice.

**Adaptability** is both enhanced and limited. The OAuth standard allows SSE-Forum to switch identity providers (from Google to GitHub, as in Challenge Task 4) with relatively modest code changes. The protocol's standardised flows (authorization code, token exchange) provide a common interface. However, adapting the authentication behaviour itself — adding custom MFA policies, restricting login geographies, or implementing risk-based authentication — requires the IdP to support those features.

The balance is pragmatic: for most applications, the security gains from delegating to a mature IdP outweigh the losses in observability and autonomy. The key is to mitigate residual risk through proper token management, PKCE implementation, and session validation — exactly the controls implemented in this exercise.

---

## (2) Token Management, Secure Storage, and Flow Selection (300 words)

Proper token management, secure storage, and flow selection are foundational to a robust OAuth system. Each addresses a distinct attack surface.

**Token management** governs the lifecycle of access and refresh tokens. Access tokens should be short-lived (the 15-minute `maxAge` in this implementation) to limit the damage window if intercepted. Refresh tokens enable session continuity without re-authentication but must be stored with stronger protections since they have longer lifetimes. The implementation stores the refresh token as an `httpOnly`, `Secure`, `sameSite: 'strict'` cookie — preventing JavaScript access (mitigating XSS), requiring HTTPS transmission, and blocking cross-site attachment (mitigating CSRF). Without these flags, a stolen token could grant an attacker persistent access to a user's account.

**Secure storage** determines where tokens reside on the client. The two common approaches are cookies (as used here) and browser local/session storage. Cookies with `httpOnly` are preferable because they are inaccessible to client-side scripts, reducing the XSS attack surface. Local storage, by contrast, is readable by any JavaScript running on the page — a single XSS vulnerability would expose all stored tokens. The trade-off is that cookies are automatically attached to requests, which requires CSRF protections (hence the `state` parameter and `sameSite` attribute in this implementation).

**Flow selection** determines which OAuth grant type is used. The Authorization Code flow (implemented in Step 3) is appropriate for server-side applications because the client secret never reaches the browser. The addition of PKCE (Step 4) protects against authorization code interception attacks, where a malicious app on the same device captures the code during the redirect. PKCE binds the code to a cryptographic verifier that only the legitimate client possesses, making intercepted codes useless. The Implicit flow (now deprecated in OAuth 2.1) would expose tokens directly in the URL fragment — far less secure. Choosing the right flow for the deployment context is not optional; it is a critical security decision.

---

## (3) Refresh Token: Advantages, Disadvantages, and Implementation

### Discussion

**Current design:** When the access token expires (15 minutes), the user must re-authenticate via Google's consent screen. This is simple but disruptive.

**Advantages of the current (no-refresh) approach:**
- Simpler implementation with fewer attack surfaces
- Forced re-authentication provides periodic identity verification
- No long-lived tokens to protect

**Disadvantages:**
- Poor user experience — frequent redirects to Google
- Each re-authentication creates network overhead
- Users in the middle of a forum discussion lose continuity

**Advantages of the refresh token extension (implemented in `oserver-refresh-ws.js`):**
- Seamless session continuity — the middleware silently obtains new access tokens
- Reduced load on the IdP (fewer full OAuth flows)
- Configurable token lifetimes allow fine-grained security/UX trade-offs

**Disadvantages of refresh tokens:**
- Longer-lived credentials increase the impact of token theft
- Requires secure storage (the `httpOnly` + `Secure` + `sameSite` cookie flags are essential)
- Token revocation must be handled — if a refresh token is compromised, the attacker can generate new access tokens until the refresh token is revoked

### Implementation

See `oserver-refresh-ws.js` and `helper-refresh-token.js`. The key changes:

1. **`helper-refresh-token.js`** — Calls Google's token endpoint with `grant_type: 'refresh_token'` to obtain a new access token without user interaction.

2. **Modified `authenticateTokenPkce` middleware** — Before redirecting to Google, it checks for a valid refresh token cookie. If present, it silently refreshes the access token and sets a new cookie.

3. **Explicit `/auth/refresh` endpoint** — Allows the client to proactively request a token refresh before the access token expires.

To run: update `package.json` start script to `"start": "node oserver-refresh-ws.js"`.
