export const $ = (s) => document.querySelector(s);
export const num = (n) => Math.floor(n).toLocaleString('ru-RU');
export const time = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
export const rate = (n) => `${n >= 0 ? '+' : ''}${Math.round(n * 60)}`;
export const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
