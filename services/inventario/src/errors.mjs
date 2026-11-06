export function fail(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}
export function requireValue(condition, message = 'Revisa los datos e inténtalo otra vez.') {
  if (!condition) throw fail(400, 'VALIDATION', message);
}
export function errorResult(error) {
  return { status: error.status || 502, body: { code: error.code || 'SHOPIFY_UNAVAILABLE', message: error.status ? error.message : 'No pudimos confirmar el cambio. Revisa el historial antes de intentarlo de nuevo.', ...(error.current === undefined ? {} : { current: error.current }), ...(error.productId ? { productId: error.productId } : {}), ...(error.steps ? { steps: error.steps } : {}) } };
}
