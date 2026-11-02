// scripts/router.ts
import { UIShell } from './ui-shell.js';
import { EmployeeManager } from './employee-manager.js';
import { auth as authRaw } from './firebase-config.js';
import { PdfService } from './pdf-service.js';
import { resolveAllowedNavigationKeys } from './navigation-access.js';
import type { FirebaseAuthWrapper, FirebaseUser } from './types/firebase';

import { Schedule } from './schedule.js';
import { Leaves } from './leaves.js';
import { Changes } from './changes.js';
import { ChangesRotation } from './changes-rotation.js';
import { ScrappedPdfs } from './scrapped-pdfs.js';
import { Options } from './options.js';
import { Login } from './login.js';
import { Statistics } from './statistics.js';
import { Stations } from './stations.js';
import { Appointments } from './appointments.js';
import { Interview } from './interview.js';

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
    module: PageModule;
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
        schedule: { page: 'schedule', module: Schedule },
        leaves: { page: 'leaves', module: Leaves },
        changes: { page: 'changes', module: Changes },
        'changes-rotation': { page: 'changes-rotation', module: ChangesRotation },
        'scrapped-pdfs': { page: 'scrapped-pdfs', module: ScrappedPdfs },
        options: { page: 'options', module: Options },
        statistics: { page: 'statistics', module: Statistics },
        stations: { page: 'stations', module: Stations },
        'massage-stations': { page: 'massage-stations', module: Stations },
        appointments: { page: 'appointments', module: Appointments },
        interview: { page: 'interview', module: Interview },
        login: { page: 'login', module: Login },
    };

    let activeModule: PageModule | null = null;
    let currentUser: FirebaseUser | null = null;
    let isNavigating = false;
    let navigationQueued = false;
    let isAuthReady = false;
    let pendingPostLoginPage: string | null = null;
    let lastUserUid: string | null = null;
    let pdfServicesStarted = false;

    const init = (): void => {
        UIShell.render();
        window.addEventListener('hashchange', () => {
            if (!isAuthReady) return;
            void navigate();
        });
        document.addEventListener('app:access-mode-updated', () => {
            if (!isAuthReady) return;
            void navigate();
        });

        auth.onAuthStateChanged((user) => {
            const currentUid = user ? user.uid : null;
            if (!isAuthReady || currentUid !== lastUserUid) {
                isAuthReady = true;
                currentUser = user;
                lastUserUid = currentUid;
                void navigate();
            }
        });
    };

    const ensurePdfServicesStarted = (): void => {
        if (pdfServicesStarted) return;
        pdfServicesStarted = true;
        PdfService.fetchAndCachePdfLinks();
    };

    const navigate = async (): Promise<void> => {
        if (isNavigating) {
            navigationQueued = true;
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
                if (pendingPostLoginPage) {
                    targetPage = pendingPostLoginPage;
                    pendingPostLoginPage = null;
                } else {
                    targetPage = pageName === 'login' || !pageName ? 'schedule' : pageName;
                }
            } else {
                if (pageName && pageName !== 'login') {
                    pendingPostLoginPage = pageName;
                }
                targetPage = 'login';
            }

            let isMassageAccess = false;
            if (currentUser) {
                await EmployeeManager.load();
                const employee = EmployeeManager.getEmployeeByUid(currentUser.uid);
                const isAdmin = EmployeeManager.isUserAdmin(currentUser.uid);
                isMassageAccess = EmployeeManager.isMassageAccessUser(currentUser.uid);

                if (EmployeeManager.hasLoadError() && !employee) {
                    targetPage = 'schedule';
                } else if (isMassageAccess) {
                    const allowedMassagePages = new Set(['massage-stations', 'options']);
                    if (!allowedMassagePages.has(targetPage)) {
                        targetPage = 'massage-stations';
                    }
                } else {
                    const allowedKeys = resolveAllowedNavigationKeys(employee);
                    if (isAdmin) {
                        allowedKeys.add('options');
                        if (allowedKeys.has('changes')) {
                            allowedKeys.add('changes-rotation');
                        }
                    }

                    const effectiveKey = targetPage === 'changes-rotation' ? 'changes' : targetPage;
                    const isTargetAllowed = allowedKeys.has(effectiveKey);

                    if (!isTargetAllowed) {
                        const fallback = allowedKeys.has('schedule')
                            ? 'schedule'
                            : (allowedKeys.values().next().value || 'schedule');
                        targetPage = fallback;
                    }
                }
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

            activeModule = route.module;
            try {
                await route.module.init();
            } catch (initErr) {
                console.error(`Error initializing module for ${targetPage}:`, initErr);
                try {
                    activeModule?.destroy?.();
                } catch (destroyErr) {
                    console.error('Error destroying failed module:', destroyErr);
                }
                activeModule = null;
                throw initErr;
            }

            if (targetPage === 'scrapped-pdfs') {
                PdfService.markAsSeen();
            }
        } catch (error) {
            console.error('Navigation error:', error);
        } finally {
            UIShell.hideLoading();
            isNavigating = false;
            if (navigationQueued) {
                navigationQueued = false;
                void navigate();
            }
        }
    };

    return { init };
})();
