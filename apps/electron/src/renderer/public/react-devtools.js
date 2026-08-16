// React DevTools - only in development (when running via Vite dev server)
if (location.protocol === 'file:' || location.hostname === 'localhost') {
  const s = document.createElement('script');
  s.src = 'http://localhost:8097';
  document.head.appendChild(s);
}
