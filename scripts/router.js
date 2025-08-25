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
        UIShell.render();
        window.addEventListener('hashchange', navigate);
        
        // Ustaw listener, który wywoła nawigację po każdej zmianie stanu autentykacji
        firebase.auth().onAuthStateChanged(user => {
            currentUser = user;
            navigate();
        });
    };

    const navigate = async () => {
        UIShell.showLoading();

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
            // Użyj replaceState, aby uniknąć tworzenia nowej pozycji w historii i pętli nawigacji
            history.replaceState(null, '', '#' + targetPage);
        }

        const route = routes[targetPage];
        if (!route) {
            console.error(`No route found for ${targetPage}`);
            UIShell.hideLoading();
            return;
        }

        try {
            // 3. Załaduj dane, jeśli są potrzebne
            if (currentUser) {
                await EmployeeManager.load();
            }

            // 4. Zaktualizuj ogólny UI (np. nagłówek)
            UIShell.updateUserState(currentUser);
            const appHeader = document.getElementById('appHeader');
            if (appHeader) {
                appHeader.style.display = currentUser ? 'flex' : 'none';
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

        } catch (error) {
            console.error("Navigation error:", error);
        } finally {
            UIShell.hideLoading();
        }
    };

    return {
        init,
    };
})();
