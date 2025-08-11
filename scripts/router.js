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
        }
    };

    const init = () => {
        window.addEventListener('hashchange', navigate);
        UIShell.render();
        navigate(); // Navigate to the initial page
    };

    const navigate = () => {
        const pageName = window.location.hash.substring(1) || 'schedule';
        const route = routes[pageName];

        if (route) {
            UIShell.loadPage(route.page, route.init);
        } else {
            // Fallback to schedule page if route is not found
            window.location.hash = 'schedule';
        }
    };

    return {
        init,
    };
})();
