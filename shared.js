document.addEventListener('DOMContentLoaded', () => {
    // Adres URL Twojej wdrożonej aplikacji internetowej Google Apps Script
    // Można go tu zostawić jako centralny punkt konfiguracji
    const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzu0mPeOZvjxnTJmvELkRdYMqFjxnhJHUdHbYJHojO06m9im_eoqQOQ3UzKtdgK8VPq6Q/exec';

    const dateTimeText = document.getElementById('dateTimeText');

    // Funkcja aktualizująca datę i czas w nagłówku
    const updateDateTimeHeader = () => {
        if (!dateTimeText) return; // Kontynuuj tylko jeśli element istnieje na stronie
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        dateTimeText.textContent = now.toLocaleDateString('pl-PL', options);
    };

    // Uruchomienie zegara
    setInterval(updateDateTimeHeader, 1000);
    updateDateTimeHeader();

    // Można tu w przyszłości dodać inne globalne funkcje,
    // np. obsługę wylogowywania, globalne powiadomienia itp.
});