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

export const price = (quote) =>
  `${quote.cost} ₡ · ${quote.metal} спл.${quote.oil ? ` · ${quote.oil} нефти` : ''}${quote.components ? ` · ${quote.components} эл.` : ''}`;
export const deliveryText = (status) => {
  const reason =
    status?.reason || (status?.stock > 0 ? `Готово ${status.stock}` : 'Нет местного запаса');
  if (!(status?.inTransit > 0)) return reason;
  return status.eta != null
    ? `Едет ${status.inTransit} ≈${Math.ceil(status.eta)} с${status.stock ? ` · готово ${status.stock}` : ''}`
    : `${reason} · груз ${status.inTransit}`;
};
