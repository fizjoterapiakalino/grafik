# WebScrapper dla zla-chrzanow.pl/private (Render.com)

Ten projekt to web scraper napisany w Node.js z wykorzystaniem Puppeteer i Express.js, przeznaczony do działania na platformie Render.com. Jego celem jest logowanie się na stronę `https://zla-chrzanow.pl/private/`, ekstrakcja linków do plików PDF i udostępnianie ich poprzez proste API.

## Funkcjonalności

- Logowanie na zabezpieczoną stronę.
- Ekstrakcja wszystkich linków do plików PDF.
- Udostępnianie pobranych linków poprzez endpoint `/api/pdfs` w formacie JSON.
- Automatyczne odświeżanie linków co godzinę.

## Konfiguracja na Render.com

Aby uruchomić ten projekt na Render.com, wykonaj następujące kroki:

1.  **Przygotuj repozytorium Git:**
    - Upewnij się, że Twój projekt `WebScrapper` (zawierający `package.json` i `server.js`) znajduje się w osobnym repozytorium Git (np. na GitHubie).

2.  **Utwórz nową usługę webową na Render.com:**
    - Przejdź na [render.com](https://render.com/).
    - Zaloguj się lub utwórz konto.
    - Kliknij "New" -> "Web Service".
    - Połącz swoje konto Git (GitHub, GitLab, Bitbucket).
    - Wybierz repozytorium, w którym znajduje się Twój projekt `WebScrapper`.

3.  **Skonfiguruj usługę webową:**
    - **Name:** Nadaj nazwę swojej usłudze (np. `pdf-scraper-api`).
    - **Region:** Wybierz najbliższy region.
    - **Branch:** Wybierz gałąź, z której Render ma wdrażać kod (np. `main` lub `master`).
    - **Root Directory:** Jeśli Twój projekt `WebScrapper` znajduje się w podkatalogu repozytorium, podaj ścieżkę do niego (np. `WebScrapper/`). Jeśli jest w głównym katalogu, pozostaw puste.
    - **Runtime:** `Node`
    - **Build Command:** `npm install`
    - **Start Command:** `node server.js`
    - **Instance Type:** Wybierz "Free" (darmowy plan).

4.  **Ustaw zmienne środowiskowe:**
    - W sekcji "Environment" (lub "Advanced" -> "Environment Variables") dodaj następujące zmienne:
        - `TARGET_URL`: `https://zla-chrzanow.pl/private/`
        - `LOGIN_USERNAME`: Twoja nazwa użytkownika do logowania.
        - `LOGIN_PASSWORD`: Twoje hasło do logowania.
    - **Ważne:** Nigdy nie umieszczaj danych logowania bezpośrednio w kodzie! Zmienne środowiskowe Render.com są bezpieczne.

5.  **Dostosuj selektory (jeśli to konieczne):**
    - W pliku `server.js` znajdują się miejsca oznaczone `TODO: Uzupełnij selektory...`. Będziesz musiał/a dostosować selektory CSS dla pól nazwy użytkownika, hasła i przycisku logowania, a także dla linków do PDF-ów, aby pasowały do struktury HTML strony `https://zla-chrzanow.pl/private/`.
    - Możesz to zrobić, otwierając stronę w przeglądarce, logując się, a następnie używając narzędzi deweloperskich (prawy przycisk myszy -> "Zbadaj element") do znalezienia odpowiednich selektorów (np. `id`, `class`, `name`).

6.  **Wdróż projekt:**
    - Kliknij "Create Web Service". Render.com automatycznie zbuduje i wdroży Twój projekt.
    - Po wdrożeniu otrzymasz publiczny URL dla swojej usługi webowej (np. `https://pdf-scraper-api.onrender.com`).

## Użycie API

Po uruchomieniu projektu na Render.com, będziesz mógł/mogła uzyskać dostęp do linków PDF poprzez endpoint:

`https://[NAZWA_TWOJEJ_USLUGI].onrender.com/api/pdfs`

Zastąp `[NAZWA_TWOJEJ_USLUGI]` rzeczywistą nazwą Twojej usługi webowej na Render.com.

## Integracja z Twoją stroną na GitHub Pages

Aby wyświetlić te linki na swojej stronie hostowanej na GitHub Pages:

Przykład kodu JavaScript do umieszczenia na stronie GitHub Pages:

```html
<!DOCTYPE html>
<html lang="pl">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Pobrane Dokumenty PDF</title>
        <link rel="stylesheet" href="../styles/main.css" />
        <link rel="stylesheet" href="../styles/components.css" />
        <!-- Dodaj inne potrzebne style -->
    </head>
    <body>
        <header>
            <!-- Twoja istniejąca nawigacja/nagłówek -->
        </header>
        <main>
            <h1>Dostępne Dokumenty PDF</h1>
            <div id="pdf-links-container">Ładowanie linków...</div>
        </main>
        <footer>
            <!-- Twoja istniejąca stopka -->
        </footer>

        <script>
            // WAŻNE: Zastąp ten URL rzeczywistym adresem URL Twojej usługi Render.com
            // Przykład: 'https://pdf-scraper-api.onrender.com/api/pdfs'
            const RENDER_API_URL = 'https://[NAZWA_TWOJEJ_USLUGI].onrender.com/api/pdfs';

            async function fetchPdfLinks() {
                const container = document.getElementById('pdf-links-container');
                try {
                    const response = await fetch(RENDER_API_URL);
                    if (!response.ok) {
                        throw new Error(`Błąd HTTP: ${response.status}`);
                    }
                    const links = await response.json();

                    if (links.length === 0) {
                        container.innerHTML = '<p>Brak dostępnych linków PDF.</p>';
                        return;
                    }

                    const ul = document.createElement('ul');
                    links.forEach((link) => {
                        const li = document.createElement('li');
                        const a = document.createElement('a');
                        a.href = link;
                        a.target = '_blank'; // Otwórz w nowej karcie
                        a.textContent = link.substring(link.lastIndexOf('/') + 1); // Wyświetl tylko nazwę pliku
                        li.appendChild(a);
                        ul.appendChild(li);
                    });
                    container.innerHTML = '';
                    container.appendChild(ul);
                } catch (error) {
                    console.error('Błąd podczas pobierania linków PDF:', error);
                    container.innerHTML = '<p>Wystąpił błąd podczas ładowania linków. Spróbuj ponownie później.</p>';
                }
            }

            fetchPdfLinks();
        </script>
    </body>
</html>
```
