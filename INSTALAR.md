# Instalar Tracky en tu computadora

Tracky se instala **conversando con Claude**: tú respondes unas preguntas y aceptas unos permisos; Claude hace
el resto. Calcula **30–40 minutos** (la mitad es la descarga del modelo de voz, mientras tanto puedes hacer otra cosa).

## Antes de empezar (10 min, una sola vez)

| Necesitas | Para qué | Costo |
|---|---|---|
| Una computadora con **macOS**, **Windows 10/11** o **Linux** (8 GB de RAM o más; ideal 16 GB o una Mac con chip M) | Transcribir tus juntas sin que el audio salga de tu computadora | — |
| La **app de escritorio de Claude** con **Claude Code** (Mac o Windows; en Linux, Claude Code en terminal), plan Pro o superior | Es quien te instala todo | Tu plan de Claude |
| Cuenta de **GitHub** | Guarda tu copia de Tracky | Gratis |
| Cuenta de **Supabase** (entra con tu GitHub) | Tu base de datos | Gratis |
| Cuenta de **Netlify** (entra con tu GitHub) | Tu sitio web | Gratis |
| Cuenta en **console.anthropic.com** con método de pago | La llave para que Tracky use Claude | Por uso: centavos de dólar por junta resumida |
| **Chrome** o **Edge** | Para grabar | Gratis |

En la app de Claude: **Ajustes → Conectores** → conecta **GitHub**, **Supabase** y **Netlify**.

Pide a quien te compartió Tracky que te dé acceso al repositorio `edreirbs/tracky` (o que te pase el enlace
de la plantilla).

## Instalar

1. Abre la app de Claude → **Claude Code** → abre una carpeta nueva (por ejemplo `Documentos/Tracky`).
   En Windows, Claude Code necesita **Git para Windows** (la app te lo pide si falta).
2. Escribe: `Configura Tracky desde https://github.com/edreirbs/tracky`
3. Sigue la conversación. Claude te pedirá solo esto:
   * tu correo, tu nombre y un nombre para tu sitio;
   * los **temas** de tus juntas (para tus etiquetas);
   * pegar **dos valores** en Supabase (30 s, con enlace directo);
   * pegar tu **llave de Claude en Netlify** (1 min, con enlace directo). **Nunca la pegues en el chat**;
   * abrir el **enlace de tu correo** para entrar;
   * en Mac, aceptar el **permiso de audio**; en todos, escribir un **código de 6 dígitos** en Tracky.
4. Al final verás confeti 🎉. Listo.

**Para grabar juntas en línea:** en Mac se capta solo el audio de Teams/Zoom. En Windows, al grabar, Chrome o
Edge te preguntará qué compartir: elige **Pantalla completa** y activa **Compartir audio del sistema** (no se
graba la pantalla). En Linux, comparte la **pestaña** de la junta (Meet, Teams o Zoom en el navegador).

**Si algo falla, no te preocupes ni busques ayuda:** dile a Claude qué pasó (o pega el error). Claude es el
desarrollador encargado de tu instalación: diagnostica y lo arregla. Después, en cualquier momento, escribe
`/tracky-doctor` en la misma carpeta.

## Danos tu opinión (muy importante en esta primera versión)

Mientras instalas, anota (o dícteselo a Claude al final y pídele que lo guarde en `SETUP-RESULT.md`):

* **En qué paso** te atoraste o dudaste, y **qué esperabas** que pasara.
* **Cuánto tardó** en total y qué parte se te hizo larga.
* Si algo te pidió un dato que **no entendiste**.
* Una **captura de pantalla** si algo se vio mal (sin datos personales).

Nunca compartas tu llave de Claude, tu archivo `.env` ni capturas con tus notas o transcripciones.
