# MPC-HC Discord Thumbnail - Notas de Desarrollo

## Última actualización: 2025-12-31

---

## Problema Principal: Thumbnails desaparecen en Discord

### Síntomas observados:
1. Las imágenes se suben correctamente a Imgur (confirmado en logs)
2. Discord RPC recibe la URL y responde con `assets.large_image` correcto
3. **Después de ~20-40 minutos de uso**, el thumbnail deja de mostrarse en Discord
4. El problema ocurre tanto reproduciendo como pausado por mucho tiempo
5. Al cambiar de archivo/episodio, funciona un rato y luego deja de mostrar

### Causa probable:
- **Rate limit interno de Discord** para imágenes externas (URLs de Imgur)
- Discord convierte las URLs a formato interno: `mp:external/...`
- Después de cierto tiempo/cantidad de imágenes, Discord deja de renderizar nuevas imágenes externas
- NO es problema de caché de Imgur (las URLs funcionan en navegador)

---

## Soluciones implementadas:

### 1. Cache-buster en URLs (parcialmente efectivo)
```typescript
// imgur.service.ts
this.lastUrl = `${response.data.data.link}?t=${now}`;
```
- Agrega timestamp a URL para evitar caché de Discord
- Ayuda pero no resuelve completamente el problema

### 2. Reconexión periódica a Discord RPC
```typescript
// discord.service.ts
private readonly RECONNECT_INTERVAL = 1800000; // 30 minutos
private readonly RECONNECT_ACTIVITY_COUNT = 100; // ~16 min de uso activo
private readonly PAUSED_RECONNECT_INTERVAL = 300000; // 5 minutos si está pausado
```
- Reconecta automáticamente cada 100 actualizaciones O 30 minutos
- **NUEVO**: Si está pausado más de 5 minutos, reconecta cada 5 minutos
- Solo cuenta cuando hay actividad real (reproduciendo/pausado)
- Resetea contadores después de reconectar
- Logs claros indicando razón de reconexión

### 3. Refresh de imagen durante pausa
```typescript
// index.ts
const PAUSED_REFRESH_INTERVAL = 180000; // 3 minutos
```
- Cuando está pausado, re-sube la misma imagen cada 3 minutos con nueva URL
- Guarda el snapshot de pausa para reutilizar (no captura de nuevo)
- Intenta mantener el thumbnail visible durante pausas largas

### 4. Detección de resume (pausa -> play)
```typescript
// index.ts
const RESUME_THRESHOLD = 60000; // 1 minuto
```
- Si estuvo pausado más de 1 minuto y reanuda reproducción:
  - Fuerza reconexión a Discord RPC
  - Fuerza subida de nueva imagen a Imgur
  - Log: "Resume detectado después de Xs de pausa - forzando refresh"

---

## Logging agregado para debug:

### Discord Service:
- Log del resultado de `setActivity` cada 10 actualizaciones con `large_image` de la respuesta
- Advertencia si Discord no confirma la imagen en la respuesta (nuevo 2025-12-23)
- Advertencia si `setActivity` devuelve null/undefined
- Log cuando fuerza reconexión con contador de actualizaciones

### Imgur Service:
- Log detallado de respuesta: id, type, size
- Log de errores HTTP específicos con status code
- Log de errores de red con código de error

---

## Configuración actual:

| Parámetro | Valor | Descripción |
|-----------|-------|-------------|
| Update interval | 10s | Frecuencia de actualización de Discord |
| Imgur upload interval | 60s (1 min) | Mínimo entre subidas a Imgur |
| Paused refresh | 60s (1 min) | Re-subir imagen durante pausa |
| Discord reconnect (normal) | 50 updates / 30 min | Reconexión preventiva (más frecuente) |
| Discord reconnect (pausado) | 5 min | Reconexión más frecuente si pausado |
| Resume threshold | 1 min | Tiempo mínimo de pausa para forzar refresh al reanudar |
| Image compression | 640px, 80% quality | Tamaño de thumbnails |

---

## Ideas pendientes por probar:

1. **Detectar cuando Discord rechaza imagen**: Verificar la respuesta de `setActivity` más a fondo

2. **Reducir frecuencia de nuevas URLs**: Quizás Discord penaliza por cambiar URLs muy seguido (actualmente 3 min)

3. **Proxy de imágenes**: Usar un servicio propio en lugar de Imgur directo

4. **Discord Application Assets**: Subir imágenes directamente a Discord en lugar de usar URLs externas

---

## Estructura del proyecto:

```
src/
├── index.ts              # Loop principal
├── config.ts             # Configuración desde .env
├── services/
│   ├── discord.service.ts   # Discord RPC
│   ├── imgur.service.ts     # Subida de imágenes
│   ├── image.service.ts     # Compresión de imágenes
│   └── mpc-hc.service.ts    # Conexión con MPC-HC
├── types/
│   └── index.ts          # TypeScript interfaces
└── utils/
    ├── helpers.ts        # Utilidades
    └── logger.ts         # Logging a archivo
```

---

## Comandos útiles:

```bash
npm run build          # Compilar TypeScript
npm restart            # Reiniciar con PM2
npm run logs           # Ver logs en tiempo real
pm2 logs mpc-discord   # Logs de PM2
```

---

## ⚠️ RECORDATORIO IMPORTANTE

**Después de cada cambio en el código, SIEMPRE ejecutar:**
```bash
npm run build && npm restart
```
Esto compila TypeScript y reinicia el servicio con PM2 para aplicar los cambios.

**Regla operativa (Copilot CLI):** al terminar cualquier cambio de código en esta sesión, ejecutar siempre `npm restart` (idealmente junto con `npm run build`).

---

## Sesión 2025-12-25: Avances y descubrimientos

### Hallazgo clave:
- **Reiniciar Discord (cliente) resetea el rate limit de imágenes externas**
- Cuando el thumbnail desaparece, cerrar y abrir Discord lo soluciona inmediatamente
- Esto confirma que es un rate limit del lado del cliente Discord, no del servidor

### Cambios realizados:
- Aumentado `IMGUR_UPLOAD_INTERVAL` de 2 min a 3 min
- Aumentado `PAUSED_REFRESH_INTERVAL` de 2 min a 3 min
- Objetivo: reducir cantidad de URLs únicas para evitar rate limit

### Próximos pasos a evaluar:
- Si sigue fallando con 3 min, aumentar a 4-5 min
- Considerar reconexión más agresiva que simule reinicio de Discord

---

## Sesión 2025-12-31: Gran mejora en duración

### Resultados de prueba:
- **11 capítulos vistos** (episodios 047-057 de Katekyo Hitman Reborn)
- **~4 horas de uso** antes de que el thumbnail desapareciera
- **70 imágenes únicas** subidas a Imgur durante la sesión
- Mejora significativa respecto a los 20-40 minutos anteriores

### Hallazgo clave:
- El rate limit de Discord parece activarse después de ~60-70 URLs externas únicas
- Las reconexiones periódicas ayudan a extender la vida útil
- Las URLs únicas (con timestamp) son necesarias para que Discord refresque el thumbnail
- Sin URLs únicas, Discord cachea y no actualiza la imagen

### Cambio implementado:
- Reducido `RECONNECT_ACTIVITY_COUNT` de 100 a **50** (~8 min en vez de ~16 min)
- Objetivo: reconectar más frecuentemente para resetear el rate limit de Discord
- Similar a hacer "npm restart" parcial más seguido

### Balance identificado:
- **Pocas URLs únicas** → Discord cachea y no refresca thumbnail
- **Muchas URLs únicas** → Discord hace rate limit y deja de mostrar
- La reconexión frecuente podría ser el punto medio ideal

---

## Sesión 2026-01-13: Confirmación del rate limit y solución

### Resultados de prueba:
- **87 imágenes únicas** subidas antes de que el thumbnail desapareciera
- Reiniciar Discord (cliente) inmediatamente restauró el thumbnail
- Confirma el patrón: ~60-90 URLs únicas activan el rate limit del cliente Discord

### Hallazgo definitivo:
- **Reconectar RPC no es suficiente** - el rate limit está en el cliente Discord, no en la conexión
- **Reiniciar el cliente Discord** es la única forma de resetear el rate limit de imágenes externas
- El límite parece ser ~60-90 imágenes externas únicas por sesión de Discord

### Nueva funcionalidad implementada: Auto-reinicio de Discord
```env
# .env
AUTO_RESTART_DISCORD=true      # Activar reinicio automático (default: false)
DISCORD_RESTART_THRESHOLD=60   # Reiniciar después de X imágenes únicas (default: 60)
```

### Funcionamiento:
1. El servicio cuenta las imágenes únicas subidas a Imgur
2. Al alcanzar el umbral (default 60), cierra Discord automáticamente
3. Espera 2 segundos y lo vuelve a abrir
4. Reconecta el RPC y resetea el contador
5. El thumbnail vuelve a funcionar sin intervención manual

### Consideraciones:
- Opción desactivada por defecto (puede ser molesto para algunos usuarios)
- El reinicio de Discord cierra cualquier llamada en curso
- El proceso toma ~10 segundos en total

---

## Sesión 2026-01-16: Problema de instancia fantasma de MPC-HC

### Síntoma:
- Después de cambiar de monitor, la app dejó de mostrar Rich Presence en Discord
- Logs mostraban "MPC-HC no disponible" aunque MPC-HC estaba abierto con interfaz web activada

### Causa:
- **2 instancias de MPC-HC corriendo** - una instancia anterior no se cerró correctamente
- La app no podía conectar porque el puerto 13579 estaba siendo usado por la instancia incorrecta

### Solución:
- Cerrar todas las instancias de MPC-HC y abrir solo una
- Verificar con `tasklist | findstr mpc` si hay múltiples procesos

### Lección aprendida:
- Si MPC-HC "no responde" pero la interfaz web está activada, verificar si hay múltiples instancias corriendo
- El código de detección automática de monitores funciona correctamente

---

## Sesión 2026-02-12: Reloj de Discord (startTimestamp)

### Problema reportado:
- El reloj de "tiempo jugando" en Discord se reiniciaba a 0 cada vez que se actualizaba el estado (cada 10 segundos)
- Esto ocurría porque no se enviaba `startTimestamp` en `setActivity()`

### Solución implementada:
- Agregada variable `playbackStartTimestamp` para mantener el timestamp de inicio
- Se envía `startTimestamp` en cada llamada a `setActivity()` cuando está reproduciendo
- El timestamp se establece con `Date.now()` al iniciar reproducción de un archivo

### Comportamiento del reloj ahora:
- **Se reinicia** cuando cambia de archivo/capítulo (independiente del estado de reproducción)
- **No cuenta tiempo de pausa** - al reanudar, el timer descuenta la duración de la pausa
- **Muestra tiempo real viendo**, no la posición del video
- **No se muestra** cuando está pausado (Discord oculta el reloj sin timestamp)

### Nota sobre caché de Discord:
- Al limpiar actividad (`clearActivity`), Discord puede tardar en reflejar el cambio visualmente
- Presionar Ctrl+R en Discord fuerza el refresco de la UI
- El código funciona correctamente, es solo caché del cliente Discord

---

## Fórmula: Tiempo hasta Rate Limit de Discord

### Datos conocidos:
- **Rate limit**: ~60-90 URLs externas únicas por sesión de Discord
- **Umbral configurado**: 60 URLs (DISCORD_RESTART_THRESHOLD)

### Fórmula:
```
Tiempo hasta rate limit = URLs únicas × Intervalo de subida (minutos)
```

### Tabla de referencia (con umbral de 60 URLs):

| Intervalo | Tiempo hasta rate limit |
|-----------|-------------------------|
| 1 min     | 60 min = 1 hora         |
| 2 min     | 120 min = 2 horas       |
| 3 min     | 180 min = 3 horas       |
| 4 min     | 240 min = 4 horas       |
| 5 min     | 300 min = 5 horas       |

### Notas para pruebas:
- Si `AUTO_RESTART_DISCORD=true`, Discord se reinicia automáticamente al alcanzar el umbral
- Si `AUTO_RESTART_DISCORD=false`, el thumbnail desaparecerá al alcanzar ~60-90 URLs
- Para cambiar el intervalo, modificar `IMGUR_UPLOAD_INTERVAL` en .env (en milisegundos)

---

## Sesión 2026-02-13: Logging de progreso hacia rate limit

### Nueva funcionalidad:
Se agregó logging detallado para rastrear el progreso hacia el rate limit de Discord.

### Formato del log:
```
📊 Imagen #12/60 | Sesión: 36min | Rate limit estimado en: 2h 24min
```

### Log al iniciar:
```
Imgur: subida cada 180 segundos (3 min)
Rate limit estimado: 60 imágenes = 180 min
```

### Propósito:
- Verificar en tiempo real si la fórmula de rate limit se cumple
- Facilitar pruebas con diferentes intervalos de subida
- Tener datos concretos para ajustar `IMGUR_UPLOAD_INTERVAL`

### Próximos pasos:
- Monitorear logs con intervalo actual de 2 min
- ~~Si se confirma la fórmula, probar con 2.5 min o 2 min~~ ✅ Reducido a 2 min

---

## Sesión 2026-02-19: Reducción de intervalo a 2 minutos

### Análisis de logs (Feb 12-19):
- **8 días de logs, CERO desapariciones de thumbnail**
- **Máximo alcanzado: 102 imágenes** (Feb 14, 6h 20min) sin problemas
- Las reconexiones RPC cada ~8 min previenen efectivamente el rate limit
- El umbral de 60 imágenes es muy conservador — 102 funcionó perfecto

### Cambio realizado:
- `IMGUR_UPLOAD_INTERVAL`: 180000 → **120000** (3 min → 2 min)
- `PAUSED_REFRESH_INTERVAL`: 180000 → **120000** (3 min → 2 min)

### Justificación:
- Con 2 min, se necesitan ~204 min (3.4h) para llegar a 102 imágenes
- Margen de seguridad amplio dado que 102 imágenes no causaron problemas
- Thumbnails se actualizarán más rápido al cambiar de capítulo/estado

---

## Sesión 2026-02-24: Reducción de intervalo a 90 segundos

### Análisis de logs (Feb 19-24):
- **CERO desapariciones** de thumbnail en toda la semana
- **Máximo alcanzado: 183 imágenes** (Feb 23→24, sesión de 13h+) sin problemas
- `AUTO_RESTART_DISCORD` nunca se activó — las reconexiones RPC cada ~8 min son suficientes
- El umbral de 60 es muy conservador — 183 imágenes (3× el umbral) funcionó perfecto

### Datos por sesión (intervalo 2 min):

| Fecha | Máx imágenes | Duración sesión | ¿Desapareció? |
|-------|-------------|-----------------|---------------|
| Feb 19 | 65 | 7h 6min | ❌ No |
| Feb 20 | 67 | 8h 37min | ❌ No |
| Feb 23→24 | 183 | 13h+ | ❌ No |
| Feb 24 | 53 (nueva) | 2h 41min+ | ❌ No |

### Cambio realizado:
- `IMGUR_UPLOAD_INTERVAL`: 120000 → **90000** (2 min → 1.5 min)
- `PAUSED_REFRESH_INTERVAL`: 120000 → **90000** (2 min → 1.5 min)

### Justificación (fórmula: Tiempo = URLs × Intervalo):
- A 1.5 min, se necesitan ~274 min (4.5h) para llegar a 183 imágenes (máximo probado)
- Margen de seguridad amplio: 183 imágenes no causaron ningún problema
- Thumbnails se actualizarán 33% más rápido al cambiar de capítulo/estado
- Próxima revisión: verificar en unos días si 183+ imágenes siguen sin causar problemas

---

## Sesión 2026-03-06: Reducción de intervalo a 75 segundos (1 min 15s)

### Análisis de logs (Feb 27 - Mar 6, intervalo 90s):
- **10 días de logs, CERO desapariciones** de thumbnail
- **Máximo alcanzado: 357 imágenes** (Mar 5, sesión de 10h+) sin problemas
- `AUTO_RESTART_DISCORD` nunca se activó — las reconexiones RPC siguen siendo suficientes
- El umbral de 60 sigue siendo muy conservador — 357 imágenes (6× el umbral) funcionó perfecto

### Datos por sesión (intervalo 90s):

| Fecha | Máx imágenes | Duración sesión | ¿Desapareció? |
|-------|-------------|-----------------|---------------|
| Feb 27 | 228 | 10h 30min | ❌ No |
| Feb 28 | 272 | 10h 10min | ❌ No |
| Mar 1 | 287 | 12h 28min | ❌ No |
| Mar 2 | 194 | 11h 30min | ❌ No |
| Mar 3 | 235 | 10h 8min | ❌ No |
| Mar 4 | 298 | 10h 22min | ❌ No |
| Mar 5 | 357 | 10h 3min | ❌ No |
| Mar 6 | 340 | en curso | ❌ No |

### Cambio realizado:
- `IMGUR_UPLOAD_INTERVAL`: 90000 → **75000** (1.5 min → 1 min 15s)
- `PAUSED_REFRESH_INTERVAL`: 90000 → **75000** (1.5 min → 1 min 15s)

### Justificación (fórmula: Tiempo = URLs × Intervalo):
- A 1 min 15s, se necesitan ~446 min (7.4h) para llegar a 357 imágenes (máximo probado)
- Margen de seguridad amplio: 357 imágenes no causaron ningún problema
- Thumbnails se actualizarán 20% más rápido al cambiar de capítulo/estado
- Próxima revisión: verificar en unos días si el rendimiento se mantiene estable

---

## Sesión 2026-03-07: Bug de persistencia del Rich Presence al cerrar MPC-HC

### Síntoma:
- Al cerrar MPC-HC, Discord seguía mostrando la actividad "Jugando MPC-HC Player" con el último episodio
- Los logs mostraban "Actividad de Discord limpiada" cada 10 segundos, pero Discord no la eliminaba
- La presencia quedaba "fantasma" indefinidamente

### Causa raíz:
- `clearActivity()` usaba optional chaining: `this.client.user?.clearActivity()`
- Si `this.client.user` era `null`/`undefined`, la llamada no hacía nada pero **no reportaba error**
- El log "Actividad de Discord limpiada" se imprimía siempre, dando falsa confianza
- Además, se llamaba `clearActivity()` cada 10 segundos redundantemente sin verificar si ya estaba limpia

### Solución implementada:
1. **Flag `activityActive`**: Rastrea si hay una actividad activa en Discord, evita llamadas redundantes
2. **Verificación de `client.user`**: Si es `null`, desconecta el RPC como fallback (desconectar garantiza que Discord elimine la presencia)
3. **Fallback en error**: Si `clearActivity()` lanza error, desconecta RPC como último recurso
4. **Reconexión automática**: Cuando MPC-HC vuelve a estar disponible después de una desconexión, el loop principal reconecta automáticamente a Discord RPC

### Nota sobre presencia residual:
- Si la presencia ya quedó "pegada" antes del fix, **Ctrl+R en Discord** la elimina inmediatamente
- Esto es porque la actividad queda en la caché del cliente Discord y una conexión RPC nueva no tiene control sobre ella
- El fix previene que esto vuelva a ocurrir desconectando el RPC al cerrar MPC-HC

### Archivos modificados:
- `src/services/discord.service.ts`: `clearActivity()` robusto con fallback de desconexión
- `src/index.ts`: Reconexión automática cuando MPC-HC reaparece después de estar cerrado

---

## Sesión 2026-03-24: Reducción de intervalo a 60 segundos + Limpieza de títulos scene

### Análisis de logs (Mar 17-24, intervalo 75s):
- **8 días de logs, CERO desapariciones** de thumbnail
- **Máximo alcanzado: 183 imágenes** (Mar 19) sin problemas
- Las reconexiones RPC siguen siendo suficientes para prevenir rate limit

### Datos por sesión (intervalo 75s):

| Fecha | Máx imágenes | ¿Desapareció? |
|-------|-------------|---------------|
| Mar 17 | 81 | ❌ No |
| Mar 18 | 88 | ❌ No |
| Mar 19 | 183 | ❌ No |
| Mar 20 | 48 | ❌ No |
| Mar 21 | 113 | ❌ No |
| Mar 22 | 130 | ❌ No |
| Mar 23 | 43 | ❌ No |
| Mar 24 | 58 | ❌ No |

### Cambio 1 - Intervalo reducido:
- `IMGUR_UPLOAD_INTERVAL`: 75000 → **60000** (1 min 15s → 1 min)
- `PAUSED_REFRESH_INTERVAL`: 75000 → **60000** (1 min 15s → 1 min)

### Justificación:
- A 1 min, se necesitan ~183 min (3h) para llegar a 183 imágenes (máximo probado)
- Margen de seguridad amplio: 183 imágenes no causaron ningún problema
- Thumbnails se actualizarán 25% más rápido

### Cambio 2 - Limpieza de títulos formato scene:
Se mejoró `cleanFilename()` para detectar y limpiar nombres de archivo en formato scene (con puntos como separadores).

**Antes:**
```
The.Darwin.Incident.S01E12.Sexual.Dimorphism.1080p.AMDL.DUAL.DDP2.0.H.265.MSubs-ToonsHub
```

**Después:**
```
The Darwin Incident - S01E12 - Sexual Dimorphism
```

### Regex implementado:
```typescript
// Detectar formato scene (puntos como separadores con patrón SxxExx)
const sceneMatch = cleaned.match(/^(.+?)\.(S\d{2}E\d{2})\.(.+?)\.(\d{3,4}p|WEB|HDTV|BluRay)/i);
if (sceneMatch) {
  const showName = sceneMatch[1].replace(/\./g, ' ');
  const episode = sceneMatch[2].toUpperCase();
  const episodeTitle = sceneMatch[3].replace(/\./g, ' ');
  cleaned = `${showName} - ${episode} - ${episodeTitle}`;
}
```

### Archivos modificados:
- `src/config.ts`: Intervalo de subida a 60s
- `src/index.ts`: Intervalo de pausa a 60s
- `src/utils/helpers.ts`: Regex para limpiar títulos scene

---

## Sesión 2026-04-14: Fix reloj acumulado en pausas largas

### Problema reportado:
- El reloj verde de Discord seguía acumulando tiempo aunque el capítulo no se estuviera reproduciendo.
- Al retomar el mismo capítulo mucho después, el contador mostraba tiempos inflados (horas) hasta que se estabilizaba.

### Causa raíz:
- `startTimestamp` se mantenía como un timestamp de sesión y dependía de detectar transiciones `paused -> playing`.
- Si MPC-HC/Discord quedaban desincronizados en estado durante pausas largas, el reloj podía seguir corriendo.

### Solución implementada:
- El `startTimestamp` ahora se calcula en cada update usando la posición real del video:
```typescript
const playbackStartTimestamp = Date.now() - status.position;
```
- Así el reloj queda anclado al progreso real del capítulo y deja de acumular tiempo "fantasma".

### Archivo modificado:
- `src/index.ts`: cálculo de `startTimestamp` basado en `status.position`

### Ajuste posterior (mismo día):
- Se cambió a un enfoque de **tiempo reproducido acumulado** (no posición del capítulo):
  - Acumula solo cuando `status.state === 'playing'`
  - Se congela en pausa, detenido o MPC-HC no disponible
  - Al retomar el mismo capítulo, continúa desde el tiempo acumulado previo
  - Se resetea únicamente al cambiar de archivo/capítulo

---

## Sesión 2026-04-17: Fix de capítulo "pegado" en Discord

### Problema reportado:
- En algunos cambios de capítulo/archivo, Discord se quedaba mostrando el episodio anterior.
- En logs aparecía `INVALID_PAYLOAD` al enviar actividad.

### Causa raíz:
- `largeImageText` se enviaba con `status.file` completo.
- Algunos nombres de archivo superaban el límite de Discord (128 chars), provocando error y fallando `setActivity()`.
- Al fallar updates seguidos, la presencia podía quedar desactualizada visualmente.

### Solución implementada:
- Se agregó truncado defensivo a todos los textos de presencia antes de `setActivity()`:
  - `details`
  - `state`
  - `largeImageText`
  - `smallImageText`
- Nuevo helper interno en `DiscordService`: `truncateForDiscord()` con límite de 128 chars.

### Archivo modificado:
- `src/services/discord.service.ts`
