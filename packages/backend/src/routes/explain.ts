import type { FastifyInstance } from 'fastify';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '../db/client.js';
import { redis } from '../cache/client.js';
import type { WindVector } from '@thailand-aq/types';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const DAILY_QUOTA_LIMIT = 1400;
const BKK_OFFSET_MS = 7 * 3600_000; // UTC+7
const FIRE_RADIUS_KM = 300;

// --- geo helpers ---

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function quadrant(deg: number): 'N' | 'E' | 'S' | 'W' {
  if (deg >= 315 || deg < 45) return 'N';
  if (deg < 135) return 'E';
  if (deg < 225) return 'S';
  return 'W';
}

function compassFromDeg(deg: number): string {
  const dirs = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

function nearestWind(vectors: WindVector[], lat: number, lng: number): WindVector | null {
  if (!vectors.length) return null;
  let best = vectors[0];
  let bestD = (best.lat - lat) ** 2 + (best.lng - lng) ** 2;
  for (const v of vectors.slice(1)) {
    const d = (v.lat - lat) ** 2 + (v.lng - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

function medianOf(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// --- AQI helpers ---

const AQI_BP = [12.0, 35.4, 55.4, 150.4, 250.4];
const AQI_LABELS = [
  'Good',
  'Moderate',
  'Unhealthy for sensitive groups',
  'Unhealthy',
  'Very unhealthy',
  'Hazardous',
];

function pm25Cat(pm25: number): string {
  for (let i = 0; i < AQI_BP.length; i++) {
    if (pm25 <= AQI_BP[i]) return AQI_LABELS[i];
  }
  return AQI_LABELS[AQI_LABELS.length - 1];
}

// --- trend ---

function computeTrend(readings: number[]): string {
  if (readings.length < 8) return 'insufficient data';
  const recent = (readings[0] + readings[1] + readings[2] + readings[3]) / 4;
  const older = (readings[4] + readings[5] + readings[6] + readings[7]) / 4;
  if (older === 0) return 'stable';
  const ratio = recent / older;
  if (ratio > 1.15) return 'rising sharply';
  if (ratio > 1.05) return 'rising';
  if (ratio < 0.85) return 'falling sharply';
  if (ratio < 0.95) return 'falling';
  return 'stable';
}

// --- route ---

export function explainRoutes(app: FastifyInstance): void {
  app.post<{ Body: { stationId: string; lat: number; lng: number; date?: string } }>(
    '/api/explain',
    async (req, reply) => {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return reply.status(503).send({ error: 'AI explanation not configured' });
      }

      const { stationId, lat, lng } = req.body ?? {};
      if (!stationId || lat === undefined || lng === undefined) {
        return reply.status(400).send({ error: 'Missing required fields: stationId, lat, lng' });
      }

      // Quota check — keyed to Bangkok calendar day
      const todayBkk = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
      const quotaKey = `explain:quota:${todayBkk}`;
      const count = await redis.incr(quotaKey);
      if (count === 1) await redis.expire(quotaKey, 86400);
      if (count > DAILY_QUOTA_LIMIT) {
        return reply.status(429).send({ error: 'quota_exceeded' });
      }

      // Anchor all time windows to the selected date (BKK timezone).
      // anchorEndMs = start of the day AFTER selectedDate in BKK = exclusive upper bound.
      const selectedDate =
        req.body.date ?? new Date(Date.now() + BKK_OFFSET_MS).toISOString().slice(0, 10);
      const [yr, mo, dy] = selectedDate.split('-').map(Number);
      const anchorEndMs = Date.UTC(yr, mo - 1, dy) - BKK_OFFSET_MS + 86_400_000;

      const since48h = new Date(anchorEndMs - 48 * 3600_000).toISOString();
      const until = new Date(anchorEndMs).toISOString();
      const since7d = new Date(anchorEndMs - 7 * 86_400_000).toISOString();
      const since3h = new Date(anchorEndMs - 3 * 3600_000).toISOString();
      const BOX_FIRE = FIRE_RADIUS_KM / 111; // degrees bounding-box pre-filter

      // Gather all context in parallel
      const [stationRows, fireRows, peerRows, windCache] = await Promise.all([
        supabase
          .from('measurements')
          .select('value, measured_at, stations(id, name)')
          .eq('station_id', stationId)
          .eq('parameter', 'pm25')
          .gte('measured_at', since7d)
          .order('measured_at', { ascending: false })
          .limit(170),

        supabase
          .from('fire_points')
          .select('lat, lng, frp, fire_type, detected_at')
          .gte('detected_at', since48h)
          .lt('detected_at', until)
          .gte('lat', lat - BOX_FIRE)
          .lte('lat', lat + BOX_FIRE)
          .gte('lng', lng - BOX_FIRE)
          .lte('lng', lng + BOX_FIRE),

        supabase
          .from('measurements')
          .select('value, measured_at, station_id, stations(id, name, lat, lng)')
          .eq('parameter', 'pm25')
          .gte('measured_at', since3h)
          .neq('station_id', stationId)
          .order('measured_at', { ascending: false }),

        redis.get<WindVector[]>(`wind:${selectedDate}`),
      ]);

      if (stationRows.error) throw new Error(stationRows.error.message);
      if (!stationRows.data?.length) {
        return reply.status(404).send({ error: 'Station not found' });
      }

      // --- station context ---
      type StationJoin = { id: string; name: string } | null;
      const stationName =
        (stationRows.data[0].stations as unknown as StationJoin)?.name ?? stationId;
      const readings = (stationRows.data as { value: number; measured_at: string }[]).map(
        (r) => r.value,
      );
      const latestPm25 = readings[0];
      const trend = computeTrend(readings);

      // Daily averages (group by BKK calendar day)
      const dailyMap = new Map<string, number[]>();
      for (const row of stationRows.data as { value: number; measured_at: string }[]) {
        const bkkDate = new Date(new Date(row.measured_at).getTime() + BKK_OFFSET_MS)
          .toISOString()
          .slice(0, 10);
        if (!dailyMap.has(bkkDate)) dailyMap.set(bkkDate, []);
        dailyMap.get(bkkDate)!.push(row.value);
      }
      const dailyAvgs = [...dailyMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, vals]) => ({
          date,
          avg: vals.reduce((s, v) => s + v, 0) / vals.length,
        }));

      // --- fires context ---
      req.log.info(
        {
          fireError: fireRows.error?.message ?? null,
          fireRowCount: fireRows.data?.length ?? 0,
          since48h,
          until,
        },
        'explain: fire query result',
      );

      type FireRow = {
        lat: number;
        lng: number;
        frp: number | null;
        fire_type: number | null;
        detected_at: string;
      };
      const fires = ((fireRows.data as unknown as FireRow[] | null) ?? [])
        .map((f) => ({
          ...f,
          distKm: haversineKm(lat, lng, f.lat, f.lng),
          bearing: bearingDeg(lat, lng, f.lat, f.lng),
        }))
        .filter((f) => f.distKm <= FIRE_RADIUS_KM);

      const quadrantCounts = { N: 0, E: 0, S: 0, W: 0 };
      const quadrantFrp = { N: 0, E: 0, S: 0, W: 0 };
      for (const f of fires) {
        const q = quadrant(f.bearing);
        quadrantCounts[q]++;
        quadrantFrp[q] += f.frp ?? 0;
      }
      const topFires = [...fires].sort((a, b) => (b.frp ?? 0) - (a.frp ?? 0)).slice(0, 5);
      const vegFires = fires.filter((f) => f.fire_type === 0).length;

      // --- peers context ---
      type PeerJoin = { id: string; name: string; lat: number; lng: number } | null;
      const peerMap = new Map<string, { name: string; pm25: number; distKm: number }>();
      for (const row of (peerRows.data as {
        value: number;
        measured_at: string;
        station_id: string;
        stations: unknown;
      }[]) ?? []) {
        const sid = row.station_id;
        if (peerMap.has(sid)) continue; // already have most recent
        const s = row.stations as PeerJoin;
        if (!s) continue;
        const distKm = haversineKm(lat, lng, s.lat, s.lng);
        if (distKm > 75) continue;
        peerMap.set(sid, { name: s.name, pm25: row.value, distKm });
      }
      const peerList = [...peerMap.values()];
      const peerValues = peerList.map((p) => p.pm25);
      const peerMedian = medianOf(peerValues);
      const peerMin = peerValues.length ? Math.min(...peerValues) : null;
      const peerMax = peerValues.length ? Math.max(...peerValues) : null;
      const outlierRatio = peerMedian > 0 ? latestPm25 / peerMedian : null;
      const isOutlier = outlierRatio !== null && (outlierRatio < 0.3 || outlierRatio > 3);

      // --- wind context ---
      const wind = windCache ? nearestWind(windCache, lat, lng) : null;

      // --- build prompt ---
      const dailyLines = dailyAvgs
        .map((d) => `  ${d.date}: ${d.avg.toFixed(1)} µg/m³ (${pm25Cat(d.avg)})`)
        .join('\n');

      const windStr = wind
        ? `From ${compassFromDeg(wind.directionDeg)} at ${wind.speedKmh.toFixed(1)} km/h (blowing toward ${compassFromDeg((wind.directionDeg + 180) % 360)})`
        : 'No wind data available';

      const fireStr =
        fires.length === 0
          ? `No fires detected within ${FIRE_RADIUS_KM} km in the last 48 hours`
          : [
              `${fires.length} fire detections (${vegFires} vegetation, ${fires.length - vegFires} other)`,
              `Total FRP: ${fires.reduce((s, f) => s + (f.frp ?? 0), 0).toFixed(0)} MW`,
              `By quadrant — N: ${quadrantCounts.N} fires (${quadrantFrp.N.toFixed(0)} MW), E: ${quadrantCounts.E} (${quadrantFrp.E.toFixed(0)} MW), S: ${quadrantCounts.S} (${quadrantFrp.S.toFixed(0)} MW), W: ${quadrantCounts.W} (${quadrantFrp.W.toFixed(0)} MW)`,
              topFires.length
                ? `Top fires by FRP: ${topFires.map((f) => `${(f.frp ?? 0).toFixed(0)} MW at ${f.distKm.toFixed(0)} km ${compassFromDeg(f.bearing)}`).join(', ')}`
                : '',
            ]
              .filter(Boolean)
              .join('\n');

      const peerStr =
        peerList.length === 0
          ? 'No peer station data available within 75 km'
          : [
              `${peerList.length} stations — median ${peerMedian.toFixed(1)} µg/m³, range ${peerMin?.toFixed(1)}–${peerMax?.toFixed(1)} µg/m³`,
              peerList
                .sort((a, b) => b.pm25 - a.pm25)
                .slice(0, 5)
                .map((p) => `  ${p.name}: ${p.pm25.toFixed(1)} µg/m³ (${p.distKm.toFixed(0)} km)`)
                .join('\n'),
            ].join('\n');

      const outlierNote = isOutlier
        ? `ANOMALY: This station reads ${outlierRatio.toFixed(1)}× the peer median (${peerMedian.toFixed(1)} µg/m³). This is an outlier — consider sensor issues, a sheltered location, microclimate, or a very local source.`
        : '';

      const upwindQuadrant = wind ? quadrant((wind.directionDeg + 180) % 360) : null;
      const upwindFireCount = upwindQuadrant ? quadrantCounts[upwindQuadrant] : 0;

      const prompt = `You are explaining current air quality data to a general audience in plain English.

STATION: ${stationName} (${lat.toFixed(3)}°N, ${lng.toFixed(3)}°E)
CURRENT PM2.5: ${latestPm25.toFixed(1)} µg/m³ — ${pm25Cat(latestPm25)}
RECENT TREND: ${trend}

7-DAY DAILY AVERAGES
${dailyLines || '  No historical data'}

WIND
${windStr}

FIRES WITHIN ${FIRE_RADIUS_KM} KM (last 48 h ending ${selectedDate})
${fireStr}
${upwindQuadrant && upwindFireCount > 0 ? `→ ${upwindFireCount} fires in the upwind quadrant (${upwindQuadrant}), directly in the path of smoke toward this station` : ''}

PEER STATIONS WITHIN 75 KM (last 3 h)
${peerStr}
${outlierNote ? `\n${outlierNote}` : ''}

CONTEXT: April is peak dry season and agricultural burning season in mainland Southeast Asia (Thailand, Myanmar, Laos, Cambodia). Smoke can travel hundreds of kilometres under stable atmospheric conditions.

Write 3–5 short paragraphs in plain English. No markdown headers, no bullet points — flowing prose only.
- Describe the current reading and what it means for air quality.
- ${latestPm25 > 35 ? `Reason about the likely sources. Fires in the quadrant that the wind is blowing FROM (${upwindQuadrant ?? 'unknown'}) are most likely to affect this station. Explain clearly if fires upwind appear to be a factor.` : 'Explain why conditions are currently good.'}
- Comment on the trend over the past week.
${isOutlier ? '- Explicitly note the anomaly versus nearby stations and suggest possible explanations.' : ''}
- Do not speculate beyond what the data shows. Be clear and accessible to a non-scientist.`;

      // Start streaming — hijack Fastify response so we control the raw socket
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });

      try {
        reply.raw.write('__PROMPT__' + JSON.stringify(prompt) + '\n');
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
        const result = await model.generateContentStream(prompt);
        for await (const chunk of result.stream) {
          reply.raw.write(chunk.text());
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.error({ err }, 'Gemini API error');
        reply.raw.write(`\n\n[ERROR: ${msg}]`);
      }

      reply.raw.end();
    },
  );
}
