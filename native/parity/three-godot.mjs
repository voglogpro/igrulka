// Re-export original CPU geometry, matrices, raycasting and scene classes unchanged.
// The parity bundler exempts this import from its alias to prevent recursion.
export * from '../../vendor/three/three.module.js';
export { GodotRenderer as WebGLRenderer } from './godot-renderer.mjs';
