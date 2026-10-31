# Zgłaszanie Nieobecności Pacjenta w Grafiku - Plan Implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodanie przycisku „Zgłoś nieobecność” w górnym navbarze aktywnego po zaznaczeniu pacjenta, kompaktowego kalendarza wielokrotnego wyboru dni nieobecności oraz wyświetlania żółtego trójkąta ostrzegawczego (⚠️) przy nazwisku w dniu nieobecności bez modyfikowania statystyk obciążenia ani daty końca turnusu.

**Architecture:** 
1. Przycisk `#btnReportAbsence` w `#scheduleActionButtons` (zarządzany w `setActiveCell` w `scripts/schedule-events.ts` identycznie jak `#btnPatientInfo`).
2. Nowy modal z mini-kalendarzem (`#patientAbsenceModal` w `scripts/schedule-modals.ts`) umożliwiający wielokrotny wybór dni nieobecności (`absenceDates: string[]`) z podświetleniem zakresu turnusu (`treatmentStartDate` do `treatmentEndDate`).
3. Dedykowana flaga i klasa `.patient-absence-marker` w `scripts/schedule-logic.ts` i `styles/schedule.css` renderująca żółty trójkąt (`::before` z FontAwesome `\f071` w lewym górnym rogu komórki/części split), która nie zanieczyszcza tekstu komórki ani `ScheduleUI.getElementText()`.
4. Zachowanie i sanityzacja `absenceDates` w `scripts/schedule-data.ts`, `scripts/schedule-helpers.ts` i `scripts/schedule-drag-drop.ts` (przenoszenie komórek, split/merge, czyszczenie).

**Tech Stack:** TypeScript, Vanilla JS/DOM, FontAwesome 5 Free, Jest (JSDOM), CSS3 Flexbox/Grid, Firebase Firestore.

**Spec:** Ustalenia z użytkownikiem z dnia 30–31.10.2026:
- Generator danych deweloperskich (`TestDataGenerator`) pozostaje niewidoczny na produkcji (`isLocal()` przepuszcza tylko localhost/127.0.0.1/'').
- Przycisk w navbarze staje się aktywny tylko po zaznaczeniu komórki z pacjentem (w tym dowolnej połowy komórki podzielonej, wyłączony dla pustych komórek, przerw i hydroterapii).
- Zgłoszone nieobecności pacjenta są **wyłącznie wizualnym znacznikiem w grafiku (żółty trójkąt w dniu nieobecności)** — nie pomniejszają statystyk obciążenia w `statsDaily` i nie przesuwają automatycznie daty zakończenia turnusu.
- Trójkąt ostrzegawczy nie może zanieczyszczać tekstu nazwiska pacjenta w `contenteditable`, wyszukiwaniu duplikatów ani w `ScheduleUI.getElementText()`.

## Global Constraints

- Język interfejsu i komunikatów toast: wyłącznie język polski.
- Bezpieczeństwo i czystość tekstu: żaden element ikony/emotikony nie może trafić do `cell.content` ani `ScheduleUI.getElementText()`.
- Obsługa komórek zwykłych oraz podzielonych (`isSplit: true` - połówki `treatmentData1.absenceDates` i `treatmentData2.absenceDates`).
- Brak wpływu na statystyki obciążenia: `statsDaily` oraz `createDailyWorkloadSnapshot` w `scripts/statistics-helpers.ts` pozostają nienaruszone.
- Standardy jakości: `npm run type-check`, `npm run lint` i `npm test` muszą przejść w 100% bez błędów.

## Review Focus

1. **Izolacja tekstu pacjenta**: `ScheduleUI.getElementText()` i edycja inline nie mogą pobierać ikony/symbolu trójkąta ostrzegawczego.
2. **Prawidłowe pozycjonowanie znaczników**: Żółty trójkąt (`.patient-absence-marker::before` w lewym górnym rogu) nie może kolidować z dzwoneczkiem końca turnusu (`.treatment-end-marker::after` w prawym górnym rogu).
3. **Niezależność połówek w komórce podzielonej**: Zgłoszenie nieobecności dla pacjenta w części 1 (górnej) nie może oznaczać nieobecności dla pacjenta w części 2 (dolnej).
4. **Przenoszenie i czyszczenie**: Przeciąganie/przenoszenie pacjenta (drag & drop lub duplicate modal) musi przenosić jego `absenceDates`; wyczyszczenie komórki musi usuwać nieobecności.
5. **Obsługa stref czasowych i formatu**: Wszystkie daty w `absenceDates` są znormalizowanymi stringami ISO `YYYY-MM-DD` wg czasu lokalnego (`formatLocalIsoDate()`), posortowanymi chronologicznie.

---

### Task 1: Model Danych, Sanityzacja i Operacje Pomocnicze (absenceDates)

**Files:**
- Modify: `scripts/types/index.ts`
- Modify: `scripts/utils.ts`
- Modify: `scripts/schedule-data.ts`
- Modify: `scripts/schedule-helpers.ts`
- Modify: `scripts/schedule-drag-drop.ts`
- Modify: `scripts/schedule.ts`
- Test: `tests/schedule-data.test.js`
- Test: `tests/schedule-helpers.test.js`

- [ ] Krok 1.1: Rozszerzenie typów `TreatmentData` i `CellState` o `absenceDates?: string[] | null`, `absenceDates1?: string[] | null`, `absenceDates2?: string[] | null` w `scripts/types/index.ts`.
- [ ] Krok 1.2: Dodanie `'absenceDates'`, `'absenceDates1'`, `'absenceDates2'` do `CELL_CONTENT_KEYS` i aktualizacja `copyTreatmentData` w `scripts/utils.ts`.
- [ ] Krok 1.3: Aktualizacja `ALLOWED_CELL_KEYS`, `ALLOWED_TREATMENT_KEYS`, `sanitizeTreatmentData` i `sanitizeCellState` w `scripts/schedule-data.ts` (walidacja tablicy stringów `YYYY-MM-DD`).
- [ ] Krok 1.4: Aktualizacja funkcji pomocniczych w `scripts/schedule-helpers.ts`: `getTreatmentData`, `copyTreatmentToTarget`, `copyFullCellState`, `createSourceClearFn`, `clearSplitFields`, `updateSplitCellPart`, `updateNormalCell`.
- [ ] Krok 1.5: Aktualizacja `scripts/schedule-drag-drop.ts` (`extractDataToMove`, `applyTargetAutoSplit`, `applyTargetPartUpdate`, `CONTENT_KEYS`) oraz `scripts/schedule.ts` (`mergeSplitCell`, `clearCell`).
- [ ] Krok 1.6: Dodanie testów jednostkowych w `tests/schedule-data.test.js` oraz `tests/schedule-helpers.test.js` weryfikujących zapis, sanityzację, kopiowanie i czyszczenie `absenceDates`.
- [ ] Krok 1.7: Uruchomienie testów i lintera (`npm test tests/schedule-data.test.js tests/schedule-helpers.test.js`, `npm run type-check`).

---

### Task 2: Logika Wyświetlania i Żółty Trójkąt Ostrzegawczy (Desktop & Mobile)

**Files:**
- Modify: `scripts/schedule-logic.ts`
- Modify: `styles/schedule.css`
- Modify: `scripts/schedule-ui.ts`
- Test: `tests/schedule-logic.test.js`

- [x] Krok 2.1: Rozszerzenie `CellData`, `PartData` i `CellDisplayData` w `scripts/schedule-logic.ts` o pola `absenceDates` oraz flagę `isAbsentToday?: boolean`.
- [x] Krok 2.2: W `ScheduleLogic.getCellDisplayData()`: porównanie dzisiejszej daty (`todayStr` = `YYYY-MM-DD`) z `absenceDates` komórki oraz połówek `treatmentData1.absenceDates` / `treatmentData2.absenceDates`. Jeśli pacjent ma dzisiaj nieobecność, dodanie klasy `patient-absence-marker` i ustawienie `isAbsentToday = true`.
- [x] Krok 2.3: Dodanie stylów CSS w `styles/schedule.css` dla `.patient-absence-marker` z pseudo-elementem `::before` (żółty/bursztynowy trójkąt FontAwesome `\f071` w lewym górnym rogu `top: -2px; left: -2px`, z-index 4, okrągłe tło, bez kolizji z dzwonkiem w prawym górnym rogu).
- [x] Krok 2.4: W `scripts/schedule-ui.ts` w `applyCellDataToDom` oraz w widoku mobilnym (`createMobileSlotPart`): dodanie tooltipa `⚠️ Zgłoszona nieobecność pacjenta w dniu dzisiejszym` oraz taga `.mobile-schedule-tag.absence` w widoku mobilnym (wewnątrz `.cell-icon`, by nie trafiał do tekstu).
- [x] Krok 2.5: Dodanie testów w `tests/schedule-logic.test.js` weryfikujących, że komórka z nieobecnością w dniu dzisiejszym otrzymuje klasę `patient-absence-marker`, a komórka z nieobecnością w innym dniu jej nie otrzymuje.
- [x] Krok 2.6: Weryfikacja, że `ScheduleUI.getElementText()` całkowicie ignoruje znaczniki nieobecności i zwraca czysty tekst pacjenta.

---

### Task 3: Przycisk w Navbarze i Interaktywny Mini-Kalendarz Nieobecności

**Files:**
- Modify: `scripts/ui-shell.ts`
- Modify: `pages/schedule.html`
- Modify: `styles/schedule.css`
- Modify: `styles/components.css`
- Modify: `scripts/schedule-modals.ts`
- Modify: `scripts/schedule-events.ts`
- Modify: `scripts/schedule.ts`
- Test: Utworzenie `tests/schedule-absence-modal.test.js`

- [ ] Krok 3.1: Dodanie przycisku `#btnReportAbsence` do `#scheduleActionButtons` w `scripts/ui-shell.ts` z ikoną `fas fa-calendar-times`, etykietą i tooltipem „Zgłoś nieobecność pacjenta”.
- [ ] Krok 3.2: Dodanie struktury HTML modala `#patientAbsenceModal` w `pages/schedule.html` (pasek nawigacji miesiąca `<` / `>`, siatka kalendarza Pn-Nd, legenda, licznik zaznaczonych dni, przyciski „Wyczyść wszystkie”, „Zapisz”, „Anuluj”) oraz opcji w menu kontekstowym `#contextReportAbsence`.
- [ ] Krok 3.3: Dodanie stylizacji CSS w `styles/schedule.css` i `styles/components.css` dla kalendarza nieobecności (zwarty układ, podświetlenie dni w turnusie, podświetlenie zaznaczonych nieobecności na żółto z trójkątem ⚠️, dni dzisiejszego i innych miesięcy).
- [ ] Krok 3.4: Implementacja `openPatientAbsenceModal` w `scripts/schedule-modals.ts`:
  - Obsługa komórki zwykłej oraz zaznaczonej połówki komórki podzielonej.
  - Wyświetlanie nazwiska pacjenta oraz zakresu turnusu.
  - Nawigacja pomiędzy miesiącami (poprzedni/następny miesiąc).
  - Przełączanie (toggle) dat w lokalnym `Set<string>`.
  - Wizualne oznaczenie dni w turnusie (`treatmentStartDate` do `treatmentEndDate`).
  - Przycisk „Wyczyść wszystkie” czyszczący zaznaczenia.
  - Zapisanie tablicy posortowanych dat `YYYY-MM-DD` do stanu komórki przez przekazany callback i toast z potwierdzeniem.
  - Obsługa klawiszy (Esc = zamknij bez zapisu, Enter = zapisz).
- [ ] Krok 3.5: Podpięcie stanu aktywności `#btnReportAbsence` w `setActiveCell` w `scripts/schedule-events.ts` (aktywny tylko dla komórek z pacjentem, zablokowany dla przerw/hydro/pustych) oraz zdarzeń click na `#btnReportAbsence` i `#contextReportAbsence`.
- [ ] Krok 3.6: Połączenie metody w `Schedule` w `scripts/schedule.ts` i przekazanie zależności do `ScheduleEvents`.
- [ ] Krok 3.7: Napisanie testów JSDOM w `tests/schedule-absence-modal.test.js` testujących aktywację przycisku, otwarcie modala, przełączanie dat, zapis do Firestore oraz wyczyszczenie nieobecności.

---

### Task 4: Kompleksowa Weryfikacja, Przegląd Kodu (Flash Reviewer) i Końcowy Szlif

**Files:**
- Wszystkie zmodyfikowane i utworzone pliki.

- [ ] Krok 4.1: Uruchomienie pełnego zestawu testów i kontrolerów jakości:
  - `npm run type-check`
  - `npm run lint`
  - `npm test`
- [ ] Krok 4.2: Uruchomienie subagenta recenzenta `research` (`Model: "flash"`) do niezależnego audytu kodu pod kątem:
  - Odporności na błędy,
  - Braku regresji w innych funkcjach grafiku i statystyk,
  - Zgodności z wymaganiami użytkownika (tylko żółty trójkąt w grafiku, bez wpływu na statystyki).
- [ ] Krok 4.3: Ewentualne poprawki zgłoszone przez recenzenta i ponowna weryfikacja.
- [ ] Krok 4.4: Zbudowanie produkcyjne (`npm run build`) i weryfikacja w przeglądarce / curl.
