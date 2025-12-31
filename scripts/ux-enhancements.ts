// scripts/ux-enhancements.ts
import { debugLog } from './common.js';

/**
 * Moduł ulepszeń UX
 * - Skróty klawiszowe
 * - Pasek postępu dnia
 * - Animacje przejść
 */

/**
 * Interfejs publicznego API UXEnhancements
 */
interface UXEnhancementsAPI {
    init(): void;
    initScheduleEnhancements(): void;
    destroy(): void;
    updateDayProgress(): void;
}

export const UXEnhancements: UXEnhancementsAPI = (() => {
    let progressBarInterval: ReturnType<typeof setInterval> | null = null;

    /**
     * Pokazuje feedback dla skrótu klawiszowego
     */
    const showShortcutFeedback = (message: string): void => {
        if (typeof window.showToast === 'function') {
            window.showToast(message, 1500);
        }
    };

    /**
     * Inicjalizuje skróty klawiszowe
     * - Ctrl+Z: Undo
     * - Escape: Anuluj edycję / zamknij modal
     * - Ctrl+S: Zapisz (zapobiega domyślnemu zachowaniu)
     * - Ctrl+F: Focus na wyszukiwarkę
     */
    const initKeyboardShortcuts = (): void => {
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            // Ctrl+Z - Undo
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement | null;
                if (undoBtn && !undoBtn.disabled) {
                    e.preventDefault();
                    undoBtn.click();
                    showShortcutFeedback('Cofnięto zmiany (Ctrl+Z)');
                }
            }

            // Escape - Zamknij modal lub anuluj edycję
            if (e.key === 'Escape') {
                // Zamknij modalne okna
                const modals = document.querySelectorAll<HTMLElement>(
                    '.modal[style*="display: flex"], .modal[style*="display: block"]'
                );
                modals.forEach((modal) => {
                    const closeBtn = modal.querySelector<HTMLElement>('.close-btn, .cancel-btn, [data-dismiss="modal"]');
                    if (closeBtn) closeBtn.click();
                });

                // Anuluj edycję komórki
                const editingCell = document.querySelector<HTMLElement>('td.editing, td[contenteditable="true"]');
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
                const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
                if (searchInput) {
                    e.preventDefault();
                    searchInput.focus();
                    showShortcutFeedback('Szukaj (Ctrl+F)');
                }
            }
        });

        debugLog('UXEnhancements: Skróty klawiszowe zainicjowane');
    };

    /**
     * Tworzy i aktualizuje pasek postępu dnia
     * Pokazuje aktualną pozycję dnia roboczego (7:00 - 18:00)
     */
    const initDayProgressBar = (): void => {
        // Sprawdź czy jest dedykowany kontener
        const progressContainer = document.getElementById('dayProgressContainer');
        if (!progressContainer) return;

        // Utwórz pasek postępu
        let progressBar = document.getElementById('dayProgressBar');
        if (!progressBar) {
            progressBar = document.createElement('div');
            progressBar.id = 'dayProgressBar';
            progressBar.className = 'day-progress-bar';
            progressBar.innerHTML = `
                <div class="day-progress-info">
                    <span class="day-progress-label">
                        <i class="fas fa-clock"></i>
                        Postęp dnia
                    </span>
                    <span class="day-progress-elapsed"></span>
                </div>
                <div class="day-progress-track">
                    <div class="day-progress-fill"></div>
                    <div class="day-progress-marker" title="Aktualny czas"></div>
                </div>
                <div class="day-progress-info day-progress-info-right">
                    <span class="day-progress-time"></span>
                    <span class="day-progress-remaining"></span>
                </div>
            `;

            progressContainer.appendChild(progressBar);
        }

        updateDayProgress();

        // Aktualizuj co minutę
        if (progressBarInterval) clearInterval(progressBarInterval);
        progressBarInterval = setInterval(updateDayProgress, 60000);
    };

    /**
     * Aktualizuje pozycję paska postępu i wszystkie informacje
     */
    const updateDayProgress = (): void => {
        const progressFill = document.querySelector<HTMLElement>('.day-progress-fill');
        const progressMarker = document.querySelector<HTMLElement>('.day-progress-marker');
        const progressTime = document.querySelector<HTMLElement>('.day-progress-time');
        const progressElapsed = document.querySelector<HTMLElement>('.day-progress-elapsed');
        const progressRemaining = document.querySelector<HTMLElement>('.day-progress-remaining');

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

        // Oblicz pozostały czas
        const minutesRemaining = totalMinutes - minutesSinceStart;
        const hoursRemaining = Math.floor(Math.max(0, minutesRemaining) / 60);
        const minsRemaining = Math.max(0, minutesRemaining) % 60;

        // Oblicz minięty czas
        const hoursElapsed = Math.floor(Math.max(0, minutesSinceStart) / 60);
        const minsElapsed = Math.max(0, minutesSinceStart) % 60;

        // Aktualizuj UI
        progressFill.style.width = `${progress}%`;
        progressMarker.style.left = `${progress}%`;
        progressTime.textContent = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

        // Tooltip na wskaźniku
        if (currentHour >= startHour && currentHour < endHour) {
            progressMarker.setAttribute(
                'title',
                `Do końca zmiany: ${hoursRemaining}h ${minsRemaining}min\nMinęło: ${hoursElapsed}h ${minsElapsed}min`
            );
        } else if (currentHour < startHour) {
            const minsToStart = (startHour - currentHour) * 60 - currentMinute;
            const hToStart = Math.floor(minsToStart / 60);
            const mToStart = minsToStart % 60;
            progressMarker.setAttribute('title', `Do rozpoczęcia: ${hToStart}h ${mToStart}min`);
        } else {
            progressMarker.setAttribute('title', 'Zmiana zakończona');
        }

        // Minięty czas
        if (progressElapsed) {
            if (currentHour >= startHour && currentHour < endHour) {
                progressElapsed.innerHTML = `<small>Minęło: ${hoursElapsed}h ${minsElapsed}min</small>`;
            } else if (currentHour < startHour) {
                progressElapsed.innerHTML = `<small>Przed rozpoczęciem</small>`;
            } else {
                progressElapsed.innerHTML = `<small>Zmiana zakończona</small>`;
            }
        }

        // Pozostały czas
        if (progressRemaining) {
            if (currentHour >= startHour && currentHour < endHour) {
                progressRemaining.innerHTML = `<small>Pozostało: <strong>${hoursRemaining}h ${minsRemaining}min</strong></small>`;
            } else if (currentHour < startHour) {
                const minsToStart = (startHour - currentHour) * 60 - currentMinute;
                const hToStart = Math.floor(minsToStart / 60);
                const mToStart = minsToStart % 60;
                progressRemaining.innerHTML = `<small>Start za: ${hToStart}h ${mToStart}min</small>`;
            } else {
                progressRemaining.innerHTML = `<small>Do jutra 7:00</small>`;
            }
        }

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
    const highlightCurrentTimeRow = (hour: number, minute: number): void => {
        // Usuń poprzednie podświetlenie
        document.querySelectorAll<HTMLTableRowElement>('.schedule-table tr.current-time-row').forEach((row) => {
            row.classList.remove('current-time-row');
        });

        // Znajdź odpowiedni wiersz
        const timeSlots = document.querySelectorAll<HTMLTableRowElement>('.schedule-table tbody tr');
        timeSlots.forEach((row) => {
            const timeCell = row.querySelector<HTMLTableCellElement>('td:first-child');
            if (timeCell && timeCell.textContent) {
                const cellTime = timeCell.textContent.trim();
                const [cellHourStr, cellMinuteStr] = cellTime.split(':');
                const cellHour = parseInt(cellHourStr, 10);
                const cellMinute = parseInt(cellMinuteStr, 10);

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
    const initPageTransitions = (): void => {
        // Dodaj klasę animacji do kontenera strony
        const pageContent = document.getElementById('page-content');
        if (pageContent) {
            pageContent.classList.add('page-transition');
        }

        // Obserwuj zmiany w kontenerze strony
        const observer = new MutationObserver((mutations: MutationRecord[]) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0 && pageContent) {
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

        debugLog('UXEnhancements: Animacje przejść zainicjowane');
    };

    /**
     * Inicjalizacja wszystkich ulepszeń
     */
    const init = (): void => {
        initKeyboardShortcuts();
        initPageTransitions();
        debugLog('UXEnhancements: Moduł zainicjowany');
    };

    /**
     * Inicjalizacja ulepszeń specyficznych dla harmonogramu
     * (wywoływane po załadowaniu strony schedule)
     */
    const initScheduleEnhancements = (): void => {
        initDayProgressBar();
    };

    /**
     * Czyszczenie przy zmianie strony
     */
    const destroy = (): void => {
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

// Backward compatibility - przypisanie do window
declare global {
    interface Window {
        UXEnhancements: UXEnhancementsAPI;
    }
}

if (typeof window !== 'undefined') {
    window.UXEnhancements = UXEnhancements;
}
