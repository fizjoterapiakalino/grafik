const UIShell = (() => {
    const render = () => {
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
            <div id="appHeader" class="app-header">
                <div class="banner-left-content">
                    <img src="logo.png" alt="Logo Kalinowa" class="banner-logo">
                    <span class="banner-title">Grafik Kalinowa</span>
                </div>
                <div id="dateTimeText" class="date-time-text"></div>
                <div class="header-right-menu">
                    <div class="search-container">
                        <i class="fas fa-search search-icon"></i>
                        <input type="text" id="searchInput" class="search-input" placeholder="Szukaj...">
                        <button id="clearSearchButton" class="clear-search-btn" style="display: none;"><i class="fas fa-times"></i></button>
                    </div>
                    <button id="undoButton" class="undo-button" title="Cofnij (Ctrl+Z)" disabled><i class="fas fa-undo"></i></button>
                    <button id="printChangesTable" class="action-btn" title="Drukuj Grafik"><i class="fas fa-print"></i></button>
                    <div id="saveStatus" class="save-status"></div>
                    <!-- Hamburger menu will be inserted here by shared.js -->
                </div>
            </div>
            <main id="page-content" class="container"></main>
        `;

        // Initialize shared components like hamburger menu
        Shared.initialize();
    };

    const loadPage = async (pageName) => { // Usunięto callback
        const pageContent = document.getElementById('page-content');
        if (!pageContent) {
            console.error('Fatal error: #page-content element not found.');
            return Promise.reject('Page content container not found');
        }

        try {
            const response = await fetch(`pages/${pageName}.html`);
            if (!response.ok) {
                throw new Error(`Could not load page: ${pageName}`);
            }
            pageContent.innerHTML = await response.text();
        } catch (error) {
            console.error(`Failed to load page content for ${pageName}:`, error);
            pageContent.innerHTML = `<div class="error-page"><h1>Wystąpił błąd</h1><p>Nie można załadować strony. Spróbuj ponownie później.</p></div>`;
            return Promise.reject(error);
        }
    };

    const updateUserState = (user) => {
        const appHeader = document.getElementById('appHeader');
        const bannerTitle = document.querySelector('.banner-title');
        const logoutBtnContainer = document.getElementById('logoutBtnContainer');

        if (user) {
            // Użytkownik zalogowany
            const employee = EmployeeManager.getEmployeeByUid(user.uid);
            if (employee) {
                // Użytkownik jest powiązany z pracownikiem -> widok uproszczony
                appHeader.classList.add('user-view');
                if (bannerTitle) {
                    bannerTitle.textContent = `Grafik Kalinowa - ${employee.name.split(' ')[0]}`;
                }
            } else {
                // Użytkownik nie jest pracownikiem (np. admin) -> widok pełny
                appHeader.classList.remove('user-view');
                if (bannerTitle) {
                    bannerTitle.textContent = 'Grafik Kalinowa';
                }
            }
            if (logoutBtnContainer) {
                logoutBtnContainer.style.display = 'block';
            }
        } else {
            // Użytkownik wylogowany
            appHeader.classList.remove('user-view');
            if (bannerTitle) {
                bannerTitle.textContent = 'Grafik Kalinowa';
            }
            if (logoutBtnContainer) {
                logoutBtnContainer.style.display = 'none';
            }
        }
    };

    const showLoading = () => {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.remove('hidden');
        }
    };

    const hideLoading = () => {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    };

    return {
        render,
        loadPage,
        updateUserState, // Eksportuj nową metodę
        showLoading,
        hideLoading
    };
})();
