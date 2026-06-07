## 2025-05-22 - XSS via innerHTML in Modals and Overlays
**Vulnerability:** Several locations in the codebase used `innerHTML` to inject dynamic, unsanitized strings (employee names, patient history, room names) directly into the DOM.
**Learning:** While some data validation existed in `scripts/data-validation.ts`, it used a blacklist approach which is insufficient against sophisticated XSS. The application lacked a centralized escaping utility.
**Prevention:** Always use `textContent` for plain text. When `innerHTML` is required for structured templates, use a robust `escapeHTML` utility to sanitize every dynamic variable. Avoid blacklist-based sanitization in favor of proper entity encoding.
