/* global __SKYFRONT_AUDIO_WORKER_SOURCE__ */
import { pcmCatalog } from './pcm-catalog.js';
const rates = new Map(),
  contexts = new WeakMap();
let worker,
  workerFailed = false,
  busy = false,
  idlePending = false,
  foregroundRate = null,
  workerJobs = 0;
const idle = (callback) =>
  typeof requestIdleCallback === 'function'
    ? requestIdleCallback(callback, { timeout: 2000 })
    : setTimeout(callback, 8);
function stopWorker() {
  worker?.terminate();
  worker = null;
  busy = false;
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => stopWorker());
  window.addEventListener('pageshow', () => pump());
}
function getWorker() {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  let objectURL;
  try {
    const source =
      typeof __SKYFRONT_AUDIO_WORKER_SOURCE__ === 'string'
        ? __SKYFRONT_AUDIO_WORKER_SOURCE__
        : null;
    if (source) {
      objectURL = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      worker = new Worker(objectURL);
    } else worker = new Worker(new URL('./pcm-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      busy = false;
      const state = rates.get(data.rate);
      if (data.error) {
        failWorker();
        return;
      }
      if (state && !state.records.has(data.index)) {
        workerJobs++;
        receive(state, data.index, data.channels);
      }
      pump();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      failWorker();
    };
    return worker;
  } catch {
    workerFailed = true;
    stopWorker();
    return null;
  } finally {
    if (objectURL) URL.revokeObjectURL(objectURL);
  }
}
function failWorker() {
  workerFailed = true;
  stopWorker();
  pump();
}
function receive(state, index, channels) {
  state.records.set(index, channels);
  for (const listener of state.listeners) listener(index, channels);
  if (state.records.size === state.jobs.length) {
    state.resolve();
    state.listeners.clear();
  }
}
function pending() {
  const ordered = [rates.get(foregroundRate), ...rates.values()].filter(Boolean);
  for (const state of ordered) {
    const index = state.jobs.findIndex((_, i) => !state.records.has(i));
    if (index >= 0) return { state, index };
  }
  return null;
}
function pump() {
  if (busy || idlePending) return;
  const item = pending();
  if (!item) {
    stopWorker();
    return;
  }
  const instance = getWorker();
  if (instance) {
    busy = true;
    instance.postMessage({ rate: item.state.rate, index: item.index });
    return;
  }
  idlePending = true;
  idle(() => {
    idlePending = false;
    const next = pending();
    if (!next) return;
    const output = next.state.jobs[next.index].make();
    receive(next.state, next.index, Array.isArray(output) ? output : [output]);
    pump();
  });
}
export function warmAudioPCM(rate = 48000, priority = false) {
  if (priority) foregroundRate = rate;
  if (!rates.has(rate)) {
    // Bound shared raw PCM to the two most recent sample rates. Live contexts retain
    // their own AudioBuffers; unfinished jobs are never discarded midway through.
    if (rates.size >= 2)
      for (const [key, state] of rates)
        if (state.records.size === state.jobs.length) {
          rates.delete(key);
          break;
        }
    let resolve;
    const ready = new Promise((done) => (resolve = done));
    rates.set(rate, {
      rate,
      jobs: pcmCatalog(rate),
      records: new Map(),
      listeners: new Set(),
      ready,
      resolve,
    });
  }
  pump();
  return rates.get(rate);
}
export function audioBufferBank(context) {
  if (contexts.has(context)) return contexts.get(context);
  const state = warmAudioPCM(context.sampleRate, true),
    buffers = {};
  let resolveLoops;
  const loopsReady = new Promise((done) => (resolveLoops = done));
  const convert = (index, channels) => {
    if (context.state === 'closed') return;
    const job = state.jobs[index],
      buffer = context.createBuffer(channels.length, channels[0].length, context.sampleRate);
    channels.forEach((channel, i) => buffer.copyToChannel(channel, i));
    if (job.loop) buffers[job.name] = buffer;
    else (buffers[job.name] ||= [])[job.variant] = buffer;
    if (state.jobs.filter((job) => job.loop).every((job) => buffers[job.name])) resolveLoops();
  };
  for (const [index, channels] of state.records) convert(index, channels);
  state.listeners.add(convert);
  state.ready.then(() => {
    state.listeners.delete(convert);
    if (context.state === 'closed') resolveLoops();
  });
  const result = { buffers, ready: state.ready, loopsReady };
  contexts.set(context, result);
  return result;
}
export function audioBankDiagnostics() {
  return [...rates.values()].map((state) => ({
    rate: state.rate,
    rendered: state.records.size,
    total: state.jobs.length,
    worker: !!worker,
    workerJobs,
  }));
}
