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
                    <div id="scheduleActionButtons" class="schedule-action-buttons">
                        <button id="btnPatientInfo" class="action-icon-btn" title="Informacje o pacjencie"><i class="fas fa-user-circle"></i></button>
                        <button id="btnSplitCell" class="action-icon-btn" title="Podziel komórkę"><i class="fas fa-users"></i></button>
                        <button id="btnAddBreak" class="action-icon-btn" title="Dodaj przerwę"><i class="fas fa-coffee"></i></button>
                        <button id="btnMassage" class="action-icon-btn" title="Oznacz jako Masaż"><i class="fas fa-hand-paper"></i></button>
                        <button id="btnPnf" class="action-icon-btn" title="Oznacz jako PNF"><i class="fas fa-brain"></i></button>
                        <button id="btnClearCell" class="action-icon-btn danger" title="Wyczyść komórkę"><i class="fas fa-trash-alt"></i></button>
                    </div>
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
            const scheduleActionButtons = document.getElementById('scheduleActionButtons');
            if (scheduleActionButtons) {
                if (pageName === 'schedule') {
                    scheduleActionButtons.style.display = 'flex'; // Pokaż przyciski dla strony schedule
                } else {
                    scheduleActionButtons.style.display = 'none'; // Ukryj dla innych stron
                }
            }
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
                    bannerTitle.textContent = `Grafik Kalinowa - ${EmployeeManager.getNameById(employee.id)}`;
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
            Shared.updateUserInfo(employee ? employee.name : 'Admin'); // Aktualizuj informację o użytkowniku
        } else {
            // Użytkownik wylogowany
            appHeader.classList.remove('user-view');
            if (bannerTitle) {
                bannerTitle.textContent = 'Grafik Kalinowa';
            }
            if (logoutBtnContainer) {
                logoutBtnContainer.style.display = 'none';
            }
            Shared.updateUserInfo('Gość'); // Resetuj informację o użytkowniku
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
