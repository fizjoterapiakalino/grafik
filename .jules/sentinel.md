# Sentinel Security Journal 🛡️

## 2025-05-15 - XSS in Template Literals with innerHTML
**Vulnerability:** User-provided or database-provided content was directly inserted into the DOM using template literals and `innerHTML` without escaping, leading to potential Cross-Site Scripting (XSS).
**Learning:** Even with basic input validation blacklists, relying on `innerHTML` for dynamic content is dangerous as blacklists can be bypassed. Confirmation modals and history logs are common places where this pattern occurs.
**Prevention:** Always use a robust escaping utility like `escapeHTML` when using `innerHTML`, or preferably, use `textContent` or programmatic DOM creation (`createElement`).
