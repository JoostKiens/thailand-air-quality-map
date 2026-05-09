import { useState, useCallback } from 'react';

const API = import.meta.env.VITE_API_BASE_URL;

interface ExplainOptions {
  stationId: string;
  lat: number;
  lng: number;
  date: string; // YYYY-MM-DD in BKK timezone — anchors the fire/peer/measurement windows
}

interface ExplainState {
  text: string;
  loading: boolean;
  error: 'quota_exceeded' | 'unavailable' | null;
  quotaExceeded: boolean;
}

const INITIAL: ExplainState = {
  text: '',
  loading: false,
  error: null,
  quotaExceeded: false,
};

export function useExplain() {
  const [state, setState] = useState<ExplainState>(INITIAL);

  const explain = useCallback(async ({ stationId, lat, lng, date }: ExplainOptions) => {
    setState({ text: '', loading: true, error: null, quotaExceeded: false });

    let res: Response;
    try {
      res = await fetch(`${API}/api/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId, lat, lng, date }),
      });
    } catch {
      setState({ text: '', loading: false, error: 'unavailable', quotaExceeded: false });
      return;
    }

    if (res.status === 429) {
      setState({ text: '', loading: false, error: 'quota_exceeded', quotaExceeded: true });
      return;
    }
    if (!res.ok) {
      setState({ text: '', loading: false, error: 'unavailable', quotaExceeded: false });
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      setState({ text: '', loading: false, error: 'unavailable', quotaExceeded: false });
      return;
    }

    const decoder = new TextDecoder();
    let accumulated = '';
    let promptStripped = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });

        // Strip and log the debug prompt line emitted as the first chunk
        if (!promptStripped && accumulated.includes('\n')) {
          const nl = accumulated.indexOf('\n');
          const firstLine = accumulated.slice(0, nl);
          if (firstLine.startsWith('__PROMPT__')) {
            try {
              console.log(
                '[Explain prompt]\n',
                JSON.parse(firstLine.slice('__PROMPT__'.length)) as string,
              );
            } catch {}
            accumulated = accumulated.slice(nl + 1);
          }
          promptStripped = true;
        }

        const hasError = accumulated.includes('[ERROR:');
        setState({
          text: accumulated,
          loading: !hasError,
          error: hasError ? 'unavailable' : null,
          quotaExceeded: false,
        });
        if (hasError) break;
      }
    } finally {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  const reset = useCallback(() => setState(INITIAL), []);

  return { ...state, explain, reset };
}
