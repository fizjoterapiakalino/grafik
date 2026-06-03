## 2025-05-21 - [XSS] Unescaped dynamic content in modals
**Vulnerability:** User-contributed data (employee names, patient notes, history) were inserted into the DOM using innerHTML without proper escaping.
**Learning:** The application uses innerHTML extensively for dynamic UI updates, creating many potential XSS vectors.
**Prevention:** Always use textContent for simple text or the escapeHTML utility when using innerHTML.
