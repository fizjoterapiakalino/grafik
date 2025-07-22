document.addEventListener('DOMContentLoaded', function () {
    const mainScheduleTable = document.getElementById('mainScheduleTable');
    const tableHead = mainScheduleTable.querySelector('thead tr');
    const tableBody = mainScheduleTable.querySelector('tbody');

    // --- Funkcje pomocnicze ---
    function toggleLoading(show) {
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) loadingOverlay.style.display = show ? 'flex' : 'none';
    }

    // --- Logika została uproszczona ---
    // Nie ma już nasłuchiwania na zmiany logowania. Ładujemy harmonogram od razu.
    loadSchedule();

    // --- Główna funkcja renderująca tabelę ---
    function renderTable(scheduleData) {
        tableHead.innerHTML = '<th>Godzina</th>';
        tableBody.innerHTML = '';

        const firstRow = scheduleData.length > 0 ? scheduleData[0] : null;
        if (!firstRow || !firstRow.slots) {
            tableHead.innerHTML += `<th>Brak danych w bazie. Stwórz pierwszy wpis w konsoli Firebase.</th>`;
            return;
        }
        
        const therapists = Object.keys(firstRow.slots).sort(); 
        therapists.forEach(therapist => {
            const th = document.createElement('th');
            th.textContent = therapist;
            tableHead.appendChild(th);
        });

        scheduleData.forEach(rowData => {
            if (!rowData.slots) return;

            const row = document.createElement('tr');
            row.dataset.time = rowData.time;

            const timeCell = document.createElement('td');
            timeCell.textContent = rowData.time;
            timeCell.classList.add('time-cell');
            row.appendChild(timeCell);

            therapists.forEach(therapist => {
                const cell = document.createElement('td');
                const slotData = rowData.slots[therapist] || { text: '', type: 'normal' };
                
                cell.textContent = slotData.text;
                cell.className = `slot-cell type-${slotData.type}`;
                cell.dataset.therapist = therapist;

                // Edycja jest teraz włączona DLA KAŻDEGO.
                cell.contentEditable = true;
                cell.addEventListener('blur', (e) => {
                    handleCellUpdate(rowData.time, therapist, e.target.textContent);
                });
                
                row.appendChild(cell);
            });
            tableBody.appendChild(row);
        });
    }

    // --- Komunikacja z Firestore ---
    function loadSchedule() {
        toggleLoading(true);
        db.collection('schedules').orderBy('time').onSnapshot(snapshot => {
            const scheduleData = snapshot.docs
                .map(doc => doc.data())
                .filter(data => data && data.slots); 

            // Przekazujemy dane do renderowania bez informacji o logowaniu
            renderTable(scheduleData);
            toggleLoading(false);
        }, error => {
            console.error("Błąd ładowania harmonogramu: ", error);
            tableBody.innerHTML = `<tr><td colspan="99">Błąd: ${error.message}</td></tr>`;
            toggleLoading(false);
        });
    }

    function handleCellUpdate(time, therapist, newText) {
        const docRef = db.collection('schedules').doc(time);
        const updateKey = `slots.${therapist}.text`;

        docRef.update({
            [updateKey]: newText
        }).catch(error => {
            console.error("Błąd aktualizacji komórki: ", error);
        });
    }
});
