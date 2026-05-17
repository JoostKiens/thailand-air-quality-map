import { useEffect, useRef, useState } from 'react';
import type { PM25GridPoint } from '@thailand-aq/types';

export function usePM25Bitmap(data: PM25GridPoint[] | undefined): ImageBitmap | null {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/pm25Canvas.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<{ bitmap: ImageBitmap }>) => {
      setBitmap((prev) => {
        prev?.close();
        return e.data.bitmap;
      });
    };
    worker.onerror = (e) => {
      console.error('[pm25 worker] error:', e.message, e);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!data) {
      setBitmap((prev) => {
        prev?.close();
        return null;
      });
      return;
    }
    if (!workerRef.current) return;
    workerRef.current.postMessage({ data });
  }, [data]);

  return bitmap;
}
