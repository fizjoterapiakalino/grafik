import { Shared } from '../scripts/shared.js';

const renderNav = () => {
    document.body.innerHTML = `
        <ul class="main-nav-list">
            <li data-nav-access-key="schedule"><a href="#schedule">Grafik</a></li>
            <li data-nav-access-key="appointments"><a href="#appointments">Planowanie</a></li>
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
});
