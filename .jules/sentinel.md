# Sentinel Journal - Grafik Kalinowa

## 2025-05-15 - XSS Vulnerability via innerHTML
**Vulnerability:** Multiple instances of `innerHTML` being used with unsanitized data from Firestore and user input (e.g., employee names, patient names, time slots).
**Learning:** The application relies on a weak blacklist-based validation in `scripts/data-validation.ts`, which is insufficient to prevent all XSS attacks.
**Prevention:** Always escape dynamic content before inserting it into the DOM via `innerHTML`, or prefer `textContent` and programmatic element creation.
