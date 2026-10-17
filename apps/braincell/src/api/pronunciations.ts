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

/* ---- this restaurant's own words (Menu Items → how a dish sounds): applied at once, to its voice only ---- */

export type OwnWord = { word: string; sayAs: string; spoken: string; updatedAt: string };

export const listOwnWords = async (): Promise<OwnWord[]> => (await api.get('/api/v1/pronunciations/own')).data.items as OwnWord[];

/** How this restaurant wants `word` said — its voice uses it right away. */
export const setOwnWord = async (word: string, sayAs: string): Promise<OwnWord> =>
  (await api.put('/api/v1/pronunciations/own', { word, sayAs, source: 'menu item' })).data.item as OwnWord;

/** Back to the default reading. */
export const resetOwnWord = async (word: string) => (await api.delete(`/api/v1/pronunciations/own/${encodeURIComponent(word)}`)).data;

/** What this restaurant's voice is given for `text` (its own words over Qravy's dictionary). */
export const voiceTextFor = async (text: string, signal?: AbortSignal): Promise<string> =>
  String((await api.get('/api/v1/pronunciations/say', { params: { text }, signal })).data.spoken ?? text);
