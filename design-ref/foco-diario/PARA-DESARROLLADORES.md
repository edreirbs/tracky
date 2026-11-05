# Foco Diario: guía técnica

Versión 1.0. Todo está en **un solo archivo**: `Foco Diario.html` (HTML + CSS + JS,
sin librerías ni compilación). Se edita con cualquier editor de texto.

## Requisitos
- Microsoft Edge o Google Chrome (escritorio). Usa la *File System Access API*
  (`showDirectoryPicker`, `createWritable`). Firefox y Safari no la soportan:
  la app muestra un aviso.
- Funciona abriendo el archivo directamente (`file:///`), sin servidor.
- Única llamada externa: las tipografías de Google Fonts (Manrope y Caveat).
  Sin internet usa tipografías del sistema. **No se envía ningún dato del usuario.**
  Si se quiere cero conexiones, quitar el `<link>` de Google Fonts.

## Cómo se guardan los datos
- El usuario elige una carpeta. Su acceso (no los datos) se recuerda en IndexedDB
  (`foco-diario` → store `h` → clave `dir`).
- Datos: `<carpeta>/datos.focodata`. Se escribe 500 ms después de cada cambio
  (y al ocultar la pestaña). `createWritable` reemplaza el archivo de forma atómica.
- Respaldo automático: `<carpeta>/respaldos/respaldo-AAAA-MM-DD.focodata`,
  uno por día, se conservan los últimos 14.
- No se usa `localStorage` para datos.

## Cifrado
- Clave: PBKDF2-SHA256, 600 000 iteraciones, sal de 16 bytes → AES-GCM 256.
- Cada guardado usa un IV nuevo de 12 bytes.
- La clave vive solo en memoria mientras la app está desbloqueada. Al bloquear
  (botón o inactividad configurable) se descarta junto con los datos.
- **No hay recuperación de contraseña.** Es intencional.

Formato de `datos.focodata` (JSON):
```json
{ "app":"foco-diario", "v":2, "kdf":"PBKDF2-SHA256", "iter":600000,
  "alg":"AES-GCM-256", "salt":"<base64>", "iv":"<base64>",
  "data":"<base64 del JSON cifrado>", "savedAt":"<ISO>" }
```

## Modelo de datos (lo que va cifrado)
```text
S = {
  v: 1,
  people: [{ id, name, color(0-5), ex? }],
  items:  [{ id, text, action, personId, status, due, blocking, createdAt,
             doneAt?, followUp?, waitingOn?, estimate?, actual?, tomorrow?, ex? }],
           // status: inbox | now | next | waiting | done
  notes:  [{ id, type: contact|note, title, body, company?, phone?, email?,
             personId, tags[], pinned?, createdAt, updatedAt, ex? }],
  settings: { autoLock (min, 0 = nunca), lastBackup (fecha copia USB) },
  timer: { id, est (min), startedAt, acc } | null,
  lastOpen, closedOn
}
```
`ex: true` marca los datos de ejemplo que se borran con "Borrar ejemplos".

## Estructura del código (dentro de `<script>`)
- **Utilidades:** fechas, `esc()` para escapar HTML (usarlo SIEMPRE al pintar texto del usuario).
- **Estado y guardado:** `save()` (con espera), `flush()`, `dailyBackup()`.
- **Vistas:** `vAhora` (tablero), `vProcesar`, `vEsperando`, `vPersonas`, `vArchivo`,
  `vCierre`, `vSeguridad`. Cada una devuelve HTML; `render()` pinta la actual.
  La vista va en el hash (`#ahora`, `#archivo`...).
- **Acciones:** un solo `click` delegado con `data-act="..."` y un `switch`.
  Para agregar un botón: ponle `data-act="miAccion"` y agrega el `case`.
- **Formularios:** `submit` delegado con `data-form="..."`.
- **Cifrado, carpeta y bloqueo:** al final del script.

Colores y tipografías: tokens CSS en `:root` (`--n0..--n5` son los colores de
post-it por persona). Cambiar el diseño = cambiar tokens, no reglas sueltas.

## Probar cambios
1. Abrir el archivo en Edge con una **carpeta de prueba**, nunca con datos reales.
2. Prueba automática (opcional, requiere Node.js):
   ```
   npm install playwright
   npx playwright install chromium
   cd "Foco Diario"
   npx http-server -p 8765      (o: python -m http.server 8765)
   node pruebas/prueba-basica.js
   ```
   Simula la carpeta con el almacenamiento privado del navegador y prueba:
   crear archivo, capturar, guardar contacto, bloquear, contraseña incorrecta,
   desbloquear y buscar.

## Reglas para mejoras
- Mantener un solo archivo y cero dependencias.
- No cambiar el formato de datos sin migración: los usuarios ya tienen archivos.
  Si se agregan campos, que tengan valor por defecto en `normalize()`.
- Ningún dato del usuario sale de la computadora sin acción explícita.
- Probar en modo oscuro de Windows y a 400 px de ancho.
