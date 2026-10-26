-- Tabla para registrar las descargas diarias exitosas por usuario (1 gratis por día UTC)
CREATE TABLE IF NOT EXISTS daily_downloads (
    user_id TEXT NOT NULL,
    download_date TEXT NOT NULL,
    success_count INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, download_date)
);

-- Tabla para almacenar pagos pendientes antes de ser confirmados por Telegram Stars
CREATE TABLE IF NOT EXISTS pending_payments (
    payment_payload TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    video_url TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para llevar el registro histórico de recargas y compras de estrellas por usuario
CREATE TABLE IF NOT EXISTS user_purchases (
    user_id TEXT PRIMARY KEY,
    purchase_count INTEGER DEFAULT 0,
    total_stars_spent INTEGER DEFAULT 0
);
