const Schedule = (() => {
    let appState = {
        scheduleCells: {}
    };
    let undoManager;
    let loadingOverlay;
    let undoButton;
    let unsubscribeSchedule;
    let isSaving = false;
    let saveQueue = null;
    let currentUserId = null; // Dodana zmienna do przechowywania UID aktualnego użytkownika

    // Funkcja do pobierania referencji do dokumentu grafiku (zawsze mainSchedule)
    const getScheduleDocRef = () => {
        return db.collection(AppConfig.firestore.collections.schedules).doc(AppConfig.firestore.docs.mainSchedule);
    };

    const listenForScheduleChanges = () => {
        if (unsubscribeSchedule) {
            unsubscribeSchedule(); // Anuluj poprzednią subskrypcję, jeśli istnieje
        }

        const docRef = getScheduleDocRef(); // Zawsze odwołuj się do mainSchedule
        unsubscribeSchedule = docRef.onSnapshot(
            (doc) => {
                console.log("listenForScheduleChanges: Snapshot received.");
                if (doc.exists) {
                    console.log("listenForScheduleChanges: Document data:", doc.data());
                    const savedData = doc.data();
                    if (savedData.scheduleCells && Object.keys(savedData.scheduleCells).length > 0) {
                        appState.scheduleCells = savedData.scheduleCells;
                        console.log("listenForScheduleChanges: appState.scheduleCells updated with data:", appState.scheduleCells);
                    } else {
                        appState.scheduleCells = {}; // Upewnij się, że jest puste
                        console.warn("listenForScheduleChanges: Document 'mainSchedule' exists, but its 'scheduleCells' field is either missing or empty. The table will be empty.");
                    }
                    ScheduleUI.render();
                } else {
                    console.log(`No main schedule found, creating a new one.`);
                    // Jeśli główny dokument nie istnieje, zainicjuj pusty grafik i zapisz go
                    appState.scheduleCells = {};
                    ScheduleUI.render();
                    saveSchedule(); // Zapisz pusty grafik, aby utworzyć dokument mainSchedule
                }
            },
            (error) => {
                console.error('Error listening to schedule changes:', error);
                window.showToast('Błąd synchronizacji grafiku. Odśwież stronę.', 5000);
            }
        );
    };

    const saveSchedule = async () => {
        if (isSaving) {
            saveQueue = { ...appState };
            return;
        }

        isSaving = true;
        window.setSaveStatus('saving');

        try {
            await getScheduleDocRef().set(appState, { merge: true }); // Zawsze zapisuj do mainSchedule
            window.setSaveStatus('saved');
            isSaving = false;

            if (saveQueue) {
                appState = saveQueue;
                saveQueue = null;
                await saveSchedule();
            }
        } catch (error) {
            console.error('Error saving schedule to Firestore:', error);
            window.setSaveStatus('error');
            isSaving = false;
        }
    };

    const renderAndSave = () => {
        ScheduleUI.render();
        saveSchedule();
    };

    const updateCellState = (cell, updateFn) => {
        if (!cell) return;
        undoManager.pushState(getCurrentTableState());
        const time = cell.dataset.time;
        const employeeIndex = cell.dataset.employeeIndex;
        if (!appState.scheduleCells[time]) appState.scheduleCells[time] = {};
        let cellState = appState.scheduleCells[time][employeeIndex] || {};
        
        updateFn(cellState);

        appState.scheduleCells[time][employeeIndex] = cellState;
        
        renderAndSave();
        undoManager.pushState(getCurrentTableState());
    };
    
    const getCurrentTableState = () => JSON.parse(JSON.stringify(appState));

    const init = async () => {
        loadingOverlay = document.getElementById('loadingOverlay');
        undoButton = document.getElementById('undoButton');

        undoManager = new UndoManager({
            maxStates: AppConfig.undoManager.maxStates,
            onUpdate: (manager) => {
                if (undoButton) undoButton.disabled = !manager.canUndo();
            }
        });

        const mainController = {
            exitEditMode(element) {
                if (!element || element.getAttribute('contenteditable') !== 'true') return;
                const newText = capitalizeFirstLetter(element.textContent.trim());
                element.setAttribute('contenteditable', 'false');
                const parentCell = element.closest('td');
                if (!parentCell) return;
                const employeeIndex = parentCell.dataset.employeeIndex;
                const time = parentCell.dataset.time;
                const duplicate = this.findDuplicateEntry(newText, time, employeeIndex);
                const updateSchedule = (isMove = false) => {
                    undoManager.pushState(getCurrentTableState()); // Przenieś pushState na początek, aby objąć całą operację

                    if (!appState.scheduleCells[time]) appState.scheduleCells[time] = {};
                    if (!appState.scheduleCells[time][employeeIndex]) appState.scheduleCells[time][employeeIndex] = {};
                    let cellState = appState.scheduleCells[time][employeeIndex];

                    if (isMove && duplicate) {
                        // Przenieś cały stan z duplikatu do bieżącej komórki
                        const oldCellState = appState.scheduleCells[duplicate.time][duplicate.employeeIndex];
                        cellState = { ...oldCellState }; // Kopiuj stan starej komórki do nowej
                        
                        // Wyczyść starą komórkę
                        appState.scheduleCells[duplicate.time][duplicate.employeeIndex] = {};
                    }

                    // Sprawdź, czy pacjent istnieje GDZIEKOLWIEK w grafiku (po ewentualnym przeniesieniu)
                    const patientExists = this.findDuplicateEntry(newText, null, null);

                    if (newText.includes('/')) {
                        const parts = newText.split('/', 2);
                        cellState = { ...cellState, isSplit: true, content1: parts[0], content2: parts[1] };
                    } else if (cellState.isSplit) {
                        const isFirstDiv = element === parentCell.querySelector('div:first-child');
                        if (isFirstDiv) {
                            cellState.content1 = newText;
                        } else {
                            cellState.content2 = newText;
                        }
                        if (!cellState.content1 && !cellState.content2) {
                            delete cellState.isSplit;
                        }
                    } else {
                        cellState.content = newText;
                    }

                    // Jeśli pacjent nie istnieje i komórka nie ma jeszcze daty, ustaw ją
                    if (!patientExists && !cellState.treatmentStartDate) {
                        const today = new Date();
                        const year = today.getFullYear();
                        const month = String(today.getMonth() + 1).padStart(2, '0');
                        const day = String(today.getDate()).padStart(2, '0');
                        cellState.treatmentStartDate = `${year}-${month}-${day}`;
                    }

                    appState.scheduleCells[time][employeeIndex] = cellState;
                    renderAndSave();
                    undoManager.pushState(getCurrentTableState());
                };
                if (duplicate) {
                    this.showDuplicateConfirmationDialog(duplicate, () => updateSchedule(true), () => updateSchedule(false), () => { ScheduleUI.render(); });
                } else {
                    updateSchedule(false);
                }
            },
            enterEditMode(element, clearContent = false, initialChar = '') {
                if (!element || element.classList.contains('break-cell') || element.getAttribute('contenteditable') === 'true') return;
                if (element.tagName === 'TD' && element.classList.contains('split-cell')) {
                    const firstDiv = element.querySelector('div');
                    if (firstDiv) {
                        this.enterEditMode(firstDiv, clearContent, initialChar);
                    }
                    return;
                }
                const isEditableTarget = (element.tagName === 'TD' && !element.classList.contains('split-cell')) || (element.tagName === 'DIV' && element.parentNode.classList.contains('split-cell'));
                if (!isEditableTarget) return;
                undoManager.pushState(getCurrentTableState());
                const originalValue = ScheduleUI.getElementText(element);
                element.dataset.originalValue = originalValue;
                element.innerHTML = ScheduleUI.getElementText(element);
                element.setAttribute('contenteditable', 'true');
                element.classList.remove('massage-text', 'pnf-text');
                delete element.dataset.isMassage;
                delete element.dataset.isPnf;
                if (clearContent) {
                    element.textContent = initialChar;
                } else if (initialChar) {
                    element.textContent += initialChar;
                }
                element.focus();
                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(element);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            },
            findDuplicateEntry(text, currentTime, currentEmployeeIndex) {
                if (!text) return null;
                const lowerCaseText = text.toLowerCase();
                for (const time in appState.scheduleCells) {
                    for (const employeeIndex in appState.scheduleCells[time]) {
                        if (time === currentTime && employeeIndex === currentEmployeeIndex) {
                            continue;
                        }
                        const cellData = appState.scheduleCells[time][employeeIndex];
                        if (cellData.content?.toLowerCase() === lowerCaseText ||
                            cellData.content1?.toLowerCase() === lowerCaseText ||
                            cellData.content2?.toLowerCase() === lowerCaseText) {
                            return { time, employeeIndex, cellData };
                        }
                    }
                }
                return null;
            },
            showDuplicateConfirmationDialog(duplicateInfo, onMove, onAdd, onCancel) {
                const modal = document.getElementById('duplicateModal');
                const modalText = document.getElementById('duplicateModalText');
                const moveBtn = document.getElementById('moveEntryBtn');
                const addBtn = document.getElementById('addAnywayBtn');
                const cancelBtn = document.getElementById('cancelBtn');
                const employeeName = EmployeeManager.getNameById(duplicateInfo.employeeIndex);
                modalText.innerHTML = `Znaleziono identyczny wpis dla "<b>${employeeName}</b>" o godzinie ${duplicateInfo.time}. Co chcesz zrobić?`;
                modal.style.display = 'block';
                const closeAndCleanup = () => {
                    modal.style.display = 'none';
                    moveBtn.onclick = null;
                    addBtn.onclick = null;
                    cancelBtn.onclick = null;
                };
                moveBtn.onclick = () => { closeAndCleanup(); onMove(); };
                addBtn.onclick = () => { closeAndCleanup(); onAdd(); };
                cancelBtn.onclick = () => {
                    closeAndCleanup();
                    if (onCancel) onCancel();
                };
            },
            getCurrentTableStateForCell(cell) {
                if (cell.tagName === 'TH') {
                    return { content: ScheduleUI.getElementText(cell) };
                }
                if (cell.classList.contains('break-cell')) {
                    return { content: AppConfig.schedule.breakText, isBreak: true };
                }
                if (cell.classList.contains('split-cell')) {
                    const part1 = cell.children[0];
                    const part2 = cell.children[1];
                    return {
                        content1: ScheduleUI.getElementText(part1),
                        content2: ScheduleUI.getElementText(part2),
                        isSplit: true,
                        isMassage1: part1?.dataset.isMassage === 'true',
                        isMassage2: part2?.dataset.isMassage === 'true',
                        isPnf1: part1?.dataset.isPnf === 'true',
                        isPnf2: part2?.dataset.isPnf === 'true'
                    };
                }
                return {
                    content: ScheduleUI.getElementText(cell),
                    isMassage: cell.dataset.isMassage === 'true',
                    isPnf: cell.dataset.isPnf === 'true'
                };
            },
            openPatientInfoModal(element) {
                const patientName = ScheduleUI.getElementText(element);
                if (!patientName) {
                    window.showToast("Brak pacjenta w tej komórce.", 3000);
                    return;
                }

                const modal = document.getElementById('patientInfoModal');
                const patientNameInput = document.getElementById('patientName');
                const startDateInput = document.getElementById('treatmentStartDate');
                const extensionDaysInput = document.getElementById('treatmentExtensionDays');
                const endDateInput = document.getElementById('treatmentEndDate');
                const saveModalBtn = document.getElementById('savePatientInfoModal');
                const closeModalBtn = document.getElementById('closePatientInfoModal');
                const additionalInfoTextarea = document.getElementById('additionalInfo');
                const genderMaleRadio = document.getElementById('genderMale');
                const genderFemaleRadio = document.getElementById('genderFemale');
                const patientGenderIcon = document.getElementById('patientGenderIcon');

                // Definicja funkcji updateGenderIconInModal musi być przed jej użyciem
                const updateGenderIconInModal = (gender) => {
                    patientGenderIcon.className = 'gender-icon';
                    if (gender === 'male') {
                        patientGenderIcon.classList.add('male');
                    } else if (gender === 'female') {
                        patientGenderIcon.classList.add('female');
                    }
                };

                const parentCell = element.closest('td');
                const time = parentCell.dataset.time;
                const employeeIndex = parentCell.dataset.employeeIndex;
                const cellState = appState.scheduleCells[time]?.[employeeIndex] || {};

                const isSplitPart = element.tagName === 'DIV';
                const partIndex = isSplitPart ? (element === parentCell.querySelector('div:first-child') ? 1 : 2) : null;

                patientNameInput.value = patientName;

                let treatmentData = {};
                let currentGender = '';
                let currentAdditionalInfo = '';

                if (isSplitPart) {
                    const dataKey = `treatmentData${partIndex}`;
                    treatmentData = cellState[dataKey] || {};
                    currentGender = treatmentData.gender || '';
                    currentAdditionalInfo = treatmentData.additionalInfo || '';
                } else {
                    treatmentData = {
                        startDate: cellState.treatmentStartDate,
                        extensionDays: cellState.treatmentExtensionDays
                    };
                    currentGender = cellState.gender || '';
                    currentAdditionalInfo = cellState.additionalInfo || '';
                }
                
                startDateInput.value = treatmentData.startDate || '';
                extensionDaysInput.value = treatmentData.extensionDays || 0;
                additionalInfoTextarea.value = currentAdditionalInfo;

                // Ustawienie wybranej płci
                if (currentGender === 'male') {
                    genderMaleRadio.checked = true;
                } else if (currentGender === 'female') {
                    genderFemaleRadio.checked = true;
                } else {
                    genderMaleRadio.checked = false;
                    genderFemaleRadio.checked = false;
                }
                updateGenderIconInModal(currentGender);

                const calculateEndDate = (startDate, extensionDays) => {
                    if (!startDate) return '';
                    let endDate = new Date(startDate);
                    let totalDays = 15 + parseInt(extensionDays || 0, 10);
                    let daysAdded = 0;
                    while (daysAdded < totalDays) {
                        endDate.setDate(endDate.getDate() + 1);
                        const dayOfWeek = endDate.getDay();
                        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                            daysAdded++;
                        }
                    }
                    return endDate.toISOString().split('T')[0];
                };

                const updateEndDate = () => {
                    endDateInput.value = calculateEndDate(startDateInput.value, extensionDaysInput.value);
                };

                updateEndDate();

                const startDateChangeHandler = () => updateEndDate();
                const extensionInputHandler = () => updateEndDate();
                const genderChangeHandler = (event) => updateGenderIconInModal(event.target.value);

                startDateInput.addEventListener('change', startDateChangeHandler);
                extensionDaysInput.addEventListener('input', extensionInputHandler);
                genderMaleRadio.addEventListener('change', genderChangeHandler);
                genderFemaleRadio.addEventListener('change', genderChangeHandler);

                const closeModal = () => {
                    startDateInput.removeEventListener('change', startDateChangeHandler);
                    extensionDaysInput.removeEventListener('input', extensionInputHandler);
                    genderMaleRadio.removeEventListener('change', genderChangeHandler);
                    genderFemaleRadio.removeEventListener('change', genderChangeHandler);
                    modal.style.display = 'none';
                };

                saveModalBtn.onclick = () => {
                    updateCellState(parentCell, state => {
                        const selectedGender = document.querySelector('input[name="patientGender"]:checked')?.value || '';
                        const newTreatmentData = {
                            startDate: startDateInput.value,
                            extensionDays: parseInt(extensionDaysInput.value, 10),
                            endDate: endDateInput.value,
                            gender: selectedGender,
                            additionalInfo: additionalInfoTextarea.value
                        };

                        if (isSplitPart) {
                            const dataKey = `treatmentData${partIndex}`;
                            state[dataKey] = newTreatmentData;
                        } else {
                            state.treatmentStartDate = newTreatmentData.startDate;
                            state.treatmentExtensionDays = newTreatmentData.extensionDays;
                            state.treatmentEndDate = newTreatmentData.endDate;
                            state.gender = newTreatmentData.gender;
                            state.additionalInfo = newTreatmentData.additionalInfo;
                        }
                    });
                    window.showToast("Zapisano daty zabiegów i informacje o pacjencie.");
                    closeModal();
                };

                closeModalBtn.onclick = closeModal;
                modal.onclick = (event) => {
                    if (event.target === modal) {
                        closeModal();
                    }
                };
                modal.style.display = 'flex';
            },
            openEmployeeSelectionModal(cell) {
                console.log("openEmployeeSelectionModal called with cell:", cell);
                // TODO: Implement employee selection modal for schedule
                window.showToast("Funkcja wyboru pracownika nie jest jeszcze zaimplementowana.");
            },
            toggleSpecialStyle(cell, dataAttribute) {
                updateCellState(cell, state => {
                    // Jeśli to jest komórka dzielona, zastosuj styl do obu części
                    if (state.isSplit) {
                        state[`${dataAttribute}1`] = !state[`${dataAttribute}1`];
                        state[`${dataAttribute}2`] = !state[`${dataAttribute}2`];
                    } else {
                        state[dataAttribute] = !state[dataAttribute];
                    }
                    window.showToast('Zmieniono styl');
                });
            },
            mergeSplitCell(cell) {
                const time = cell.dataset.time;
                const employeeIndex = cell.dataset.employeeIndex;
                const cellState = appState.scheduleCells[time]?.[employeeIndex];

                if (!cellState || !cellState.isSplit) {
                    window.showToast('Ta komórka nie jest podzielona.', 3000);
                    return;
                }

                const content1 = cellState.content1 || '';
                const content2 = cellState.content2 || '';

                if (content1.trim() !== '' && content2.trim() !== '') {
                    window.showToast('Jedna z części komórki musi być pusta, aby je scalić.', 3000);
                    return;
                }

                const mergedContent = content1.trim() === '' ? content2 : content1;

                updateCellState(cell, state => {
                    delete state.isSplit;
                    delete state.content1;
                    delete state.content2;
                    state.content = mergedContent;
                    window.showToast('Scalono komórkę.');
                });
            },
            undoLastAction() {
                const prevState = undoManager.undo();
                if (prevState) {
                    appState.scheduleCells = prevState.scheduleCells;
                    renderAndSave();
                }
            }
        };

        if (loadingOverlay) loadingOverlay.style.display = 'flex';
        try {
            await EmployeeManager.load();
            
            ScheduleUI.initialize(appState);
            ScheduleEvents.initialize({
                appState: appState,
                undoManager: undoManager,
                ui: ScheduleUI,
                updateCellState: updateCellState,
                renderAndSave: renderAndSave,
                getCurrentTableState: getCurrentTableState,
                exitEditMode: mainController.exitEditMode.bind(mainController),
                enterEditMode: mainController.enterEditMode.bind(mainController),
                getCurrentTableStateForCell: mainController.getCurrentTableStateForCell.bind(mainController),
                openPatientInfoModal: mainController.openPatientInfoModal.bind(mainController),
                openEmployeeSelectionModal: mainController.openEmployeeSelectionModal.bind(mainController),
                toggleSpecialStyle: mainController.toggleSpecialStyle.bind(mainController),
                mergeSplitCell: mainController.mergeSplitCell.bind(mainController),
                undoLastAction: mainController.undoLastAction.bind(mainController)
            });

            undoManager.initialize(getCurrentTableState());

            // Nasłuchuj zmian stanu uwierzytelnienia Firebase
            firebase.auth().onAuthStateChanged(user => {
                if (user) {
                    currentUserId = user.uid;
                } else {
                    currentUserId = null;
                }
                listenForScheduleChanges(); // Załaduj grafik po ustaleniu UID
            });

        } catch (error) {
            console.error("Błąd inicjalizacji strony harmonogramu:", error);
            window.showToast("Wystąpił krytyczny błąd inicjalizacji. Odśwież stronę.", 5000);
        } finally {
            if (loadingOverlay) hideLoadingOverlay(loadingOverlay);
        }
    };

    const destroy = () => {
        if (typeof ScheduleEvents.destroy === 'function') {
            ScheduleEvents.destroy();
        }
        if (typeof unsubscribeSchedule === 'function') {
            unsubscribeSchedule();
        }
        // Jeśli ScheduleUI też dodaje globalne listenery, dodaj i tu destroy
        console.log("Schedule module destroyed");
    };

    return {
        init,
        destroy // Eksportuj metodę
    };
})();
