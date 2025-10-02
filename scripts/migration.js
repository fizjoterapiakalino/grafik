const Migration = (() => {

    const runMigration = async () => {
        const sourceDocId = '2025-08-08'; // Dokument źródłowy z danymi
        const targetDocId = 'mainSchedule'; // Dokument docelowy

        const sourceRef = db.collection('schedules').doc(sourceDocId);
        const targetRef = db.collection('schedules').doc(targetDocId);

        try {
            window.showToast('Rozpoczynam migrację danych...', 3000);

            const sourceDoc = await sourceRef.get();

            if (!sourceDoc.exists) {
                console.error(`Dokument źródłowy '${sourceDocId}' nie istnieje!`);
                window.showToast(`Błąd: Dokument źródłowy '${sourceDocId}' nie istnieje!`, 5000);
                return;
            }

            const sourceData = sourceDoc.data();
            const scheduleCellsToMigrate = sourceData.scheduleCells;

            if (!scheduleCellsToMigrate) {
                console.error(`Dokument źródłowy '${sourceDocId}' nie zawiera pola 'scheduleCells'!`);
                window.showToast(`Błąd: Dokument źródłowy '${sourceDocId}' nie zawiera danych do migracji.`, 5000);
                return;
            }

            await targetRef.set({
                scheduleCells: scheduleCellsToMigrate
            }, { merge: true });

            console.log('Migracja zakończona pomyślnie!');
            window.showToast('Dane grafiku zostały pomyślnie przeniesione do mainSchedule!', 5000);

        } catch (error) {
            console.error('Wystąpił błąd podczas migracji:', error);
            window.showToast('Błąd krytyczny podczas migracji. Sprawdź konsolę.', 5000);
        }
    };

    const init = () => {
        const migrateButton = document.getElementById('runMigrationButton');
        if (migrateButton) {
            migrateButton.addEventListener('click', runMigration);
        } else {
            console.warn('Przycisk migracji nie został znaleziony.');
        }
    };

    return {
        init
    };

})();
