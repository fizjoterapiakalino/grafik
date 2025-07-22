document.addEventListener('DOMContentLoaded', () => {
    const dateTimeText = document.getElementById('dateTimeText');
    const loadingOverlay = document.getElementById('loadingOverlay');

    // Globalna funkcja do przełączania nakładki ładowania
    window.toggleLoadingOverlay = (show) => {
        if (loadingOverlay) {
            loadingOverlay.style.display = show ? 'flex' : 'none';
        }
    };

    // --- ZEGAR ---
    const updateDateTimeHeader = () => {
        if (!dateTimeText) return;
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        dateTimeText.textContent = now.toLocaleDateString('pl-PL', options);
    };

    // --- INICJALIZACJA ---
    if (dateTimeText) {
        setInterval(updateDateTimeHeader, 1000);
        updateDateTimeHeader();
    }
    
    // Domyślnie ukryj nakładkę przy starcie strony
    toggleLoadingOverlay(false);
});
