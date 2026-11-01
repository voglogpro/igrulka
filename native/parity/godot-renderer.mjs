import { SceneExporter, SCENE_PROTOCOL } from './scene-protocol.mjs';
import { showNativeFailure, reportNativeStatus } from './native-failure.mjs';

export class NativeTransport {
  constructor(webview = globalThis.chrome?.webview) {
    if (!webview?.postMessage || !webview?.addEventListener)
      throw Error(
        'The original game requires its native Godot host; no WebGL fallback is enabled.',
      );
    this.webview = webview;
    this.pending = new Map();
    this.ready = false;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    webview.addEventListener('message', (event) => this.receive(event.data));
    webview.postMessage({ kind: 'renderer-attached', protocol: SCENE_PROTOCOL });
  }
  receive(message) {
    if (typeof message === 'string') {
      try {
        message = JSON.parse(message);
      } catch {
        return;
      }
    }
    if (message?.kind === 'native-ready' && message.protocol === SCENE_PROTOCOL) {
      globalThis.__SKYFRONT_NATIVE__ ||= {};
      globalThis.__SKYFRONT_NATIVE__.enhancedGraphics = message.enhancedGraphics === true;
      if (typeof message.serverAddress === 'string' && message.serverAddress) {
        globalThis.__SKYFRONT_NATIVE__ ||= {};
        globalThis.__SKYFRONT_NATIVE__.serverAddress = message.serverAddress;
      }
      this.ready = true;
      this.resolveReady();
      reportNativeStatus('native-ready');
    }
    if (message?.kind === 'scene-ack') {
      const pending = this.pending.get(message.seq);
      if (pending) {
        this.pending.delete(message.seq);
        globalThis.clearTimeout(pending.timer);
        pending.resolve(message);
      }
    }
    if (message?.kind === 'native-error') {
      const error = Error(message.message || 'Godot scene failed');
      this.failed = error;
      this.ready = false;
      showNativeFailure(error.message);
      this.rejectReady(error);
      for (const pending of this.pending.values()) {
        globalThis.clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    }
  }
  async waitReady(timeoutMs = 30000) {
    if (this.failed) throw this.failed;
    let timer;
    try {
      await Promise.race([
        this.readyPromise,
        new Promise((_, reject) => {
          timer = globalThis.setTimeout(
            () => reject(Error('Godot did not become ready in 30 seconds')),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
  send(packet) {
    if (!this.ready) return Promise.reject(Error('Native scene backend is not ready'));
    if (this.pending.size) return Promise.reject(Error('Only one native scene may be in flight'));
    // A cold driver compiles the authored model/effect variants before Start.
    // Its ACK requires FramePostDraw and can exceed the live-frame watchdog,
    // especially while another client is already drawing on an integrated GPU.
    const timeoutMs = packet.frame?.environment?.post?.artWarmup === true ? 120000 : 30000;
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.pending.delete(packet.seq);
        reject(Error(`Godot did not acknowledge the scene in ${timeoutMs / 1000} seconds`));
      }, timeoutMs);
      this.pending.set(packet.seq, { resolve, reject, timer });
      try {
        this.webview.postMessage(packet);
      } catch (error) {
        this.pending.delete(packet.seq);
        globalThis.clearTimeout(timer);
        reject(error);
      }
    });
  }
}

// Same canvas/input and Three CPU scene as the browser, with no WebGL context.
export class GodotRenderer {
  constructor({ transport, exporter, canvas, clock = () => globalThis.performance.now() } = {}) {
    this.domElement = canvas || globalThis.document.createElement('canvas');
    this.domElement.dataset.renderer = 'godot';
    this.transport =
      transport || globalThis.__SKYFRONT_STARTUP_TRANSPORT__ || new NativeTransport();
    if (this.transport === globalThis.__SKYFRONT_STARTUP_TRANSPORT__)
      delete globalThis.__SKYFRONT_STARTUP_TRANSPORT__;
    this.exporter = exporter || new SceneExporter();
    this.shadowMap = { enabled: true, type: 0, autoUpdate: false, needsUpdate: true };
    this.capabilities = { maxSamples: 4, isWebGL2: false };
    this.info = {
      render: { calls: 0, triangles: 0 },
      memory: { geometries: 0, textures: 0 },
      programs: [],
    };
    this._pixelRatio = 1;
    this._width = this._height = 1;
    this._target = null;
    this._scene = null;
    this._camera = null;
    this._seq = 0;
    this._pending = null;
    this._wanted = false;
    this._options = {};
    this.toneMappingExposure = 1;
    this._clock = clock;
    this._profile = {
      submitted: 0,
      acked: 0,
      captureMs: 0,
      maxCaptureMs: 0,
      captureTotalMs: 0,
      postMessageMs: 0,
      maxPostMessageMs: 0,
      ackMs: 0,
      maxAckMs: 0,
      lastPacketBytes: 0,
      lastNativeApplyMs: 0,
      lastNativeParseMs: 0,
      objectUpdates: 0,
      geometryUpdates: 0,
      materialUpdates: 0,
      textureUpdates: 0,
    };
    this._firstAckAt = null;
    this._lastAckAt = null;
  }
  setPixelRatio(ratio) {
    this._pixelRatio = ratio;
  }
  getPixelRatio() {
    return this._pixelRatio;
  }
  setSize(width, height, updateStyle = true) {
    this._width = width;
    this._height = height;
    this.domElement.width = Math.max(1, Math.floor(width * this._pixelRatio));
    this.domElement.height = Math.max(1, Math.floor(height * this._pixelRatio));
    if (updateStyle) {
      this.domElement.style.width = width + 'px';
      this.domElement.style.height = height + 'px';
    }
  }
  setDrawingBufferSize(width, height, ratio) {
    this._pixelRatio = ratio;
    this.setSize(width, height, false);
  }
  getSize(target) {
    return target.set(this._width, this._height);
  }
  getDrawingBufferSize(target) {
    return target.set(this.domElement.width, this.domElement.height);
  }
  getRenderTarget() {
    return this._target;
  }
  setRenderTarget(target) {
    this._target = target;
  }
  getContext() {
    return { isContextLost: () => false };
  }
  async compileAsync() {
    await this.transport.waitReady();
  }
  initTexture() {}
  dispose() {}
  setClearColor() {}
  setScissor() {}
  setScissorTest() {}
  getScissorTest() {
    return false;
  }
  getScissor(target) {
    return target.set(0, 0, this._width, this._height);
  }
  getViewport(target) {
    return target.set(0, 0, this._width, this._height);
  }
  setViewport() {}
  render(scene, camera, options = {}) {
    if (this.transport.failed || globalThis.__SKYFRONT_NATIVE_FAILED__) return;
    this._scene = scene;
    this._camera = camera;
    this._options = options;
    this._wanted = true;
    if (!this._pending && this.transport.ready) this._submit();
  }
  _submit() {
    if (!this._wanted || this._pending) return;
    this._wanted = false;
    const captureStarted = this._clock();
    const packet = this.exporter.capture(this._scene, this._camera, ++this._seq, {
      ...this._options,
      exposure: this.toneMappingExposure,
    });
    const captureMs = this._clock() - captureStarted;
    this._profile.submitted++;
    this._profile.captureMs = captureMs;
    this._profile.captureTotalMs += captureMs;
    this._profile.maxCaptureMs = Math.max(this._profile.maxCaptureMs, captureMs);
    this._profile.objectUpdates = packet.frame.objects.length;
    this._profile.geometryUpdates = packet.frame.geometryUpdates.length;
    this._profile.materialUpdates = packet.frame.materialUpdates.length;
    this._profile.textureUpdates = packet.frame.textureUpdates.length;
    if (packet.seq === 1)
      reportNativeStatus('first-scene', {
        objects: packet.frame.objects.length,
        geometries: packet.definitions.geometries.length,
        materials: packet.definitions.materials.length,
        textures: packet.definitions.textures.length,
      });
    this.info.memory.geometries = this.exporter.geometryCache.size;
    this.info.memory.textures = this.exporter.textureCache.size;
    this.info.render.calls = this.exporter.objectCache.size;
    const sentAt = this._clock();
    this._pending = this.transport.send(packet);
    this._profile.postMessageMs = this._clock() - sentAt;
    this._profile.maxPostMessageMs = Math.max(
      this._profile.maxPostMessageMs,
      this._profile.postMessageMs,
    );
    this._pending.then(
      (ack) => {
        const at = this._clock(),
          ackMs = at - sentAt;
        this._profile.acked++;
        this._profile.ackMs = ackMs;
        this._profile.maxAckMs = Math.max(this._profile.maxAckMs, ackMs);
        this._profile.lastPacketBytes = ack?.packetBytes ?? this._profile.lastPacketBytes;
        this._profile.lastNativeApplyMs = ack?.applyMs ?? this._profile.lastNativeApplyMs;
        this._profile.lastNativeParseMs = ack?.parseMs ?? this._profile.lastNativeParseMs;
        this._firstAckAt ??= at;
        this._lastAckAt = at;
        this._pending = null;
        if (this._wanted) this._submit();
      },
      (error) => {
        this._pending = null;
        this._wanted = false;
        globalThis.console.error('Godot scene transport failed:', error);
        showNativeFailure(error.message);
      },
    );
    return this._pending;
  }
  async present(scene, camera, options = {}) {
    await this.transport.waitReady();
    while (this._pending) await this._pending;
    this._scene = scene;
    this._camera = camera;
    this._options = options;
    this._wanted = true;
    await this._submit();
  }
  diagnostics() {
    const elapsed = this._lastAckAt - this._firstAckAt;
    return {
      ...this._profile,
      captureMeanMs: this._profile.submitted
        ? this._profile.captureTotalMs / this._profile.submitted
        : 0,
      effectiveHz: elapsed > 0 ? ((this._profile.acked - 1) * 1000) / elapsed : 0,
      pending: !!this._pending,
      geometries: this.exporter.geometryCache.size,
      materials: this.exporter.materialCache.size,
      textures: this.exporter.textureCache.size,
      exporter: this.exporter.diagnostics?.() ?? null,
    };
  }
}
