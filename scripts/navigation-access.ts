export interface NavigationAccessItem {
    key: string;
    href: string;
    text: string;
    icon: string;
    id?: string;
}

export const NAVIGATION_ACCESS_ITEMS: NavigationAccessItem[] = [
    { key: 'schedule', href: '#schedule', text: 'Grafik', icon: 'fas fa-calendar-alt' },
    { key: 'appointments', href: '#appointments', text: 'Planowanie', icon: 'fas fa-clock' },
    { key: 'stations', href: '#stations', text: 'Stanowiska', icon: 'fas fa-clinic-medical' },
    { key: 'massage-stations', href: '#massage-stations', text: 'Masaż', icon: 'fas fa-hands', id: 'navLinkMassageStations' },
    { key: 'leaves', href: '#leaves', text: 'Urlopy', icon: 'fas fa-plane-departure' },
    { key: 'changes', href: '#changes', text: 'Harmonogram zmian', icon: 'fas fa-exchange-alt' },
    { key: 'statistics', href: '#statistics', text: 'Statystyki', icon: 'fas fa-chart-bar' },
    { key: 'scrapped-pdfs', href: '#scrapped-pdfs', text: 'ISO', icon: 'fas fa-file-pdf', id: 'navLinkIso' },
    { key: 'options', href: '#options', text: 'Opcje', icon: 'fas fa-cogs' },
];

export const getDefaultNavigationAccess = (): string[] => NAVIGATION_ACCESS_ITEMS.map((item) => item.key);
