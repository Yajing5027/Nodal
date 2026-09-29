// Apply the saved appearance before the app paints, including on reload.
try {
  const preference = localStorage.getItem('nodal.appearance');
  const theme = preference === 'dark' || preference === 'light' ? preference : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.classList.toggle('dark-theme', theme === 'dark');
} catch { /* The app applies the system appearance when local storage is unavailable. */ }
