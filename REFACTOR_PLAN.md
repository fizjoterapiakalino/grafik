# Analiza i Plan Optymalizacji Kodu

## 📊 Podsumowanie stanu projektu

| Metryka | Wartość |
|---------|---------|
| Pliki TypeScript | 31 |
| Łączny rozmiar kodu | ~310 KB |
| Największe pliki | schedule-events.ts (35KB), leaves.ts (35KB), options.ts (22KB) |

---

## 🔴 Krytyczne problemy do naprawienia

### 1. **Duplikacje typów `CellState`** (WYSOKI PRIORYTET)
Interfejs `CellState` jest zdefiniowany **6 razy** w różnych plikach:
- `utils.ts` (linia 17) - **EKSPORTOWANA**
- `schedule.ts` (linia 26)
- `schedule-modals.ts` (linia 17)
- `schedule-helpers.ts` (linia 13)
- `schedule-events.ts` (linia 9)
- `schedule-data.ts` (linia 21)

**Rozwiązanie**: Usunąć lokalne definicje i zaimportować z `utils.ts` lub przenieść do `types/index.ts`.

### 2. **Brakujące czyszczenie event listenerów** (ŚREDNI PRIORYTET)
Moduły z **niekompletnymi `destroy()`**:
- `calendar-modal.ts` - brak funkcji `destroy()` do usuwania listenerów
- `changes.ts` - niektóre listenery na komórkach nie są usuwane przy destroy

### 3. **Console.log w kodzie produkcyjnym** (NISKI PRIORYTET)
Znaleziono **24 wystąpień** `console.log` w plikach produkcyjnych.
Powinny być zamienione na:
- Usunięte lub
- Kondycyjne (np. `if (AppConfig.debug) console.log(...)`)

---

## 🟡 Problemy średniego priorytetu

### 4. **Duże pliki wymagające podziału**
| Plik | Rozmiar | Zalecany podział |
|------|---------|------------------|
| `schedule-events.ts` | 35 KB | Wydzielić obsługę drag & drop |
| `leaves.ts` | 35 KB | Wydzielić generowanie tabeli do `leaves-table.ts` |
| `options.ts` | 22 KB | Wydzielić modal potwierdzenia do wspólnego modułu |

### 5. **Brak centralizacji typów**
- `types/index.ts` istnieje, ale nie jest w pełni wykorzystywany
- Interfejsy dla `TreatmentData`, `HistoryEntry` powtarzają się

### 6. **Wzorce backward compatibility**
Każdy moduł ma:
```typescript
declare global { interface Window { ... } }
window.ModuleName = ModuleName;
```
To tworzy globalne zależności. Rozważyć usunięcie po pełnej migracji na moduły ES.

---

## 🟢 Pozytywne aspekty

✅ Dobre czyszczenie listenerów w większości modułów (`destroy()`)
✅ Konsekwentny wzorzec modułów IIFE z publicznym API
✅ Typy Firebase wydzielone do `types/firebase.ts`
✅ Konfiguracja scentralizowana w `common.ts` (`AppConfig`)
✅ UndoManager poprawnie zarządza stanem

---

## 📋 Plan Refaktoryzacji

### Faza 1: Konsolidacja typów ✅ (UKOŃCZONA)
1. ~~Przenieść `CellState`, `TreatmentData`, `HistoryEntry` do `types/index.ts`~~
2. ~~Usunąć lokalne definicje w 6 plikach~~
3. ~~Zaktualizować importy~~
4. ~~Przetestować kompilację~~

**Wynik**: Zredukowano duplikacje z 6 plików do 1 centralnego modułu typów.

### Faza 2: Porządkowanie modułów ✅ (UKOŃCZONA)
1. ~~Dodać `destroy()` do `calendar-modal.ts`~~ ✅
2. ~~Wydzielić wspólne funkcje dat do `utils.ts`~~ ✅ (dodano `toUTCDate`, `toDateString`, `formatDatePL`, `isWorkday`)
3. Wydzielić modal potwierdzenia do `shared/confirmation-modal.ts` *(opcjonalne - wymaga zmian HTML)*

**Wynik**: Dodano `destroy()` do `CalendarModal`. Scentralizowano funkcje dat w `utils.ts`.

### Faza 3: Optymalizacja wydajności ✅ (UKOŃCZONA)
1. ~~Usunąć/warunkować `console.log`~~ - Zamieniono 24 wystąpienia na `debugLog`
2. ~~Dodać debouncing do wyszukiwania~~ ✅ - Dodano funkcję `debounce` z opóźnieniem 250ms
3. Memorizować obliczenia w `leaves-summary.ts` *(opcjonalnie, do przemyślenia)*

**Wynik**: Dodano `debugLog`, `debounce` i flagę `AppConfig.debug`. Zoptymalizowano wyszukiwanie.

### Faza 4: Refaktoryzacja dużych plików ✅ (UKOŃCZONA)
1. ~~`schedule-events.ts` → wydzielić drag-and-drop~~ ✅
   - Utworzono `schedule-drag-drop.ts` (219 linii)
   - Zredukowano `schedule-events.ts` z 794 do 584 linii (-26%)
2. ~~`leaves.ts` → wydzielić PDF export~~ ✅
   - Utworzono `leaves-pdf.ts` (146 linii)
   - Zredukowano `leaves.ts` z 779 do 670 linii (-14%)

**Wynik**: Logika Drag & Drop i eksport PDF są teraz w osobnych, dobrze udokumentowanych modułach.

---

## 🚀 Rekomendowane pierwsze kroki

1. **Konsolidacja `CellState`** - największy zysk, najmniejsze ryzyko
2. **Usunięcie `console.log`** - szybkie, poprawia profesjonalizm
3. **Dodanie `destroy()` do `calendar-modal.ts`** - zapobiega wyciekom pamięci

---

Czy chcesz, żebym rozpoczął refaktoryzację od konkretnej fazy?
