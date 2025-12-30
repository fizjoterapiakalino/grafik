import { BackupService } from './backup-service.js';

export const BackupScheduler = (() => {
    let intervalId = null;

    const checkAndRunBackup = async () => {
        const now = new Date();
        const day = now.getDay(); // 0 (Sun) - 6 (Sat)
        const hour = now.getHours();
        const minute = now.getMinutes();

        // Poniedziałek (1) do Piątku (5), godzina 17:30
        if (day >= 1 && day <= 5 && hour === 17 && minute === 30) {
            // Sprawdź, czy backup już został wykonany dzisiaj (aby uniknąć duplikatów w ciągu jednej minuty)
            // Możemy sprawdzić datę ostatniego backupu
            const lastBackupDate = await BackupService.getLastBackupDate();

            if (lastBackupDate) {
                const lastBackupDay = lastBackupDate.getDate();
                const lastBackupMonth = lastBackupDate.getMonth();
                const lastBackupYear = lastBackupDate.getFullYear();

                // Jeśli backup z dzisiaj już istnieje, pomiń
                if (lastBackupDay === now.getDate() &&
                    lastBackupMonth === now.getMonth() &&
                    lastBackupYear === now.getFullYear()) {
                    console.log('Automatyczny backup na dzisiaj już został wykonany.');
                    return;
                }
            }

            console.log('Rozpoczynanie automatycznego backupu...');
            await BackupService.performBackup(true); // true = silent mode
        }
    };

    const init = () => {
        // Sprawdź co 60 sekund
        intervalId = setInterval(checkAndRunBackup, 60000);
        console.log('BackupScheduler: Zainicjowano sprawdzanie harmonogramu kopii zapasowej.');

        // Opcjonalnie sprawdź natychmiast po uruchomieniu (mało prawdopodobne że trafimy co do sekundy, ale warto dla debuga)
        checkAndRunBackup();
    };

    const stop = () => {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
    };

    return {
        init,
        stop
    };
})();
