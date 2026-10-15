// apps/braincell/src/api/pronunciations.ts — Qravy's pronunciation dictionary, one for every restaurant
// (auth-service routes/pronounceRoutes.ts). Only Qravy changes it: a restaurant sends a request, Qravy reviews it in Cortex.
import api from './auth';

export type DictWord = {
  word: string;
  sayAs: string;
  spoken: string;
  /** 'you': Qravy accepted your request for it */
  by: 'qravy' | 'you' | 'another restaurant';
  updatedAt: string;
};

export type WordRequest = {
  id: string;
  word: string;
  sayAs: string;
  spoken: string;
  note: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  decidedAt: string | null;
  /** what Qravy put in the dictionary — differs from what was asked when Qravy edited it */
  final: { sayAs: string; spoken: string } | null;
  /** Qravy's note back */
  reply: string;
};

export const listWords = async (): Promise<DictWord[]> => (await api.get('/api/v1/pronunciations')).data.items as DictWord[];

export const listRequests = async (): Promise<WordRequest[]> => (await api.get('/api/v1/pronunciations/requests')).data.items as WordRequest[];

/** Ask Qravy to add a word or change how it's said (another request for the same word, while it waits, replaces it). */
export const requestWord = async (word: string, sayAs: string, note?: string): Promise<WordRequest> =>
  (await api.put('/api/v1/pronunciations', { word, sayAs, ...(note ? { note } : {}) })).data.item as WordRequest;

/** Take back a request that's still waiting. */
export const withdrawRequest = async (id: string) => (await api.delete(`/api/v1/pronunciations/requests/${encodeURIComponent(id)}`)).data;
