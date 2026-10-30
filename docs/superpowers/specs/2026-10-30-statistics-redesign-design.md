# Przeprojektowanie modułu Statystyki — „Obciążenie i Sumienność” (Wariant A)

**Data:** 2026-10-30
**Status:** Gotowy do akceptacji użytkownika (po przeglądzie technicznym Builder Check)
**Zakres:** `pages/statistics.html`, `styles/statistics.css`, `scripts/statistics.ts`, `scripts/statistics-helpers.ts`, `scripts/workload-snapshot.ts`, `scripts/changes-rotation.ts` (współdzielenie generatora okresów 2-tygodniowych), `scripts/schedule-helpers.ts`, `scripts/schedule-events.ts`, `scripts/schedule-modals.ts`, testy jednostkowe `tests/`

---

## 1. Cel i kontekst („Intent & Why”)

Aplikacja **GrafikKalinowa** obsługuje bieżący grafik pracy przychodni fizjoterapii. Specyfika pracy przychodni narzuca twarde uwarunkowania prawne i organizacyjne:

1. **Brak ewidencji pacjentów (RODO / ograniczenie prawne):** aplikacja nie przechowuje kartoteki pacjentów. Każdy wpis tekstowy w komórce harmonogramu stanowi autonomiczną jednostkę pracy w danym slocie czasowym — nie wolno budować rejestru pacjentów ani deduplikować wpisów po nazwisku czy identyfikatorze między dniami i pracownikami.
2. **Brak stałych stanowisk i sztywnych zmian w analizie pracy:** wszyscy fizjoterapeuci wykonują pełen przekrój zabiegów (strona *Stanowiska* ma charakter formalno-organizacyjny), a godziny pracy i obecność na zmianie rannej/popołudniowej bywają elastycznie wymieniane między pracownikami ze względów osobistych lub potrzeb zespołu.
3. **Czynnik ludzki przy wprowadzaniu danych:**
   - Turnusy zabiegowe zaczynają się w różne dni tygodnia (np. wtorek, czwartek, z przesunięciami świątecznymi). Gdy z powodu zamieszania na starcie turnusu wpis zostanie dodany następnego dnia, pracownicy w praktyce nie cofają ręcznie daty rozpoczęcia — pojedyncze 1-dniowe przesunięcie 15-dniowego turnusu traktujemy świadomie jako pomijalny błąd statystyczny (w skali zmiany, miesiąca i roku turnus nadal obejmuje 15 dni roboczych).
   - Wpisy pacjentów bywają niekonsekwentnie przenoszone między kolumnami pracowników w trakcie turnusu.
   - Zakończone turnusy (oznaczone czerwonym dzwoneczkiem 🔔) bywają przetrzymywane w kolumnie bez wyczyszczenia.

**Cel projektu:** Zastąpić przeładowaną, 5-zakładkową stronę Statystyk **jednym spójnym ekranem bez zakładek (Wariant A — „Obciążenie i Sumienność”)**, który:
- rzetelnie mierzy obciążenie pracownika w skali **1 tygodnia, 2 tygodni (1 zmiany rotacyjnej), miesiąca i roku**,
- dostarcza pomocniczych sygnałów o zaangażowaniu i sumienności prowadzenia własnej kolumny grafiku,
- uodparnia statystyki na przypadkowe zniekształcenia i sztuczne zawyżanie wyników.

---

## 2. Cele, Poza zakresem i Anty-cele

### Cele (Goals)
- **Jeden ekran główny bez zakładek** w `pages/statistics.html` zawierający: pasek wyboru okresu, 4 kafelki KPI, wykres porównawczy *Śr. aktywnych slotów / dzień vs. zaległe dzwoneczki 🔔* oraz jedną tabelę łączącą obciążenie i higienę prowadzenia grafiku.
- **4 horyzonty czasowe:** `1 Tydzień` (tydzień ISO), `2 Tygodnie (Zmiana)` (**widok domyślny**, oparty o ten sam 14-dniowy cykl rotacji co moduł *Zmiany*), `Miesiąc`, `Rok`.
- **Automatyczne i kompletne daty turnusu:** każdy wpis zabiegowy ma gwarantowaną datę rozpoczęcia `startDate` i wyliczoną datę końca `endDate` (15 dni roboczych z pominięciem weekendów i polskich świąt) — również przy wklejaniu (`Ctrl+V`), przenoszeniu i edycji komórek dzielonych (`A / B`).
- **Odcięcie zakończonych turnusów:** w 15. (ostatnim) dniu roboczym turnusu (`data === endDate`) pacjent odbywa ostatni zabieg i komórka jeszcze wlicza się do obciążenia; od kolejnego dnia (`data > endDate`) komórka **nie wlicza się** do aktywnego obciążenia i staje się widoczna wyłącznie jako nieposprzątany „zaległy dzwoneczek 🔔”.
- **Odporność na sztuczne mnożenie wpisów:** jednostką obciążenia jest **aktywny 30-minutowy slot zabiegowy** (maksymalnie `1` na komórkę w danym dniu, niezależnie od podziału `A / B`).

### Poza zakresem — elementy usuwane (Non-Goals)
Z modułu Statystyki (`pages/statistics.html`, `scripts/statistics.ts`, `scripts/statistics-helpers.ts`, `styles/statistics.css`) definitywnie usuwamy:
1. Zakładkę **Statystyki Urlopów** (`#leavesStatsView`) oraz wszystkie karty i wykresy urlopowe z dawnego *Przeglądu* (`#leaveTypesChart`, `#monthlyLeavesChart`, karty *Na urlopie dziś* i *Dni urlopów*). Dane urlopowe z kolekcji `leaves/mainLeaves` są używane wyłącznie w tle do wyznaczenia dni nieobecności pracownika, aby urlop nie zaniżał jego średniej dziennej.
2. Zakładkę **Pracownicy** (`#employeeStatsView` — lista kadrowa i bilans urlopów).
3. Wszystkie metryki **I Zmiana / II Zmiana** oraz **Poranne / Popołudniowe do przekazania**.
4. Metryki **Unikalnych nazw pacjentów**, **Duplikatów wpisów**, **Pacjentów wg godziny**, dawną tabelę alertów duplikatów oraz odczyt/zapis kolekcji `statsWeekly` (cała analityka okresowa opiera się na dziennych snapshotach `statsDaily`).
5. Wsteczne przepisywanie wczorajszych snapshotów (`D+1` backfill) — pominięte celowo decyzją użytkownika jako niepotrzebna złożoność przy zmiennych dniach startu turnusów i braku zwyczaju ręcznego cofania `startDate`.

### Anty-cele (Anti-Goals)
- **Zakaz ukrytej ewidencji pacjentów:** żadna metryka nie agreguje ani nie śledzi tożsamości pacjenta między komórkami lub dniami.
- **Zakaz przepisywania zamkniętej historii:** przeniesienie pacjenta w środku turnusu do innego terapeuty lub ręczna edycja dat nie modyfikuje snapshotów z minionych dni (`statsDaily/{data < dzisiaj}`).
- **Zakaz „nieśmiertelnych” komórek bez dat:** brak dat leczenia nie może powodować bezterminowego wliczania komórki do obciążenia.

---

## 3. Ograniczenia techniczne i domenowe

- **Kompatybilność z upstream CI/CD i Firestore:** zachowujemy istniejącą kolekcję `statsDaily/{YYYY-MM-DD}` i reguły bezpieczeństwa w `firebase-security-rules.txt` (`allow read, write: if isAuthenticated()`). Dokumenty `DailyWorkloadSnapshot` (`version: 2`) pozostają w pełni kompatybilne z już zapisanymi w bazie snapshotami dziennymi.
- **Wykluczenia z aktywnych pracowników *(decyzja inżynierska)*:** w statystykach uczestniczą wszyscy pracownicy z `EmployeeManager.getAll()`, którzy nie mają flagi `isHidden: true` (spójnie z kolumnami głównego `Grafiku` — pracownicy `isScheduleOnly: true` pracują w tabeli zabiegowej, więc są ujęci w statystykach obciążenia).
- **Strefy czasowe i święta:** wszystkie operacje na datach `YYYY-MM-DD`, numerach tygodni ISO, okresach 14-dniowych i polskich świętach ruchomych/stałych (`isHoliday`, `isClinicalWorkday`) operują deterministycznie bez dryfu strefowego/DST.

---

## 4. Szczegółowe reguły danych i odporności na zafałszowanie

### 4.1. Gwarancja dat turnusu we wszystkich operacjach Grafiku
1. **Wpisanie nowego tekstu / zmiana pacjenta w komórce (`scripts/schedule-helpers.ts`):**
   - Wpisanie pacjenta w pustą komórkę lub zmiana nazwiska na inne nadaje `startDate = dzisiaj` (`formatLocalIsoDate()`), `extensionDays = 0` oraz `endDate = ScheduleLogic.calculateEndDate(startDate, 0)` (15. dzień roboczy włącznie ze `startDate`).
2. **Wklejanie `Ctrl+V` (`scripts/schedule-events.ts`):**
   - Jeśli wklejana komórka (lub jej połówka `isSplit`) posiada `startDate` i jej wyliczona `endDate >= dzisiaj` (kopiowanie/przenoszenie aktywnego turnusu), zachowuje swoje `startDate`, `extensionDays` i `endDate` (z nowym `patientId`).
   - Jeśli wklejana komórka **nie posiada `startDate`** (stary wpis legacy) LUB jej turnus **już wygasł** (`endDate < dzisiaj`, np. skopiowano starą komórkę z dzwoneczkiem), wklejenie automatycznie inicjalizuje świeży turnus: `startDate = dzisiaj`, `extensionDays = 0`, `endDate = calculateEndDate(dzisiaj, 0)`.
3. **Przenoszenie `Drag & Drop` oraz modal duplikatu „Przenieś” (`scripts/schedule-drag-drop.ts`, `scripts/schedule-helpers.ts`):**
   - Przeniesienie pacjenta do innej godziny lub innego pracownika **zachowuje pierwotne `startDate`, `extensionDays` i `endDate`** (przeniesienie nie resetuje licznika 15 dni).
   - Jeśli przenoszony stary wpis legacy nie miał `startDate`, uzupełniamy `startDate = dzisiaj`, `extensionDays = 0` i `endDate`.
4. **Modal „Informacje o pacjencie” (`scripts/schedule-modals.ts`):**
   - Naprawiamy obsługę komórek dzielonych (`isSplit`): rozpoznajemy klikniętą połówkę (`getTargetPart(element) === 1 | 2`) i odczytujemy/zapisujemy odpowiednio `treatmentData1` lub `treatmentData2` zamiast nadpisywać pola komórki niepodzielonej.
   - Jeśli `startDateInput.value` jest puste przy zapisie, ustawiamy domyślnie `dzisiaj`.

### 4.2. Kiedy komórka liczy się jako aktywny slot obciążenia (Reguła dzwoneczka 🔔 i `A / B`)
Dla badanego dnia roboczego `D` (`YYYY-MM-DD`) i pracownika `E`:
1. Jeśli pracownik `E` ma w dniu `D` aktywny urlop/nieobecność w `leavesData` (`isOnLeave === true`), dzień `D` jest oznaczony jako dzień nieobecności (`patientSlots = 0`, wyłączony z mianownika średniej dziennej).
2. Dla każdego z 22 wierszy godzinowych (`7:00` – `17:30`):
   - Pomijamy komórki puste, przerwy (`isBreak === true`) oraz hydroterapię pełnokomórkową (`isHydrotherapy === true`).
   - Funkcja pomocnicza `isEntryActiveOnDate(content, startDate, extensionDays, rawEndDate, everyOtherDay, isHydroPart, D)`:
     - Zwraca `false`, jeśli `isHydroPart === true` lub `content` po `trim()` jest puste.
     - Zwraca `false`, jeśli brak `startDate` (**usunięcie dotychczasowego `if (!startDate || !endDate) return true` — komórka bez dat nie jest wiecznie aktywna**).
     - Wylicza `effectiveEndDate = rawEndDate?.trim() || ScheduleLogic.calculateEndDate(startDate, extensionDays || 0)`.
     - Zwraca `false`, jeśli `D < startDate` lub **`D > effectiveEndDate`**.
       *(W 15. dniu roboczym `D === effectiveEndDate` pacjent odbywa ostatni zabieg, więc wpis jest jeszcze aktywny; w widoku Grafiku wizualny dzwoneczek `.treatment-end-marker` pozostaje bez zmian przy `endDate <= dziś`, przypominając o końcu turnusu, a odcięcie ze statystyk następuje od `D > effectiveEndDate`).*
     - Jeśli `everyOtherDay === true`, zwraca `isEveryOtherWorkday(startDate, D)`; w przeciwnym razie `true`.
   - **Zasada 1 komórka 30 min = maks. 1 aktywny slot:**
     - Komórka normalna: aktywna, gdy `isEntryActiveOnDate(...) === true` -> `+1` do `patientSlots`.
     - Komórka dzielona (`isSplit === true`): aktywna, gdy `isEntryActiveOnDate(part1) || isEntryActiveOnDate(part2)` -> **`+1`** (nie `+2`) do `patientSlots`.

### 4.3. Dzienne snapshoty `statsDaily`
- Tak jak dotychczas, każdy zapis `Grafiku` w dniu roboczym `T` aktualizuje dokument `statsDaily/{T}` bieżącym stanem aktywnych slotów (`persistTodayWorkloadSnapshot`).
- Dodatkowo *(decyzja inżynierska)* podczas otwarcia `Grafiku` lub `Statystyk` w dniu roboczym `T`, jeśli dokument `statsDaily/{T}` jeszcze dziś nie istnieje (bo np. nikt jeszcze dziś nie edytował tabeli, a trwają aktywne turnusy), snapshot na dzień `T` jest automatycznie zapisywany, aby spokojny dzień bez edycji nie pozostawiał luki w danych.
- Snapshoty z dni przeszłych (`data < dzisiaj`) są niemutowalne.

### 4.4. Metryki higieny i sumienności prowadzenia kolumny (liczone z `mainSchedule`)
W tabeli i wykresie Wariantu A obok obciążenia z wybranego okresu pokazujemy wskaźniki porządku we własnej kolumnie pracownika:
1. **Zaległe dzwoneczki 🔔 (stan na dziś):**
   - Liczba przeterminowanych wpisów w kolumnie pracownika (`effectiveEndDate < dzisiaj`, z pominięciem przerw i hydroterapii). W komórce dzielonej `A / B`, jeśli obie połówki są przeterminowane, liczymy każdą przeterminowaną połówkę i podajemy w podpowiedzi (`title`) godziny wszystkich komórek wymagających posprzątania (np. `Do wyczyszczenia: 08:00, 13:30`).
2. **Ręczne przedłużenia `+dni` (stan na dziś):**
   - Liczba aktualnie aktywnych wpisów w kolumnie pracownika (`effectiveEndDate >= dzisiaj`), w których ustawiono `extensionDays > 0`, oraz suma dopisanych dni (np. `+5 dni (2 wpisy)` lub `0`). Pozwala to wychwycić sztuczne wydłużanie turnusów zamiast czyszczenia zakończonych wpisów.
3. **Ostatnia aktualizacja kolumny *(decyzja inżynierska w miejsce odrzuconego D/D+1)*:**
   - Data ostatniej aktywności edycyjnej w kolumnie pracownika wyznaczona z istniejących pól `mainSchedule`: maksimum z najnowszej `startDate` wpisów w kolumnie oraz najnowszego znacznika czasu `cellState.history[0]?.timestamp` w kolumnie (wyświetlana czytelnie jako `Dziś`, `Wczoraj`, `X dni temu` lub `Brak danych`). Od razu pokazuje, czy pracownik na bieżąco aktualizuje swoją kolumnę, czy nie dotykał jej od długiego czasu.
4. **Bezpiecznik starych komórek bez dat (`undatedCount`):**
   - Jeśli w `mainSchedule` istnieją jeszcze stare nieedytowane komórki sprzed wdrożenia nieposiadające `startDate` (`undatedCount > 0`), nad tabelą pojawia się dyskretny baner informujący o liczbie takich komórek (ze wskazaniem pracownika i godziny) oraz o tym, że do czasu uzupełnienia daty nie są wliczane do aktywnego obciążenia. Przy `undatedCount === 0` baner jest ukryty.

---

## 5. Architektura interfejsu użytkownika (Wariant A)

Cały widok `pages/statistics.html` składa się z jednej strony bez zakładek:

### 5.1. Pasek sterowania (Toolbar)
- **Przełącznik horyzontu (4 przyciski segmentowe):**
  1. `1 Tydzień`
  2. `2 Tygodnie (Zmiana)` *(domyślnie aktywny)*
  3. `Miesiąc`
  4. `Rok`
- **Selektory kontekstowe:**
  - `Rok` (`<select id="statsYearSelect">`) — zawsze widoczny.
  - `Okres` (`<select id="statsPeriodSelect">`):
    - dla `1 Tydzień`: lista tygodni ISO w wybranym roku (np. `Tydzień 44 (26.10 – 30.10)`), domyślnie bieżący tydzień;
    - dla `2 Tygodnie (Zmiana)`: lista 14-dniowych zmian wyliczanych tym samym ciągłym algorytmem `generateTwoWeekPeriods(year)` (`EPOCH_MONDAY = 2024-01-01`) co moduł *Zmiany* (np. `Zmiana: 19.10 – 30.10 (bieżąca)`), domyślnie zmiana obejmująca dzisiejszą datę;
    - dla `Miesiąc`: lista miesięcy `Styczeń..Grudzień`, domyślnie bieżący miesiąc;
    - dla `Rok`: selektor podokresu ukryty.
- **Status snapshotu po prawej stronie paska:**
  - Badge `Snapshot: Dzisiaj` (lub data ostatniego snapshotu) + przycisk ręcznego odświeżenia `Odśwież snapshot`.

### 5.2. Cztery kafelki KPI zespołu
1. **Śr. aktywnych / dzień pracy:** średnia liczba aktywnych 30-min slotów zabiegowych na zapisany dzień obecności pracownika w wybranym okresie + zmiana względem bezpośrednio poprzedzającego okresu tej samej długości (np. `▲ +0.6 vs poprz. zmiana` lub `Brak danych z poprz. okresu`).
2. **Śr. suma w okresie (na pracownika) *(mianownik — decyzja inżynierska)*:** łączna suma aktywnych slotów zespołu podzielona przez liczbę pracowników mających w tym okresie co najmniej 1 dzień obecności (`presentDays > 0`, aby całookresowy urlop lub L4 jednej osoby nie zaniżały sztucznie średniej zespołu) + podtytuł `Łącznie zespół: X slotów • Y obecnych`.
3. **Zaległe dzwoneczki 🔔 (dziś):** łączna liczba przeterminowanych wpisów (`effectiveEndDate < dzisiaj`) wiszących obecnie w `mainSchedule` + podtytuł `Odcięte ze statystyk (nie zawyżają)`.
4. **Pokrycie dni roboczych:** liczba dni roboczych ze snapshotem w wybranym okresie w stosunku do wszystkich dni roboczych przychodni w tym okresie (dla trwającego okresu: liczonych do dzisiaj włącznie), np. `9 / 10 dni roboczych`.

### 5.3. Wykres porównawczy pracowników (Chart.js)
- Poziomy wykres słupkowy (`indexAxis: 'y'`, wspólna skala dzienna slotów *(decyzja inżynierska)*, dzięki której słupki dzwoneczków `0–5` są zawsze czytelne i proporcjonalne zarówno w widoku tygodnia, jak i całego roku, a pojedyncze dni urlopu nie skracają niesprawiedliwie paska pracownika):
  - **Seria 1 („Śr. aktywnych slotów / dzień pracy”):** średnia dzienna aktywnych slotów pracownika w wybranym okresie (z tooltipem pokazującym także łączną sumę slotów w okresie i liczbę dni obecności).
  - **Seria 2 („Zaległe dzwoneczki 🔔 dziś — odcięte”):** liczba nieusuniętych wpisów po turnusie wiszących dziś w kolumnie pracownika (kolor czerwony półprzezroczysty).

### 5.4. Tabela „Obciążenie i Sumienność pracowników”
Kolumny tabeli:
1. **Pracownik** (imię/nazwisko wg `EmployeeManager.getNameById`, kolorowy znacznik pracownika).
2. **Dni pracy** (liczba zapisanych dni obecności w okresie; jeśli pracownik miał dni urlopowe w okresie, krótka informacja np. `9 dni (1d urlop)`).
3. **Śr. aktywnych / dzień** (`totalActiveSlots / presentDays` zaokrąglone do 1 miejsca po przecinku; `—` przy `0` dni).
4. **Suma w okresie** (łączna liczba aktywnych slotów w wybranym okresie; nagłówek dopasowany do trybu: `Suma (1 tydz.)`, `Suma (2 tyg.)`, `Suma (miesiąc)`, `Suma (rok)`).
5. **Zaległe 🔔 (dziś)** (badge: `0 🔔` zielony, `1 🔔` żółty, `≥2 🔔` czerwony + tooltip `title` z listą konkretnych godzin do wyczyszczenia).
6. **Ręczne przedłużenia (+dni)** (`0` lub `+X dni (Y wpisów)` z aktywnych dziś komórek).
7. **Ost. aktualizacja kolumny** (`Dziś`, `Wczoraj`, `X dni temu` lub `—` na podstawie najnowszej daty wpisu / historii edycji w kolumnie pracownika).

---

## 6. Co pozostaje w gestii implementatora („Left to the Builder”)

- Wydzielenie czystego helpera okresów 2-tygodniowych (`generateTwoWeekPeriods`) tak, aby współdzieliły go `scripts/changes-rotation.ts` oraz `scripts/statistics-helpers.ts` bez ładowania Firebase w testach jednostkowych.
- Organizacja odchudzonego kodu w `scripts/statistics.ts` i `scripts/statistics-helpers.ts` (usunięcie martwego kodu usuniętych 4 zakładek i `statsWeekly`).
- Stylizacja CSS w `styles/statistics.css` dopasowana do obecnego motywu kart i tabel aplikacji oraz responsywności na ekranach gabinetowych/mobilnych.
- Aktualizacja i rozbudowa testów Jest (`tests/statistics-helpers.test.js`, `tests/schedule-helpers.test.js`, testy okresu 2-tygodniowego, odcięcia dzwoneczków po `endDate`, limitu 1 slotu na komórkę `A/B` oraz wklejania `Ctrl+V`).
