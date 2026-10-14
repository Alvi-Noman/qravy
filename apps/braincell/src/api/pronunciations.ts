// apps/braincell/src/api/pronunciations.ts — Qravy's pronunciation dictionary, one for every restaurant
// (auth-service routes/pronounceRoutes.ts). A fix made here is used by every restaurant's AI waiter.
import api from './auth';

export type DictWord = {
  word: string;
  sayAs: string;
  spoken: string;
  /** set by Qravy: restaurants can't change it */
  locked: boolean;
  by: 'qravy' | 'you' | 'another restaurant';
  updatedAt: string;
};

export const listWords = async (): Promise<DictWord[]> => (await api.get('/api/v1/pronunciations')).data.items as DictWord[];

/** Add a word or improve its fix — for everyone. `previousWord`: the word it replaces (a renamed waiter). */
export const saveWord = async (word: string, sayAs: string, previousWord?: string | null) =>
  (await api.put('/api/v1/pronunciations', { word, sayAs, ...(previousWord ? { previousWord } : {}) })).data;

/** Only a word this restaurant added (Qravy's and other restaurants' can be improved, not removed). */
export const removeWord = async (word: string) => (await api.delete(`/api/v1/pronunciations/${encodeURIComponent(word)}`)).data;
