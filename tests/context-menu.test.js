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
                    <li id="submenuItem" class="has-submenu">
                        Submenu
                        <ul id="submenu" class="context-submenu">
                            <li id="submenuAction">Action</li>
                        </ul>
                    </li>
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
        target.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 20,
            clientY: 30,
        }));

        const menu = document.getElementById('contextMenu');
        expect(menu.style.display).toBe('block');
        expect(menu.classList.contains('visible')).toBe(true);
        expect(document.getElementById('conditionalItem').style.display).toBe('flex');
        expect(onShow).toHaveBeenCalledWith(target, expect.any(MouseEvent));

        document.querySelector('.disabled-target').dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
        }));

        expect(document.getElementById('conditionalItem').style.display).toBe('none');
    });

    test('runs item action with current target and hides menu after click', () => {
        setupDom();
        const action = jest.fn();

        initializeContextMenu('contextMenu', '.target', [
            { id: 'copyItem', action },
        ]);

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

        initializeContextMenu('contextMenu', '.target', [
            { id: 'copyItem', action: jest.fn() },
        ]);

        document.querySelector('.target').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        document.getElementById('outside').click();

        expect(document.getElementById('contextMenu').style.display).toBe('none');
    });

    test('opens submenu to the left when there is no room on the right edge', () => {
        setupDom();
        Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 320 });
        Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 240 });

        const menu = document.getElementById('contextMenu');
        const submenuItem = document.getElementById('submenuItem');
        const submenu = document.getElementById('submenu');

        Object.defineProperty(menu, 'offsetWidth', { configurable: true, value: 220 });
        Object.defineProperty(menu, 'offsetHeight', { configurable: true, value: 120 });
        submenuItem.getBoundingClientRect = () => ({
            x: 250,
            y: 50,
            left: 250,
            right: 310,
            top: 50,
            bottom: 82,
            width: 60,
            height: 32,
            toJSON: () => ({}),
        });
        submenu.getBoundingClientRect = () => ({
            x: 0,
            y: 0,
            left: 0,
            right: 180,
            top: 0,
            bottom: 100,
            width: 180,
            height: 100,
            toJSON: () => ({}),
        });

        initializeContextMenu('contextMenu', '.target', [
            { id: 'copyItem', action: jest.fn() },
        ]);

        document.querySelector('.target').dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 300,
            clientY: 40,
        }));
        submenuItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

        expect(submenu.classList.contains('open-left')).toBe(true);
    });

    test('keeps the root menu list unclipped so submenu can render outside it', () => {
        setupDom();
        initializeContextMenu('contextMenu', '.target', [
            { id: 'copyItem', action: jest.fn() },
        ]);

        const rootList = document.querySelector('#contextMenu > ul');
        const style = window.getComputedStyle(rootList);

        expect(style.overflowY).not.toBe('auto');
        expect(style.overflow).not.toBe('hidden');
    });
});
