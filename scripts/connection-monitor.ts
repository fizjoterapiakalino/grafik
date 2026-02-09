// scripts/connection-monitor.ts
/**
 * Connection Monitor
 * 
 * Monitoruje stan połączenia z Firebase i zarządza synchronizacją offline.
 * Wyświetla użytkownikowi informacje o stanie połączenia.
 */

import { debugLog } from './common.js';

interface ConnectionState {
    isOnline: boolean;
    lastOnline: Date | null;
    pendingWrites: number;
    syncStatus: 'synced' | 'syncing' | 'offline' | 'error';
}

interface ConnectionMonitorAPI {
    init(): void;
    destroy(): void;
    getState(): ConnectionState;
    isOnline(): boolean;
    onStateChange(callback: (state: ConnectionState) => void): () => void;
}

export const ConnectionMonitor: ConnectionMonitorAPI = (() => {
    let state: ConnectionState = {
        isOnline: navigator.onLine,
        lastOnline: navigator.onLine ? new Date() : null,
        pendingWrites: 0,
        syncStatus: navigator.onLine ? 'synced' : 'offline'
    };

    const listeners: Set<(state: ConnectionState) => void> = new Set();
    let statusIndicator: HTMLElement | null = null;

    const notifyListeners = (): void => {
        listeners.forEach(callback => callback({ ...state }));
    };

    const updateState = (updates: Partial<ConnectionState>): void => {
        state = { ...state, ...updates };
        updateUI();
        notifyListeners();
    };

    const createStatusIndicator = (): void => {
        // Sprawdź czy już istnieje
        if (document.getElementById('connectionStatus')) return;

        statusIndicator = document.createElement('div');
        statusIndicator.id = 'connectionStatus';
        statusIndicator.className = 'connection-status';
        statusIndicator.innerHTML = `
            <span class="connection-icon"></span>
            <span class="connection-text"></span>
        `;
        document.body.appendChild(statusIndicator);

        // Dodaj style jeśli jeszcze nie istnieją
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

        statusIndicator.className = `connection-status ${state.syncStatus}`;

        const messages: Record<ConnectionState['syncStatus'], string> = {
            synced: 'Zsynchronizowano',
            syncing: 'Synchronizacja...',
            offline: 'Tryb offline - zmiany zostaną zapisane lokalnie',
            error: 'Błąd synchronizacji'
        };

        if (textEl) {
            textEl.textContent = messages[state.syncStatus];
        }

        // Pokaż status i ukryj po chwili (chyba że offline)
        if (state.syncStatus === 'offline' || state.syncStatus === 'error') {
            statusIndicator.classList.add('visible');
        } else if (state.syncStatus === 'syncing') {
            statusIndicator.classList.add('visible');
        } else {
            statusIndicator.classList.add('visible');
            setTimeout(() => {
                if (state.syncStatus === 'synced') {
                    statusIndicator?.classList.remove('visible');
                }
            }, 2000);
        }
    };

    const handleOnline = (): void => {
        debugLog('Connection restored - online');
        updateState({
            isOnline: true,
            lastOnline: new Date(),
            syncStatus: 'syncing'
        });

        // Firestore automatycznie zsynchronizuje pending writes
        // Po chwili zmień status na synced
        setTimeout(() => {
            if (state.isOnline) {
                updateState({ syncStatus: 'synced' });
            }
        }, 2000);
    };

    const handleOffline = (): void => {
        debugLog('Connection lost - offline');
        updateState({
            isOnline: false,
            syncStatus: 'offline'
        });
    };

    const setupFirestoreSync = (): void => {
        // Monitor synchronizacji oparty na navigator.onLine jest już włączony.
        // Firestore z włączoną persistencją automatycznie cache'uje dane offline
        // i synchronizuje je po powrocie połączenia.
        // 
        // Opcjonalnie: Można dodać bardziej zaawansowane monitorowanie przy użyciu
        // natywnego API Firestore (db._native) z onSnapshotsInSync(), ale
        // dla większości przypadków użycia navigator.onLine jest wystarczający.
        debugLog('Firestore offline sync is handled by persistence layer');
    };

    const init = (): void => {
        createStatusIndicator();

        // Nasłuchuj zdarzeń online/offline
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Ustaw początkowy stan
        if (navigator.onLine) {
            updateState({ isOnline: true, syncStatus: 'synced' });
        } else {
            handleOffline();
        }

        // Monitoruj synchronizację Firestore
        setupFirestoreSync();

        debugLog('ConnectionMonitor initialized');
    };

    const destroy = (): void => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);

        if (statusIndicator) {
            statusIndicator.remove();
            statusIndicator = null;
        }

        listeners.clear();
        debugLog('ConnectionMonitor destroyed');
    };

    const getState = (): ConnectionState => ({ ...state });

    const isOnline = (): boolean => state.isOnline;

    const onStateChange = (callback: (state: ConnectionState) => void): (() => void) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
    };

    return {
        init,
        destroy,
        getState,
        isOnline,
        onStateChange
    };
})();

// Backward compatibility
declare global {
    interface Window {
        ConnectionMonitor: ConnectionMonitorAPI;
    }
}

window.ConnectionMonitor = ConnectionMonitor;
