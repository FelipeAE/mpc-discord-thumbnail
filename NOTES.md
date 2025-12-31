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
| Imgur upload interval | 180s (3 min) | Mínimo entre subidas a Imgur |
| Paused refresh | 180s (3 min) | Re-subir imagen durante pausa |
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
