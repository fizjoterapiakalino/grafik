// scripts/router.ts
import { UIShell } from './ui-shell.js';
import { EmployeeManager } from './employee-manager.js';
import { auth as authRaw } from './firebase-config.js';
import { PdfService } from './pdf-service.js';
import type { FirebaseAuthWrapper, FirebaseUser } from './types/firebase';

import { Schedule } from './schedule.js';
import { Leaves } from './leaves.js';
import { Changes } from './changes.js';
import { ScrappedPdfs } from './scrapped-pdfs.js';
import { Options } from './options.js';
import { Login } from './login.js';
import { Statistics } from './statistics.js';
import { Stations } from './stations.js';
import { Appointments } from './appointments.js';

const auth = authRaw as unknown as FirebaseAuthWrapper;

/**
 * Interfejs modułu strony
 */
interface PageModule {
    init(): void | Promise<void>;
    destroy?(): void;
}

/**
 * Definicja trasy
 */
interface Route {
    page: string;
    init(): void | Promise<void>;
    getModule(): PageModule;
}

/**
 * Interfejs publicznego API Router
 */
interface RouterAPI {
    init(): void;
}

/**
 * Moduł routera
 */
export const Router: RouterAPI = (() => {
    const routes: Record<string, Route> = {
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
        statistics: {
            page: 'statistics',
            init: () => Statistics.init(),
            getModule: () => Statistics,
        },
        stations: {
            page: 'stations',
            init: () => Stations.init(),
            getModule: () => Stations,
        },
        'massage-stations': {
            page: 'massage-stations',
            init: () => Stations.init(),
            getModule: () => Stations,
        },
        appointments: {
            page: 'appointments',
            init: () => Appointments.init(),
            getModule: () => Appointments,
        },
        login: {
            page: 'login',
            init: () => Login.init(),
            getModule: () => Login,
        },
    };

    let activeModule: PageModule | null = null;
    let currentUser: FirebaseUser | null = null;
    let isNavigating = false;
    let lastUserUid: string | null = null;
    let pdfServicesStarted = false;

    const init = (): void => {
        UIShell.render();
        window.addEventListener('hashchange', navigate);
        document.addEventListener('app:access-mode-updated', () => {
            navigate();
        });

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
    };

    const ensurePdfServicesStarted = (): void => {
        if (pdfServicesStarted) return;
        pdfServicesStarted = true;
        PdfService.fetchAndCachePdfLinks();
        PdfService.initRealtimeUpdates();
    };

    const navigate = async (): Promise<void> => {
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
            let targetPage: string;

            if (currentUser) {
                targetPage = pageName === 'login' || !pageName ? 'schedule' : pageName;
            } else {
                targetPage = 'login';
            }

            if (currentUser) {
                await EmployeeManager.load();
            }

            const isMassageAccess = currentUser ? EmployeeManager.isMassageAccessUser(currentUser.uid) : false;
            if (currentUser && isMassageAccess) {
                const allowedMassagePages = new Set(['massage-stations', 'options']);
                targetPage = allowedMassagePages.has(targetPage) ? targetPage : 'massage-stations';
            }

            if (pageName !== targetPage) {
                history.replaceState(null, '', '#' + targetPage);
            }

            const route = routes[targetPage];
            if (!route) {
                console.error(`No route found for ${targetPage}`);
                return;
            }

            if (currentUser && !isMassageAccess) {
                ensurePdfServicesStarted();
            }

            UIShell.updateUserState(currentUser);
            const appHeader = document.getElementById('appHeader');
            if (appHeader) {
                const useMassageLightShell = Boolean(currentUser && (isMassageAccess || targetPage === 'massage-stations'));
                const displayStyle = currentUser && !useMassageLightShell ? 'flex' : 'none';
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

    return { init };
})();
