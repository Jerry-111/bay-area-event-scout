# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately, not through a public issue.

1. Go to the repository's **Security** tab on GitHub.
2. Click **Report a vulnerability** to open a private security advisory.
3. Include a description, reproduction steps, the affected file(s), and the impact.

You should get an acknowledgement within a few days. Please give us a reasonable amount of time to
investigate and fix an issue before disclosing it publicly.

## Scope

In scope:

- **Secret leakage** — API keys, `ADMIN_PASSWORD`, `DATABASE_URL`, or other secrets exposed through
  logs, error messages, the admin UI, source control, or a committed file.
- **Admin auth bypass** — a way to read or modify data in `apps/admin` without a valid session, or to
  forge/replay a session cookie.
- **Server-side request forgery (SSRF)** — the scout fetches URLs surfaced by discovery
  (`packages/intelligence/src/fetch-page.ts` and the connectors in `packages/discovery`) with no
  login and no user-provided URLs in the trust boundary sense, but a way to make it fetch or leak the
  contents of internal/unintended hosts is a real finding.
- **Prompt injection that exfiltrates config** — a crafted event page or search result that causes
  the LLM extraction/scoring/planning prompts to leak configuration, secrets, or other events' data,
  rather than just producing a wrong score or a wrong field.

Out of scope:

- Findings that require an attacker to already have your `.env.local`, database, or API keys.
- The accuracy or quality of event discovery, extraction, or scoring — that's a bug report
  (see `.github/ISSUE_TEMPLATE/bug_report.md`), not a security issue.
- Rate limiting or availability of third-party sites the scout reads (Luma, X, newsletters, etc.).
- Issues in third-party dependencies without a demonstrated impact on this project — report those
  upstream.

## Operator guidance

If you run your own deployment:

- Keep every secret (`LLM_API_KEY`/provider keys, `EXA_API_KEY`, `X_BEARER_TOKEN`,
  `FIRECRAWL_API_KEY`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `ADMIN_PASSWORD`,
  `TRIGGER_SECRET_KEY`) in `.env.local` (gitignored) or your host's secret store (Trigger.dev and
  Railway both have one). Never commit them, and never put them in a `scout.profile.yaml` you intend
  to share — a profile is preferences only and is safe to commit.
- **Set `ADMIN_PASSWORD` before exposing the admin dashboard on a public URL.** Without it, `apps/admin`
  serves the dashboard with no login at all. With it set, sign-in uses `ADMIN_USERNAME` +
  `ADMIN_PASSWORD` and a signed, HttpOnly session cookie. See
  [docs/operations.md](docs/operations.md) and [docs/admin-railway-deploy.md](docs/admin-railway-deploy.md).
- `MOCK_MODE=true` never makes a real API call, never writes to a real database, and never sends a
  real Telegram message, so it's safe for local development, forks, and CI.
- Treat any LLM output (extracted fields, scores, rationale text) as untrusted content when rendering
  it — it originates from third-party web pages.
