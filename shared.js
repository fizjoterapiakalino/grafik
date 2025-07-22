document.addEventListener('DOMContentLoaded', () => {
    const headerRightMenu = document.querySelector('.header-right-menu');
    const dateTimeText = document.getElementById('dateTimeText');
    const loadingOverlay = document.getElementById('loadingOverlay');

    // Globalna funkcja do przełączania nakładki ładowania
    window.toggleLoadingOverlay = (show) => {
        if (loadingOverlay) {
            loadingOverlay.style.display = show ? 'flex' : 'none';
        }
    };

    // --- UWIERZYTELNIANIE ---
    const auth = firebase.auth();
    const provider = new firebase.auth.GoogleAuthProvider();

    window.signIn = () => {
        auth.signInWithPopup(provider).catch(error => {
            console.error("Błąd logowania:", error);
            alert("Logowanie nie powiodło się: " + error.message);
        });
    };

    window.signOut = () => {
        auth.signOut().catch(error => {
            console.error("Błąd wylogowywania:", error);
        });
    };

    auth.onAuthStateChanged(user => {
        updateLoginButton(user);
    });

    function updateLoginButton(user) {
        // Usuń istniejący przycisk, jeśli jest
        const existingButton = document.getElementById('authButton');
        if (existingButton) {
            existingButton.remove();
        }

        const authButton = document.createElement('a');
        authButton.href = '#';
        authButton.id = 'authButton';
        authButton.className = 'menu-item'; // Styl jak inne przyciski menu

        if (user) {
            // Użytkownik zalogowany
            authButton.textContent = 'Wyloguj';
            authButton.title = `Zalogowano jako ${user.displayName || user.email}`;
            authButton.onclick = (e) => {
                e.preventDefault();
                signOut();
            };
        } else {
            // Użytkownik wylogowany
            authButton.textContent = 'Zaloguj';
            authButton.title = 'Zaloguj się z Google, aby edytować';
            authButton.onclick = (e) => {
                e.preventDefault();
                signIn();
            };
        }
        // Dodaj przycisk na końcu menu
        if(headerRightMenu) {
            headerRightMenu.appendChild(authButton);
        }
    }

    // --- ZEGAR ---
    const updateDateTimeHeader = () => {
        if (!dateTimeText) return;
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        dateTimeText.textContent = now.toLocaleDateString('pl-PL', options);
    };

    // --- INICJALIZACJA ---
    if(headerRightMenu) {
        setInterval(updateDateTimeHeader, 1000);
        updateDateTimeHeader();
    }
    toggleLoadingOverlay(false); // Domyślnie ukryj
});
