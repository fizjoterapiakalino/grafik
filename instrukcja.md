
# Instrukcja dodawania niestandardowej czcionki do jsPDF

Aby rozwiązać problem z polskimi znakami, musisz wygenerować plik JavaScript zawierający czcionkę (w tym przypadku DejaVu Sans) w formacie base64, a następnie wkleić jego zawartość do istniejącego pliku `scripts/DejaVuSans.js`.

## Krok 1: Pobranie czcionki

1.  Pobierz czcionkę **DejaVu Sans** w formacie `.ttf`. Możesz ją znaleźć na wielu stronach z darmowymi czcionkami, np. [Google Fonts](https://fonts.google.com/) lub [Font Squirrel](https://www.fontsquirrel.com/fonts/dejavu-sans). Potrzebny będzie plik `DejaVuSans.ttf`.

## Krok 2: Wygenerowanie kodu JavaScript z czcionką

1.  Przejdź do generatora online, który konwertuje pliki `.ttf` na format `jsPDF`. Dobrym narzędziem jest na przykład [ten generator](https://rawgit.com/MrRio/jsPDF/master/fontconverter/fontconverter.html).
2.  W generatorze:
    *   Wybierz pobrany plik `DejaVuSans.ttf`.
    *   W polu "Font Name" wpisz **DejaVuSans**.
    *   W polu "Font Style" wybierz **normal**.
    *   Kliknij przycisk **"Create"** (lub podobny), aby wygenerować kod.
3.  Po chwili poniżej pojawi się wygenerowany kod JavaScript. Skopiuj **całą** jego zawartość. Będzie ona wyglądać mniej więcej tak:

    ```javascript
    (function (jsPDFAPI) {
        'use strict';
        jsPDFAPI.addFileToVFS('DejaVuSans-normal.ttf', 'AAEAAAASAQAABAAgR0RFRgARAAhEAAAJ...'); // Tutaj będzie bardzo długi ciąg znaków base64
        jsPDFAPI.addFont('DejaVu