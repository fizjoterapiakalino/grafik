// scripts/router.js
const Router = (() => {
    const routes = {
        'schedule': {
            page: 'schedule',
            init: () => {
                if (typeof Schedule !== 'undefined') Schedule.init();
            },
            getModule: () => (typeof Schedule !== 'undefined' ? Schedule : null)
        },
        'leaves': {
            page: 'leaves',
            init: () => {
                if (typeof Leaves !== 'undefined') Leaves.init();
            },
            getModule: () => (typeof Leaves !== 'undefined' ? Leaves : null)
        },
        'changes': {
            page: 'changes',
            init: () => {
                if (typeof Changes !== 'undefined') Changes.init();
            },
            getModule: () => (typeof Changes !== 'undefined' ? Changes : null)
        },
        'scrapped-pdfs': { // <== DODAJ TEN BLOK
        page: 'scrapped-pdfs',
        init: () => {
            if (typeof ScrappedPdfs !== 'undefined') ScrappedPdfs.init();
        },
        getModule: () => (typeof ScrappedPdfs !== 'undefined' ? ScrappedPdfs : null)
         },
        'options': {
            page: 'options',
            init: () => {
                if (typeof Options !== 'undefined') Options.init();
            },
            getModule: () => (typeof Options !== 'undefined' ? Options : null)
        },
        'login': {
            page: 'login',
            init: () => {
                if (typeof Login !== 'undefined') Login.init();
            },
            getModule: () => (typeof Login !== 'undefined' ? Login : null)
        }
    };

    let activeModule = null;
    let currentUser = null; // Zmienna przechowująca aktualny stan zalogowania
    let isNavigating = false; // Flaga do zapobiegania podwójnym nawigacjom
    let lastUserUid = null; // Przechowuje UID ostatnio zalogowanego użytkownika

    const SCRAPED_PDFS_CACHE_KEY = 'scrapedPdfLinks';
    const SCRAPING_STATUS_KEY = 'isScraping';
    const RENDER_API_BASE_URL = 'https://pdf-scraper-api-5qqr.onrender.com'; // Przeniesiono do zasięgu modułu

    // Funkcja do pobierania linków PDF z serwera i zapisywania ich do cache
    const fetchAndCachePdfLinks = async (forceScrape = false) => {
        Shared.setIsoLinkActive(false); // Dezaktywuj przycisk ISO na czas scrapingu
        localStorage.setItem(SCRAPING_STATUS_KEY, 'true'); // Ustaw status scrapingu na true

        try {
            let response;

            if (forceScrape) {
                window.showToast('Rozpoczynam odświeżanie linków ISO...', 5000);
                await fetch(`${RENDER_API_BASE_URL}/api/scrape`, { method: 'POST' });
                // Poczekaj chwilę, aby scraping mógł się rozpocząć na serwerze
                await new Promise(resolve => setTimeout(resolve, 2000)); 
            }
            
            response = await fetch(`${RENDER_API_BASE_URL}/api/pdfs`);
            const data = await response.json();

            if (data.isScraping) {
                window.showToast('Scraping w toku, proszę czekać...', 5000);
                // Można zaimplementować mechanizm odpytywania co jakiś czas,
                // ale na razie zakładamy, że po pewnym czasie linki będą dostępne.
                // Dla uproszczenia, po prostu poczekamy i spróbujemy ponownie pobrać.
                await new Promise(resolve => setTimeout(resolve, 10000)); // Poczekaj 10 sekund
                response = await fetch(`${RENDER_API_BASE_URL}/api/pdfs`);
                const newData = await response.json();
                if (!newData.isScraping) {
                    localStorage.setItem(SCRAPED_PDFS_CACHE_KEY, JSON.stringify(newData.links));
                    window.showToast('Linki ISO zostały odświeżone!', 3000);
                    Shared.setIsoLinkActive(true);
                    localStorage.setItem(SCRAPING_STATUS_KEY, 'false');
                    return newData.links;
                } else {
                    window.showToast('Scraping nadal w toku. Spróbuj ponownie później.', 5000);
                    Shared.setIsoLinkActive(false);
                    localStorage.setItem(SCRAPING_STATUS_KEY, 'true');
                    return [];
                }
            } else {
                localStorage.setItem(SCRAPED_PDFS_CACHE_KEY, JSON.stringify(data.links));
                window.showToast('Linki ISO dostępne.', 3000);
                Shared.setIsoLinkActive(true);
                localStorage.setItem(SCRAPING_STATUS_KEY, 'false');
                return data.links;
            }
        } catch (error) {
            console.error('Błąd podczas pobierania lub cachowania linków PDF:', error);
            window.showToast('Błąd podczas pobierania linków ISO.', 5000);
            Shared.setIsoLinkActive(false); // Pozostaw nieaktywny w przypadku błędu
            return [];
        } finally {
            localStorage.setItem(SCRAPING_STATUS_KEY, 'false'); // Zawsze resetuj status po zakończeniu próby scrapingu
        }
    };

    const init = () => {
        UIShell.render();
        window.addEventListener('hashchange', navigate);
        
        // Ustaw listener, który wywoła nawigację po każdej zmianie stanu autentykacji
        let isInitialAuthCheck = true; // Flaga do śledzenia pierwszego sprawdzenia stanu autentykacji
        firebase.auth().onAuthStateChanged(user => {
            const currentUid = user ? user.uid : null;
            if (isInitialAuthCheck || currentUid !== lastUserUid) { // Nawiguj przy pierwszym sprawdzeniu lub jeśli użytkownik się zmienił
                currentUser = user;
                lastUserUid = currentUid;
                navigate();
                isInitialAuthCheck = false; // Po pierwszym sprawdzeniu ustaw na false
            }
        });

        // Inicjalne pobieranie linków przy starcie aplikacji
        const cachedScrapingStatus = localStorage.getItem(SCRAPING_STATUS_KEY);
        if (cachedScrapingStatus === 'true') {
            Shared.setIsoLinkActive(false); // Jeśli poprzedni scraping nie zakończył się, dezaktywuj
            window.showToast('Poprzedni scraping nie zakończył się pomyślnie. Spróbuj odświeżyć stronę ISO.', 7000);
        } else {
            fetchAndCachePdfLinks(); // Inicjalne pobieranie linków
        }

        // Inicjalizacja Server-Sent Events
        const sse = new EventSource(`${RENDER_API_BASE_URL}/api/events`);

        sse.addEventListener('scrapingComplete', (event) => {
            console.log('Otrzymano zdarzenie scrapingComplete:', event.data);
            window.showToast('Scraping zakończony w tle. Odświeżam linki ISO...', 5000);
            fetchAndCachePdfLinks(); // Odśwież linki po zakończeniu scrapingu w tle
        });

        sse.onerror = (error) => {
            console.error('Błąd SSE:', error);
            sse.close(); // Zamknij połączenie w przypadku błędu
        };
    };

    const navigate = async () => {
            if (isNavigating) {
                return;
            }
            isNavigating = true;
            UIShell.showLoading();

            try {
                // 1. Zniszcz stary moduł, jeśli istnieje
                if (activeModule && typeof activeModule.destroy === 'function') {
                    activeModule.destroy();
                    activeModule = null;
                }

                // 2. Ustal, dokąd nawigować
                const pageName = window.location.hash.substring(1);
                let targetPage;

                if (currentUser) {
                    // Użytkownik ZALOGOWANY: domyślnie idzie do grafiku, chyba że hash mówi inaczej
                    targetPage = pageName === 'login' || !pageName ? 'schedule' : pageName;
                } else {
                    // Użytkownik NIEZALOGOWANY: zawsze idzie do logowania
                    targetPage = 'login';
                }
                
                // Ustaw hash, jeśli jest inny niż cel - to ujednolica URL
                if (pageName !== targetPage) {
                    history.replaceState(null, '', '#' + targetPage);
                }

                const route = routes[targetPage];
                if (!route) {
                    console.error(`No route found for ${targetPage}`);
                    return;
                }

                // 3. Załaduj dane, jeśli są potrzebne
                if (currentUser) {
                    await EmployeeManager.load();
                }

                // 4. Zaktualizuj ogólny UI (np. nagłówek)
                UIShell.updateUserState(currentUser);
                const appHeader = document.getElementById('appHeader');
                if (appHeader) {
                    const displayStyle = currentUser ? 'flex' : 'none';
                    appHeader.style.display = displayStyle;
                } else {
                    console.warn("appHeader element not found when trying to set display style.");
                }

                // 5. Załaduj HTML nowej strony
                await UIShell.loadPage(route.page);

                // Zarządzanie widocznością przycisku drukowania
                const printButton = document.getElementById('printChangesTable');
                if (printButton) {
                    printButton.style.display = targetPage === 'changes' ? 'block' : 'none';
                }

                // 6. Zainicjuj nowy moduł (teraz, gdy DOM jest gotowy)
                if (route.init) {
                    route.init();
                }
                activeModule = route.getModule ? route.getModule() : null;

                // Jeśli nawigujemy do strony scrapped-pdfs, wymuś odświeżenie linków
                if (targetPage === 'scrapped-pdfs') {
                    await fetchAndCachePdfLinks(true);
                }

            } catch (error) {
                console.error("Navigation error:", error);
            } finally {
                UIShell.hideLoading();
                isNavigating = false; // Zresetuj flagę po zakończeniu nawigacji
            }
        };

    return {
        init,
    };
})();
