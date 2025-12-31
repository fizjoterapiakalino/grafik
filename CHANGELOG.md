# Changelog

Wszystkie istotne zmiany w projekcie będą dokumentowane w tym pliku.

## [2.1.0] - 2025-12-31

### Dodano (Added)
- **Automatyzacja wdrożeń**: Dodano workflow GitHub Actions do automatycznej publikacji aplikacji na GitHub Pages.
- **Dynamiczna konfiguracja Firebase**: System automatycznie przełącza się między bazą testową a produkcyjną w zależności od środowiska.

### Zmieniono (Changed)
- **Logika wyświetlania urlopów**: Poprawiono system nakładek (overlay) dla urlopów trwających na przełomie miesięcy, unikając nakładania się elementów.

### Refaktoryzacja
- **Konsolidacja typów**: Przeniesiono zduplikowane interfejsy `CellState`, `TreatmentData` i `ScheduleHistoryEntry` z 6 plików do scentralizowanego modułu `types/index.ts`. Eliminuje to niespójności i ułatwia konserwację kodu.
- **Centralizacja logowania**: Zamieniono 24 wystąpienia `console.log` na warunkową funkcję `debugLog`. Logi są teraz wyświetlane tylko gdy `AppConfig.debug = true`, co eliminuje niepotrzebne komunikaty w środowisku produkcyjnym.
- **CalendarModal.destroy()**: Dodano metodę `destroy()` do `CalendarModal` która poprawnie usuwa wszystkie event listenery. Zapobiega to wyciekom pamięci przy przełączaniu stron.
- **Debounce dla wyszukiwania**: Dodano funkcję `debounce` do `common.ts` i zastosowano ją w wyszukiwarce. Redukuje to liczbę wywołań filtrowania podczas szybkiego wpisywania tekstu.
- **Wspólne funkcje dat**: Dodano `toUTCDate`, `toDateString`, `formatDatePL`, `isWorkday` do `utils.ts`. Eliminuje to duplikacje w `leaves.ts` i `calendar-modal.ts`.

## [2.0.0] - 2025-12-30

### Dodano (Added)
- **Migracja na TypeScript**: Przepisanie całego projektu na TypeScript w celu zapewnienia większego bezpieczeństwa typów i łatwiejszej konserwacji.
- **Narzędzie budowania Vite**: Przejście na Vite, co znacząco skróciło czas ładowania w trybie deweloperskim i poprawiło optymalizację wersji produkcyjnej.
- **Modularna Architektura**: Rozbicie głównych skryptów na mniejsze komponenty (np. `schedule-data.ts`, `schedule-ui.ts`, `schedule-events.ts`).
- **Usprawnienia Backend**: Wprowadzenie automatycznych backupów i rozbudowanego zarządzania pracownikami.


## [1.1.0] - 2025-12-20

### Dodano (Added)
- **System Undo/Redo**: Możliwość cofania i ponawiania zmian w sekcji urlopów (do 20 kroków wstecz).
- **Eksport do PDF**: Przycisk w nawigacji umożliwiający pobranie aktualnego widoku urlopów w formacie PDF (A3 landscape).
- **Responsive Card View (RWD)**: Nowy, natywny widok tabletu i telefonu dla tabeli urlopów. Zamiast szerokiej tabeli, pracownicy są wyświetlani jako interaktywne karty.
- **Inteligentne ukrywanie miesięcy**: W widoku mobilnym miesiące bez zaplanowanych urlopów są automatycznie ukrywane, aby zaoszczędzić miejsce.
- **Filtrowanie typów urlopów**: Legenda z opcją checkboxów pozwala dynamicznie filtrować widoczność różnych rodzajów nieobecności na wykresie.
- **System projektowy (UI/UX)**: Wprowadzono zmienne CSS (CSS Variables) dla kolorów, odstępów i cieni, co ułatwia przyszłe modyfikacje wyglądu.

### Zmieniono (Changed)
- **Visual Overhaul (Glassmorphism)**: Nowoczesny design oparty na szklanych panelach (`backdrop-filter: blur`), półprzezroczystości i miękkich cieniach.
- **Personalizacja**: Zmieniono sposób wyświetlania pracowników na listach i w tabelach na format "Imię Nazwisko" (jeśli dane są dostępne).
- **Sortowanie**: Ujednolicono sortowanie pracowników we wszystkich modułach (Grafik, Podsumowanie, Opieka) - teraz wszędzie kolejność jest identyczna i oparta na Imieniu i Nazwisku.
- **Optymalizacja Header**: Poprawiono układ nagłówka dla urządzeń mobilnych - selektor roku i przełączniki widoków układają się pionowo.
- **Input Styling**: Globalnie odświeżono wygląd pól tekstowych, list wyborów i przycisków.

### Naprawiono (Fixed)
- Poprawiono logikę zamykania kalendarza (Esc i kliknięcie poza obszar modalny).
- Usunięto błąd nakładania się nakładek ładowania (loading overlay).
- Naprawiono problem z niedziałającym przyciskiem "Wyczyść wyszukiwanie" na niektórych podstronach.

---

## [1.0.0] - 2025-12-01
- Pierwsza stabilna wersja produkcyjna.
- Podstawowy moduł grafiku i zarządzania pracownikami.
- Integracja z Firebase (Firestore/Auth).
