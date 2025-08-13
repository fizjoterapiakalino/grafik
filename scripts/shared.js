const Shared = (() => {
    const initialize = () => {
        const dateTimeText = document.getElementById('dateTimeText');
        const appHeader = document.getElementById('appHeader');

        const updateDateTimeHeader = () => {
            if (!dateTimeText) return;
            const now = new Date();
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
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
                { href: '#options', text: 'Opcje', icon: 'fas fa-cogs' }
            ];
            
            const hamburger = document.createElement('div');
            hamburger.className = 'hamburger-menu';
            hamburger.innerHTML = '<i class="fas fa-bars"></i>';
            
            const navPanel = document.createElement('div');
            navPanel.className = 'nav-panel';
            
            const ul = document.createElement('ul');
            navLinks.forEach(link => {
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
            });
            navPanel.appendChild(ul);

            // Add logout button
            const logoutLi = document.createElement('li');
            logoutLi.id = 'logoutBtnContainer';
            logoutLi.style.display = 'none'; // Initially hidden
            const logoutA = document.createElement('a');
            logoutA.href = '#';
            logoutA.id = 'logoutBtn';
            logoutA.innerHTML = '<i class="fas fa-sign-out-alt"></i> <span>Wyloguj</span>';
            logoutLi.appendChild(logoutA);
            ul.appendChild(logoutLi);

            const footerInfo = document.createElement('div');
            footerInfo.className = 'footer-info';
            footerInfo.innerHTML = '<p>&copy; 2025 Fizjoterapia Kalinowa. Wszelkie prawa zastrzeżone.</p>';
            navPanel.appendChild(footerInfo);

            headerRightMenu.appendChild(hamburger);
            document.body.appendChild(navPanel);

            const updateActiveLink = () => {
                const currentHash = window.location.hash || '#schedule';
                navPanel.querySelectorAll('a').forEach(a => {
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
                if (navPanel.classList.contains('visible') && !navPanel.contains(e.target) && !hamburger.contains(e.target)) {
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
                firebase.auth().signOut().then(() => {
                    window.location.hash = '#login'; // Przekieruj po wylogowaniu
                });
            });
        }
    };

    return {
        initialize
    };
})();
