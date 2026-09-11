// React DevTools - only in development (when running via Vite dev server)
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  const s = document.createElement('script');
  s.src = 'http://localhost:8097';
  document.head.appendChild(s);
}
