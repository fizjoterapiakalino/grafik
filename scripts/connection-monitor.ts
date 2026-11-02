// scripts/connection-monitor.ts
import { debugLog } from './common.js';

type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

interface ConnectionMonitorAPI {
    init(): void;
    destroy(): void;
}

export const ConnectionMonitor: ConnectionMonitorAPI = (() => {
    let syncStatus: SyncStatus = navigator.onLine ? 'synced' : 'offline';
    let statusIndicator: HTMLElement | null = null;

    const createStatusIndicator = (): void => {
        if (document.getElementById('connectionStatus')) return;

        statusIndicator = document.createElement('div');
        statusIndicator.id = 'connectionStatus';
        statusIndicator.className = 'connection-status';
        statusIndicator.innerHTML = '<span class="connection-icon"></span><span class="connection-text"></span>';
        document.body.appendChild(statusIndicator);

        if (!document.getElementById('connectionStatusStyles')) {
            const styles = document.createElement('style');
            styles.id = 'connectionStatusStyles';
            styles.textContent = `
                .connection-status {
                    position: fixed;
                    bottom: 20px;
                    left: 20px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 16px;
                    border-radius: 8px;
                    font-size: 0.85rem;
                    font-weight: 500;
                    z-index: 9999;
                    transition: all 0.3s ease;
                    opacity: 0;
                    transform: translateY(10px);
                    pointer-events: none;
                }
                .connection-status.visible {
                    opacity: 1;
                    transform: translateY(0);
                    pointer-events: auto;
                }
                .connection-status.synced {
                    background: rgba(16, 185, 129, 0.9);
                    color: white;
                    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
                }
                .connection-status.syncing {
                    background: rgba(59, 130, 246, 0.9);
                    color: white;
                    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
                }
                .connection-status.offline {
                    background: rgba(239, 68, 68, 0.9);
                    color: white;
                    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
                }
                .connection-status.error {
                    background: rgba(245, 158, 11, 0.9);
                    color: white;
                    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
                }
                .connection-icon {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: currentColor;
                }
                .connection-status.syncing .connection-icon {
                    animation: pulse 1s infinite;
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.5; transform: scale(0.8); }
                }
            `;
            document.head.appendChild(styles);
        }
    };

    const updateUI = (): void => {
        if (!statusIndicator) return;
        const textEl = statusIndicator.querySelector('.connection-text');
        statusIndicator.className = `connection-status ${syncStatus}`;

        const messages: Record<SyncStatus, string> = {
            synced: 'Zsynchronizowano',
            syncing: 'Synchronizacja...',
            offline: 'Tryb offline - zmiany zostaną zapisane lokalnie',
            error: 'Błąd synchronizacji',
        };

        if (textEl) {
            textEl.textContent = messages[syncStatus];
        }

        statusIndicator.classList.add('visible');
        if (syncStatus === 'synced') {
            setTimeout(() => {
                if (syncStatus === 'synced') {
                    statusIndicator?.classList.remove('visible');
                }
            }, 2000);
        }
    };

    const handleOnline = (): void => {
        debugLog('Connection restored - online');
        syncStatus = 'syncing';
        updateUI();
        setTimeout(() => {
            if (navigator.onLine) {
                syncStatus = 'synced';
                updateUI();
            }
        }, 2000);
    };

    const handleOffline = (): void => {
        debugLog('Connection lost - offline');
        syncStatus = 'offline';
        updateUI();
    };

    const init = (): void => {
        createStatusIndicator();
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        if (navigator.onLine) {
            syncStatus = 'synced';
            updateUI();
        } else {
            handleOffline();
        }
        debugLog('ConnectionMonitor initialized');
    };

    const destroy = (): void => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        if (statusIndicator) {
            statusIndicator.remove();
            statusIndicator = null;
        }
    };

    return { init, destroy };
})();
