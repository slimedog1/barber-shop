# Security Best Practices Audit

**Date:** 2026-10-08  
**Scope:** `barber-shop-plain` (Express 5 / Node.js, vanilla browser JavaScript, MongoDB), current working tree at commit `8fccfd7`.  
**Method:** Static review of server routes, frontend DOM rendering, session and header configuration, deployment settings, and `npm audit` against the checked-in lockfile. The original audit made no application-code changes. The local `.env` is ignored and untracked; during remediation, only SMTP variable lines were removed without displaying or reproducing their values.

## Executive summary

The audit originally found one known vulnerable direct dependency, one booking-hours validation bug, and a rate-limiting gap for the public availability API. Those findings and the session-secret fallback have since been addressed as described below. No confirmed SQL injection, command injection, authentication bypass, CSRF, deserialization, or exploitable XSS issue was found in the reviewed code. Admin routes require a Mongo-backed session, cookies use `HttpOnly`, `SameSite=Strict`, and production `Secure`, and Helmet configures security headers.

## Remediation update — 2026-10-08

- **SBP-01:** Removed Nodemailer and outgoing booking/cancellation email code, and removed SMTP entries from the repo example and local `.env`. Customer email collection remains for staff contact from the admin appointments page. Vercel environment settings were not changed.
- **SBP-02:** Replaced clock-string checks with shop-local date-time comparisons, including the reserved end time.
- **SBP-03:** Added MongoDB-backed shared counters for booking, login, and availability limits; bounded availability and direct booking requests to the current 12-month calendar window; aligned the browser calendar to the shop timezone returned by the API.
- **SBP-04:** Removed the fixed session-secret fallback; startup still requires a configured secret.

JavaScript syntax checks and `git diff --check` pass. Runtime behavior against MongoDB was not exercised. A post-change `npm audit` could not reach the npm registry because DNS resolution failed; the `npm uninstall` operation reported zero vulnerabilities from its available audit data.

## Findings

### High

#### SBP-01 — Nodemailer lockfile contains a version affected by a high-severity upstream advisory — Resolved by removal

- **Original location:** `package.json`; `package-lock.json`; use of user-supplied recipient in the booking route.
- **Evidence:** The lockfile resolves Nodemailer to `7.0.13`. `npm audit` reports a High-severity address-parser denial-of-service advisory affecting versions through `10.0.5`, with `10.0.6` listed as patched. The booking route passes the customer’s email address to `sendMail` as the recipient.
- **Impact:** A crafted recipient can reach Nodemailer’s address parser. In the current route, email syntax validation and a 254-character maximum sharply constrain the published large-input denial-of-service payload, so this audit did not establish that the advisory is practically exploitable through this endpoint at its demonstrated severity. The vulnerable dependency remains deployed, and future call paths may not preserve those constraints. [GHSA-v53p-9fqp-m79j](https://github.com/advisories/GHSA-v53p-9fqp-m79j)
- **Change:** Nodemailer and all outbound email code were removed, and the lockfile was regenerated. Booking still stores the customer's email for staff contact. The feature's SMTP variables were removed from the example and local `.env`; any SMTP variables configured in Vercel still need to be deleted there.

The post-change registry audit could not run because DNS resolution failed. The `npm uninstall` operation reported zero vulnerabilities from its available audit data.

### Medium

#### SBP-02 — Appointment validation can confirm a booking after closing — Resolved

- **Location:** `server.js:256-263` (`POST /api/appointments`).
- **Evidence:** The code checks `start.toFormat("HH:mm")` and `reservedEnd.toFormat("HH:mm")` against opening and closing strings. If the requested start is after closing and the reserved end rolls into the next day, the end clock string can be earlier than the closing time and pass the check.
- **Impact:** A public caller can submit a future appointment outside business hours; availability generation itself uses full date-time values and does not offer that slot, but the booking endpoint independently accepts submitted values.
- **Change:** The booking endpoint now compares full shop-local date-time values against opening and closing instants, including the reserved end time.

```js
const opening = localDateTime(date, hours.open);
const closing = localDateTime(date, hours.close);
if (!opening || !closing || start < opening || reservedEnd > closing) {
  return res.status(409).json({ error: "That time is outside the shop schedule." });
}
```

#### SBP-03 — Public availability lookups are unthrottled and accept distant months — Resolved in code; database runtime check pending

- **Location:** `server.js:197-218` (`GET /api/availability`); existing limiter declarations at `server.js:181-182` are applied to booking and login only.
- **Evidence:** Availability requests query MongoDB for appointments and blocks for any syntactically valid `YYYY-MM` month. The route has no rate limiter or bound on how far in the past or future the requested month may be.
- **Impact:** Repeated public requests can consume database and function capacity. The existing booking and login limits also use the default in-process store, so their counters are not shared between multiple serverless instances.
- **Change:** Availability, booking, and login use MongoDB-backed shared counters. Availability and booking requests are restricted to the current 12-month window, and the browser calendar uses the shop timezone. MongoDB concurrency and TTL behavior have not been exercised at runtime.

### Low

#### SBP-04 — Fixed fallback value is supplied as the session secret — Resolved

- **Location:** `server.js:172-179`, especially line 174; startup validation at `server.js:616-620`.
- **Evidence:** Session configuration includes a fixed fallback string if `SESSION_SECRET` is absent. The startup validation currently requires `SESSION_SECRET` before requests can proceed, so this fallback is not used during normal successful startup; it is a risky fallback if that validation is changed or bypassed later.
- **Impact:** A future startup-path regression could make session signatures predictable.
- **Change:** The fallback was removed. Session setup now uses `SESSION_SECRET` directly, with existing startup validation requiring a configured secret.

```js
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters.");
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  // ...
}));
```

## Requested checks with no confirmed finding

- **SQL injection:** No SQL layer is used; the application queries MongoDB with explicit fields and does not pass whole request objects into query filters or update operators.
- **Command injection:** No shell/process execution APIs were found in the application source.
- **Authentication/authorization:** No unauthenticated admin data or mutation route was found. Admin API routes use `requireAdmin`; the login handler regenerates the session after successful authentication. The app uses one shared admin credential by design, so access is not attributable to individual staff accounts.
- **Sensitive data exposure:** Appointment/customer details are returned only from authenticated admin endpoints. `.env` is ignored and untracked; `.env.example` contains placeholders. Secret values were not displayed or reproduced during the audit or remediation.
- **Insecure deserialization:** No `eval`, dynamic code construction, or custom unsafe object deserialization was found; JSON input uses Express’s parser with a 20 KB body limit.
- **XSS:** Dynamic names, service values, appointment data, and identifiers are HTML-escaped before template insertion in the reviewed paths; editable about text is assigned with `textContent`. Remaining `innerHTML` uses were static strings, fixed translations, or escaped values.
- **CSRF:** Cookie-authenticated admin state changes require an admin session; the session cookie is `SameSite=Strict`, and `/api/admin` rejects a supplied cross-origin `Origin`. No confirmed CSRF bypass was found in the reviewed browser flows.
- **Security headers/configuration:** Helmet is enabled with a restrictive same-origin script policy, and `x-powered-by` is disabled. The `style-src` policy allows inline styles, which supports the current dynamically styled UI and weakens CSP’s defense-in-depth value; consider moving styles to CSS classes or using a nonce if practical.
- **Hardcoded credentials:** No real credential was found in tracked source. The session fallback noted in SBP-04 is a placeholder, not a discovered live secret.

## Review limits

This is a source and dependency review, not a penetration test. Runtime behavior at Vercel, MongoDB Atlas network rules, Cloudinary account restrictions, and secret values were not independently inspected. `npm audit` ran against the committed lockfile on 2026-10-08.
