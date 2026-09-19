import { escapeAttr, escapeHtml } from "./format.js";
import { baseStyles, loginStyles } from "./styles.js";

export function renderLoginPage(username: string, error = "", next = "/"): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in · Event Scout</title>
  <style>${baseStyles}${loginStyles}</style>
</head>
<body>
  <main>
    <div class="intro">
      <h1>Event Scout</h1>
      <p>Sign in once and this browser stays signed in for 30 days.</p>
    </div>
    <form method="post" action="/login">
      ${error ? `<div class="banner banner-warning">${escapeHtml(error)}</div>` : ""}
      <input type="hidden" name="next" value="${escapeAttr(next)}">
      <label>
        Username
        <input name="username" type="text" autocomplete="username" value="${escapeAttr(username)}" required>
      </label>
      <label>
        Password
        <input name="password" type="password" autocomplete="current-password" autofocus required>
      </label>
      <button class="primary" type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>`;
}
