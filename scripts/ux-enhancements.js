// scripts/ux-enhancements.js
/**
 * Moduł ulepszeń UX
 * - Skróty klawiszowe
 * - Pasek postępu dnia
 * - Animacje przejść
 */

export const UXEnhancements = (() => {
    let progressBarInterval = null;

    /**
     * Inicjalizuje skróty klawiszowe
     * - Ctrl+Z: Undo
     * - Escape: Anuluj edycję / zamknij modal
     * - Ctrl+S: Zapisz (zapobiega domyślnemu zachowaniu)
     */
    const initKeyboardShortcuts = () => {
        document.addEventListener('keydown', (e) => {
            // Ctrl+Z - Undo
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                const undoBtn = document.getElementById('undoBtn');
                if (undoBtn && !undoBtn.disabled) {
                    e.preventDefault();
                    undoBtn.click();
                    showShortcutFeedback('Cofnięto zmiany (Ctrl+Z)');
                }
            }

            // Escape - Zamknij modal lub anuluj edycję
            if (e.key === 'Escape') {
                // Zamknij modalne okna
                const modals = document.querySelectorAll(
                    '.modal[style*="display: flex"], .modal[style*="display: block"]',
                );
                modals.forEach((modal) => {
                    const closeBtn = modal.querySelector('.close-btn, .cancel-btn, [data-dismiss="modal"]');
                    if (closeBtn) closeBtn.click();
                });

                // Anuluj edycję komórki
                const editingCell = document.querySelector('td.editing, td[contenteditable="true"]');
                if (editingCell) {
                    editingCell.blur();
                }
            }

            // Ctrl+S - Zapobiegaj zapisowi strony
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                showShortcutFeedback('Dane są zapisywane automatycznie');
            }

            // Ctrl+F - Focus na wyszukiwarkę
            if (e.ctrlKey && e.key === 'f') {
                const searchInput = document.getElementById('searchInput');
                if (searchInput) {
                    e.preventDefault();
                    searchInput.focus();
                    showShortcutFeedback('Szukaj (Ctrl+F)');
                }
            }
        });

        console.log('UXEnhancements: Skróty klawiszowe zainicjowane');
    };

    /**
     * Pokazuje feedback dla skrótu klawiszowego
     */
    const showShortcutFeedback = (message) => {
        if (typeof window.showToast === 'function') {
            window.showToast(message, 1500);
        }
    };

    /**
     * Tworzy i aktualizuje pasek postępu dnia
     * Pokazuje aktualną pozycję dnia roboczego (7:00 - 18:00)
     */
    const initDayProgressBar = () => {
        // Sprawdź czy jesteśmy na stronie harmonogramu
        const tableContainer = document.querySelector('.table-container');
        if (!tableContainer) return;

        // Utwórz pasek postępu
        let progressBar = document.getElementById('dayProgressBar');
        if (!progressBar) {
            progressBar = document.createElement('div');
            progressBar.id = 'dayProgressBar';
            progressBar.className = 'day-progress-bar';
            progressBar.innerHTML = `
                <div class="day-progress-track">
                    <div class="day-progress-fill"></div>
                    <div class="day-progress-marker"></div>
                </div>
                <span class="day-progress-time"></span>
            `;

            // Wstaw przed tabelą
            const scheduleTable = document.querySelector('.schedule-table');
            if (scheduleTable) {
                scheduleTable.parentNode.insertBefore(progressBar, scheduleTable);
            }
        }

        updateDayProgress();

        // Aktualizuj co minutę
        if (progressBarInterval) clearInterval(progressBarInterval);
        progressBarInterval = setInterval(updateDayProgress, 60000);
    };

    /**
     * Aktualizuje pozycję paska postępu
     */
    const updateDayProgress = () => {
        const progressFill = document.querySelector('.day-progress-fill');
        const progressMarker = document.querySelector('.day-progress-marker');
        const progressTime = document.querySelector('.day-progress-time');

        if (!progressFill || !progressMarker || !progressTime) return;

        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        // Godziny pracy: 7:00 - 18:00 (11 godzin)
        const startHour = 7;
        const endHour = 18;
        const totalMinutes = (endHour - startHour) * 60;

        // Oblicz postęp
        const minutesSinceStart = (currentHour - startHour) * 60 + currentMinute;
        let progress = (minutesSinceStart / totalMinutes) * 100;

        // Ogranicz do 0-100%
        progress = Math.max(0, Math.min(100, progress));

        // Aktualizuj UI
        progressFill.style.width = `${progress}%`;
        progressMarker.style.left = `${progress}%`;
        progressTime.textContent = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

        // Pokaż/ukryj w zależności od czasu
        const progressBar = document.getElementById('dayProgressBar');
        if (progressBar) {
            if (currentHour < startHour || currentHour >= endHour) {
                progressBar.classList.add('outside-hours');
            } else {
                progressBar.classList.remove('outside-hours');
            }
        }

        // Podświetl aktualny wiersz w tabeli
        highlightCurrentTimeRow(currentHour, currentMinute);
    };

    /**
     * Podświetla aktualny wiersz czasowy w tabeli
     */
    const highlightCurrentTimeRow = (hour, minute) => {
        // Usuń poprzednie podświetlenie
        document.querySelectorAll('.schedule-table tr.current-time-row').forEach((row) => {
            row.classList.remove('current-time-row');
        });

        // Znajdź odpowiedni wiersz
        const timeSlots = document.querySelectorAll('.schedule-table tbody tr');
        timeSlots.forEach((row) => {
            const timeCell = row.querySelector('td:first-child');
            if (timeCell) {
                const cellTime = timeCell.textContent.trim();
                const [cellHour, cellMinute] = cellTime.split(':').map(Number);

                // Podświetl jeśli aktualny czas mieści się w tym slocie (30-minutowe sloty)
                if (cellHour === hour && minute >= cellMinute && minute < cellMinute + 30) {
                    row.classList.add('current-time-row');
                }
            }
        });
    };

    /**
     * Dodaje animacje przejść do strony
     */
    const initPageTransitions = () => {
        // Dodaj klasę animacji do kontenera strony
        const pageContent = document.getElementById('page-content');
        if (pageContent) {
            pageContent.classList.add('page-transition');
        }

        // Obserwuj zmiany w kontenerze strony
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Dodaj animację wejścia
                    pageContent.classList.add('page-enter');
                    requestAnimationFrame(() => {
                        pageContent.classList.add('page-enter-active');
                    });

                    // Usuń klasy po animacji
                    setTimeout(() => {
                        pageContent.classList.remove('page-enter', 'page-enter-active');
                    }, 300);
                }
            });
        });

        if (pageContent) {
            observer.observe(pageContent, { childList: true });
        }

        console.log('UXEnhancements: Animacje przejść zainicjowane');
    };

    /**
     * Inicjalizacja wszystkich ulepszeń
     */
    const init = () => {
        initKeyboardShortcuts();
        initPageTransitions();
        console.log('UXEnhancements: Moduł zainicjowany');
    };

    /**
     * Inicjalizacja ulepszeń specyficznych dla harmonogramu
     * (wywoływane po załadowaniu strony schedule)
     */
    const initScheduleEnhancements = () => {
        initDayProgressBar();
    };

    /**
     * Czyszczenie przy zmianie strony
     */
    const destroy = () => {
        if (progressBarInterval) {
            clearInterval(progressBarInterval);
            progressBarInterval = null;
        }
    };

    return {
        init,
        initScheduleEnhancements,
        destroy,
        updateDayProgress,
    };
})();

// Eksportuj do window dla kompatybilności
if (typeof window !== 'undefined') {
    window.UXEnhancements = UXEnhancements;
}
