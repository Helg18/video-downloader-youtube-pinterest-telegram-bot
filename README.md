# Telegram Video Downloader Bot (Cloudflare Workers)

Bot de Telegram desarrollado para ejecutarse en el plan gratuito de **Cloudflare Workers**, sin almacenamiento temporal de videos (streaming/enlace directo) y monetizado mediante **Estrellas de Telegram (Telegram Stars)**.

---

## Características Principales

- **Sin Servidores (Serverless)**: Vive en Cloudflare Workers con costos de infraestructura a **$0**.
- **Sin Almacenamiento**: Los videos no se almacenan en ningún disco ni base de datos; se obtienen mediante enlaces directos a través de la API gratuita de **Cobalt** y se envían directamente a Telegram.
- **Límite Diario Gratuito**: Cada usuario tiene derecho a **1 descarga exitosa gratis por día**. Si la descarga falla (enlace caído o error), **no se consume el intento**, permitiendo probar con otro video.
- **Monetización con Estrellas**: Si el usuario ya usó su descarga gratuita, el bot genera automáticamente una factura de **20 Estrellas (`XTR`)** utilizando la pasarela nativa de pagos digitales de Telegram.
- **Comandos de Ayuda y Estadísticas**:
  - `/start`: Mensaje de bienvenida e introducción.
  - `/help`: Guía de ayuda con ejemplos concretos de URLs válidas (YouTube, Instagram, Facebook, Pinterest).
  - `/stats`: Muestra cuántas descargas gratuitas le quedan hoy al usuario, cuántas veces ha recargado con estrellas y el total de estrellas gastadas.
- **Base de Datos Ultrarrápida**: Utiliza **Cloudflare D1 (SQLite)** para registrar el historial de descargas diarias y recargas de estrellas de forma segura y atómica.

---

## Requisitos Previos

1. Una cuenta gratuita de [Cloudflare](https://dash.cloudflare.com/).
2. Node.js instalado en tu entorno local.
3. Un bot de Telegram creado a través de [@BotFather](https://t.me/BotFather) (asegúrate de habilitar los pagos si deseas probar las Estrellas de Telegram).

---

## Estructura del Proyecto

- `src/index.ts`: Código fuente principal del bot (comentado línea por línea en español).
- `schema.sql`: Estructura de tablas de la base de datos D1 (`daily_downloads`, `pending_payments`, `user_purchases`).
- `wrangler.toml`: Configuración de despliegue para Cloudflare Workers.
- `package.json`: Dependencias del proyecto.

---

## Guía de Instalación y Despliegue

### 1. Instalar dependencias
```bash
npm install
```

### 2. Autenticarse en Cloudflare
```bash
npx wrangler login
```

### 3. Crear la Base de Datos D1
```bash
npx wrangler d1 create telegram-bot-db
```
Copia el `database_id` que te devuelve la consola y pégalo en tu archivo `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "telegram-bot-db"
database_id = "TU_DATABASE_ID_AQUÍ"
```

### 4. Aplicar el Esquema SQL
- **Entorno local:**
  ```bash
  npx wrangler d1 execute telegram-bot-db --local --file=schema.sql
  ```
- **Producción (Cloudflare):**
  ```bash
  npx wrangler d1 execute telegram-bot-db --remote --file=schema.sql
  ```

### 5. Configurar el Token del Bot
```bash
npx wrangler secret put BOT_TOKEN
```
Ingresa el token proporcionado por `@BotFather`.

### 6. Desplegar a Cloudflare Workers
```bash
npx wrangler deploy
```
La consola te entregará una URL pública (ej. `https://telegram-video-bot.tu-usuario.workers.dev`).

### 7. Configurar el Webhook en Telegram
Ejecuta el siguiente comando en tu terminal reemplazando `<TU_BOT_TOKEN>` y tu URL:
```bash
curl -X POST "https://api.telegram.org/bot<TU_BOT_TOKEN>/setWebhook?url=https://telegram-video-bot.tu-usuario.workers.dev/webhook"
```

---

## Arquitectura y Regla de Oro

Todo el código fuente se encuentra comentado rigurosamente línea por línea y bloque por bloque en **español** (`src/index.ts`), cumpliendo con la regla de oro solicitada.
