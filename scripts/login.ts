// scripts/login.ts
import { auth } from './firebase-config.js';
import type { FirebaseAuthWrapper } from './types/firebase';

// Type assertion dla auth
const typedAuth = auth as unknown as FirebaseAuthWrapper;

/**
 * Interfejs publicznego API Login
 */
interface LoginAPI {
    init(): void;
    destroy(): void;
}

/**
 * Moduł logowania
 */
export const Login: LoginAPI = (() => {
    let loginForm: HTMLFormElement | null = null;

    const handleSubmit = async (e: Event): Promise<void> => {
        e.preventDefault();
        const emailInput = document.getElementById('emailInput') as HTMLInputElement | null;
        const passwordInput = document.getElementById('passwordInput') as HTMLInputElement | null;
        const loginError = document.getElementById('loginError');

        if (!emailInput || !passwordInput || !loginError) {
            console.error('Login form elements not found.');
            return;
        }

        loginError.textContent = '';
        const email = emailInput.value;
        const password = passwordInput.value;

        try {
            await typedAuth.signInWithEmailAndPassword(email, password);
            window.location.hash = '#schedule';
        } catch (error) {
            console.error('Błąd logowania:', error);
            loginError.textContent = 'Nieprawidłowy e-mail lub hasło.';
        }
    };

    const init = (): void => {
        loginForm = document.getElementById('loginForm') as HTMLFormElement | null;
        if (loginForm) {
            loginForm.addEventListener('submit', handleSubmit);
        } else {
            console.error('Login form not found, cannot initialize Login module.');
        }
    };

    const destroy = (): void => {
        if (loginForm) {
            loginForm.removeEventListener('submit', handleSubmit);
            loginForm = null;
        }
        console.log('Login module destroyed');
    };

    return { init, destroy };
})();

// Backward compatibility
declare global {
    interface Window {
        Login: LoginAPI;
    }
}

window.Login = Login;
