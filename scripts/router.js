const Router = (() => {
    const routes = {
        'schedule': {
            page: 'schedule',
            init: () => {
                // Ensure all necessary modules are loaded and initialized
                if (typeof Schedule !== 'undefined') {
                    Schedule.init();
                } else {
                    console.error('Schedule module not found.');
                }
            }
        },
        'leaves': {
            page: 'leaves',
            init: () => {
                if (typeof Leaves !== 'undefined') {
                    Leaves.init();
                } else {
                    console.error('Leaves module not found.');
                }
            }
        },
        'options': {
            page: 'options',
            init: () => {
                if (typeof Options !== 'undefined') {
                    Options.init();
                } else {
                    console.error('Options module not found.');
                }
            }
        },
        'login': { page: 'login', init: Login.init } // Dodaj nową trasę
    };

    const init = () => {
        window.addEventListener('hashchange', navigate);
        UIShell.render();
        navigate(); // Navigate to the initial page
    };

    const navigate = () => {
        const pageName = window.location.hash.substring(1) || 'schedule';
        UIShell.showLoading(); // Pokaż loader na początku nawigacji

        firebase.auth().onAuthStateChanged(user => {
            UIShell.updateUserState(user); // Zaktualizuj UI (np. przycisk wyloguj)
            const appHeader = document.getElementById('appHeader');

            if (user) {
                // Użytkownik jest zalogowany
                if(appHeader) appHeader.style.display = 'flex'; // Pokaż header
                if (pageName === 'login') {
                    window.location.hash = '#schedule';
                } else {
                    const route = routes[pageName] || routes['schedule'];
                    UIShell.loadPage(route.page, route.init).finally(() => UIShell.hideLoading());
                }
            } else {
                // Użytkownik nie jest zalogowany
                if (pageName !== 'login') {
                    window.location.hash = '#login';
                } else {
                    // Na stronie logowania chowamy header i loader
                    if(appHeader) appHeader.style.display = 'none';
                    UIShell.loadPage(routes.login.page, routes.login.init).finally(() => UIShell.hideLoading());
                }
            }
        });
    };

    return {
        init,
    };
})();
