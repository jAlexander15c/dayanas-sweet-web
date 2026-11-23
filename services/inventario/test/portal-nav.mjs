// Navegación del portal (fase 2): en el iPhone, «Cuenta» guarda Face ID, contraseña y Salir; «Más» guarda
// Categorías, Historial y Usuarios. En escritorio se ven directo. Este ayudante abre el menú solo si hace falta.
const ACCOUNT = ['Salir', 'Cambiar contraseña', 'Face ID / huella'];
export async function tocar(page, name) {
  const target = page.getByRole('button', { name, exact: true });
  if (!(await target.isVisible())) await page.getByRole('button', { name: ACCOUNT.includes(name) ? 'Cuenta' : 'Más', exact: true }).click();
  await target.click();
}
