// scripts/backup-scheduler.ts
import { debugLog } from './common.js';
import { BackupService } from './backup-service.js';

/**
 * Interfejs publicznego API BackupScheduler
 */
interface BackupSchedulerAPI {
    init(): void;
    stop(): void;
}

/**
 * Scheduler automatycznych kopii zapasowych
 */
export const BackupScheduler: BackupSchedulerAPI = (() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const checkAndRunBackup = async (): Promise<void> => {
        const now = new Date();
        const day = now.getDay(); // 0 (Sun) - 6 (Sat)
        const hour = now.getHours();
        const minute = now.getMinutes();

        // Poniedziałek (1) do Piątku (5), godzina 17:30
        if (day >= 1 && day <= 5 && hour === 17 && minute === 30) {
            const lastBackupDate = await BackupService.getLastBackupDate();

            if (lastBackupDate) {
                const lastBackupDay = lastBackupDate.getDate();
                const lastBackupMonth = lastBackupDate.getMonth();
                const lastBackupYear = lastBackupDate.getFullYear();

                // Jeśli backup z dzisiaj już istnieje, pomiń
                if (
                    lastBackupDay === now.getDate() &&
                    lastBackupMonth === now.getMonth() &&
                    lastBackupYear === now.getFullYear()
                ) {
                    debugLog('Automatyczny backup na dzisiaj już został wykonany.');
                    return;
                }
            }

            debugLog('Rozpoczynanie automatycznego backupu...');
            await BackupService.performBackup(true); // true = silent mode
        }
    };

    const init = (): void => {
        // Sprawdź co 60 sekund
        intervalId = setInterval(checkAndRunBackup, 60000);
        debugLog('BackupScheduler: Zainicjowano sprawdzanie harmonogramu kopii zapasowej.');

        // Sprawdź natychmiast po uruchomieniu
        checkAndRunBackup();
    };

    const stop = (): void => {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
    };

    return {
        init,
        stop,
    };
})();
