import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// preloadしたいアセット一覧
const ASSETS = {
  models: {
    homepage: '/Homepage.glb',
    mountains: '/mountains.glb'
  },
  textures: {
    noise: '/noise.webp',
    rockNormal: '/rock_normal.webp'
  }
};

/**
 * すべてのGLB / テクスチャをLoadingManagerでpreloadする。
 * @param {(progress: number) => void} [onProgress] 0〜1の読み込み進捗コールバック
 * @returns {Promise<{ models: Record<string, import('three').Group>, textures: Record<string, import('three').Texture> }>}
 */
export function preload(onProgress) {
  const manager = new THREE.LoadingManager();

  manager.onProgress = (_url, loaded, total) => {
    onProgress?.(total > 0 ? loaded / total : 0);
  };

  const gltfLoader = new GLTFLoader(manager);
  const textureLoader = new THREE.TextureLoader(manager);

  const models = {};
  const textures = {};

  const tasks = [];

  for (const [key, url] of Object.entries(ASSETS.models)) {
    tasks.push(
      gltfLoader.loadAsync(url).then((gltf) => {
        models[key] = gltf.scene;
      })
    );
  }

  for (const [key, url] of Object.entries(ASSETS.textures)) {
    tasks.push(
      textureLoader.loadAsync(url).then((texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        textures[key] = texture;
      })
    );
  }

  return Promise.all(tasks).then(() => ({ models, textures }));
}
