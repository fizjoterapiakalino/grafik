// scripts/login.js
const Login = (() => {
    let loginForm = null; // Zmienna do przechowywania referencji do formularza

    const handleSubmit = async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById('emailInput');
        const passwordInput = document.getElementById('passwordInput');
        const loginError = document.getElementById('loginError');

        if (!emailInput || !passwordInput || !loginError) {
            console.error("Login form elements not found.");
            return;
        }

        loginError.textContent = '';
        const email = emailInput.value;
        const password = passwordInput.value;

        try {
            await firebase.auth().signInWithEmailAndPassword(email, password);
            // Po udanym logowaniu, router automatycznie przekieruje
            window.location.hash = '#schedule';
        } catch (error) {
            console.error("Błąd logowania:", error);
            loginError.textContent = "Nieprawidłowy e-mail lub hasło.";
        }
    };

    const init = () => {
        loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', handleSubmit);
        } else {
            console.error("Login form not found, cannot initialize Login module.");
        }
    };

    const destroy = () => {
        if (loginForm) {
            loginForm.removeEventListener('submit', handleSubmit);
            loginForm = null;
        }
        console.log("Login module destroyed");
    };

    return { init, destroy };
})();
