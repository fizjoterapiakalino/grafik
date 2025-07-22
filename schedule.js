document.addEventListener('DOMContentLoaded', function () {
    const mainScheduleTable = document.getElementById('mainScheduleTable');
    const tableHead = mainScheduleTable.querySelector('thead tr');
    const tableBody = mainScheduleTable.querySelector('tbody');
    const loadingOverlay = document.getElementById('loadingOverlay');

    let therapists = []; // Globalna lista terapeutów

    function toggleLoading(show) {
        if (loadingOverlay) loadingOverlay.style.display = show ? 'flex' : 'none';
    }

    firebase.auth().onAuthStateChanged(user => {
        loadSchedule(!!user);
    });

    function renderTable(scheduleData, isUserLoggedIn) {
        // 1. Czyszczenie tabeli
        tableHead.innerHTML = '<th>Godzina</th>';
        tableBody.innerHTML = '';

        // 2. Wyciągnięcie terapeutów z pierwszego prawidłowego rekordu
        const firstRow = scheduleData.length > 0 ? scheduleData[0] : null;
        if (!firstRow || !firstRow.slots) { // Dodatkowy, bezpieczny warunek
            tableHead.innerHTML += '<th>Brak prawidłowych danych w bazie. Uruchom init-db.html.</th>';
            return;
        }
        
        therapists = Object.keys(firstRow.slots).sort();
        therapists.forEach(therapist => {
            const th = document.createElement('th');
            th.textContent = therapist;
            tableHead.appendChild(th);
        });

        // 3. Renderowanie wierszy z danymi
        scheduleData.forEach(rowData => {
            // Upewnij się, że ten wiersz również ma dane w prawidłowym formacie
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

                if (isUserLoggedIn) {
                    cell.contentEditable = true;
                    cell.addEventListener('blur', (e) => {
                        handleCellUpdate(rowData.time, therapist, e.target.textContent);
                    });
                }
                row.appendChild(cell);
            });
            tableBody.appendChild(row);
        });
    }

    function loadSchedule(isUserLoggedIn) {
        toggleLoading(true);
        db.collection('schedules').orderBy('time').onSnapshot(snapshot => {
            // FILTRUJEMY DANE: Bierzemy tylko te dokumenty, które mają pole 'slots'
            const scheduleData = snapshot.docs
                .map(doc => doc.data())
                .filter(data => data.slots); 

            renderTable(scheduleData, isUserLoggedIn);
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

        docRef.update({ [updateKey]: newText })
            .catch(error => {
                console.error("Błąd aktualizacji komórki: ", error);
            });
    }
});
