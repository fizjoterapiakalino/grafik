// scripts/shared.ts
import { debounce } from './common.js';

/**
 * Link nawigacyjny
 */
interface NavLink {
    href: string;
    text: string;
    icon: string;
    id?: string;
}

/**
 * Status zapisu
 */
export type SaveStatus = 'saving' | 'saved' | 'error';

/**
 * Interfejs publicznego API Shared
 */
interface SharedAPI {
    initialize(): void;
    updateUserInfo(userName: string | null): void;
    setIsoLinkActive(isActive: boolean): void;
}

/**
 * Moduł współdzielonych funkcji UI
 */
export const Shared: SharedAPI = (() => {
    const initialize = (): void => {
        const dateTimeText = document.getElementById('dateTimeText');
        const appHeader = document.getElementById('appHeader');

        const updateDateTimeHeader = (): void => {
            if (!dateTimeText) return;
            const now = new Date();
            const options: Intl.DateTimeFormatOptions = {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            };
            dateTimeText.textContent = now.toLocaleDateString('pl-PL', options);
        };

        const generateHamburgerMenu = (): void => {
            if (!appHeader) return;

            let headerRightMenu = appHeader.querySelector('.header-right-menu');
            if (!headerRightMenu) {
                headerRightMenu = document.createElement('div');
                headerRightMenu.className = 'header-right-menu';
                appHeader.appendChild(headerRightMenu);
            }

            const navLinks: NavLink[] = [
                { href: '#schedule', text: 'Grafik', icon: 'fas fa-calendar-alt' },
                { href: '#leaves', text: 'Urlopy', icon: 'fas fa-plane-departure' },
                { href: '#changes', text: 'Harmonogram zmian', icon: 'fas fa-exchange-alt' },
                { href: '#scrapped-pdfs', text: 'ISO', icon: 'fas fa-file-pdf', id: 'navLinkIso' },
                { href: '#options', text: 'Opcje', icon: 'fas fa-cogs' },
            ];

            const hamburger = document.createElement('div');
            hamburger.className = 'hamburger-menu';
            hamburger.innerHTML = '<i class="fas fa-bars"></i>';

            const navPanel = document.createElement('div');
            navPanel.className = 'nav-panel';

            const userInfoDiv = document.createElement('div');
            userInfoDiv.className = 'user-info';
            userInfoDiv.id = 'navPanelUserInfo';
            userInfoDiv.textContent = 'Zalogowano jako: Gość';
            navPanel.appendChild(userInfoDiv);

            const ul = document.createElement('ul');
            ul.className = 'main-nav-list';
            navLinks.forEach((link) => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.href = link.href;

                const icon = document.createElement('i');
                icon.className = link.icon;
                a.appendChild(icon);

                const textSpan = document.createElement('span');
                textSpan.textContent = ' ' + link.text;
                a.appendChild(textSpan);

                li.appendChild(a);
                ul.appendChild(li);

                if (link.id) {
                    a.id = link.id;
                }

                a.addEventListener('click', () => {
                    navPanel.classList.remove('visible');
                    hamburger.classList.remove('active');
                });
            });
            navPanel.appendChild(ul);

            // Add logout button
            const logoutUl = document.createElement('ul');
            logoutUl.className = 'logout-nav-list';
            const logoutLi = document.createElement('li');
            logoutLi.id = 'logoutBtnContainer';
            logoutLi.style.display = 'none';
            const logoutA = document.createElement('a');
            logoutA.href = '#';
            logoutA.id = 'logoutBtn';
            logoutA.innerHTML = '<i class="fas fa-sign-out-alt"></i> <span>Wyloguj</span>';
            logoutLi.appendChild(logoutA);
            logoutUl.appendChild(logoutLi);
            navPanel.appendChild(logoutUl);

            const footerInfo = document.createElement('div');
            footerInfo.className = 'footer-info';
            footerInfo.innerHTML = '<p>&copy; 2025 Fizjoterapia Kalinowa. Wszelkie prawa zastrzeżone.</p>';
            navPanel.appendChild(footerInfo);

            document.body.appendChild(hamburger);
            document.body.appendChild(navPanel);

            const updateActiveLink = (): void => {
                const currentHash = window.location.hash || '#schedule';
                navPanel.querySelectorAll('a').forEach((a) => {
                    if (a.getAttribute('href') === currentHash) {
                        a.classList.add('active');
                    } else {
                        a.classList.remove('active');
                    }
                });
            };

            hamburger.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                navPanel.classList.toggle('visible');
                hamburger.classList.toggle('active');
            });

            document.addEventListener('click', (e: MouseEvent) => {
                const target = e.target as Node;
                if (
                    navPanel.classList.contains('visible') &&
                    !navPanel.contains(target) &&
                    !hamburger.contains(target)
                ) {
                    navPanel.classList.remove('visible');
                    hamburger.classList.remove('active');
                }
            });

            window.addEventListener('hashchange', updateActiveLink);
            updateActiveLink();
        };

        window.showToast = (message: string, duration: number = 3000): void => {
            let toastContainer = document.getElementById('toast-container');
            if (!toastContainer) {
                toastContainer = document.createElement('div');
                toastContainer.id = 'toast-container';
                document.body.appendChild(toastContainer);
            }

            const toast = document.createElement('div');
            toast.className = 'toast show';
            toast.textContent = message;
            toastContainer.appendChild(toast);

            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => {
                    if (toast.parentNode === toastContainer) {
                        toastContainer!.removeChild(toast);
                    }
                }, 500);
            }, duration);
        };

        const setupGlobalEventListeners = (): void => {
            const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
            const clearSearchButton = document.getElementById('clearSearchButton');

            if (searchInput) {
                // Debounced search - czeka 250ms po ostatnim naciśnięciu klawisza
                const debouncedSearch = debounce((searchTerm: string) => {
                    document.dispatchEvent(new CustomEvent('app:search', { detail: { searchTerm } }));
                }, 250);

                searchInput.addEventListener('input', (e: Event) => {
                    const target = e.target as HTMLInputElement;
                    const searchTerm = target.value.trim();

                    // Natychmiastowa aktualizacja UI (przycisk czyszczenia)
                    if (clearSearchButton) {
                        clearSearchButton.style.display = searchTerm ? 'block' : 'none';
                    }

                    // Opóźnione wyszukiwanie
                    debouncedSearch(searchTerm);
                });
            }

            if (clearSearchButton) {
                clearSearchButton.addEventListener('click', () => {
                    if (searchInput) {
                        searchInput.value = '';
                        searchInput.focus();
                    }
                    // Czyszczenie nie wymaga debounce - wykonaj natychmiast
                    document.dispatchEvent(new CustomEvent('app:search', { detail: { searchTerm: '' } }));
                    clearSearchButton.style.display = 'none';
                });
            }
        };

        generateHamburgerMenu();
        setInterval(updateDateTimeHeader, 1000);
        updateDateTimeHeader();
        setupGlobalEventListeners();

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                // Use window.firebase for backward compatibility
                const firebase = (window as unknown as { firebase?: { auth(): { signOut(): Promise<void> } } }).firebase;
                if (firebase) {
                    firebase.auth().signOut().then(() => {
                        const currentNavPanel = document.querySelector('.nav-panel');
                        const currentHamburger = document.querySelector('.hamburger-menu');
                        if (currentNavPanel) {
                            currentNavPanel.classList.remove('visible');
                        }
                        if (currentHamburger) {
                            currentHamburger.classList.remove('active');
                        }
                    });
                }
            });
        }
    };

    const updateUserInfo = (userName: string | null): void => {
        const userInfoElement = document.getElementById('navPanelUserInfo');
        if (userInfoElement) {
            userInfoElement.textContent = `Zalogowano jako: ${userName || 'Gość'}`;
        }
    };

    const setIsoLinkActive = (isActive: boolean): void => {
        const isoLink = document.getElementById('navLinkIso') as HTMLAnchorElement | null;
        if (isoLink) {
            if (isActive) {
                isoLink.classList.remove('disabled');
                isoLink.style.pointerEvents = 'auto';
                isoLink.style.opacity = '1';
            } else {
                isoLink.classList.add('disabled');
                isoLink.style.pointerEvents = 'none';
                isoLink.style.opacity = '0.5';
            }
        }
    };

    return {
        initialize,
        updateUserInfo,
        setIsoLinkActive,
    };
})();

/**
 * Ustawia status zapisu w UI
 */
export const setSaveStatus = (status: SaveStatus): void => {
    const statusElement = document.getElementById('saveStatus');
    if (!statusElement) return;

    statusElement.classList.remove('saving', 'saved', 'error');
    statusElement.style.display = 'block';

    switch (status) {
        case 'saving':
            statusElement.classList.add('saving');
            statusElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Zapisywanie...';
            break;
        case 'saved':
            statusElement.classList.add('saved');
            statusElement.innerHTML = '<i class="fas fa-check-circle"></i> Zapisano';
            setTimeout(() => {
                statusElement.style.display = 'none';
            }, 2000);
            break;
        case 'error':
            statusElement.classList.add('error');
            statusElement.innerHTML = '<i class="fas fa-exclamation-circle"></i> Błąd zapisu';
            break;
    }
};

// Backward compatibility
declare global {
    interface Window {
        Shared: SharedAPI;
        setSaveStatus: typeof setSaveStatus;
    }
}

window.Shared = Shared;
window.setSaveStatus = setSaveStatus;
