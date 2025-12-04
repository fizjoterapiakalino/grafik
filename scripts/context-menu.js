// scripts/context-menu.js

const contextMenuInstances = {};

export const initializeContextMenu = (menuId, targetSelector, itemConfig) => {
    const contextMenu = document.getElementById(menuId);
    if (!contextMenu) {
        console.error(`Context menu with id "${menuId}" not found.`);
        return;
    }

    let currentTarget = null;

    const handleContextMenu = (event) => {
        const target = event.target.closest(targetSelector);
        if (target) {
            event.preventDefault();
            contextMenu.contextEvent = event;
            currentTarget = target;

            // New: Call onShow for items that have it
            itemConfig.forEach((item) => {
                if (item.onShow) {
                    item.onShow(currentTarget, event);
                }
            });

            itemConfig.forEach((item) => {
                const element = document.getElementById(item.id);
                if (element) {
                    const shouldShow = item.condition ? item.condition(currentTarget) : true;
                    element.style.display = shouldShow ? 'flex' : 'none';
                }
            });

            // Temporarily show to measure
            contextMenu.style.visibility = 'hidden';
            contextMenu.style.display = 'block'; // Ensure it has dimensions
            contextMenu.classList.add('visible'); // Add class if it affects styling/dimensions

            const { clientX: mouseX, clientY: mouseY } = event;
            const { innerWidth: windowWidth, innerHeight: windowHeight } = window;
            const menuWidth = contextMenu.offsetWidth;
            const menuHeight = contextMenu.offsetHeight;

            let x = mouseX;
            let y = mouseY;

            // Prevent going off-screen right
            if (x + menuWidth > windowWidth) {
                x = windowWidth - menuWidth - 10;
            }

            // Prevent going off-screen bottom
            if (y + menuHeight > windowHeight) {
                y = windowHeight - menuHeight - 10;
            }

            // Ensure not negative (top/left)
            if (x < 0) x = 10;
            if (y < 0) y = 10;

            contextMenu.style.left = `${x}px`;
            contextMenu.style.top = `${y}px`;
            contextMenu.style.visibility = 'visible';
            // contextMenu.classList.add('visible'); // Already added above
        }
    };

    const handleClickOutside = (event) => {
        if (!contextMenu.contains(event.target)) {
            contextMenu.classList.remove('visible');
            contextMenu.style.display = 'none'; // Explicitly hide
        }
    };

    const itemClickHandlers = new Map();
    itemConfig.forEach((item) => {
        const element = document.getElementById(item.id);
        if (element) {
            const handler = () => {
                if (currentTarget && item.action) {
                    item.action(currentTarget, contextMenu.contextEvent);
                }
                contextMenu.classList.remove('visible');
                contextMenu.style.display = 'none'; // Explicitly hide
            };
            itemClickHandlers.set(item.id, handler);
            element.addEventListener('click', handler);
        }
    });

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', handleClickOutside);

    // Long Press Support for Mobile
    let longPressTimer;
    const LONG_PRESS_DURATION = 500; // ms

    const handleTouchStart = (event) => {
        const target = event.target.closest(targetSelector);
        if (target) {
            longPressTimer = setTimeout(() => {
                // Create a synthetic contextmenu event
                const contextMenuEvent = new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: event.touches[0].clientX,
                    clientY: event.touches[0].clientY,
                });
                target.dispatchEvent(contextMenuEvent);
            }, LONG_PRESS_DURATION);
        }
    };

    const handleTouchEnd = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
        }
    };

    const handleTouchMove = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
        }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('click', handleClickOutside);

    contextMenuInstances[menuId] = {
        handleContextMenu,
        handleClickOutside,
        itemClickHandlers,
        itemConfig,
    };
};

export const destroyContextMenu = (menuId) => {
    const instance = contextMenuInstances[menuId];
    if (instance) {
        document.removeEventListener('contextmenu', instance.handleContextMenu);
        document.removeEventListener('click', instance.handleClickOutside);
        instance.itemConfig.forEach((item) => {
            const element = document.getElementById(item.id);
            const handler = instance.itemClickHandlers.get(item.id);
            if (element && handler) {
                element.removeEventListener('click', handler);
            }
        });
        delete contextMenuInstances[menuId];
        console.log(`Context menu ${menuId} destroyed.`);
    }
};

// Backward compatibility
window.initializeContextMenu = initializeContextMenu;
window.destroyContextMenu = destroyContextMenu;
