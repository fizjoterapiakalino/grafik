const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

let mockLeavesData = {};
let mockLeavesSnapshotCallback = null;
const mockLeavesUnsubscribe = jest.fn();
const mockStationsUnsubscribe = jest.fn();

jest.mock('../scripts/firebase-config.js', () => ({
    auth: {
        currentUser: null,
    },
    db: {
        collection: jest.fn((collectionName) => ({
            doc: jest.fn((docName) => {
                if (collectionName === 'leaves' && docName === 'mainLeaves') {
                    return {
                        get: jest.fn(async () => ({
                            exists: true,
                            data: () => mockLeavesData,
                        })),
                        onSnapshot: jest.fn((cb) => {
                            mockLeavesSnapshotCallback = cb;
                            return mockLeavesUnsubscribe;
                        }),
                    };
                }
                if (collectionName === 'stations') {
                    return {
                        get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
                        onSnapshot: jest.fn(() => mockStationsUnsubscribe),
                    };
                }
                return {
                    get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
                };
            }),
        })),
    },
}));

const mockEmployees = {
    0: { firstName: 'Jan', lastName: 'Kowalski', displayName: 'Jan K.', color: '#14b8a6' },
    1: { firstName: 'Anna', lastName: 'Nowak', displayName: 'Anna N.', color: '#3b82f6' },
    2: { firstName: 'Piotr', lastName: 'Wiśniewski', displayName: 'Piotr W.', color: '#f59e0b' },
};

jest.mock('../scripts/employee-manager.js', () => ({
    EmployeeManager: {
        getAll: jest.fn(() => mockEmployees),
        getById: jest.fn((id) => mockEmployees[id] || null),
        getFullNameById: jest.fn((id) => {
            const emp = mockEmployees[id];
            return emp ? `${emp.firstName} ${emp.lastName}` : `Pracownik ${id}`;
        }),
        isUserAdmin: jest.fn(() => true),
        getEmployeeByUid: jest.fn(() => null),
    },
}));

import { ScheduleUI } from '../scripts/schedule-ui.js';

const buildScheduleDom = () => {
    document.body.innerHTML = `
        <div class="table-container">
            <table id="mainScheduleTable" class="schedule-table">
                <thead>
                    <tr id="tableHeaderRow"><th>Godzina</th></tr>
                </thead>
                <tbody></tbody>
            </table>
            <div id="upcomingLeavesBar" class="upcoming-leaves-bar" role="region" aria-label="Nadchodzące zaplanowane urlopy">
                <div class="upcoming-leaves-label">
                    <i class="fas fa-umbrella-beach" aria-hidden="true"></i>
                    <span class="upcoming-leaves-label-text">Nadchodzące urlopy:</span>
                </div>
                <div id="upcomingLeavesViewport" class="upcoming-leaves-viewport">
                    <div id="upcomingLeavesTrack" class="upcoming-leaves-track"></div>
                </div>
            </div>
            <div class="schedule-footer-bar">
                <div id="dayProgressContainer"></div>
                <div id="patientCount" class="patient-count-badge"></div>
            </div>
        </div>
    `;
};

const formatOffsetIsoDate = (daysOffset) => {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

describe('ScheduleUI Upcoming Leaves Bar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockLeavesData = {};
        mockLeavesSnapshotCallback = null;
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
        buildScheduleDom();
    });

    afterEach(() => {
        ScheduleUI.destroy();
    });

    test('renders empty state when there are no upcoming leaves', async () => {
        mockLeavesData = {
            'Jan K.': [
                { id: '1', type: 'vacation', startDate: formatOffsetIsoDate(-10), endDate: formatOffsetIsoDate(-3) },
            ],
        };

        ScheduleUI.initialize({ scheduleCells: {} });
        await flushPromises();

        const bar = document.getElementById('upcomingLeavesBar');
        const track = document.getElementById('upcomingLeavesTrack');
        expect(track.textContent).toContain('Brak nadchodzących zaplanowanych urlopów');
        expect(bar.classList.contains('is-scrolling')).toBe(false);
    });

    test('renders upcoming leaves statically when content fits within bar width', async () => {
        const futureStart = formatOffsetIsoDate(3);
        const futureEnd = formatOffsetIsoDate(7);
        mockLeavesData = {
            'Jan K.': [{ id: '1', type: 'vacation', startDate: futureStart, endDate: futureEnd }],
        };

        ScheduleUI.initialize({ scheduleCells: {} });
        await flushPromises();

        const viewport = document.getElementById('upcomingLeavesViewport');
        const primaryGroup = document.querySelector('#upcomingLeavesTrack .upcoming-leaves-group');
        Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 800 });
        Object.defineProperty(primaryGroup, 'scrollWidth', { configurable: true, value: 240 });

        ScheduleUI.syncUpcomingLeavesMarquee();

        const bar = document.getElementById('upcomingLeavesBar');
        const chips = bar.querySelectorAll('.upcoming-leave-chip');
        expect(chips).toHaveLength(1);
        expect(chips[0].querySelector('.upcoming-leave-surname').textContent).toBe('Kowalski');
        expect(bar.classList.contains('is-scrolling')).toBe(false);
        expect(bar.querySelectorAll('.upcoming-leaves-group-clone')).toHaveLength(0);
    });

    test('enables looping right-to-left scroll when leaves overflow bar width and disables it when resized wider', async () => {
        mockLeavesData = {
            'Jan K.': [{ id: '1', type: 'child_care_art_188', startDate: formatOffsetIsoDate(-1), endDate: formatOffsetIsoDate(2) }],
            'Anna N.': [{ id: '2', type: 'vacation', startDate: formatOffsetIsoDate(4), endDate: formatOffsetIsoDate(8) }],
            'Piotr W.': [{ id: '3', type: 'schedule_pickup', startDate: formatOffsetIsoDate(10), endDate: formatOffsetIsoDate(12) }],
        };

        ScheduleUI.initialize({ scheduleCells: {} });
        await flushPromises();

        const bar = document.getElementById('upcomingLeavesBar');
        const viewport = document.getElementById('upcomingLeavesViewport');
        const track = document.getElementById('upcomingLeavesTrack');
        const primaryGroup = track.querySelector('.upcoming-leaves-group');

        let viewportWidth = 420;
        Object.defineProperty(viewport, 'clientWidth', { configurable: true, get: () => viewportWidth });
        Object.defineProperty(primaryGroup, 'scrollWidth', { configurable: true, value: 760 });

        ScheduleUI.syncUpcomingLeavesMarquee();

        expect(bar.classList.contains('is-scrolling')).toBe(true);
        const clones = track.querySelectorAll('.upcoming-leaves-group-clone');
        expect(clones).toHaveLength(1);
        expect(clones[0].getAttribute('aria-hidden')).toBe('true');
        expect(track.style.getPropertyValue('--upcoming-leaves-duration')).toMatch(/s$/);

        // First chip should show ongoing indicator while keeping leave/care type color dot
        const chips = primaryGroup.querySelectorAll('.upcoming-leave-chip');
        expect(chips[0].classList.contains('is-ongoing')).toBe(true);
        expect(chips[0].querySelector('.upcoming-leave-status').textContent).toBe('Trwa');
        expect(chips[0].querySelector('.upcoming-leave-dot').style.backgroundColor).toBe('rgb(243, 156, 18)');
        expect(chips[1].querySelector('.upcoming-leave-dot').style.backgroundColor).toBe('rgb(52, 152, 219)');
        expect(chips[2].querySelector('.upcoming-leave-dot').style.backgroundColor).toBe('rgb(26, 188, 156)');

        // Resize wider so all items fit cleanly
        viewportWidth = 1000;
        ScheduleUI.syncUpcomingLeavesMarquee();

        expect(bar.classList.contains('is-scrolling')).toBe(false);
        expect(track.querySelectorAll('.upcoming-leaves-group-clone')).toHaveLength(0);
        expect(track.style.getPropertyValue('--upcoming-leaves-duration')).toBe('');
    });

    test('updates bar on live Firestore snapshot changes and cleans up listeners on destroy', async () => {
        ScheduleUI.initialize({ scheduleCells: {} });
        await flushPromises();

        expect(typeof mockLeavesSnapshotCallback).toBe('function');

        mockLeavesSnapshotCallback({
            exists: true,
            data: () => ({
                'Anna N.': [{ id: '9', type: 'vacation', startDate: formatOffsetIsoDate(5), endDate: formatOffsetIsoDate(9) }],
            }),
        });

        const surnames = Array.from(document.querySelectorAll('.upcoming-leave-surname')).map((el) => el.textContent);
        expect(surnames).toEqual(['Nowak']);

        ScheduleUI.destroy();
        expect(mockLeavesUnsubscribe).toHaveBeenCalledTimes(1);
        expect(mockStationsUnsubscribe).toHaveBeenCalledTimes(1);
    });
});
