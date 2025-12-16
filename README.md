# MPC-HC Discord Rich Presence

Muestra en tu perfil de Discord lo que estás viendo en MPC-HC con thumbnail en vivo.

![Discord Rich Presence Example](https://i.imgur.com/example.png)

## Características

- Muestra el nombre del archivo que estás reproduciendo
- Thumbnail en vivo subido a Imgur
- Detecta estados: reproduciendo, pausado, detenido
- Compresión automática de imágenes (640px, 80% calidad)
- Detección de cambio de archivo (actualiza thumbnail inmediatamente)
- Limpieza automática de nombres de archivo (remueve tags de fansubs)
- Rotación diaria de logs (7 días de retención)
- Ejecución en background con PM2

## Requisitos

- [Node.js](https://nodejs.org/) v18 o superior
- [MPC-HC](https://github.com/clsid2/mpc-hc/releases) con Web Interface habilitada
- [Discord](https://discord.com/) abierto en tu PC
- Cuenta de [Imgur](https://imgur.com/) (para obtener Client ID)
- Aplicación de [Discord Developer](https://discord.com/developers/applications)

## Instalación

1. Clona el repositorio:
```bash
git clone https://github.com/FelipeAE/mpc-discord-thumbnail.git
cd mpc-discord-thumbnail
```

2. Instala las dependencias:
```bash
npm install
```

3. Copia el archivo de configuración:
```bash
cp .env.example .env
```

4. Edita `.env` con tus credenciales (ver sección Configuración)

## Configuración

### MPC-HC Web Interface

1. Abre MPC-HC
2. Ve a `View > Options` (o presiona `O`)
3. Navega a `Player > Web Interface`
4. Marca `Listen on port:` y deja el puerto `13579`
5. Aplica y reinicia MPC-HC

### Imgur Client ID

1. Ve a [https://api.imgur.com/oauth2/addclient](https://api.imgur.com/oauth2/addclient)
2. Inicia sesión o crea una cuenta
3. Rellena el formulario:
   - **Application name:** `MPC Discord Presence`
   - **Authorization type:** `Anonymous usage without user authorization`
   - **Authorization callback URL:** `https://localhost`
4. Copia el `Client ID` generado

### Discord Application ID

1. Ve a [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Click en `New Application`
3. Ponle un nombre (ej: `MPC-HC Player`)
4. Copia el `Application ID`

### Archivo .env

```env
# MPC-HC Web Interface
MPC_HOST=localhost
MPC_PORT=13579

# Imgur API
IMGUR_CLIENT_ID=tu_client_id_aqui
IMGUR_UPLOAD_INTERVAL=60000

# Discord Application
DISCORD_CLIENT_ID=tu_application_id_aqui

# Intervalo de actualización en ms
UPDATE_INTERVAL=15000
```

## Uso

### Comandos disponibles

| Comando | Descripción |
|---------|-------------|
| `npm start` | Inicia la app en background |
| `npm stop` | Detiene la app |
| `npm restart` | Reinicia la app |
| `npm run logs` | Ver logs en tiempo real |
| `npm run status` | Ver estado del proceso |
| `npm run dev` | Modo desarrollo (logs en consola) |

### Iniciar

```bash
npm start
```

### Ver logs

```bash
npm run logs
```

### Detener

```bash
npm stop
```

## Estructura del proyecto

```
mpc-discord-thumbnail/
├── src/
│   ├── index.ts              # Punto de entrada
│   ├── config.ts             # Configuración
│   ├── services/
│   │   ├── mpc-hc.service.ts # Comunicación con MPC-HC
│   │   ├── imgur.service.ts  # Subida a Imgur
│   │   ├── discord.service.ts # Discord Rich Presence
│   │   └── image.service.ts  # Compresión de imágenes
│   ├── types/
│   │   └── index.ts          # Tipos TypeScript
│   └── utils/
│       ├── logger.ts         # Sistema de logs
│       └── helpers.ts        # Utilidades
├── logs/                     # Logs diarios (auto-generado)
├── .env                      # Configuración (no incluido en git)
├── .env.example              # Ejemplo de configuración
└── package.json
```

## Notas

- Los thumbnails se suben a Imgur cada 1 minuto por defecto (configurable)
- La imagen se mantiene cuando pausas el video
- Al cambiar de archivo, el thumbnail se actualiza inmediatamente
- Los logs se guardan en `logs/app-YYYY-MM-DD.log` y se eliminan después de 7 días

## Licencia

MIT
