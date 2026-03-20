export const THEME_KEY = 'versable-theme';

export type Theme = 'light' | 'dark';

export function getStoredTheme(): Theme {
	if (typeof window === 'undefined') return 'light';
	return (localStorage.getItem(THEME_KEY) as Theme) || 'light';
}

export function setTheme(theme: Theme) {
	if (typeof window === 'undefined') return;
	localStorage.setItem(THEME_KEY, theme);
	document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function initTheme() {
	const theme = getStoredTheme();
	setTheme(theme);
	return theme;
}
