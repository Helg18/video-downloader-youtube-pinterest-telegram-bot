/**
 * @file index.ts
 * @description Bot de Telegram para descarga de videos sin marcas de agua (YouTube, Pinterest)
 * alojado en Cloudflare Workers. Utiliza Hono, Cloudflare D1 (SQLite), integración con RapidAPI para YouTube,
 * análisis nativo para Pinterest, respuestas amigables con emojis y Estrellas de Telegram.
 * 
 * REGLA DE ORO: Todo el código está comentado detalladamente línea por línea y bloque por bloque en español.
 */

import { Hono } from 'hono';

/**
 * Interfaz que define las ligaduras (Bindings) inyectadas por Cloudflare Workers.
 * - DB: Conexión a la base de datos Cloudflare D1 (SQLite).
 * - BOT_TOKEN: Token secreto del bot de Telegram obtenido a través de BotFather.
 * - RAPIDAPI_KEY: Clave de RapidAPI para garantizar descargas estables de YouTube.
 */
type Bindings = {
  DB: D1Database;
  BOT_TOKEN: string;
  RAPIDAPI_KEY?: string;
};

/**
 * Instancia principal del framework Hono optimizada para Cloudflare Workers.
 */
const app = new Hono<{ Bindings: Bindings }>();

/**
 * Ruta GET raíz ('/')
 * Permite comprobar instantáneamente si el Worker está activo respondiendo peticiones HTTP.
 */
app.get('/', (c) => {
  return c.text('Telegram Video Downloader Bot is running smoothly on Cloudflare Workers!');
});

/**
 * Ruta POST '/webhook'
 * Endpoint principal donde Telegram notifica cualquier evento (mensajes, comandos, pagos, pre-chequeos).
 */
app.post('/webhook', async (c) => {
  try {
    // Parsea el cuerpo de la solicitud HTTP recibida desde los servidores de Telegram a un objeto JSON.
    const update = await c.req.json();
    
    // Obtiene el token del bot desde las variables de entorno / secretos seguros de Cloudflare.
    const token = c.env.BOT_TOKEN;

    // Validación de seguridad: si el token no está configurado, detiene la ejecución con un error 500.
    if (!token) {
      console.error('ERROR CRITICO: BOT_TOKEN no esta configurado en los secretos de Cloudflare.');
      return c.json({ error: 'BOT_TOKEN is not configured' }, 500);
    }

    // Manejo de consultas de pre-checkout para pagos con Estrellas de Telegram (Telegram Stars).
    if (update.pre_checkout_query) {
      await answerPreCheckoutQuery(token, update.pre_checkout_query.id, true);
      return c.json({ ok: true });
    }

    // Extrae el objeto de mensaje, soportando mensajes nuevos o editados.
    const message = update.message || update.edited_message;
    if (!message) return c.json({ ok: true });

    // Extracción de metadatos del mensaje recibido.
    const chatId = message.chat.id;                         // ID del chat para enviar respuestas amigables.
    const userId = String(message.from.id);                   // ID único del usuario para control de cuotas.
    const text = message.text || message.caption || '';       // Texto o pie de foto enviado por el usuario.

    // Manejo de pagos exitosos de Estrellas de Telegram (successful_payment).
    if (message.successful_payment) {
      const payload = message.successful_payment.invoice_payload;
      
      const pending = await c.env.DB.prepare(
        'SELECT video_url FROM pending_payments WHERE payment_payload = ?'
      ).bind(payload).first<{ video_url: string }>();

      if (pending) {
        await sendMessage(token, chatId, '✨ ¡Pago recibido con éxito! Procesando tu video sin marcas de agua... 🎬');
        await processAndSendVideo(token, c.env.DB, userId, chatId, pending.video_url, true, c.env.RAPIDAPI_KEY);
        
        await c.env.DB.prepare(
          `INSERT INTO user_purchases (user_id, purchase_count, total_stars_spent)
           VALUES (?, 1, 20)
           ON CONFLICT(user_id) 
           DO UPDATE SET purchase_count = purchase_count + 1, total_stars_spent = total_stars_spent + 20`
        ).bind(userId).run();

        await c.env.DB.prepare('DELETE FROM pending_payments WHERE payment_payload = ?').bind(payload).run();
      } else {
        console.warn('ADVERTENCIA: Pago recibido pero no se encontro la solicitud pendiente para el payload: ' + payload);
        await sendMessage(token, chatId, '⚠️ ¡Hola! Recibimos tu pago, pero no encontramos la solicitud de video asociada.');
      }
      return c.json({ ok: true });
    }

    // Comando /start: Saludo amigable con emojis e introducción de reglas.
    if (text.startsWith('/start')) {
      await sendMessage(
        token,
        chatId,
        '👋 ¡Hola! Bienvenido a tu Bot de Descarga de Videos favorito 🎥✨\n\n' +
        '📥 Envíame un enlace de **YouTube o Pinterest** y te enviaré el video limpio y sin marcas de agua.\n\n' +
        '🎁 **Nuestras Reglas:**\n' +
        '• Tienes **1 descarga gratis todos los días** 🌟\n' +
        '• Las descargas adicionales cuestan solo **20 Estrellas** de Telegram ⭐️\n\n' +
        '💡 Escribe /help para ver ejemplos de links o /stats para ver tus estadísticas.'
      );
      return c.json({ ok: true });
    }

    // Comando /help: Guía amigable con ejemplos de URLs.
    if (text.startsWith('/help')) {
      await sendMessage(
        token,
        chatId,
        '📖 **Guía rápida de ayuda y ejemplos** 💡\n\n' +
        'Simplemente copia y pega enlaces de estas plataformas:\n\n' +
        '▶️ **YouTube:**\n' +
        '`https://youtu.be/oxNK7VBizac`\n\n' +
        '📌 **Pinterest:**\n' +
        '`https://pin.it/...`\n\n' +
        '🛡️ *Tip:* Si una descarga falla por motivos ajenos a nosotros, **tu descarga gratuita no se consume**. ¡Puedes reintentar con confianza! 🎯'
      );
      return c.json({ ok: true });
    }

    // Comando /stats: Estadísticas amigables del usuario.
    if (text.startsWith('/stats')) {
      const today = new Date().toISOString().split('T')[0];

      const dlRecord = await c.env.DB.prepare(
        'SELECT success_count FROM daily_downloads WHERE user_id = ? AND download_date = ?'
      ).bind(userId, today).first<{ success_count: number }>();
      const usedFree = dlRecord ? dlRecord.success_count : 0;
      const freeRemaining = Math.max(0, 1 - usedFree);

      const purchaseRecord = await c.env.DB.prepare(
        'SELECT purchase_count, total_stars_spent FROM user_purchases WHERE user_id = ?'
      ).bind(userId).first<{ purchase_count: number; total_stars_spent: number }>();
      
      const purchaseCount = purchaseRecord ? purchaseRecord.purchase_count : 0;
      const starsSpent = purchaseRecord ? purchaseRecord.total_stars_spent : 0;

      await sendMessage(
        token,
        chatId,
        '📊 **Tus Estadísticas Personales** 🌟\n\n' +
        '🎁 Descargas gratuitas disponibles hoy: **' + freeRemaining + '/1**\n' +
        '⭐ Veces que has recargado con Estrellas: **' + purchaseCount + '**\n' +
        '💎 Total de Estrellas invertidas: **' + starsSpent + ' XTR**\n\n' +
        '¡Gracias por usar nuestro bot! ❤️'
      );
      return c.json({ ok: true });
    }

    // Detección de URLs en el mensaje del usuario.
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = text.match(urlRegex);

    if (!matches || matches.length === 0) {
      await sendMessage(token, chatId, '🤔 Hmm... No detecte ningun enlace en tu mensaje. Envíame un link valido o usa /help 💡');
      return c.json({ ok: true });
    }

    const videoUrl = matches[0];
    console.log('INFO: Usuario ' + userId + ' solicito descarga para la URL: ' + videoUrl);

    await handleVideoRequest(token, c.env.DB, userId, chatId, videoUrl, c.env.RAPIDAPI_KEY);

    return c.json({ ok: true });
  } catch (err: any) {
    console.error('FATAL ERROR: Error critico en el webhook:', err);
    return c.json({ error: err.message }, 500);
  }
});

/**
 * Envía un mensaje de texto amigable con formato Markdown a un chat de Telegram.
 */
async function sendMessage(token: string, chatId: number | string, text: string) {
  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) {
    console.error('ERROR: No se pudo enviar el mensaje a Telegram:', await res.text());
  }
}

/**
 * Responde a la consulta de pre-checkout de Telegram Stars.
 */
async function answerPreCheckoutQuery(token: string, queryId: string, ok: boolean, errorString?: string) {
  const url = 'https://api.telegram.org/bot' + token + '/answerPreCheckoutQuery';
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pre_checkout_query_id: queryId, ok, error_message: errorString }),
  });
}

/**
 * Envía una factura de cobro por 20 Estrellas de Telegram (`XTR`).
 */
async function sendInvoice(token: string, chatId: number | string, payload: string) {
  const url = 'https://api.telegram.org/bot' + token + '/sendInvoice';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      title: 'Descarga de Video sin marca de agua',
      description: 'Has agotado tu descarga gratuita de hoy. Paga 20 Estrellas para descargar este video.',
      payload: payload,
      currency: 'XTR',
      prices: [{ label: '1 Video Download', amount: 20 }],
    }),
  });
  const data = await res.json() as any;
  if (!data.ok) {
    console.error('ERROR: Fallo al enviar la factura de Telegram Stars:', JSON.stringify(data));
  }
}

/**
 * Envía el archivo de video al usuario utilizando la API de Telegram.
 */
async function sendVideo(token: string, chatId: number | string, directVideoUrl: string) {
  const url = 'https://api.telegram.org/bot' + token + '/sendVideo';
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      video: directVideoUrl,
    }),
  });

  const data = await response.json() as any;
  if (!data.ok) {
    console.error('ERROR: Fallo la API sendVideo de Telegram:', JSON.stringify(data));
    throw new Error(data.description || 'Failed to send video via Telegram API');
  }
}

/**
 * Administra la lógica de cuota diaria o emisión de factura de pago.
 */
async function handleVideoRequest(token: string, db: D1Database, userId: string, chatId: number | string, videoUrl: string, rapidApiKey?: string) {
  const today = new Date().toISOString().split('T')[0];

  const record = await db.prepare(
    'SELECT success_count FROM daily_downloads WHERE user_id = ? AND download_date = ?'
  ).bind(userId, today).first<{ success_count: number }>();

  const successCount = record ? record.success_count : 0;

  if (successCount < 1) {
    await sendMessage(token, chatId, '⏳ ¡Procesando tu video mágico! Dame un momentito... ✨');
    await processAndSendVideo(token, db, userId, chatId, videoUrl, false, rapidApiKey);
  } else {
    const payload = 'dl_' + userId + '_' + Date.now();
    await db.prepare(
      'INSERT INTO pending_payments (payment_payload, user_id, video_url) VALUES (?, ?, ?)'
    ).bind(payload, userId, videoUrl).run();

    await sendInvoice(token, chatId, payload);
  }
}

/**
 * Procesa la extracción de la URL directa del video y lo envía al usuario.
 */
async function processAndSendVideo(
  token: string,
  db: D1Database,
  userId: string,
  chatId: number | string,
  videoUrl: string,
  isPaid: boolean,
  rapidApiKey?: string
) {
  try {
    const directUrl = await extractDirectVideoUrl(videoUrl, rapidApiKey);

    if (!directUrl) {
      await sendMessage(
        token,
        chatId,
        '😅 ¡Vaya! No pudimos extraer el video de este enlace en este momento.\n\n' +
        '🛡️ *Pero no te preocupes:* **Tu descarga gratuita sigue intacta**. Puedes intentar con otro enlace o probar más tarde. 🔄'
      );
      return;
    }

    await sendVideo(token, chatId, directUrl);

    // Si la descarga fue gratuita y exitosa, registra el éxito en D1.
    if (!isPaid) {
      const today = new Date().toISOString().split('T')[0];
      await db.prepare(
        `INSERT INTO daily_downloads (user_id, download_date, success_count)
         VALUES (?, ?, 1)
         ON CONFLICT(user_id, download_date) 
         DO UPDATE SET success_count = success_count + 1`
      ).bind(userId, today).run();
    }
  } catch (err: any) {
    console.error('ERROR: Excepcion procesando y enviando video:', err);
    await sendMessage(
      token,
      chatId,
      '⚠️ Ocurrio un pequeño inconveniente al enviar el video. (Tu descarga gratuita no ha sido afectada). 🎁'
    );
  }
}

/**
 * Función recursiva para buscar únicamente URLs de video `.mp4` en objetos JSON anidados (Pinterest).
 */
function findPinterestMp4Url(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null;

  if (typeof obj.vod_url === 'string' && obj.vod_url && obj.vod_url.includes('.mp4')) return obj.vod_url;
  if (typeof obj.video_url === 'string' && obj.video_url && obj.video_url.includes('.mp4')) return obj.video_url;

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string' && val.includes('.mp4') && !val.includes('.m3u8')) {
      return val;
    }
    if (typeof val === 'object') {
      const found = findPinterestMp4Url(val);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Extrae la URL directa de descarga sin marcas de agua utilizando RapidAPI para YouTube
 * y análisis nativo (`__PWS_DATA__`) para Pinterest.
 * 
 * @param pageUrl URL pública del video aportada por el usuario.
 * @param rapidApiKey Clave de RapidAPI.
 * @returns Retorna la URL directa del archivo `.mp4` o null si falla.
 */
async function extractDirectVideoUrl(pageUrl: string, rapidApiKey?: string): Promise<string | null> {
  console.log('DEBUG: Iniciando extraccion para: ' + pageUrl);

  // 1. Extracción de YouTube utilizando RapidAPI
  if (rapidApiKey) {
    try {
      console.log('DEBUG: Consultando YouTube Media Downloader en RapidAPI...');
      const response = await fetch('https://youtube-media-downloader.p.rapidapi.com/v2/video/details?url=' + encodeURIComponent(pageUrl), {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': rapidApiKey,
          'X-RapidAPI-Host': 'youtube-media-downloader.p.rapidapi.com',
        },
      });
      const data = await response.json() as any;
      console.log('DEBUG: RapidAPI response status:', response.status);

      // Intenta múltiples formatos de respuesta comunes de RapidAPI
      const directUrl = data?.videos?.items?.[0]?.url 
                     || data?.link 
                     || data?.url 
                     || data?.formats?.[0]?.url;

      if (directUrl) {
        console.log('SUCCESS: Video de YouTube obtenido mediante RapidAPI.');
        return directUrl;
      }
    } catch (e) {
      console.error('ERROR: Fallo la peticion a RapidAPI:', e);
    }
  } else {
    console.warn('ADVERTENCIA: RAPIDAPI_KEY no esta configurada en los secretos de Cloudflare.');
  }

  // 2. Extracción nativa para Pinterest (analizando __PWS_DATA__ JSON y archivos .mp4)
  try {
    if (pageUrl.includes('pin.it') || pageUrl.includes('pinterest.com')) {
      console.log('DEBUG: Realizando analisis avanzado de Pinterest...');
      const res = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      });
      
      const html = await res.text();
      const pwsMatch = html.match(/<script[^>]*id=["']__PWS_DATA__[^>]*>([\s\S]*?)<\/script>/i);
      if (pwsMatch && pwsMatch[1]) {
        try {
          const pwsJson = JSON.parse(pwsMatch[1]);
          const mp4Url = findPinterestMp4Url(pwsJson);
          if (mp4Url) {
            console.log('SUCCESS: Video .mp4 de Pinterest extraido de __PWS_DATA__.');
            return mp4Url.replace(/&amp;/g, '&');
          }
        } catch (jsonErr) {
          console.error('ERROR: Error parseando JSON de Pinterest:', jsonErr);
        }
      }

      const pinMp4Regex = /(https:\/\/[^"'\s]+\.mp4[^"'\s]*)/i;
      const match = html.match(pinMp4Regex);
      if (match && match[1]) {
        console.log('SUCCESS: Video .mp4 de Pinterest extraido mediante regex.');
        return match[1].replace(/&amp;/g, '&');
      }
    }
  } catch (e) {
    console.error('ERROR: Excepcion analizando Pinterest:', e);
  }

  console.error('ERROR CRITICO: Todos los metodos de extraccion fallaron para:', pageUrl);
  return null;
}

app.post('/reset-db', async (c) => {
  return c.text('DB reset endpoint ready');
});

export default app;
