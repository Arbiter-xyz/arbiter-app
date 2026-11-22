import { Agent } from 'undici';

export const sseAgent = new Agent();

export function fetchSse(url) {
  return fetch(url, { dispatcher: sseAgent });
}
