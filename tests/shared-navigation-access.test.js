import { Shared } from '../scripts/shared.js';
import { resolveAllowedNavigationKeys, getDefaultNavigationAccess } from '../scripts/navigation-access.js';

const renderNav = () => {
    document.body.innerHTML = `
        <ul class="main-nav-list">
            <li data-nav-access-key="schedule"><a href="#schedule">Grafik</a></li>
            <li data-nav-access-key="appointments"><a href="#appointments">Planowanie</a></li>
            <li data-nav-access-key="massage-stations"><a href="#massage-stations">Masaż</a></li>
            <li data-nav-access-key="options"><a href="#options">Opcje</a></li>
        </ul>
    `;
};

describe('Shared navigation access', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('respects menuAccess for admin users', () => {
        renderNav();

        Shared.applyNavigationAccess({
            role: 'admin',
            menuAccess: ['schedule', 'options'],
        });

        expect(document.querySelector('[data-nav-access-key="schedule"]').style.display).toBe('');
        expect(document.querySelector('[data-nav-access-key="appointments"]').style.display).toBe('none');
        expect(document.querySelector('[data-nav-access-key="options"]').style.display).toBe('');
    });

    test('keeps default full menu when menuAccess is not configured', () => {
        renderNav();

        Shared.applyNavigationAccess({ role: 'admin' });

        expect(document.querySelector('[data-nav-access-key="appointments"]').style.display).toBe('');
    });

    test('resolveAllowedNavigationKeys handles massage, restricted, and legacy accounts', () => {
        // 1. accessMode: 'massage'
        const massageKeys = resolveAllowedNavigationKeys({
            role: 'user',
            accessMode: 'massage',
            menuAccess: ['schedule', 'stations'], // powinno być nadpisane przez tryb masażu
        });
        expect(massageKeys).toEqual(new Set(['massage-stations', 'options']));

        // 2. Zwykły użytkownik z ograniczonym menuAccess
        const userKeys = resolveAllowedNavigationKeys({
            role: 'user',
            menuAccess: ['schedule', 'leaves'],
        });
        expect(userKeys).toEqual(new Set(['schedule', 'leaves']));
        expect(userKeys.has('options')).toBe(false);

        // 3. Legacy konto (brak menuAccess) - dostaje default + legacy auto-upgrade dla interview
        const legacyKeys = resolveAllowedNavigationKeys({
            role: 'user',
        });
        const defaultKeys = getDefaultNavigationAccess();
        defaultKeys.forEach((key) => {
            expect(legacyKeys.has(key)).toBe(true);
        });
        expect(legacyKeys.has('interview')).toBe(true);

        // 4. null / undefined pracownik
        const nullKeys = resolveAllowedNavigationKeys(null);
        expect(nullKeys.has('schedule')).toBe(true);
    });

    test('applyNavigationAccess hides restricted items for massage accounts', () => {
        renderNav();

        Shared.applyNavigationAccess({
            role: 'user',
            accessMode: 'massage',
        });

        expect(document.querySelector('[data-nav-access-key="schedule"]').style.display).toBe('none');
        expect(document.querySelector('[data-nav-access-key="appointments"]').style.display).toBe('none');
        expect(document.querySelector('[data-nav-access-key="options"]').style.display).toBe('');
    });
});
