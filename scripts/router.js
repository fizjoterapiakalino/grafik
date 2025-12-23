// scripts/router.js
import { UIShell } from './ui-shell.js';
import { EmployeeManager } from './employee-manager.js';
import { Shared } from './shared.js';
import { auth } from './firebase-config.js';
import { PdfService } from './pdf-service.js';

// Dynamic imports to avoid circular dependencies and global pollution if possible,
// though for now we keep the structure but remove hardcoded global checks where we can.
// We will still check for existence if modules are loaded via script tags, but ideally we move towards full modules.
// Since the project uses type="module", we can import them directly if needed, but the current architecture
// seems to rely on side-effects or global registration for some modules (like Schedule).
// For this refactor, we will assume modules are available or imported.

// To fully remove globals, we would need to import Schedule, Leaves etc. here.
// Let's try to import them dynamically or assume they are registered.
// Given the current file structure, let's import them to ensure they are loaded.
import { Schedule } from './schedule.js';
import { Leaves } from './leaves.js';
import { Changes } from './changes.js';
import { ScrappedPdfs } from './scrapped-pdfs.js';
import { Options } from './options.js';
import { Login } from './login.js';

export const Router = (() => {
    const routes = {
        schedule: {
            page: 'schedule',
            init: () => Schedule.init(),
            getModule: () => Schedule,
        },
        leaves: {
            page: 'leaves',
            init: () => Leaves.init(),
            getModule: () => Leaves,
        },
        changes: {
            page: 'changes',
            init: () => Changes.init(),
            getModule: () => Changes,
        },
        'scrapped-pdfs': {
            page: 'scrapped-pdfs',
            init: () => ScrappedPdfs.init(),
            getModule: () => ScrappedPdfs,
        },
        options: {
            page: 'options',
            init: () => Options.init(),
            getModule: () => Options,
        },
        login: {
            page: 'login',
            init: () => Login.init(),
            getModule: () => Login,
        },
    };

    let activeModule = null;
    let currentUser = null;
    let isNavigating = false;
    let lastUserUid = null;

    const init = () => {
        UIShell.render();
        window.addEventListener('hashchange', navigate);

        let isInitialAuthCheck = true;
        auth.onAuthStateChanged((user) => {
            const currentUid = user ? user.uid : null;
            if (isInitialAuthCheck || currentUid !== lastUserUid) {
                currentUser = user;
                lastUserUid = currentUid;
                navigate();
                isInitialAuthCheck = false;
            }
        });

        // Initialize PDF Service
        PdfService.fetchAndCachePdfLinks();
        PdfService.initRealtimeUpdates();
    };

    const navigate = async () => {
        if (isNavigating) {
            return;
        }
        isNavigating = true;
        UIShell.showLoading();

        try {
            if (activeModule && typeof activeModule.destroy === 'function') {
                try {
                    activeModule.destroy();
                } catch (err) {
                    console.error('Error destroying module:', err);
                }
                activeModule = null;
            }

            const pageName = window.location.hash.substring(1);
            let targetPage;

            if (currentUser) {
                targetPage = pageName === 'login' || !pageName ? 'schedule' : pageName;
            } else {
                targetPage = 'login';
            }

            if (pageName !== targetPage) {
                history.replaceState(null, '', '#' + targetPage);
            }

            const route = routes[targetPage];
            if (!route) {
                console.error(`No route found for ${targetPage}`);
                return;
            }

            if (currentUser) {
                await EmployeeManager.load();
            }

            UIShell.updateUserState(currentUser);
            const appHeader = document.getElementById('appHeader');
            if (appHeader) {
                const displayStyle = currentUser ? 'flex' : 'none';
                appHeader.style.display = displayStyle;
            }

            await UIShell.loadPage(route.page);

            const printButton = document.getElementById('printChangesTable');
            if (printButton) {
                printButton.style.display = targetPage === 'changes' ? 'block' : 'none';
            }

            if (route.init) {
                await route.init();
            }
            activeModule = route.getModule ? route.getModule() : null;

            if (targetPage === 'scrapped-pdfs') {
                await PdfService.fetchAndCachePdfLinks(true);
                PdfService.markAsSeen();
            }
        } catch (error) {
            console.error('Navigation error:', error);
        } finally {
            UIShell.hideLoading();
            isNavigating = false;
        }
    };

    return {
        init,
    };
})();

// Backward compatibility - keeping it for now as requested in plan, but marked for removal
// window.Router = Router;
