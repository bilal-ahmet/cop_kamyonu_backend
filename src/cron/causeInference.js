/**
 * Bir aracın neden veri göndermediğine dair TAHMİN üretir.
 *
 * Backend'in elindeki tek gerçek bilgi "veri gelmedi"dir. Bu tek başına "internet kesildi"
 * demek değildir; cihaz kapalı olabilir, firmware donmuş olabilir, sensör panelde pasif
 * yapılmış olabilir ya da araç park halinde olabilir. Cihaz firmware'ine (heartbeat, sinyal
 * gücü, uptime) erişimimiz olmadığı için sebep kesin bilinemez — bu yüzden burada üretilen
 * her şey "tahmin + güven seviyesi + dayanak"tır, kesin teşhis değil.
 *
 * Sinyal #1 (filo geneli korelasyon) araç seviyesinde değil filo seviyesinde karar verilir;
 * connectivityWatch.js içinde ele alınır ve bu modüle hiç gelinmez.
 */
const pool = require('../db');

/** Bu değerin altındaki batarya, sessizliğin güç kaynaklı olabileceğine işaret sayılır. */
const LOW_BATTERY_MV = parseInt(process.env.LOW_BATTERY_MV, 10) || 11500;

/** Son paketler arasında bu kadar mV düşüş "batarya tükeniyor" sayılır. */
const BATTERY_DROP_MV = 300;

/**
 * Sinyaller yalnızca sessizlikten HEMEN ÖNCEKİ bu pencereye bakar.
 * Sadece "son N paket" demek yetmez: araç uzun süre önce birkaç paket gönderip sustuysa,
 * çok daha eski kayıtlar listeye karışır ve tahmini bozar.
 */
const LOOKBACK_MINUTES = 60;

/**
 * Cihazın internet yokken veriyi biriktirip sonra topluca gönderip göndermediği projeye
 * özgü bir davranıştır ve doğrulanmadan güvenilemez: `recorded_at` cihaz saatidir, saat
 * kayması da aynı görüntüyü verir. Doğrulama yöntemi README/plan'daki teşhis sorgusudur —
 * gerçek saha verisiyle çalıştırılıp sonuç netleşince bu bayrak açılır.
 */
const BACKFILL_ENABLED = process.env.BACKFILL_ENABLED === 'true';

/** Bu süreden büyük `received_at - recorded_at` farkı "cihazda birikmiş veri" sayılır. */
const BACKFILL_MIN_LAG_MINUTES = 2;

/** Sebep kodlarının Türkçe karşılıkları — bildirim metinlerinde kullanılır. */
const CAUSE_LABELS = {
  connectivity:  'bağlantı/kapsama sorunu',
  power:         'güç veya batarya sorunu',
  sensor_config: 'sensör tanımı/ayarı',
  system_outage: 'sistem geneli veri akışı kesintisi',
  parked:        'aracın park halinde olması',
  unknown:       'bilinmiyor',
};

const CONFIDENCE_LABELS = {
  low:       'düşük güven',
  medium:    'orta güven',
  high:      'yüksek güven',
  confirmed: 'doğrulandı',
};

/**
 * Sinyal #2 — Cihaz sunucuya ULAŞIYOR ama sensör tanınmıyor.
 * /api/telemetry'e gelip 401 yiyen istekler kaydediliyor (bkz. telemetryController).
 * Sessizlik başladıktan sonra böyle bir deneme varsa internet vardır, sorun tanımdadır.
 */
async function checkAuthFailures(vehicleId, silentSince) {
  const { rows } = await pool.query(
    `SELECT f.serial_number, f.reason, f.attempt_count, f.last_attempt_at
     FROM sensor_auth_failures f
     LEFT JOIN sensors s ON s.serial_number = f.serial_number
     WHERE COALESCE(f.vehicle_id, s.vehicle_id) = $1
       AND f.last_attempt_at >= $2
     ORDER BY f.last_attempt_at DESC
     LIMIT 1`,
    [vehicleId, silentSince]
  );
  if (rows.length === 0) return null;

  const f = rows[0];
  const detail = f.reason === 'stale_cache'
    ? 'sensör veritabanında aktif ama sunucu cache\'inde yok (cache yenilenmeli)'
    : f.reason === 'inactive_sensor'
      ? 'sensör panelde pasif durumda'
      : 'seri numarası kayıtlı değil';

  return {
    cause: 'sensor_config',
    confidence: 'high',
    detail: `Cihaz sunucuya ulaşıyor fakat kabul edilmiyor — ${detail}.`,
    evidence: [`auth_failure=${f.reason}`, `serial=${f.serial_number}`, `attempts=${f.attempt_count}`],
  };
}

/**
 * Sinyal #4 — Batarya trendi.
 * Sessizlikten önceki son paketlerde batarya eşiğin altındaysa veya belirgin düşüşteyse,
 * sessizlik büyük ihtimalle güç kaynaklıdır (internet değil).
 */
async function checkBattery(vehicleId, silentSince) {
  const { rows } = await pool.query(
    `SELECT battery_mv
     FROM telemetry
     WHERE vehicle_id = $1
       AND battery_mv IS NOT NULL
       AND received_at > $2::timestamptz - make_interval(mins => $3)
     ORDER BY received_at DESC
     LIMIT 10`,
    [vehicleId, silentSince, LOOKBACK_MINUTES]
  );
  if (rows.length === 0) return null;

  const newest = rows[0].battery_mv;
  const oldest = rows[rows.length - 1].battery_mv;

  if (newest <= LOW_BATTERY_MV) {
    return {
      cause: 'power',
      confidence: 'medium',
      detail: `Son ölçülen batarya ${newest} mV, eşiğin (${LOW_BATTERY_MV} mV) altında.`,
      evidence: [`battery_mv=${newest}`, `threshold=${LOW_BATTERY_MV}`],
    };
  }

  if (rows.length >= 3 && oldest - newest >= BATTERY_DROP_MV) {
    return {
      cause: 'power',
      confidence: 'medium',
      detail: `Batarya sessizlik öncesinde düşüşteydi (${oldest} → ${newest} mV).`,
      evidence: [`battery_drop=${oldest - newest}mV`, `battery_mv=${newest}`],
    };
  }

  return null;
}

/**
 * Sinyal #5 — Araç zaten kullanımda değil.
 * Sessizlikten önce hiç hareket yoksa VE aracın aktif şoför ataması yoksa, sessizlik
 * muhtemelen normaldir (kontak kapalı, garajda). Bu durumda uyarı bilgi seviyesine iner.
 */
async function checkParked(vehicleId, silentSince) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE motion IS TRUE OR speed_kmh > 3) AS hareketli,
            COUNT(*)                                                AS toplam
     FROM (
       SELECT motion, speed_kmh
       FROM telemetry
       WHERE vehicle_id = $1
         AND received_at > $2::timestamptz - make_interval(mins => $3)
       ORDER BY received_at DESC
       LIMIT 30
     ) son_paketler`,
    [vehicleId, silentSince, LOOKBACK_MINUTES]
  );
  const { hareketli, toplam } = rows[0];
  if (Number(toplam) < 5 || Number(hareketli) > 0) return null;

  const { rowCount: aktifAtama } = await pool.query(
    `SELECT 1 FROM vehicle_assignments
     WHERE vehicle_id = $1 AND (released_date IS NULL OR released_date >= CURRENT_DATE)
     LIMIT 1`,
    [vehicleId]
  );
  if (aktifAtama > 0) return null;

  return {
    cause: 'parked',
    confidence: 'medium',
    detail: 'Araç sessizlikten önce hareketsizdi ve aktif şoför ataması yok — park halinde olabilir.',
    evidence: [`son_${toplam}_pakette_hareket_yok`, 'aktif_atama_yok'],
  };
}

/**
 * Sessizliğin sebebini tahmin eder. İlk eşleşen sinyal kazanır.
 * Hiçbiri eşleşmezse varsayılan "bağlantı" tahminidir — ama DÜŞÜK güvenle, çünkü bu
 * gerçekten bir çıkarım değil, sadece en olası varsayımdır.
 */
async function inferCause(vehicleId, silentSince) {
  try {
    const signals = [
      () => checkAuthFailures(vehicleId, silentSince),
      () => checkBattery(vehicleId, silentSince),
      () => checkParked(vehicleId, silentSince),
    ];

    for (const signal of signals) {
      const hit = await signal();
      if (hit) return hit;
    }
  } catch (err) {
    // Tahmin üretilemezse bildirim yine de çıkmalı — sadece sebebi bilinmez olur.
    console.error('[CauseInference] Sinyal değerlendirilemedi:', err.code || '', err.message);
    return {
      cause: 'unknown',
      confidence: 'low',
      detail: 'Sebep tahmini üretilemedi.',
      evidence: ['inference_error'],
    };
  }

  return {
    cause: 'connectivity',
    confidence: 'low',
    detail: 'Belirgin bir başka işaret yok; bağlantı/kapsama kaynaklı olması muhtemel.',
    evidence: ['varsayilan_tahmin'],
  };
}

/**
 * Sinyal #3 — Geriye dönük kesinleştirme.
 * Veri akışı geri geldiğinde, gelen kayıtlarda `received_at - recorded_at` farkı büyükse
 * cihaz kesinti boyunca ÇALIŞIYORDU ve veriyi biriktirmiş demektir; yani sessizliğin sebebi
 * kesin olarak bağlantı kesintisidir. BACKFILL_ENABLED kapalıyken hiç sorgulanmaz.
 */
async function detectBackfill(vehicleId, silentSince) {
  if (!BACKFILL_ENABLED || !silentSince) return null;

  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS birikmis, MAX(received_at - recorded_at) AS en_buyuk_gecikme
       FROM telemetry
       WHERE vehicle_id = $1
         AND received_at >= $2
         AND received_at - recorded_at > make_interval(mins => $3)`,
      [vehicleId, silentSince, BACKFILL_MIN_LAG_MINUTES]
    );
    if (rows[0].birikmis === 0) return null;

    return {
      cause: 'connectivity',
      confidence: 'confirmed',
      detail: `Kesinti süresince ${rows[0].birikmis} kayıt cihazda birikmiş ve bağlantı gelince gönderilmiş — cihaz çalışıyordu, sorun bağlantıdaydı.`,
      evidence: [`backfilled_rows=${rows[0].birikmis}`],
    };
  } catch (err) {
    console.error('[CauseInference] Backfill kontrolü başarısız:', err.code || '', err.message);
    return null;
  }
}

module.exports = {
  inferCause,
  detectBackfill,
  CAUSE_LABELS,
  CONFIDENCE_LABELS,
  LOW_BATTERY_MV,
  BACKFILL_ENABLED,
};
