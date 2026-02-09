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
import { ColorPreferences } from './color-preferences.js';

document.addEventListener('DOMContentLoaded', () => {
    ColorPreferences.init(); // Apply saved color preferences
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
});
