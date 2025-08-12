// scripts/login.js
const Login = (() => {
    const init = () => {
        const loginForm = document.getElementById('loginForm');
        const emailInput = document.getElementById('emailInput');
        const passwordInput = document.getElementById('passwordInput');
        const loginError = document.getElementById('loginError');

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
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
        });
    };

    return { init };
})();
