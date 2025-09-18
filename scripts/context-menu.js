document.addEventListener('DOMContentLoaded', () => {
    const contextMenuInstances = {};

    window.initializeContextMenu = (menuId, targetSelector, itemConfig) => {
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

                itemConfig.forEach(item => {
                    const element = document.getElementById(item.id);
                    if (element) {
                        const shouldShow = item.condition ? item.condition(currentTarget) : true;
                        element.style.display = shouldShow ? 'flex' : 'none';
                    }
                });

                const { clientX: mouseX, clientY: mouseY } = event;
                const { innerWidth: windowWidth, innerHeight: windowHeight } = window;
                const menuWidth = contextMenu.offsetWidth;
                const menuHeight = contextMenu.offsetHeight;

                let x = mouseX;
                let y = mouseY;

                if (mouseX + menuWidth > windowWidth) x = windowWidth - menuWidth - 5;
                if (mouseY + menuHeight > windowHeight) y = windowHeight - menuHeight - 5;

                contextMenu.style.left = `${x}px`;
                contextMenu.style.top = `${y}px`;
                contextMenu.classList.add('visible');
            }
        };

        const handleClickOutside = (event) => {
            if (!contextMenu.contains(event.target)) {
                contextMenu.classList.remove('visible');
            }
        };

        const itemClickHandlers = new Map();
        itemConfig.forEach(item => {
            const element = document.getElementById(item.id);
            if (element) {
                const handler = () => {
                    if (currentTarget && item.action) {
                        item.action(currentTarget, contextMenu.contextEvent);
                    }
                    contextMenu.classList.remove('visible');
                };
                itemClickHandlers.set(item.id, handler);
                element.addEventListener('click', handler);
            }
        });

        document.addEventListener('contextmenu', handleContextMenu);
        document.addEventListener('click', handleClickOutside);

        contextMenuInstances[menuId] = {
            handleContextMenu,
            handleClickOutside,
            itemClickHandlers,
            itemConfig
        };
    };

    window.destroyContextMenu = (menuId) => {
        const instance = contextMenuInstances[menuId];
        if (instance) {
            document.removeEventListener('contextmenu', instance.handleContextMenu);
            document.removeEventListener('click', instance.handleClickOutside);
            instance.itemConfig.forEach(item => {
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
});
