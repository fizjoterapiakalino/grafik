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
                    <!-- Hamburger menu will be inserted here by shared.js -->
                </div>
            </div>
            <main id="page-content" class="container"></main>
        `;

        // Initialize shared components like hamburger menu
        Shared.initialize();
    };

    const loadPage = async (pageName, callback) => {
        const pageContent = document.getElementById('page-content');
        if (!pageContent) {
            console.error('Fatal error: #page-content element not found.');
            return;
        }

        try {
            const response = await fetch(`pages/${pageName}.html`);
            if (!response.ok) {
                throw new Error(`Could not load page: ${pageName}`);
            }
            pageContent.innerHTML = await response.text();
            if (callback) {
                callback();
            }
        } catch (error) {
            console.error(`Failed to load page content for ${pageName}:`, error);
            pageContent.innerHTML = `<div class="error-page"><h1>Wystąpił błąd</h1><p>Nie można załadować strony. Spróbuj ponownie później.</p></div>`;
        }
    };

    const updateUserState = (user) => {
        const logoutBtnContainer = document.getElementById('logoutBtnContainer');
        if (logoutBtnContainer) {
            logoutBtnContainer.style.display = user ? 'block' : 'none';
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
