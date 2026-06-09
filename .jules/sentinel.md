## 2025-05-22 - XSS Prevention via HTML Escaping
**Vulnerability:** Dynamic content (employee names, history entries) was injected into the DOM via `innerHTML` without sanitization in `scripts/schedule-modals.ts`.
**Learning:** Even though `data-validation.ts` has some blacklist-based checks, they are not sufficient to prevent all XSS attacks, especially for data that might have bypassed initial validation or is being rendered in a context where blacklist checks aren't applied.
**Prevention:** Always sanitize dynamic content before using `innerHTML`. Prefer `textContent` when possible. Use a centralized `escapeHTML` utility for cases where HTML structure is required but data must be safe.
