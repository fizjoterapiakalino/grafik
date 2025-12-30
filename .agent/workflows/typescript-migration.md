---
description: Jak migrować plik JavaScript na TypeScript
---

# Migracja pliku JS na TypeScript

## Kroki:

1. **Skopiuj plik** z rozszerzeniem `.ts`:
   ```bash
   # Nie usuwaj od razu starego pliku .js!
   cp scripts/nazwa-pliku.js scripts/nazwa-pliku.ts
   ```

2. **Dodaj typy do importów**:
   - Zaimportuj potrzebne typy z `./types`
   - Użyj `import type { ... }` dla typów (lepszy tree-shaking)

3. **Zdefiniuj typy parametrów funkcji**:
   ```typescript
   // Przed (JS)
   function getName(employee) { ... }
   
   // Po (TS)
   function getName(employee: Employee): string { ... }
   ```

4. **Zdefiniuj typy dla zmiennych stanu**:
   ```typescript
   // Przed (JS)
   let _employees = {};
   
   // Po (TS)
   let _employees: EmployeesMap = {};
   ```

5. **Sprawdź kompilację**:
   ```bash
   npm run type-check
   ```

6. **Zaktualizuj importy w innych plikach**:
   - Zmień `.js` na `.ts` w importach
   - Vite automatycznie obsługuje oba rozszerzenia

7. **Usuń stary plik .js** gdy wszystko działa:
   ```bash
   rm scripts/nazwa-pliku.js
   ```

## Kolejność migracji (zalecana):

1. `common.ts` ✅ (zrobione)
2. `types/index.ts` ✅ (zrobione)
3. `employee-manager.ts` (następny - fundament danych)
4. `schedule-data.ts` (logika danych grafiku)
5. `leaves.ts` (urlopy)
6. Pozostałe moduły UI

## Przydatne komendy:

// turbo-all
```bash
# Sprawdź typy bez kompilacji
npm run type-check

# Uruchom dev server z Vite
npm run dev

# Zbuduj produkcję
npm run build
```

## Wskazówki:

- Używaj `as const` dla stałych tablic/obiektów
- Używaj `readonly` dla tablic które nie powinny być modyfikowane
- Dodawaj `| null` lub `| undefined` gdzie wartość może być pusta
- Używaj `?` dla opcjonalnych pól w interfejsach
