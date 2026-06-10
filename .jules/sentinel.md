# Sentinel Journal - Grafik Kalinowa

## 2025-05-15 - XSS Vulnerability via innerHTML
**Vulnerability:** Multiple instances of `innerHTML` were used with unsanitized data from Firestore and user input, including employee names, patient names, timestamps, and time slots.
**Learning:** The application relied partly on blacklist-based validation in `scripts/data-validation.ts`, which is insufficient to prevent all XSS attacks.
**Prevention:** Always escape dynamic content before inserting it into the DOM via `innerHTML`, or prefer `textContent` and programmatic element creation.

## 2025-05-22 - XSS Prevention via HTML Escaping
**Vulnerability:** Dynamic content such as employee names and history entries was injected into the DOM via `innerHTML` without sanitization in `scripts/schedule-modals.ts`.
**Learning:** Data may bypass initial validation or be rendered in contexts where validation is not applied, so output encoding is required at the rendering boundary.
**Prevention:** Use a centralized `escapeHTML` utility for cases where HTML structure is required but data must be safe.
