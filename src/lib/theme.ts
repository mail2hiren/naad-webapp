/**
 * Light / dark theme. Light is the default; the choice is stored per device.
 * index.html applies the stored choice before React loads (no flash), and
 * the sidebar toggle calls setTheme().
 */
export type Theme = 'light' | 'dark';

const KEY = 'naad-theme';

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}
