// scripts/main.js
import { Router } from './router.js';
import './firebase-config.js'; // Ensure Firebase is initialized
import './common.js';
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

document.addEventListener('DOMContentLoaded', () => {
    Router.init();
});
