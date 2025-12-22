// scripts/shared.js

export const Shared = (() => {
    const initialize = () => {
        const dateTimeText = document.getElementById('dateTimeText');
        const appHeader = document.getElementById('appHeader');

        const updateDateTimeHeader = () => {
            if (!dateTimeText) return;
            const now = new Date();
            const options = {
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

        const generateHamburgerMenu = () => {
            let headerRightMenu = appHeader.querySelector('.header-right-menu');
            if (!headerRightMenu) {
                headerRightMenu = document.createElement('div');
                headerRightMenu.className = 'header-right-menu';
                appHeader.appendChild(headerRightMenu);
            }

            const navLinks = [
                { href: '#schedule', text: 'Grafik', icon: 'fas fa-calendar-alt' },
                { href: '#leaves', text: 'Urlopy', icon: 'fas fa-plane-departure' },
                { href: '#changes', text: 'Harmonogram zmian', icon: 'fas fa-exchange-alt' },
                { href: '#scrapped-pdfs', text: 'ISO', icon: 'fas fa-file-pdf', id: 'navLinkIso' }, // Dodano ID
                { href: '#options', text: 'Opcje', icon: 'fas fa-cogs' },
            ];

            const hamburger = document.createElement('div');
            hamburger.className = 'hamburger-menu';
            hamburger.innerHTML = '<i class="fas fa-bars"></i>';

            const navPanel = document.createElement('div');
            navPanel.className = 'nav-panel';

            const userInfoDiv = document.createElement('div');
            userInfoDiv.className = 'user-info';
            userInfoDiv.id = 'navPanelUserInfo'; // Dodaj ID dla łatwiejszej aktualizacji
            userInfoDiv.textContent = 'Zalogowano jako: Gość'; // Domyślny tekst
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

                // Dodaj ID do elementu <a> dla linku ISO
                if (link.id) {
                    a.id = link.id;
                }

                // Ukryj menu po kliknięciu linku
                a.addEventListener('click', () => {
                    navPanel.classList.remove('visible');
                    hamburger.classList.remove('active');
                });
            });
            navPanel.appendChild(ul);

            // Add logout button in a separate list to push it to the bottom
            const logoutUl = document.createElement('ul');
            logoutUl.className = 'logout-nav-list';
            const logoutLi = document.createElement('li');
            logoutLi.id = 'logoutBtnContainer';
            logoutLi.style.display = 'none'; // Initially hidden
            const logoutA = document.createElement('a');
            logoutA.href = '#';
            logoutA.id = 'logoutBtn';
            logoutA.innerHTML = '<i class="fas fa-sign-out-alt"></i> <span>Wyloguj</span>';
            logoutLi.appendChild(logoutA);
            logoutUl.appendChild(logoutLi);
            navPanel.appendChild(logoutUl); // Dodaj nową listę bezpośrednio do panelu

            const footerInfo = document.createElement('div');
            footerInfo.className = 'footer-info';
            footerInfo.innerHTML = '<p>&copy; 2025 Fizjoterapia Kalinowa. Wszelkie prawa zastrzeżone.</p>';
            navPanel.appendChild(footerInfo);

            document.body.appendChild(hamburger);
            document.body.appendChild(navPanel);

            const updateActiveLink = () => {
                const currentHash = window.location.hash || '#schedule';
                navPanel.querySelectorAll('a').forEach((a) => {
                    if (a.getAttribute('href') === currentHash) {
                        a.classList.add('active');
                    } else {
                        a.classList.remove('active');
                    }
                });
            };

            hamburger.addEventListener('click', (e) => {
                e.stopPropagation();
                navPanel.classList.toggle('visible');
                hamburger.classList.toggle('active');
            });

            document.addEventListener('click', (e) => {
                if (
                    navPanel.classList.contains('visible') &&
                    !navPanel.contains(e.target) &&
                    !hamburger.contains(e.target)
                ) {
                    navPanel.classList.remove('visible');
                    hamburger.classList.remove('active');
                }
            });

            window.addEventListener('hashchange', updateActiveLink);
            updateActiveLink(); // Set on initial load
        };

        window.showToast = (message, duration = 3000) => {
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
                        toastContainer.removeChild(toast);
                    }
                }, 500);
            }, duration);
        };

        const setupGlobalEventListeners = () => {
            const searchInput = document.getElementById('searchInput');
            const clearSearchButton = document.getElementById('clearSearchButton');

            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    const searchTerm = e.target.value.trim();
                    document.dispatchEvent(new CustomEvent('app:search', { detail: { searchTerm } }));
                    if (clearSearchButton) {
                        clearSearchButton.style.display = searchTerm ? 'block' : 'none';
                    }
                });
            }

            if (clearSearchButton) {
                clearSearchButton.addEventListener('click', () => {
                    if (searchInput) {
                        searchInput.value = '';
                        searchInput.focus();
                    }
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
                firebase
                    .auth()
                    .signOut()
                    .then(() => {
                        // window.location.hash = '#login'; // REMOVED: Managed by Router via onAuthStateChanged
                        // Explicitly get elements to ensure they are correctly referenced
                        const currentNavPanel = document.querySelector('.nav-panel');
                        const currentHamburger = document.querySelector('.hamburger-menu');
                        if (currentNavPanel) {
                            currentNavPanel.classList.remove('visible'); // Ukryj menu po wylogowaniu
                        }
                        if (currentHamburger) {
                            currentHamburger.classList.remove('active');
                        }
                    });
            });
        }
    };

    const updateUserInfo = (userName) => {
        const userInfoElement = document.getElementById('navPanelUserInfo');
        if (userInfoElement) {
            userInfoElement.textContent = `Zalogowano jako: ${userName || 'Gość'}`;
        }
    };

    const setIsoLinkActive = (isActive) => {
        const isoLink = document.getElementById('navLinkIso');
        if (isoLink) {
            if (isActive) {
                isoLink.classList.remove('disabled');
                isoLink.style.pointerEvents = 'auto'; // Przywróć interaktywność
                isoLink.style.opacity = '1'; // Przywróć normalną przezroczystość
            } else {
                isoLink.classList.add('disabled');
                isoLink.style.pointerEvents = 'none'; // Wyłącz interaktywność
                isoLink.style.opacity = '0.5'; // Ustaw ciemniejszy wygląd
            }
        }
    };

    return {
        initialize,
        updateUserInfo,
        setIsoLinkActive, // Eksportuj nową metodę
    };
})();

export const setSaveStatus = (status) => {
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
window.Shared = Shared;
window.setSaveStatus = setSaveStatus;
