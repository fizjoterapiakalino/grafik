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

    const init = () => {
        UIShell.render(); // Renderuj szkielet UI na samym początku
        window.addEventListener('hashchange', navigate); // Nasłuchuj na zmiany w URL

        // Ustaw listener stanu autentykacji TYLKO RAZ
        firebase.auth().onAuthStateChanged(user => {
            const wasLoggedIn = !!currentUser;
            currentUser = user;
            UIShell.updateUserState(user);
            
            // Uruchom nawigację tylko jeśli stan logowania się zmienił lub przy pierwszym ładowaniu
            if (user && !wasLoggedIn) {
                // Użytkownik właśnie się zalogował, przenieś go do grafiku
                window.location.hash = '#schedule';
            } else if (!user && wasLoggedIn) {
                // Użytkownik właśnie się wylogował
                window.location.hash = '#login';
            } else {
                // Stan się nie zmienił (np. odświeżenie strony), nawiguj normalnie
                navigate();
            }
        });
    };

    const navigate = () => {
        const pageName = window.location.hash.substring(1);
        const appHeader = document.getElementById('appHeader');
        
        UIShell.showLoading();

        if (currentUser) {
            // Użytkownik ZALOGOWANY
            const targetPage = pageName || 'schedule'; // Domyślna strona po zalogowaniu
            if (targetPage === 'login') {
                window.location.hash = '#schedule'; // Przekieruj, jeśli zalogowany wejdzie na /login
                UIShell.hideLoading();
                return;
            }
            if (appHeader) appHeader.style.display = 'flex';
            const route = routes[targetPage] || routes['schedule'];

            // Sprawdź, czy istnieje aktywny moduł i czy ma metodę destroy
            if (activeModule && typeof activeModule.destroy === 'function') {
                activeModule.destroy();
            }
    
            // Ustaw nowy aktywny moduł i załaduj stronę
            activeModule = route.getModule ? route.getModule() : null;
            UIShell.loadPage(route.page, route.init).finally(UIShell.hideLoading);

        } else {
            // Użytkownik NIEZALOGOWANY
            if (appHeader) appHeader.style.display = 'none';
            // Każda próba wejścia na inną stronę niż /login przekierowuje na /login
            if (pageName !== 'login') {
                window.location.hash = '#login';
                UIShell.hideLoading();
                return;
            }

            if (activeModule && typeof activeModule.destroy === 'function') {
                activeModule.destroy();
            }
            activeModule = routes.login.getModule ? routes.login.getModule() : null;
            UIShell.loadPage(routes.login.page, routes.login.init).finally(UIShell.hideLoading);
        }
    };

    return {
        init,
    };
})();
