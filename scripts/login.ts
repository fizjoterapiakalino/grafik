// scripts/login.ts
import { debugLog } from './common.js';
import { auth } from './firebase-config.js';
import type { FirebaseAuthWrapper } from './types/firebase';

const typedAuth = auth as unknown as FirebaseAuthWrapper;

export const Login = (() => {
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
            globalThis.location.hash = '#schedule';
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
        debugLog('Login module destroyed');
    };

    return { init, destroy };
})();
