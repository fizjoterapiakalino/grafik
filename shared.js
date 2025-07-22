document.addEventListener('DOMContentLoaded', () => {
    const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzu0mPeOZvjxnTJmvELkRdYMqFjxnhJHUdHbYJHojO06m9im_eoqQOQ3UzKtdgK8VPq6Q/exec';
    const dateTimeText = document.getElementById('dateTimeText');
    const loadingOverlay = document.getElementById('loadingOverlay');

    // Funkcja do pokazywania/ukrywania nakładki ładowania
    window.toggleLoadingOverlay = (show) => {
        if (loadingOverlay) {
            loadingOverlay.style.display = show ? 'flex' : 'none';
        }
    };

    const updateDateTimeHeader = () => {
        if (!dateTimeText) return;
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        dateTimeText.textContent = now.toLocaleDateString('pl-PL', options);
    };

    setInterval(updateDateTimeHeader, 1000);
    updateDateTimeHeader();

    // Ukryj nakładkę domyślnie, poszczególne skrypty (schedule.js)
    // mogą ją pokazać, gdy zaczną ładować dane.
    toggleLoadingOverlay(false);
});
