# Contrato de seguimiento de celebraciones

Contrato de datos entre la pantalla del cliente y un servicio autenticado pendiente de implementar. Basado en el contexto recuperado y el plan del 3 de noviembre de 2026. No configura un endpoint, identidad, almacenamiento, pagos ni reservas reales. Un fixture local permite comprobar la interfaz, pero no demuestra las garantías del servidor descritas aquí.

## Snapshot

Todas las llamadas exitosas resuelven un `TrackingSnapshot` completo, autorizado para la sesión actual. No devuelven parches. Los campos indicados son obligatorios; las listas vacías se representan con `[]` y la ausencia de propuesta con `null`.

```ts
type TrackingStatus = 'requested' | 'quoted' | 'reserved' | 'preparing' | 'ready';

type Proposal = {
  version: number;
  totalCents: number;
  baseCents: number;
  surchargeCents: number;
  display: 'total' | 'breakdown';
  canPrepare: string;
  changes: string;
  reply: string;
};

type TrackingSnapshot = {
  id: string;
  version: number;
  status: TrackingStatus;
  pickup: { label: string };
  requestText: string;
  acceptedProposal: Proposal | null;
  pendingProposal: Proposal | null;
  payments: Array<{ id: string; amountCents: number; status: 'confirmed' }>;
  comments: Array<{ id: string; author: string; text: string }>;
  history: Array<{
    version: number;
    status: TrackingStatus;
    totalCents: number;
    reply: string;
  }>;
  permissions: { canComment: boolean; canAccept: boolean };
};
```

`id` es un identificador opaco y no acredita propiedad. `version` del snapshot es un entero positivo, creciente con cada cambio confirmado; una lectura sin cambios puede devolver la misma versión. La versión de propuesta es un entero positivo que identifica contenido inmutable dentro de esa solicitud. No se reutiliza al sustituir una propuesta y no tiene por qué coincidir con la versión del snapshot.

`requestText` contiene lo solicitado por el cliente. `canPrepare` es texto descriptivo de lo que se puede preparar, **no un booleano**. `changes` explica las diferencias respecto a la solicitud o referencia y los ajustes de esa versión; `reply` contiene la respuesta final escrita de la pastelera. `pickup.label` es la etiqueta de recogida preparada por el servicio conforme al horario de Houston, sin interpretación de fechas por el tema. `author` es una etiqueta visible de autor, no una credencial ni permiso. Estos campos y los comentarios se presentan como texto literal, sin ejecutar HTML.

Los comentarios se entregan en orden de conversación, del más antiguo al más reciente, con identificadores estables. `history` se entrega en orden de versiones, de la más antigua a la más reciente; contiene resúmenes de versiones anteriores, no mensajes ni instrucciones para calcular el estado vigente. Su `version` identifica la propuesta resumida y `status` refleja el estado registrado por el servicio para esa entrada. El snapshot vigente es la fuente de verdad; la interfaz no reconstruye sus campos desde el historial.

## Importes, propuestas y pagos

Todos los importes son enteros no negativos y seguros para JavaScript, expresados en centavos de USD. Por ejemplo, `17000` representa USD 170.00. En cada propuesta `totalCents = baseCents + surchargeCents`; el recargo lo determina la pastelera y es explícito, incluso cuando vale cero. `display` decide si se presenta solo el total o el desglose; no cambia el importe. El contrato no admite precios calculados ni cargos elegidos por el cliente.

`acceptedProposal` es el diseño y precio vigentes ya aceptados. `pendingProposal` es una oferta nueva o un ajuste que todavía requiere aceptación. Puede existir con o sin propuesta aceptada. Presentar una propuesta pendiente nunca sustituye el total vigente. Si no hay propuesta aceptada, su precio se presenta como cotización pendiente, sin inventar una reserva o un total acordado.

Los pagos proceden exclusivamente de registros confirmados por el servicio. Cada `id` aparece una sola vez. La interfaz suma `amountCents` para mostrar lo efectivamente recibido; aceptar un ajuste no borra, modifica ni recalcula el anticipo recibido. La suma de pagos también debe permanecer dentro del rango entero seguro.

- Con total aceptado `17000` y recibido `9000`, el saldo es `8000`.
- Con el mismo total antes y después del ajuste, el saldo permanece igual.
- Con total aceptado `7000` y recibido `9000`, el saldo exigible es `0` y existe una diferencia a favor de `2000`, pendiente de resolución de la pastelera.
- Una propuesta pendiente de `17000` sobre un total aceptado de `15000` conserva `15000` como vigente hasta recibir la aceptación confirmada.

Saldo exigible: `Math.max(totalCents - recibido, 0)`. Diferencia a favor: `Math.max(recibido - totalCents, 0)`. Ninguna de las tres operaciones del contrato cobra, reembolsa, crea un checkout ni altera pagos. La aceptación de una cotización por sí sola tampoco acredita un pago o confirma cupo.

## Estados y permisos

| `status` | Etiqueta | Acciones del cliente sujetas al servicio |
| --- | --- | --- |
| `requested` | Solicitud recibida | Consultar y comentar si `canComment`; normalmente todavía no hay propuesta aceptable. |
| `quoted` | Cotización disponible | Consultar, comentar si `canComment` y aceptar la propuesta pendiente si `canAccept`. Aceptar no confirma reserva por sí solo. |
| `reserved` | Reserva confirmada | Consultar, comentar y solicitar ajustes si `canComment`; aceptar un ajuste pendiente si `canAccept`. El servicio confirma la reserva con los pagos y disponibilidad correspondientes. |
| `preparing` | En preparación | Consultar, comentar y solicitar ajustes si `canComment`; la pastelera decide viabilidad y precio. Aceptar un ajuste pendiente si `canAccept`. |
| `ready` | Listo para recoger | Solo consultar; `canComment` y `canAccept` son `false`. |

Los permisos son booleanos calculados por el servidor para el usuario y el estado actuales; el tema no los concede a partir de la etiqueta de estado. `canAccept` solo puede ser `true` cuando existe una propuesta pendiente vigente y aceptable. Hasta que esté listo, los comentarios y solicitudes de ajustes permanecen disponibles según autorización del servicio. Comentar no equivale a aprobar el cambio solicitado. Cada mutación vuelve a comprobar autorización, estado y permisos aunque la pantalla conserve un snapshot antiguo.

Solo el servicio controla transiciones de estado. Aceptar un ajuste en `reserved` o `preparing` conserva el avance operativo que corresponda; el cliente no envía ni fuerza un nuevo estado.

## Servicio asíncrono

```ts
interface TrackingService {
  getTracking(id: string): Promise<TrackingSnapshot>;
  postComment(id: string, text: string, operationId: string): Promise<TrackingSnapshot>;
  acceptProposal(id: string, proposalVersion: number, operationId: string): Promise<TrackingSnapshot>;
}

type TrackingErrorCode =
  | 'AUTH_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'UNAVAILABLE';

type TrackingError = { code: TrackingErrorCode; message?: string };
```

El transporte y el mecanismo de sesión se definirán al implementar el servicio. No se presupone una URL ni un token en el tema. Los rechazos tienen un `code` estable; `message` es opcional y no contiene información de terceros. El cliente traduce el código a mensajes en español y conserva el borrador ante errores de envío.

### `getTracking(id)`

Lee el estado actual únicamente después de autenticar y autorizar la sesión. Cambiar el identificador en la URL nunca permite consultar solicitudes ajenas. Una solicitud inexistente o no accesible devuelve `NOT_FOUND`, sin revelar si pertenece a otra persona.

### `postComment(id, text, operationId)`

Agrega un comentario del usuario autenticado y devuelve el snapshot confirmado. `text` es una cadena no vacía después de quitar espacios extremos. El servicio valida contenido y sus límites antes de guardar y asigna `id` y `author`; no recibe un autor elegido por el cliente. Rechaza el comentario si no hay permiso o el pastel ya está listo. Las solicitudes de ajuste se expresan mediante este comentario y requieren revisión de la pastelera; no modifican directamente la propuesta.

### `acceptProposal(id, proposalVersion, operationId)`

Acepta exclusivamente la versión pendiente indicada después de volver a comprobar permiso, vigencia y estado de forma atómica. No recibe precio, importe, pagos ni estado del navegador. Si la propuesta fue sustituida o ya no es aceptable, rechaza con `CONFLICT`, sin aplicar el precio antiguo. La interfaz vuelve a leer con `getTracking` para mostrar la propuesta vigente; no acepta automáticamente la sustituta.

En el éxito, el snapshot contiene la nueva propuesta aceptada y `pendingProposal: null`. Conserva los pagos confirmados. La interfaz espera esta respuesta para cambiar el total acordado, saldo y diseño vigentes. Una respuesta perdida no autoriza a asumir que la aceptación falló: se reintenta la misma operación o se consulta el estado.

### Idempotencia y concurrencia

`operationId` es una cadena opaca no vacía generada por el cliente para una intención de mutación. Se conserva para reintentos de esa misma intención, incluso ante tiempo de espera o respuesta perdida; una intención nueva usa otra clave. El botón queda bloqueado mientras la llamada está pendiente, pero ese bloqueo no reemplaza la garantía del servidor.

El servidor vincula la clave al usuario, solicitud, tipo de operación y carga original. Repetir la misma operación no crea otro comentario, aceptación, entrada de historial ni efecto financiero. Devuelve un snapshot autorizado que refleja el resultado confirmado, pudiendo incluir cambios posteriores. Reutilizar la clave con otra carga devuelve `CONFLICT`. Una repetición ya confirmada se reconoce antes de rechazar por un permiso que haya cambiado posteriormente, tras verificar de nuevo la identidad y el acceso a la solicitud.

Validar una propuesta y aceptarla debe ser una única operación atómica: dos llamadas concurrentes no pueden aplicar una versión sustituida ni duplicar la aceptación. El cliente descarta respuestas de snapshots anteriores a la versión más reciente que ya mostró; no mezcla campos de distintas versiones.

## Errores

| Código | Significado y tratamiento |
| --- | --- |
| `AUTH_REQUIRED` | Falta una sesión válida; mostrar el estado de sesión requerida. |
| `NOT_FOUND` | Solicitud inexistente o sin acceso; no exponer contenido ni existencia de solicitudes ajenas. |
| `CONFLICT` | Propuesta sustituida, permiso/estado cambiado o clave reutilizada con otra carga; volver a consultar y pedir una acción explícita sobre lo vigente. |
| `VALIDATION` | Identificador, versión, clave o texto inválidos; corregir la entrada conservando el borrador. |
| `UNAVAILABLE` | Servicio temporalmente no disponible o fallo de comunicación; permitir reintentar conservando la clave de la misma mutación. |

## Escenarios obligatorios del servicio

1. Un usuario cambia el `id` por el de otro cliente: las tres operaciones responden `NOT_FOUND` y no leen ni modifican sus datos.
2. Una pantalla conserva la propuesta 2 y la pastelera publica la 3: aceptar la 2 responde `CONFLICT`; la 3 y los pagos permanecen intactos.
3. Un comentario o aceptación se repite con la misma clave y carga: ocurre una sola vez. La clave con otro texto o versión responde `CONFLICT`.
4. El pastel pasa a `ready` mientras el cliente escribe: el envío nuevo se rechaza con `CONFLICT`; ningún comentario se agrega y la siguiente lectura devuelve ambos permisos en `false`.
5. Una aceptación coincide con una sustitución de propuesta: la comprobación atómica permite solo un resultado coherente, nunca aplicar la versión antigua después de sustituirla.
6. Tras aceptar un ajuste de `15000` a `17000` con `9000` confirmados, el snapshot conserva los pagos y refleja saldo `8000`; si el ajuste es a `7000`, muestra diferencia a favor `2000` sin reembolso automático.

Antes de conectar la tienda deben demostrarse estos escenarios contra el servicio real, incluidos identidad, persistencia, concurrencia y registros de pagos. El fixture y las pruebas de pantalla solo verifican presentación y llamadas del cliente. Este documento no implementa ni certifica el backend y no autoriza publicación.
