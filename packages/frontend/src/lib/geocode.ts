const cache = new Map<string, string | null>();

export async function reverseGeocode(
  lng: number,
  lat: number,
  accessToken: string,
): Promise<string | null> {
  const key = `${lng.toFixed(3)},${lat.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key)!;

  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
        `?types=locality,place,district&limit=1&access_token=${accessToken}`,
    );
    if (!res.ok) throw new Error('geocode failed');
    const data = (await res.json()) as {
      features?: { context?: { id: string; text: string }[] }[];
    };
    const context = data.features?.[0]?.context ?? [];
    const pick = (type: string) => context.find((c) => c.id.startsWith(type))?.text;

    const parts = [
      pick('locality') ?? pick('place') ?? pick('district'),
      pick('place') ?? pick('district') ?? pick('region'),
    ]
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 2);

    const result = parts.length ? parts.join(' · ') : null;
    cache.set(key, result);
    return result;
  } catch {
    cache.set(key, null);
    return null;
  }
}
