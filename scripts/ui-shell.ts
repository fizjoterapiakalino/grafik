// scripts/ui-shell.ts
import { Shared } from './shared.js';
import { EmployeeManager } from './employee-manager.js';
import type { FirebaseUser } from './types/firebase';

/**
 * Interfejs publicznego API UIShell
 */
interface UIShellAPI {
    render(): void;
    loadPage(pageName: string): Promise<void>;
    updateUserState(user: FirebaseUser | null): void;
    showLoading(): void;
    hideLoading(): void;
}

/**
 * Moduł UI Shell - główna powłoka aplikacji
 */
export const UIShell: UIShellAPI = (() => {
    const render = (): void => {
        const appRoot = document.getElementById('app-root');
        if (!appRoot) {
            console.error('Fatal error: #app-root element not found.');
            return;
        }

        appRoot.innerHTML = `
            <div id="loadingOverlay" class="loading-overlay hidden">
                <div class="loader"></div>
                <p>Wczytywanie...</p>
            </div>
            <div id="toast-container"></div>
            <div id="appHeader" class="app-header" style="display: none;">
                <div class="banner-left-content">
                    <img src="logo.png" alt="Logo Kalinowa" class="banner-logo">
                    <span id="bannerTitleLink" class="banner-title">Grafik Kalinowa</span>
                </div>
                <div id="dateTimeText" class="date-time-text"></div>
                <div class="header-right-menu">
                    <div id="saveStatus" class="save-status"></div>
                    <div id="scheduleActionButtons" class="schedule-action-buttons">
                        <button id="btnPatientInfo" class="action-icon-btn" title="Informacje o pacjencie"><i class="fas fa-user-circle"></i></button>
                        <button id="btnAddBreak" class="action-icon-btn" title="Dodaj przerwę"><i class="fas fa-coffee"></i></button>
                        <button id="btnClearCell" class="action-icon-btn danger" title="Wyczyść komórkę"><i class="fas fa-trash-alt"></i></button>
                        <button id="btnIso" class="action-icon-btn" title="Dokumenty ISO"><i class="fas fa-file-alt"></i><span class="notification-badge" style="display: none;"></span></button>
                    </div>
                    <div class="search-container">
                        <button id="searchToggleBtn" class="search-toggle-btn" title="Szukaj"><i class="fas fa-search"></i></button>
                        <input type="text" id="searchInput" class="search-input" placeholder="Szukaj...">
                        <button id="clearSearchButton" class="clear-search-btn" style="display: none;"><i class="fas fa-times"></i></button>
                    </div>
                    <button id="undoButton" class="action-icon-btn" title="Cofnij (Ctrl+Z)" disabled><i class="fas fa-undo"></i></button>
                    <button id="printChangesTable" class="action-icon-btn active" title="Drukuj Grafik Zmian" style="display: none;"><i class="fas fa-file-pdf"></i></button>
                    <button id="printLeavesNavbarBtn" class="action-icon-btn active" title="Drukuj Grafik Urlopów" style="display: none;"><i class="fas fa-file-pdf"></i></button>
                </div>
            </div>
            <main id="page-content" class="container"></main>
        `;

        // Initialize shared components
        Shared.initialize();

        // Banner title click navigation
        const bannerTitleLink = document.getElementById('bannerTitleLink');
        if (bannerTitleLink) {
            bannerTitleLink.style.cursor = 'pointer';
            bannerTitleLink.addEventListener('click', () => {
                window.location.hash = 'schedule';
            });
        }

        const btnIso = document.getElementById('btnIso');
        if (btnIso) {
            btnIso.addEventListener('click', () => {
                window.location.hash = 'scrapped-pdfs';
            });
        }

        window.addEventListener('iso-updates-available', () => {
            const badge = document.querySelector('#btnIso .notification-badge') as HTMLElement | null;
            if (badge) {
                badge.style.display = 'block';
            }
        });

        window.addEventListener('iso-updates-cleared', () => {
            const badge = document.querySelector('#btnIso .notification-badge') as HTMLElement | null;
            if (badge) {
                badge.style.display = 'none';
            }
        });

        // Search Bar Toggle Logic
        const searchToggleBtn = document.getElementById('searchToggleBtn');
        const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
        const searchContainer = document.querySelector('.search-container');

        if (searchToggleBtn && searchInput) {
            searchToggleBtn.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                searchInput.classList.toggle('expanded');
                if (searchInput.classList.contains('expanded')) {
                    searchInput.focus();
                }
            });

            document.addEventListener('click', (e: MouseEvent) => {
                const target = e.target as Node;
                if (searchContainer && !searchContainer.contains(target)) {
                    searchInput.classList.remove('expanded');
                }
            });
        }
    };

    const loadPage = async (pageName: string): Promise<void> => {
        const pageContent = document.getElementById('page-content');
        const DYNAMIC_CSS_ID = 'page-specific-css';

        if (!pageContent) {
            console.error('Fatal error: #page-content element not found.');
            return Promise.reject('Page content container not found');
        }

        // Remove old page-specific CSS
        const oldStylesheet = document.getElementById(DYNAMIC_CSS_ID);
        if (oldStylesheet) {
            oldStylesheet.remove();
        }

        try {
            // Load new CSS if it exists
            const cssPath = `styles/${pageName}.css?v=${Date.now()}`;
            const cssResponse = await fetch(cssPath);
            if (cssResponse.ok) {
                const newStylesheet = document.createElement('link');
                newStylesheet.id = DYNAMIC_CSS_ID;
                newStylesheet.rel = 'stylesheet';
                newStylesheet.href = cssPath;
                document.head.appendChild(newStylesheet);
            }

            // Load new HTML with cache buster
            const response = await fetch(`pages/${pageName}.html?v=${Date.now()}`);
            if (!response.ok) {
                throw new Error(`Could not load page: ${pageName}`);
            }
            const pageHtml = await response.text();
            pageContent.innerHTML = pageHtml;

            const scheduleActionButtons = document.getElementById('scheduleActionButtons');
            const printChangesTable = document.getElementById('printChangesTable');
            const printLeavesNavbarBtn = document.getElementById('printLeavesNavbarBtn');

            if (scheduleActionButtons) {
                scheduleActionButtons.style.display = pageName === 'schedule' ? 'flex' : 'none';
            }
            if (printChangesTable) {
                printChangesTable.style.display = pageName === 'changes' ? 'inline-block' : 'none';
            }
            if (printLeavesNavbarBtn) {
                printLeavesNavbarBtn.style.display = pageName === 'leaves' ? 'inline-block' : 'none';
            }
        } catch (error) {
            console.error(`Failed to load page content for ${pageName}:`, error);
            pageContent.innerHTML = `<div class="error-page"><h1>Wystąpił błąd</h1><p>Nie można załadować strony. Spróbuj ponownie później.</p></div>`;
            return Promise.reject(error);
        }
    };

    const updateUserState = (user: FirebaseUser | null): void => {
        const appHeader = document.getElementById('appHeader');
        const bannerTitle = document.querySelector('.banner-title');
        const logoutBtnContainer = document.getElementById('logoutBtnContainer');

        if (!appHeader) return;

        if (user) {
            const employee = EmployeeManager.getEmployeeByUid(user.uid);
            if (employee) {
                appHeader.classList.add('user-view');
                if (bannerTitle) {
                    bannerTitle.textContent = `Grafik Kalinowa - ${EmployeeManager.getNameById(employee.id)}`;
                }
            } else {
                appHeader.classList.remove('user-view');
                if (bannerTitle) {
                    bannerTitle.textContent = 'Grafik Kalinowa';
                }
            }
            if (logoutBtnContainer) {
                logoutBtnContainer.style.display = 'block';
            }
            Shared.updateUserInfo(employee ? employee.name || null : 'Admin');
        } else {
            appHeader.classList.remove('user-view');
            if (bannerTitle) {
                bannerTitle.textContent = 'Grafik Kalinowa';
            }
            if (logoutBtnContainer) {
                logoutBtnContainer.style.display = 'none';
            }
            Shared.updateUserInfo('Gość');
        }
    };

    const showLoading = (): void => {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.remove('hidden');
        }
    };

    const hideLoading = (): void => {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    };

    return {
        render,
        loadPage,
        updateUserState,
        showLoading,
        hideLoading,
    };
})();

// Backward compatibility
declare global {
    interface Window {
        UIShell: UIShellAPI;
    }
}

window.UIShell = UIShell;
