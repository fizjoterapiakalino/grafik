## 2025-05-22 - [HTML Injection in Stations and Leaves Summary]
**Vulnerability:** User-controlled strings (employee names, room names, etc.) from Firestore were directly interpolated into `innerHTML` templates without sanitization.
**Learning:** `textContent` and programmatic DOM creation are safer alternatives to `innerHTML`. However, when using templates with `innerHTML`, all dynamic content must be explicitly escaped.
**Prevention:** Use the centralized `escapeHTML` utility for all data rendered via `innerHTML`. Always prefer `textContent` where possible, and never wrap it with redundant escaping.
