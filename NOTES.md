# MPC-HC Discord Thumbnail - Notas de Desarrollo

## Última actualización: 2025-12-22

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
```
- Reconecta automáticamente cada 100 actualizaciones O 30 minutos
- Solo cuenta cuando hay actividad real (reproduciendo/pausado)
- Resetea contadores después de reconectar

### 3. Refresh de imagen durante pausa
```typescript
// index.ts
const PAUSED_REFRESH_INTERVAL = 60000; // 1 minuto
```
- Cuando está pausado, re-sube la misma imagen cada 1 minuto con nueva URL
- Guarda el snapshot de pausa para reutilizar (no captura de nuevo)
- Intenta mantener el thumbnail visible durante pausas largas

---

## Logging agregado para debug:

### Discord Service:
- Log del resultado de `setActivity` cada 10 actualizaciones
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
| Imgur upload interval | 60s | Mínimo entre subidas a Imgur |
| Paused refresh | 60s | Re-subir imagen durante pausa |
| Discord reconnect | 100 updates / 30 min | Reconexión preventiva |
| Image compression | 640px, 80% quality | Tamaño de thumbnails |

---

## Ideas pendientes por probar:

1. **Usar imagen estática como fallback**: Registrar una imagen en Discord Developer Portal y usarla cuando las externas fallan

2. **Detectar cuando Discord rechaza imagen**: Verificar la respuesta de `setActivity` más a fondo

3. **Reducir frecuencia de nuevas URLs**: Quizás Discord penaliza por cambiar URLs muy seguido

4. **Proxy de imágenes**: Usar un servicio propio en lugar de Imgur directo

5. **Discord Application Assets**: Subir imágenes directamente a Discord en lugar de usar URLs externas

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
