// scripts/stations.ts - PhysioResource Tracker Module
import { db as dbRaw } from './firebase-config.js';

// Type for Firebase db wrapper (compatible with existing codebase)
interface DbWrapper {
    collection(name: string): {
        doc(id: string): {
            get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
            set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>;
            onSnapshot(
                callback: (snapshot: { exists: boolean; data(): Record<string, unknown> | undefined }) => void,
                errorCallback?: (error: Error) => void
            ): () => void;
        };
    };
}

const db = dbRaw as unknown as DbWrapper;

/**
 * Status stanowiska
 */
type StationStatus = 'FREE' | 'OCCUPIED' | 'FINISHED';

/**
 * Typ zabiegu
 */
interface Treatment {
    id: string;
    name: string;
    shortName: string; // Skrócona nazwa do kafelka
    duration: number; // minutes
    limit?: number; // max concurrent uses in room
}

/**
 * Stanowisko
 */
interface Station {
    id: string;
    name: string;
    roomId: string;
    status: StationStatus;
    treatmentId?: string;
    startTime?: number; // timestamp
    duration?: number; // minutes
    excludeTreatments?: string[]; // treatment IDs to hide for this station
}

/**
 * Typ pokoju - simple = jedno kliknięcie start, multi = wybór zabiegu z kafelków
 */
type RoomType = 'simple' | 'multi';

/**
 * Pomieszczenie
 */
interface Room {
    id: string;
    name: string;
    icon: string;
    type: RoomType;
    stations: Station[];
    treatments: Treatment[];
    maxCapacity: number;
    defaultDuration: number; // dla pokojów simple
}

/**
 * Dane stanu z Firebase
 */
interface StationState {
    status: StationStatus;
    treatmentId?: string;
    startTime?: number;
    duration?: number;
}

/**
 * Interfejs publicznego API Stations
 */
interface StationsAPI {
    init(): void;
    destroy(): void;
}

/**
 * Moduł Stanowiska Zabiegowe
 */
export const Stations: StationsAPI = (() => {
    // Configuration - room definitions based on specification
    // Column 1: Simple rooms (Hydro, Magnet, Aquavibron, Sala21)
    // Column 2: Fizyko 18, Fizyko 22
    // Column 3: Sala Gimnastyczna
    const ROOMS_CONFIG: Room[] = [
        {
            id: 'hydro',
            name: 'Hydroterapia',
            icon: 'fa-water',
            type: 'simple',
            maxCapacity: 3,
            defaultDuration: 15,
            stations: [
                { id: 'hydro_1', name: 'Wanna duża', roomId: 'hydro', status: 'FREE' },
                { id: 'hydro_2', name: 'Wanna mała', roomId: 'hydro', status: 'FREE' },
                { id: 'hydro_3', name: 'Wirówka', roomId: 'hydro', status: 'FREE' },
            ],
            treatments: [],
        },
        {
            id: 'magnet',
            name: 'Pole magnetyczne',
            icon: 'fa-magnet',
            type: 'simple',
            maxCapacity: 2,
            defaultDuration: 15,
            stations: [
                { id: 'magnet_1', name: 'Aparat Mały', roomId: 'magnet', status: 'FREE' },
                { id: 'magnet_2', name: 'Aparat Duży', roomId: 'magnet', status: 'FREE' },
            ],
            treatments: [],
        },
        {
            id: 'aquavibron',
            name: 'Aquavibron',
            icon: 'fa-wave-square',
            type: 'simple',
            maxCapacity: 1,
            defaultDuration: 6,
            stations: [
                { id: 'aquavibron_1', name: 'Aquavibron', roomId: 'aquavibron', status: 'FREE' },
            ],
            treatments: [],
        },
        {
            id: 'sala21',
            name: 'Sala 21',
            icon: 'fa-hands',
            type: 'multi',
            maxCapacity: 2,
            defaultDuration: 15,
            stations: [
                { id: 'sala21_1', name: 'Leżanka 1', roomId: 'sala21', status: 'FREE' },
                { id: 'sala21_2', name: 'Leżanka 2', roomId: 'sala21', status: 'FREE' },
            ],
            treatments: [
                { id: 'massage_treatment', name: 'Masaż', shortName: 'Masaż', duration: 15 },
                { id: 'therapy', name: 'Terapia', shortName: 'Terapia', duration: 20 },
                { id: 'prady_sala21', name: 'Prądy', shortName: 'Prądy', duration: 15 },
            ],
        },
        {
            id: 'physio1',
            name: 'Fizyko 18',
            icon: 'fa-bolt',
            type: 'multi',
            maxCapacity: 3,
            defaultDuration: 15,
            stations: [
                { id: 'physio1_1', name: 'Leżanka 1', roomId: 'physio1', status: 'FREE' },
                { id: 'physio1_2', name: 'Leżanka 2', roomId: 'physio1', status: 'FREE' },
                { id: 'physio1_3', name: 'Krzesło', roomId: 'physio1', status: 'FREE' },
            ],
            treatments: [
                { id: 'prady', name: 'Prądy', shortName: 'Prądy', duration: 15, limit: 2 },
                { id: 'ultrasound', name: 'Ultradźwięki', shortName: 'UD', duration: 7.5, limit: 2 },
                { id: 'laser', name: 'Laser', shortName: 'Laser', duration: 7.5, limit: 1 },
                { id: 'sollux', name: 'Sollux', shortName: 'Sollux', duration: 15 },
            ],
        },
        {
            id: 'physio2',
            name: 'Fizyko 22',
            icon: 'fa-bolt',
            type: 'multi',
            maxCapacity: 3,
            defaultDuration: 15,
            stations: [
                { id: 'physio2_1', name: 'Leżanka 1', roomId: 'physio2', status: 'FREE' },
                { id: 'physio2_2', name: 'Leżanka 2', roomId: 'physio2', status: 'FREE' },
                { id: 'physio2_3', name: 'Krzesło', roomId: 'physio2', status: 'FREE' },
            ],
            treatments: [
                { id: 'prady', name: 'Prądy', shortName: 'Prądy', duration: 15, limit: 2 },
                { id: 'ultrasound', name: 'Ultradźwięki', shortName: 'UD', duration: 7.5, limit: 2 },
                { id: 'laser', name: 'Laser', shortName: 'Laser', duration: 7.5, limit: 1 },
                { id: 'sollux', name: 'Sollux', shortName: 'Sollux', duration: 15 },
            ],
        },
        {
            id: 'gym',
            name: 'Sala Gimnastyczna',
            icon: 'fa-dumbbell',
            type: 'multi',
            maxCapacity: 5,
            defaultDuration: 20,
            stations: [
                { id: 'gym_1', name: 'Leżanka 1', roomId: 'gym', status: 'FREE', excludeTreatments: ['gym_odciazenie'] },
                { id: 'gym_2', name: 'Leżanka 2', roomId: 'gym', status: 'FREE', excludeTreatments: ['gym_odciazenie'] },
                { id: 'gym_3', name: 'Leżanka 3', roomId: 'gym', status: 'FREE', excludeTreatments: ['gym_odciazenie'] },
                { id: 'gym_4', name: 'Leżanka 4', roomId: 'gym', status: 'FREE' },
                { id: 'gym_5', name: 'Leżanka 5', roomId: 'gym', status: 'FREE' },
            ],
            treatments: [
                { id: 'gym_therapy', name: 'Terapia', shortName: 'Terapia', duration: 20 },
                { id: 'gym_massage', name: 'Masaż', shortName: 'Masaż', duration: 15 },
                { id: 'gym_odciazenie', name: 'Odciążenie', shortName: 'Odciąż.', duration: 15, limit: 2 },
            ],
        },
    ];

    // State
    let rooms: Room[] = [];
    let stationStates: Map<string, StationState> = new Map();
    let unsubscribe: (() => void) | null = null;
    let timerInterval: number | null = null;
    let soundEnabled = true;

    /**
     * Initialize module
     */
    const init = (): void => {
        console.log('Stations module initializing...');

        // Deep clone configuration
        rooms = JSON.parse(JSON.stringify(ROOMS_CONFIG));

        // Initialize audio
        initAudio();

        // Load sound preference
        const savedSoundPref = localStorage.getItem('stationsSoundEnabled');
        soundEnabled = savedSoundPref !== 'false';

        // Render views
        renderDesktopView();
        renderMobileView();

        // Setup listeners
        setupEventListeners();

        // Subscribe to real-time updates
        subscribeToUpdates();

        // Start timer
        startTimerInterval();

        // Update sound button state
        updateSoundButton();

        console.log('Stations module initialized');
    };

    /**
     * Cleanup module
     */
    const destroy = (): void => {
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }

        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }

        // Remove event listener
        document.removeEventListener('click', handleClick);

        stationStates.clear();
        rooms = [];
    };

    /**
     * Initialize notification audio
     */
    const initAudio = (): void => {
        try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            (window as any).stationsAudioContext = audioContext;
        } catch (e) {
            console.log('Audio not supported');
        }
    };

    /**
     * Play notification sound
     */
    const playNotificationSound = (): void => {
        if (!soundEnabled) return;

        try {
            const audioContext = (window as any).stationsAudioContext;
            if (audioContext) {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.value = 880;
                oscillator.type = 'sine';

                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.5);
            }
        } catch (e) {
            console.log('Could not play sound');
        }
    };

    /**
     * Subscribe to Firebase real-time updates
     */
    const subscribeToUpdates = (): void => {
        const docRef = db.collection('stations').doc('state');

        unsubscribe = docRef.onSnapshot(
            (snapshot: any) => {
                if (snapshot.exists) {
                    const data = snapshot.data();
                    const previousStates = new Map(stationStates);

                    stationStates.clear();

                    for (const [stationId, state] of Object.entries(data)) {
                        if (stationId !== '_lastUpdated') {
                            stationStates.set(stationId, state as StationState);
                        }
                    }

                    // Check for newly finished stations
                    checkForNewlyFinished(previousStates);

                    // Sync local state
                    syncLocalState();

                    // Update UI
                    updateAllStationCards();
                }
            },
            (error: any) => {
                console.error('Error subscribing to stations:', error);
            }
        );
    };

    /**
     * Check for newly finished stations and play sound
     */
    const checkForNewlyFinished = (previousStates: Map<string, StationState>): void => {
        for (const [stationId, state] of stationStates) {
            if (state.status === 'FINISHED') {
                const prevState = previousStates.get(stationId);
                if (!prevState || prevState.status !== 'FINISHED') {
                    playNotificationSound();
                    break;
                }
            }
        }
    };

    /**
     * Sync local state with Firebase data
     */
    const syncLocalState = (): void => {
        for (const room of rooms) {
            for (const station of room.stations) {
                const state = stationStates.get(station.id);
                if (state) {
                    station.status = state.status;
                    station.treatmentId = state.treatmentId;
                    station.startTime = state.startTime;
                    station.duration = state.duration;
                } else {
                    station.status = 'FREE';
                    station.treatmentId = undefined;
                    station.startTime = undefined;
                    station.duration = undefined;
                }
            }
        }
    };

    /**
     * Save station state to Firebase
     */
    const saveStationState = async (station: Station): Promise<void> => {
        try {
            const docRef = db.collection('stations').doc('state');

            const stateData: any = {
                _lastUpdated: Date.now(),
            };

            if (station.status === 'OCCUPIED' || station.status === 'FINISHED') {
                stateData[station.id] = {
                    status: station.status,
                    treatmentId: station.treatmentId,
                    startTime: station.startTime,
                    duration: station.duration,
                };
            } else {
                stateData[station.id] = {
                    status: 'FREE',
                };
            }

            await docRef.set(stateData, { merge: true });
        } catch (error) {
            console.error('Error saving station state:', error);
            window.showToast?.('Błąd zapisu', 3000);
        }
    };

    /**
     * Start treatment on a station (for simple rooms)
     */
    const startSimpleTreatment = async (room: Room, station: Station): Promise<void> => {
        station.status = 'OCCUPIED';
        station.treatmentId = station.id; // Use station ID as treatment ID for simple rooms
        station.startTime = Date.now();
        station.duration = room.defaultDuration;

        await saveStationState(station);

        window.showToast?.(`${station.name} - ${room.defaultDuration} min`, 2000);
        updateAllStationCards();
    };

    /**
     * Start treatment on a station (for multi-treatment rooms)
     */
    const startMultiTreatment = async (_room: Room, station: Station, treatment: Treatment): Promise<void> => {
        station.status = 'OCCUPIED';
        station.treatmentId = treatment.id;
        station.startTime = Date.now();
        station.duration = treatment.duration;

        await saveStationState(station);

        window.showToast?.(`${treatment.name} - ${treatment.duration} min`, 2000);
        updateAllStationCards();
    };

    /**
     * Release a station
     */
    const releaseStation = async (station: Station): Promise<void> => {
        station.status = 'FREE';
        station.treatmentId = undefined;
        station.startTime = undefined;
        station.duration = undefined;

        await saveStationState(station);

        window.showToast?.('Zwolnione', 1500);
        updateAllStationCards();
    };

    /**
     * Get remaining time in seconds
     */
    const getRemainingTime = (station: Station): number => {
        if (!station.startTime || !station.duration) return 0;

        const endTime = station.startTime + (station.duration * 60 * 1000);
        const remaining = Math.max(0, endTime - Date.now());

        return Math.ceil(remaining / 1000);
    };

    /**
     * Format time as MM:SS
     */
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    /**
     * Start timer interval
     */
    const startTimerInterval = (): void => {
        timerInterval = window.setInterval(() => {
            updateTimers();
        }, 1000);
    };

    /**
     * Update all timers
     */
    const updateTimers = (): void => {
        let hasFinishedTransition = false;

        for (const room of rooms) {
            for (const station of room.stations) {
                if (station.status === 'OCCUPIED') {
                    const remaining = getRemainingTime(station);

                    if (remaining <= 0) {
                        station.status = 'FINISHED';
                        hasFinishedTransition = true;
                        saveStationState(station);
                    }

                    updateTimerDisplay(station.id, remaining);
                }
            }
        }

        if (hasFinishedTransition) {
            playNotificationSound();
            updateAllStationCards();
        }
    };

    /**
     * Update timer display for a specific station
     */
    const updateTimerDisplay = (stationId: string, seconds: number): void => {
        const stationCards = document.querySelectorAll(`[data-station-id="${stationId}"]`);
        stationCards.forEach(card => {
            // Update timer text
            const timerEl = card.querySelector('.station-timer');
            if (timerEl) {
                timerEl.textContent = formatTime(seconds);
            }

            // Add/remove ending warning class (last 60 seconds)
            if (seconds > 0 && seconds <= 60) {
                card.classList.add('ending');
            } else {
                card.classList.remove('ending');
            }
        });
    };

    /**
     * Count treatment usage in a room
     */
    const countTreatmentUsage = (room: Room, treatmentId: string): number => {
        return room.stations.filter(s =>
            (s.status === 'OCCUPIED' || s.status === 'FINISHED') &&
            s.treatmentId === treatmentId
        ).length;
    };

    /**
     * Check if treatment is available in room
     */
    const isTreatmentAvailable = (room: Room, treatment: Treatment): boolean => {
        if (!treatment.limit) return true;
        return countTreatmentUsage(room, treatment.id) < treatment.limit;
    };

    /**
     * Count free stations in a room
     */
    const countFreeStations = (room: Room): number => {
        return room.stations.filter(s => s.status === 'FREE').length;
    };

    /**
     * Render desktop grid view
     */
    const renderDesktopView = (): void => {
        const container = document.getElementById('stationsDesktopView');
        if (!container) return;

        container.innerHTML = rooms.map(room => `
            <div class="room-panel" data-room="${room.id}">
                <div class="room-panel-header">
                    <div class="room-panel-title">
                        <i class="fas ${room.icon}"></i>
                        ${room.name}
                    </div>
                    <div class="room-stats">
                        <span class="room-stat" data-room-stats="${room.id}">
                            ${countFreeStations(room)}/${room.stations.length}
                        </span>
                    </div>
                </div>
                <div class="room-panel-body">
                    ${room.stations.map(station => renderStationCard(room, station)).join('')}
                </div>
            </div>
        `).join('');
    };

    /**
     * Render mobile accordion view
     */
    const renderMobileView = (): void => {
        const container = document.getElementById('stationsMobileView');
        if (!container) return;

        container.innerHTML = rooms.map(room => `
            <div class="room-accordion" data-room="${room.id}">
                <div class="room-accordion-header" data-accordion-room="${room.id}">
                    <div class="room-accordion-title">
                        <i class="fas ${room.icon}"></i>
                        ${room.name}
                    </div>
                    <div class="room-accordion-info">
                        <div class="room-accordion-status" data-room-status="${room.id}">
                            ${renderStatusDots(room)}
                        </div>
                        <i class="fas fa-chevron-down room-accordion-arrow"></i>
                    </div>
                </div>
                <div class="room-accordion-body" data-accordion-body="${room.id}">
                    <div class="room-accordion-content">
                        ${room.stations.map(station => renderStationCard(room, station)).join('')}
                    </div>
                </div>
            </div>
        `).join('');
    };

    /**
     * Render status dots for accordion header
     */
    const renderStatusDots = (room: Room): string => {
        return room.stations.map(station => {
            const statusClass = station.status.toLowerCase();
            return `<span class="status-dot ${statusClass}"></span>`;
        }).join('');
    };

    /**
     * Render a station card - different for simple vs multi rooms
     */
    const renderStationCard = (room: Room, station: Station): string => {
        const statusClass = station.status.toLowerCase();
        const remaining = station.status === 'OCCUPIED' ? getRemainingTime(station) : 0;
        const treatment = room.treatments.find(t => t.id === station.treatmentId);

        if (room.type === 'simple') {
            return renderSimpleStationCard(room, station, statusClass, remaining);
        } else {
            return renderMultiStationCard(room, station, statusClass, remaining, treatment);
        }
    };

    /**
     * Render simple station card (single click to start)
     */
    const renderSimpleStationCard = (room: Room, station: Station, statusClass: string, remaining: number): string => {
        let content = '';

        if (station.status === 'FREE') {
            content = `
                <div class="station-simple-content" data-action="start-simple" data-station="${station.id}" data-room="${room.id}">
                    <span class="station-name">${station.name}</span>
                    <span class="station-duration">${room.defaultDuration} min</span>
                </div>
            `;
        } else if (station.status === 'OCCUPIED') {
            content = `
                <div class="station-timer-content">
                    <span class="station-name">${station.name}</span>
                    <span class="station-timer">${formatTime(remaining)}</span>
                </div>
                <button class="station-cancel-btn" data-action="cancel" data-station="${station.id}" data-room="${room.id}">
                    <i class="fas fa-times"></i>
                </button>
            `;
        } else {
            content = `
                <div class="station-finished-content" data-action="release" data-station="${station.id}" data-room="${room.id}">
                    <span class="station-name">${station.name}</span>
                    <span class="station-timer">00:00</span>
                    <span class="station-release-hint">Kliknij aby zwolnić</span>
                </div>
            `;
        }

        return `<div class="station-card station-simple ${statusClass}" data-station-id="${station.id}">${content}</div>`;
    };

    /**
     * Render multi-treatment station card (treatment tiles visible)
     */
    const renderMultiStationCard = (room: Room, station: Station, statusClass: string, remaining: number, treatment?: Treatment): string => {
        if (station.status === 'FREE') {
            // Filter treatments based on station's excludeTreatments
            const availableTreatments = room.treatments.filter(t =>
                !station.excludeTreatments?.includes(t.id)
            );

            // Show station name + treatment tiles
            const treatmentTiles = availableTreatments.map(t => {
                const available = isTreatmentAvailable(room, t);
                const disabledClass = available ? '' : 'disabled';
                const usageInfo = t.limit ? `${countTreatmentUsage(room, t.id)}/${t.limit}` : '';

                return `
                    <button class="treatment-tile ${disabledClass}" 
                            data-action="start-treatment" 
                            data-station="${station.id}" 
                            data-room="${room.id}"
                            data-treatment="${t.id}"
                            ${available ? '' : 'disabled'}>
                        <span class="treatment-tile-name">${t.shortName}</span>
                        <span class="treatment-tile-time">${t.duration}'</span>
                        ${usageInfo ? `<span class="treatment-tile-limit">${usageInfo}</span>` : ''}
                    </button>
                `;
            }).join('');

            return `
                <div class="station-card station-multi ${statusClass}" data-station-id="${station.id}">
                    <div class="station-header">
                        <span class="station-name">${station.name}</span>
                    </div>
                    <div class="treatment-tiles">
                        ${treatmentTiles}
                    </div>
                </div>
            `;
        } else if (station.status === 'OCCUPIED') {
            return `
                <div class="station-card station-multi ${statusClass}" data-station-id="${station.id}">
                    <div class="station-occupied-content">
                        <div class="station-info">
                            <span class="station-name">${station.name}</span>
                            <span class="station-treatment-name">${treatment?.shortName || ''}</span>
                        </div>
                        <span class="station-timer">${formatTime(remaining)}</span>
                    </div>
                    <button class="station-cancel-btn" data-action="cancel" data-station="${station.id}" data-room="${room.id}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        } else {
            // FINISHED
            return `
                <div class="station-card station-multi ${statusClass}" data-station-id="${station.id}" 
                     data-action="release" data-station="${station.id}" data-room="${room.id}">
                    <div class="station-finished-content">
                        <div class="station-info">
                            <span class="station-name">${station.name}</span>
                            <span class="station-treatment-name">${treatment?.shortName || ''}</span>
                        </div>
                        <span class="station-timer">00:00</span>
                    </div>
                    <span class="station-release-hint">Kliknij aby zwolnić</span>
                </div>
            `;
        }
    };

    /**
     * Update all station cards
     */
    const updateAllStationCards = (): void => {
        for (const room of rooms) {
            for (const station of room.stations) {
                updateStationCard(room, station);
            }

            // Update room stats
            const statsEl = document.querySelector(`[data-room-stats="${room.id}"]`);
            if (statsEl) {
                statsEl.textContent = `${countFreeStations(room)}/${room.stations.length}`;
            }

            // Update status dots
            const statusDotsEl = document.querySelector(`[data-room-status="${room.id}"]`);
            if (statusDotsEl) {
                statusDotsEl.innerHTML = renderStatusDots(room);
            }
        }
    };

    /**
     * Update a single station card
     */
    const updateStationCard = (room: Room, station: Station): void => {
        const cards = document.querySelectorAll(`[data-station-id="${station.id}"]`);
        const newCardHtml = renderStationCard(room, station);

        cards.forEach(card => {
            const temp = document.createElement('div');
            temp.innerHTML = newCardHtml;
            const newCard = temp.firstElementChild as HTMLElement;

            if (newCard) {
                card.replaceWith(newCard);
            }
        });
    };

    /**
     * Setup event listeners
     */
    const setupEventListeners = (): void => {
        document.addEventListener('click', handleClick);

        // Sound toggle
        const soundBtn = document.getElementById('toggleSoundBtn');
        soundBtn?.addEventListener('click', toggleSound);
    };

    /**
     * Handle click events
     */
    const handleClick = (e: MouseEvent): void => {
        const target = e.target as HTMLElement;

        // Accordion toggle
        const accordionHeader = target.closest('[data-accordion-room]') as HTMLElement;
        if (accordionHeader && !target.closest('[data-action]')) {
            toggleAccordion(accordionHeader.dataset.accordionRoom || '');
            return;
        }

        // Action buttons/elements
        const actionEl = target.closest('[data-action]') as HTMLElement;
        if (actionEl) {
            e.stopPropagation();
            const action = actionEl.dataset.action;
            const stationId = actionEl.dataset.station;
            const roomId = actionEl.dataset.room;
            const treatmentId = actionEl.dataset.treatment;

            if (action && stationId && roomId) {
                handleAction(action, roomId, stationId, treatmentId);
            }
        }
    };

    /**
     * Handle action
     */
    const handleAction = (action: string, roomId: string, stationId: string, treatmentId?: string): void => {
        const room = rooms.find(r => r.id === roomId);
        const station = room?.stations.find(s => s.id === stationId);

        if (!room || !station) return;

        switch (action) {
            case 'start-simple':
                if (station.status === 'FREE') {
                    startSimpleTreatment(room, station);
                }
                break;
            case 'start-treatment':
                if (station.status === 'FREE' && treatmentId) {
                    const treatment = room.treatments.find(t => t.id === treatmentId);
                    if (treatment && isTreatmentAvailable(room, treatment)) {
                        startMultiTreatment(room, station, treatment);
                    }
                }
                break;
            case 'cancel':
            case 'release':
                releaseStation(station);
                break;
        }
    };

    /**
     * Toggle accordion
     */
    const toggleAccordion = (roomId: string): void => {
        const header = document.querySelector(`[data-accordion-room="${roomId}"]`);
        const body = document.querySelector(`[data-accordion-body="${roomId}"]`);

        if (!header || !body) return;

        const isExpanded = header.classList.contains('expanded');

        // Close all accordions
        document.querySelectorAll('.room-accordion-header').forEach(h => h.classList.remove('expanded'));
        document.querySelectorAll('.room-accordion-body').forEach(b => b.classList.remove('expanded'));

        // Open this one if it wasn't expanded
        if (!isExpanded) {
            header.classList.add('expanded');
            body.classList.add('expanded');
        }
    };

    /**
     * Toggle sound
     */
    const toggleSound = (): void => {
        soundEnabled = !soundEnabled;
        localStorage.setItem('stationsSoundEnabled', String(soundEnabled));
        updateSoundButton();
        window.showToast?.(soundEnabled ? 'Dźwięk włączony' : 'Dźwięk wyłączony', 1500);
    };

    /**
     * Update sound button state
     */
    const updateSoundButton = (): void => {
        const btn = document.getElementById('toggleSoundBtn');
        if (!btn) return;

        if (soundEnabled) {
            btn.classList.remove('muted');
            btn.innerHTML = '<i class="fas fa-volume-up"></i>';
        } else {
            btn.classList.add('muted');
            btn.innerHTML = '<i class="fas fa-volume-mute"></i>';
        }
    };

    return {
        init,
        destroy,
    };
})();

// Backward compatibility
declare global {
    interface Window {
        Stations: StationsAPI;
    }
}

window.Stations = Stations;
