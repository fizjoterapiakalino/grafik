# Mobile Schedule Redesign - dokument do testów

## Cel

Przebudować mobilny widok strony `schedule` tak, aby na telefonie był szybki do odczytu, nie wychodził poza szerokość ekranu i pozwalał łatwo obsłużyć bieżący harmonogram bez przewijania ciężkich kart-akordeonów.

## Problem w obecnym widoku

Obecny widok mobilny ukrywa tabelę i renderuje sloty jako karty. To działa technicznie, ale:

- zajmuje dużo pionowego miejsca,
- automatycznie rozwijane karty od aktualnej godziny robią długi widok,
- stopka z legendą i paskiem postępu konkuruje o miejsce z harmonogramem,
- edycja i akcje nie są zoptymalizowane pod ekran dotykowy,
- użytkownik nie widzi wystarczająco szybko: co jest teraz, co jest następne, gdzie są wolne terminy.

## Proponowany kierunek

Zastąpić obecny mobilny akordeon widokiem timeline.

Na mobile harmonogram powinien wyglądać jak dzienna lista pracy:

```text
[ 12:30 ] [ Terapie: 18 ] [ Zapisano ]

[ Anna ▼ ]

[ Teraz ] [ Zajęte ] [ Wolne ]

12:00  Jan Kowalski
      Masaż · koniec 24.06

12:30  TERAZ
      Wolny termin

13:00  Maria Nowak
      PNF · Co 2 dni

[ Legenda ]
```

## Układ Mobilny

### 1. Pasek statusu

Na górze mobilnego widoku:

- aktualna godzina,
- liczba terapii,
- status zapisu,
- opcjonalnie cienki pasek postępu dnia.

Przykład:

```text
12:30 · Terapie: 18 · Zapisano
```

Pełny progress bar nie powinien wypychać layoutu. Na małych ekranach wystarczy tekst albo cienka linia pod paskiem.

### 2. Wybór pracownika

Dla administratora:

- selektor pracownika jako kompaktowy dropdown,
- alternatywnie poziome chipy tylko wtedy, gdy lista jest krótka.

Dla zwykłego pracownika:

- bez selektora,
- widok od razu pokazuje jego harmonogram.

### 3. Filtry

Pod selektorem:

- `Teraz`,
- `Zajęte`,
- `Wolne`,
- opcjonalnie `Zakończone`.

Filtry powinny działać lokalnie na aktualnie wybranym pracowniku.

### 4. Timeline slotów

Każdy slot powinien mieć stabilny, kompaktowy wygląd:

- godzina po lewej,
- treść pacjenta lub `Wolny termin`,
- krótkie znaczniki zabiegów,
- data końca leczenia, jeśli istnieje,
- stan przeszły przygaszony,
- aktualny slot zawsze wyraźnie podświetlony.

Wpisy puste powinny być niższe niż wpisy zajęte, aby lista była szybka do skanowania.

### 5. Akcje slotu

Pierwszy etap może zachować obecną logikę edycji po kliknięciu.

Docelowo lepszy będzie dolny panel akcji po kliknięciu slotu:

- Edytuj pacjenta,
- Informacje,
- Masaż,
- PNF,
- Co 2 dni,
- Hydroterapia,
- Podziel / Scal,
- Wyczyść.

Panel powinien być duży dotykowo i nie wymagać menu kontekstowego.

### 6. Kompaktowy footer

Na mobile footer powinien być minimalny:

```text
[ Legenda ▼ ]
```

Po rozwinięciu:

```text
Masaż   PNF
Co 2 dni   Hydroterapia
Przerwa
```

Legenda nie powinna być stale widoczna, bo zabiera miejsce harmonogramowi.

## Etapy Wdrożenia Do Testów

### Etap 1 - Timeline bez zmiany logiki edycji

Zakres:

- przebudować `renderMobileView()` w `scripts/schedule-ui.ts`,
- dodać klasy CSS dla timeline w `styles/schedule.css`,
- zostawić obecną obsługę edycji i zapisu,
- dodać kompaktowy mobile footer z rozwijaną legendą.

Cel testu:

- sprawdzić, czy nowy układ jest czytelniejszy,
- potwierdzić, że nie psuje obecnych danych i zapisu.

### Etap 2 - Filtry i szybki skok do teraz

Zakres:

- dodać filtry `Teraz`, `Zajęte`, `Wolne`,
- dodać przycisk lub chip powrotu do aktualnej godziny,
- pamiętać ostatnio wybranego pracownika w `localStorage`.

Cel testu:

- skrócić czas dojścia do potrzebnego slotu.

### Etap 3 - Dolny panel akcji

Zakres:

- po tapnięciu slotu otwierać bottom sheet,
- przenieść najważniejsze akcje z kontekstu do dużych przycisków,
- zachować istniejące funkcje zapisu i walidacji.

Cel testu:

- poprawić obsługę dotykową,
- ograniczyć przypadkowe edycje.

## Kryteria Akceptacji

- Widok mobilny nie wychodzi poza szerokość ekranu przy 320 px, 360 px, 390 px i 430 px.
- Aktualny slot jest widoczny i wyróżniony.
- Puste sloty są łatwe do odróżnienia od zajętych.
- Zmiana pracownika nie resetuje całej strony.
- Edycja pacjenta zapisuje dane tak jak w obecnym widoku.
- Status zapisu jest widoczny albo dostępny w kompaktowym pasku.
- Legenda nie zajmuje stałego miejsca w głównym widoku.
- Widok desktopowy pozostaje bez zmian.

## Ryzyka

- Obecne eventy mogą być mocno powiązane z klasami `editable-cell`, `data-time` i `data-employee-index`.
- Zbyt duża zmiana w jednym kroku może utrudnić diagnozę problemów z zapisem.
- Dolny panel akcji powinien być wdrażany dopiero po sprawdzeniu timeline, żeby nie mieszać testu UX z przebudową interakcji.

## Rekomendacja

Najpierw wdrożyć Etap 1 jako testowy mobilny timeline. To powinno dać największą poprawę czytelności przy najmniejszym ryzyku, bo logika danych i zapisu zostaje po staremu.

