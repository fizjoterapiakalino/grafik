// scripts/main.ts
import { Router } from './router.js';
import { BackupScheduler } from './backup-scheduler.js';
import { UXEnhancements } from './ux-enhancements.js';
import { ConnectionMonitor } from './connection-monitor.js';
import './firebase-config.js';
import './common.js';
import './utils.js';
import './shared.js';
import './employee-manager.js';
import './ui-shell.js';
import './context-menu.js';
import './schedule-ui.js';
import './schedule-events.js';
import './schedule.js';
import './leaves-summary.js';
import './leaves-care-summary.js';
import './calendar-modal.js';
import './leaves.js';
import './changes.js';
import './scrapped-pdfs.js';
import './options.js';
import './login.js';
import './appointments.js';
import './appointments-pdf.js';
import { ColorPreferences } from './color-preferences.js';
import { MobileZen } from './mobile-zen.js';
import { registerSW } from 'virtual:pwa-register';

// PWA Install Prompt Logic
let deferredPrompt: any = null;

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;

    // Notify the UI that the install button can be shown
    window.dispatchEvent(new CustomEvent('pwa-installable'));
});

window.addEventListener('appinstalled', () => {
    // Log install to analytics or similar
    console.log('PWA was installed');
    deferredPrompt = null;
    window.dispatchEvent(new CustomEvent('pwa-installed'));
});

/**
 * Global function to trigger PWA installation prompt
 */
(window as any).installPWA = async () => {
    if (!deferredPrompt) {
        window.showToast?.('Instalacja jest aktualnie niedostępna lub aplikacja jest już zainstalowana.', 4000);
        return;
    }

    // Show the prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);

    // We've used the prompt, and can't use it again, throw it away
    deferredPrompt = null;
};

document.addEventListener('DOMContentLoaded', () => {
    ColorPreferences.init(); // Apply saved color preferences
    MobileZen.init(); // Apply saved mobile zen mode
    ConnectionMonitor.init(); // Monitor Firebase connection status
    Router.init();
    BackupScheduler.init();
    UXEnhancements.init();

    // Apply seasonal theme if applicable
    import('./seasonal-themes.js')
        .then((module) => {
            module.applySeasonalTheme();
        })
        .catch((err) => console.error('Failed to load seasonal themes', err));

    // PWA Service Worker registration with update prompt
    registerPWA();
});

/**
 * Register the PWA Service Worker and handle updates
 */
function registerPWA(): void {
    const updateSW = registerSW({
        onNeedRefresh() {
            // Show update banner when new version is available
            showUpdateBanner(updateSW);
        },
        onOfflineReady() {
            window.showToast?.('Aplikacja gotowa do pracy offline', 3000);
        },
        onRegisteredSW(swUrl: string, registration: ServiceWorkerRegistration | undefined) {
            // Check for updates periodically (every hour)
            if (registration) {
                setInterval(() => {
                    registration.update();
                }, 60 * 60 * 1000);
            }
            console.log('PWA Service Worker registered:', swUrl);
        },
        onRegisterError(error: Error) {
            console.error('PWA registration error:', error);
        },
    });
}

/**
 * Show a persistent update banner at the top of the page
 */
function showUpdateBanner(updateSW: (reloadPage?: boolean) => Promise<void>): void {
    // Remove existing banner if any
    document.getElementById('pwa-update-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'pwa-update-banner';
    banner.innerHTML = `
        <div class="pwa-update-content">
            <i class="fas fa-arrow-up-from-bracket"></i>
            <span>Nowa wersja aplikacji jest dostępna!</span>
            <button id="pwa-update-btn" class="pwa-update-accept">
                <i class="fas fa-rotate"></i> Aktualizuj
            </button>
            <button id="pwa-update-dismiss" class="pwa-update-dismiss">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;

    document.body.prepend(banner);

    document.getElementById('pwa-update-btn')?.addEventListener('click', () => {
        updateSW(true);
    });

    document.getElementById('pwa-update-dismiss')?.addEventListener('click', () => {
        banner.remove();
    });
}
