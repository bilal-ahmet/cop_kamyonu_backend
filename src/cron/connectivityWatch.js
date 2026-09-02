/**
 * Araçlardan veri akışını izler ve kesildiğinde bildirim üretir.
 *
 * Her dakika tarar; bildirim ise yapılandırılan aralıkla (varsayılan 5 dk) tekrarlanır.
 * Bildirim metni bilinçli olarak NÖTR'dür ("veri gelmiyor"), çünkü backend sessizliğin
 * sebebini kesin bilemez — sebep, causeInference.js'in ürettiği bir tahmin olarak eklenir.
 *
 * Durum bellekte değil `vehicle_connection_state` tablosunda tutulur: sunucu yeniden
 * başlasa da mükerrer bildirim çıkmaz ve tekrar sayacı korunur.
 */
const cron = require('node-cron');
const pool = require('../db');
const { inferCause, detectBackfill, CAUSE_LABELS, CONFIDENCE_LABELS } = require('./causeInference');
const notificationService = require('../services/notificationService');

/** Bu kadar dakikadır veri gelmiyorsa araç "sessiz" sayılır. */
const SILENCE_THRESHOLD_MINUTES = parseInt(process.env.SILENCE_THRESHOLD_MINUTES, 10) || 5;

/** Sessizlik sürdüğü sürece bildirimin tekrar aralığı. */
const SILENCE_REPEAT_MINUTES = parseInt(process.env.SILENCE_REPEAT_MINUTES, 10) || 5;

/** Araç park halinde görünüyorsa uyarı daha seyrek tekrarlanır (gürültü kontrolü). */
const PARKED_REPEAT_MINUTES = parseInt(process.env.PARKED_REPEAT_MINUTES, 10) || 30;

/** İzlenen araçların bu oranı birden susarsa sorun araçlarda değil bizdedir. */
const OUTAGE_RATIO = parseFloat(process.env.OUTAGE_RATIO) || 0.6;

/** Filo geneli kararı için gereken en az araç sayısı (2 araçlık filoda oran anlamsız). */
const OUTAGE_MIN_VEHICLES = 3;

/** Bu süreyi aşan sessizlik kritik sayılır. */
const CRITICAL_AFTER_MINUTES = 60;

const MS_PER_MINUTE = 60 * 1000;

/** Bildirim metinlerinde kullanılan yerel zaman biçimi. */
function formatTime(date) {
  return new Date(date).toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function minutesSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / MS_PER_MINUTE);
}

/**
 * İzlenen araçlar: aktif, en az bir aktif sensörü olan ve en az bir kez veri göndermiş
 * olanlar. Hiç veri göndermemiş yeni bir araç uyarı üretmez (kurulum henüz yapılmamış olabilir).
 *
 * `received_at` kullanılır, `recorded_at` değil: sorulan şey verinin sunucuya ULAŞIP
 * ulaşmadığıdır; `recorded_at` cihaz saatidir ve kayabilir.
 */
const FLEET_QUERY = `
  SELECT v.id, v.plate, v.user_id,
         son.last_seen_at,
         (son.last_seen_at < NOW() - make_interval(mins => $1)) AS is_silent,
         cs.is_online, cs.silent_since, cs.last_notified_at, cs.last_cause
  FROM vehicles v
  JOIN LATERAL (
      SELECT MAX(t.received_at) AS last_seen_at
      FROM telemetry t
      WHERE t.vehicle_id = v.id
  ) son ON TRUE
  LEFT JOIN vehicle_connection_state cs ON cs.vehicle_id = v.id
  WHERE v.is_active = TRUE
    AND son.last_seen_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM sensors s WHERE s.vehicle_id = v.id AND s.is_active = TRUE)
`;

async function upsertState(vehicleId, state) {
  await pool.query(
    `INSERT INTO vehicle_connection_state
       (vehicle_id, is_online, last_seen_at, silent_since, last_notified_at, last_cause, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (vehicle_id) DO UPDATE SET
       is_online        = EXCLUDED.is_online,
       last_seen_at     = EXCLUDED.last_seen_at,
       silent_since     = EXCLUDED.silent_since,
       last_notified_at = EXCLUDED.last_notified_at,
       last_cause       = EXCLUDED.last_cause,
       updated_at       = NOW()`,
    [vehicleId, state.isOnline, state.lastSeenAt, state.silentSince,
     state.lastNotifiedAt, state.lastCause]
  );
}

/**
 * Filo geneli kesintinin hâlihazırda duyurulup duyurulmadığını bildirim geçmişinden okur.
 * Ayrı bir durum tablosu tutmak yerine bunu türetmek, sunucu yeniden başlasa da
 * kesintinin her seferinde yeniden duyurulmasını önler.
 */
async function readOutageAnnouncement() {
  const { rows } = await pool.query(`
    SELECT (SELECT MAX(created_at) FROM notifications WHERE type = 'system_outage')    AS last_outage_at,
           (SELECT MAX(created_at) FROM notifications WHERE type = 'system_recovered') AS last_recovered_at
  `);
  const { last_outage_at, last_recovered_at } = rows[0];
  const announced = last_outage_at != null &&
    (last_recovered_at == null || new Date(last_recovered_at) < new Date(last_outage_at));
  return { announced, lastOutageAt: last_outage_at };
}

/** Filo geneli kesinti: araç başına bildirim yerine TEK bildirim (adminlere). */
async function announceSystemOutage(silentCount, total) {
  const { announced, lastOutageAt } = await readOutageAnnouncement();
  const due = !announced ||
    Date.now() - new Date(lastOutageAt).getTime() >= SILENCE_REPEAT_MINUTES * MS_PER_MINUTE;
  if (!due) return;

  await notificationService.createNotification({
    userIds: await notificationService.adminRecipients(),
    type: 'system_outage',
    severity: 'critical',
    title: `Sistem geneli: ${total} araçtan ${silentCount} tanesi veri göndermiyor`,
    message:
      'Araçların neredeyse tamamı aynı anda sustu. Bu genellikle araçlarda değil, veri ' +
      'toplama tarafında (sunucu, ağ veya operatör) bir sorun olduğunu gösterir. ' +
      'Araç bazlı bildirimler, durum normale dönene kadar üretilmiyor.',
    probableCause: 'system_outage',
    causeConfidence: 'high',
    metadata: { silent_count: silentCount, monitored_count: total, ratio: silentCount / total },
  });
  console.log(`[Bağlantı] Filo geneli kesinti bildirimi: ${silentCount}/${total}`);
}

/** Filo geneli kesinti duyurulmuşsa kapanışını bildirir. */
async function clearSystemOutage(silentCount, total) {
  const { announced } = await readOutageAnnouncement();
  if (!announced) return;

  await notificationService.createNotification({
    userIds: await notificationService.adminRecipients(),
    type: 'system_recovered',
    severity: 'info',
    title: 'Sistem geneli veri akışı normale döndü',
    message: `İzlenen ${total} araçtan ${total - silentCount} tanesi yeniden veri gönderiyor. ` +
      'Araç bazlı takip kaldığı yerden devam ediyor.',
    probableCause: 'system_outage',
    causeConfidence: 'high',
    metadata: { silent_count: silentCount, monitored_count: total },
  });
  console.log('[Bağlantı] Filo geneli kesinti kapandı.');
}

/** Veri akışı geri geldiğinde: kesintiyi kapat, mümkünse sebebi geriye dönük kesinleştir. */
async function handleResume(vehicle) {
  const silentSince = vehicle.silent_since ?? vehicle.last_seen_at;

  // Kesinti hiç bildirilmediyse (ör. filo geneli kesinti modundaydık) dönüşü de bildirme.
  if (!vehicle.last_notified_at) return;

  const backfill = await detectBackfill(vehicle.id, silentSince);
  if (backfill) {
    await notificationService.confirmCauseForOutage(vehicle.id, silentSince, backfill);
  }

  const silentMinutes = Math.max(
    0,
    Math.floor((new Date(vehicle.last_seen_at) - new Date(silentSince)) / MS_PER_MINUTE)
  );

  await notificationService.createNotification({
    userIds: await notificationService.recipientsForVehicle(vehicle.user_id),
    vehicleId: vehicle.id,
    type: 'vehicle_data_resumed',
    severity: 'info',
    title: `${vehicle.plate} — veri akışı geri geldi`,
    message: `${silentMinutes} dakikalık kesintinin ardından veri yeniden geliyor.` +
      (backfill ? ` ${backfill.detail}` : ''),
    probableCause: backfill ? backfill.cause : null,
    causeConfidence: backfill ? backfill.confidence : null,
    metadata: {
      plate: vehicle.plate,
      silent_minutes: silentMinutes,
      silent_since: silentSince,
      evidence: backfill ? backfill.evidence : undefined,
    },
  });
  console.log(`[Bağlantı] ${vehicle.plate}: veri akışı geri geldi (${silentMinutes} dk kesinti).`);
}

/** Sessiz araç: sebebi tahmin et, gerekiyorsa bildir. */
async function handleSilence(vehicle) {
  const silentSince = vehicle.silent_since ?? vehicle.last_seen_at;
  const wasOnline = vehicle.is_online !== false; // kayıt yoksa çevrimiçi varsayılır
  const { cause, confidence, detail, evidence } = await inferCause(vehicle.id, silentSince);

  const repeatMinutes = cause === 'parked' ? PARKED_REPEAT_MINUTES : SILENCE_REPEAT_MINUTES;
  const causeChanged = !wasOnline && vehicle.last_cause != null && vehicle.last_cause !== cause;
  const repeatDue = !vehicle.last_notified_at ||
    Date.now() - new Date(vehicle.last_notified_at).getTime() >= repeatMinutes * MS_PER_MINUTE;

  // İlk geçiş, sebep değişimi veya tekrar zamanı — üçü de bildirim sebebidir.
  if (!wasOnline && !causeChanged && !repeatDue) {
    await upsertState(vehicle.id, {
      isOnline: false,
      lastSeenAt: vehicle.last_seen_at,
      silentSince,
      lastNotifiedAt: vehicle.last_notified_at,
      lastCause: vehicle.last_cause,
    });
    return;
  }

  const silentMinutes = minutesSince(vehicle.last_seen_at);
  const severity = cause === 'parked'
    ? 'info'
    : silentMinutes >= CRITICAL_AFTER_MINUTES ? 'critical' : 'warning';

  await notificationService.createNotification({
    userIds: await notificationService.recipientsForVehicle(vehicle.user_id),
    vehicleId: vehicle.id,
    type: 'vehicle_data_stale',
    severity,
    title: `${vehicle.plate} — ${silentMinutes} dakikadır veri gelmiyor`,
    message: `Son veri: ${formatTime(vehicle.last_seen_at)}. ` +
      `Muhtemel sebep: ${CAUSE_LABELS[cause]} (${CONFIDENCE_LABELS[confidence]}). ${detail}`,
    probableCause: cause,
    causeConfidence: confidence,
    metadata: {
      plate: vehicle.plate,
      last_seen_at: vehicle.last_seen_at,
      silent_minutes: silentMinutes,
      evidence,
    },
  });

  await upsertState(vehicle.id, {
    isOnline: false,
    lastSeenAt: vehicle.last_seen_at,
    silentSince,
    lastNotifiedAt: new Date(),
    lastCause: cause,
  });
  console.log(`[Bağlantı] ${vehicle.plate}: ${silentMinutes} dk sessiz — tahmin: ${cause} (${confidence}).`);
}

/** Bir tarama turu. Hata yalnızca loglanır; cron ölmemeli. */
const checkConnectivity = async () => {
  try {
    const { rows: vehicles } = await pool.query(FLEET_QUERY, [SILENCE_THRESHOLD_MINUTES]);
    if (vehicles.length === 0) return;

    const silent = vehicles.filter((v) => v.is_silent);

    // Sinyal #1 — filo korelasyonu: hepsi birden sustuysa sorun araçlarda değil bizdedir.
    const fleetOutage =
      vehicles.length >= OUTAGE_MIN_VEHICLES &&
      silent.length / vehicles.length >= OUTAGE_RATIO;

    if (fleetOutage) {
      await announceSystemOutage(silent.length, vehicles.length);
    } else {
      await clearSystemOutage(silent.length, vehicles.length);
    }

    for (const vehicle of vehicles) {
      try {
        if (!vehicle.is_silent) {
          if (vehicle.is_online === false) await handleResume(vehicle);
          await upsertState(vehicle.id, {
            isOnline: true,
            lastSeenAt: vehicle.last_seen_at,
            silentSince: null,
            lastNotifiedAt: null,
            lastCause: null,
          });
          continue;
        }

        if (fleetOutage) {
          // Araç bazlı bildirim üretilmez, ama durum kaydedilir ki dönüş doğru algılansın.
          await upsertState(vehicle.id, {
            isOnline: false,
            lastSeenAt: vehicle.last_seen_at,
            silentSince: vehicle.silent_since ?? vehicle.last_seen_at,
            lastNotifiedAt: vehicle.last_notified_at,
            lastCause: 'system_outage',
          });
          continue;
        }

        await handleSilence(vehicle);
      } catch (err) {
        // Tek bir araçtaki hata diğerlerini durdurmasın.
        console.error(`[Bağlantı] Araç ${vehicle.id} işlenemedi:`, err.code || '', err.message);
      }
    }
  } catch (error) {
    console.error('[Bağlantı] Tarama hatası:', error);
  }
};

/**
 * Eski bildirimleri temizler. Sessiz bir araç günde ~288 satır üretebildiği için
 * bu olmadan tablo sürekli büyür.
 */
const cleanupNotifications = async () => {
  try {
    const { rowCount: silinen } = await pool.query(`
      DELETE FROM notifications
      WHERE (is_read = TRUE AND created_at < NOW() - INTERVAL '30 days')
         OR created_at < NOW() - INTERVAL '90 days'
    `);
    await pool.query(
      `DELETE FROM sensor_auth_failures WHERE last_attempt_at < NOW() - INTERVAL '90 days'`
    );
    console.log(`[Bağlantı] Temizlik: ${silinen} eski bildirim silindi.`);
  } catch (error) {
    console.error('[Bağlantı] Temizlik hatası:', error);
  }
};

const scheduleConnectivityWatch = () => {
  // Her dakika taranır; bildirim aralığı SILENCE_REPEAT_MINUTES ile kontrol edilir.
  cron.schedule('* * * * *', checkConnectivity);
  cron.schedule('20 0 * * *', cleanupNotifications);
  console.log(
    `[Cron Job] Bağlantı takibi zamanlandı ` +
    `(eşik ${SILENCE_THRESHOLD_MINUTES} dk, tekrar ${SILENCE_REPEAT_MINUTES} dk).`
  );
};

module.exports = {
  scheduleConnectivityWatch,
  checkConnectivity,      // manuel tetikleme / test için
  cleanupNotifications,
};
