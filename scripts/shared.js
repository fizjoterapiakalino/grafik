document.addEventListener('DOMContentLoaded', () => {
    const dateTimeText = document.getElementById('dateTimeText');
    const appHeader = document.getElementById('appHeader');

    // Function to update the date and time in the header
    const updateDateTimeHeader = () => {
        if (!dateTimeText) return;
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        dateTimeText.textContent = now.toLocaleDateString('pl-PL', options);
    };

    // --- NEW: Hamburger Menu in Header ---
    const generateHamburgerMenu = () => {
        // Find the right side of the header to inject the menu
        let headerRightMenu = appHeader.querySelector('.header-right-menu');
        if (!headerRightMenu) {
            headerRightMenu = document.createElement('div');
            headerRightMenu.className = 'header-right-menu';
            appHeader.appendChild(headerRightMenu);
        }

        const navLinks = [
            { href: 'schedule.html', text: 'Grafik', icon: 'fas fa-calendar-alt' },
            { href: 'leaves.html', text: 'Urlopy', icon: 'fas fa-plane-departure' },
            { href: 'options.html', text: 'Opcje', icon: 'fas fa-cogs' }
        ];
        const currentPage = window.location.pathname.split('/').pop();

        // Create hamburger icon
        const hamburger = document.createElement('div');
        hamburger.className = 'hamburger-menu';
        hamburger.innerHTML = '<i class="fas fa-bars"></i>';
        
        // Create navigation panel that slides from the right
        const navPanel = document.createElement('div');
        navPanel.className = 'nav-panel';
        
        const ul = document.createElement('ul');
        navLinks.forEach(link => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = link.href;
            
            const icon = document.createElement('i');
            icon.className = link.icon;
            a.appendChild(icon);
            
            const textSpan = document.createElement('span');
            textSpan.textContent = ' ' + link.text; // Dodaj spację przed tekstem
            a.appendChild(textSpan);

            if (currentPage === link.href) {
                a.classList.add('active');
            }
            li.appendChild(a);
            ul.appendChild(li);
        });
        navPanel.appendChild(ul);

        // Add footer information to the navigation panel
        const footerInfo = document.createElement('div');
        footerInfo.className = 'footer-info';
        footerInfo.innerHTML = '<p>&copy; 2025 Fizjoterapia Kalinowa. Wszelkie prawa zastrzeżone.</p>'; // You can customize this text
        navPanel.appendChild(footerInfo);

        // Add hamburger icon to the header, and panel to the body
        headerRightMenu.appendChild(hamburger);
        document.body.appendChild(navPanel);

        // Event listener to toggle menu visibility
        hamburger.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent the document click listener from firing immediately
            navPanel.classList.toggle('visible');
            hamburger.classList.toggle('active');
        });
        
        // Event listener to close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (navPanel.classList.contains('visible') && !navPanel.contains(e.target) && !hamburger.contains(e.target)) {
                navPanel.classList.remove('visible');
                hamburger.classList.remove('active');
            }
        });
    };

    // --- "Toast" Notification System ---
    window.showToast = (message, duration = 3000) => {
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            document.body.appendChild(toastContainer);
        }

        const toast = document.createElement('div');
        toast.className = 'toast show';
        toast.textContent = message;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode === toastContainer) {
                   toastContainer.removeChild(toast);
                }
            }, 500);
        }, duration);
    };

    // Initialization
    generateHamburgerMenu();
    setInterval(updateDateTimeHeader, 1000);
    updateDateTimeHeader();
});
