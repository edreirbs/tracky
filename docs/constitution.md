# Constitución de Tracky

Principios no negociables. Toda spec, plan, tarea y PR debe cumplirlos. Si algo los contradice, gana la
constitución y se abre un ADR para discutir el cambio. Hereda los principios de `meeting-recording` con los
cambios marcados con **(nuevo)** o **(cambia)**.

## I. Especificación antes que código
1. Ningún código sin requisito trazable (`FR-xxx`, `NFR-xxx`) en `specs/*/spec.md`.
2. Flujo: **spec → plan → tasks → implementación → validación**. Si la spec está mal, se corrige primero.
3. Decisiones con alternativas reales → ADR en `docs/adr/`.

## II. Seguridad por diseño
1. **Cero secretos en el cliente.** La PWA es pública. Solo lleva la URL de Supabase y la *publishable key*.
   El único secreto es `ANTHROPIC_API_KEY`, variable **secreta** de Netlify. Tracky **no usa
   `service_role`**: todo acceso a datos, incluso en segundo plano, va con el JWT de la persona (ADR-0010). **(cambia)**
2. **RLS en todas las tablas** con `user_id = auth.uid()`. Ninguna tabla queda expuesta sin política. **(nuevo)**
3. **Autenticación obligatoria** (Supabase Auth) en todo salvo `GET /health`; lista de correos permitidos por instancia.
4. **Entradas no confiables:** transcripciones, notas y textos de tareas pueden traer instrucciones maliciosas.
   Se envían a Claude delimitadas y nunca se obedecen; las herramientas que escriben piden confirmación.
5. **Ningún secreto pasa por el chat** de configuración: el usuario pega la llave de Claude en Netlify. **(nuevo)**
6. CSP estricta, sin `eval`, dependencias fijadas, escaneo de secretos, `get_advisors` de Supabase en verde.

## III. Privacidad y consentimiento
1. El **audio nunca sale de la computadora** (Whisper local, sin escribir audio a disco).
2. Cada persona tiene **su propia instancia** (repo, Supabase, Netlify, llave): nadie más ve sus datos. **(nuevo)**
3. Recordatorio de consentimiento antes de grabar e indicador visible mientras graba.
4. Sin analítica de terceros; logs sin contenido.

## IV. Resiliencia: nada se pierde
1. Todo dato capturado se guarda primero en local (*outbox* en IndexedDB) y se sincroniza a Supabase.
2. Operaciones idempotentes (`meeting_id`, `client_id` de tarea, `idempotency_key` de transacción de monedas).
3. Reintentos con *backoff* y *jitter*; degradación elegante (si falla Claude, la nota se guarda con la transcripción).

## V. Rapidez percibida
1. Un clic para grabar (< 2 s a texto en vivo). Nota guardada < 30 s tras detener (p95, 60 min).
2. **Capturar una tarea en < 5 s** desde cualquier pestaña, con solo el título obligatorio. **(nuevo)**
3. **Celebración < 100 ms** después de marcar una tarea (optimista; se concilia después). **(nuevo)**

## VI. Simplicidad
1. Arquitectura mínima: PWA + funciones de Netlify + Supabase. Sin servidores propios ni colas externas.
2. APIs nativas del navegador antes que dependencias.
3. Puertos y adaptadores solo en fronteras externas (STT, LLM, almacenamiento).

## VII. Calidad verificable
1. TypeScript `strict`. Pruebas unitarias, de contrato, de RLS (pgTAP o SQL) y E2E con audio simulado.
2. *Evals* del resumen, del cargador de tareas y del asistente antes de cambiar prompts o modelo.
3. CI verde para fusionar a `main`.

## VIII. Diseño amable para TDAH **(nuevo)**
1. **Baja carga cognitiva:** cada pantalla responde una sola pregunta; **máximo 3 en Ahora**; nada obligatorio salvo lo mínimo.
2. **Cero castigo:** nunca se restan monedas, nunca hay rojo de "atrasado"; se usa lenguaje de "reprogramar".
3. **Recompensa inmediata y visible:** cada acción terminada se celebra al instante.
4. **Externalizar la memoria:** lo importante está a la vista (*Ahora*), lo demás se oculta hasta pedirlo.
5. **Accesibilidad:** `prefers-reduced-motion`, sonido opcional, contraste AA, teclado completo.

## IX. Configuración conversacional **(nuevo)**
1. La configuración inicial completa ocurre en **una conversación de Claude Code (app de escritorio)** usando los
   conectores de GitHub, Supabase y Netlify. El usuario solo hace lo que no se puede delegar con seguridad.
2. La configuración es **reanudable e idempotente**: volver a correrla no duplica nada.
