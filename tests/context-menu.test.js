/**
 * @jest-environment jsdom
 */

import { destroyContextMenu, initializeContextMenu } from '../scripts/context-menu.js';

describe('context-menu', () => {
    afterEach(() => {
        destroyContextMenu('contextMenu');
        document.body.innerHTML = '';
    });

    const setupDom = () => {
        document.body.innerHTML = `
            <button class="target" data-enabled="true">Cell</button>
            <button class="target disabled-target" data-enabled="false">Disabled</button>
            <div id="outside">Outside</div>
            <div id="contextMenu" class="context-menu">
                <ul>
                    <li id="copyItem">Copy</li>
                    <li id="conditionalItem">Conditional</li>
                </ul>
            </div>
        `;
    };

    test('shows menu only for matching targets and applies item conditions', () => {
        setupDom();
        const action = jest.fn();
        const onShow = jest.fn();

        initializeContextMenu('contextMenu', '.target', [
            { id: 'copyItem', action, onShow },
            {
                id: 'conditionalItem',
                condition: (target) => target.dataset.enabled === 'true',
                action,
            },
        ]);

        const target = document.querySelector('.target');
        target.dispatchEvent(
            new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 20,
                clientY: 30,
            }),
        );

        const menu = document.getElementById('contextMenu');
        expect(menu.style.display).toBe('block');
        expect(menu.classList.contains('visible')).toBe(true);
        expect(document.getElementById('conditionalItem').style.display).toBe('flex');
        expect(onShow).toHaveBeenCalledWith(target, expect.any(MouseEvent));

        document.querySelector('.disabled-target').dispatchEvent(
            new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
            }),
        );

        expect(document.getElementById('conditionalItem').style.display).toBe('none');
    });

    test('runs item action with current target and hides menu after click', () => {
        setupDom();
        const action = jest.fn();

        initializeContextMenu('contextMenu', '.target', [{ id: 'copyItem', action }]);

        const target = document.querySelector('.target');
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        document.getElementById('copyItem').click();

        const menu = document.getElementById('contextMenu');
        expect(action).toHaveBeenCalledWith(target, expect.any(MouseEvent));
        expect(menu.style.display).toBe('none');
        expect(menu.classList.contains('visible')).toBe(false);
    });

    test('clicking outside hides an open menu', () => {
        setupDom();

        initializeContextMenu('contextMenu', '.target', [{ id: 'copyItem', action: jest.fn() }]);

        document
            .querySelector('.target')
            .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        document.getElementById('outside').click();

        expect(document.getElementById('contextMenu').style.display).toBe('none');
    });
});
