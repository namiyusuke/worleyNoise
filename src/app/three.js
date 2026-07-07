import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import cloudFragment from '../shaders/cloudFragment.glsl';
import cloudVertex from '../shaders/cloudVertex.glsl';
import fragmentShader from '../shaders/fragment.glsl';
import terrainFragment from '../shaders/terrainFragment.glsl';
import terrainVertex from '../shaders/terrainVertex.glsl';
import vertexShader from '../shaders/vertex.glsl';
import { preload } from './preloader';

const device = {
  width: window.innerWidth,
  height: window.innerHeight,
  pixelRatio: window.devicePixelRatio
};

export default class Three {
  constructor(canvas) {
    this.canvas = canvas;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(55, device.width / device.height, 0.01, 10000);
    this.camera.position.set(0, 0, 200);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true
    });
    this.renderer.setSize(device.width, device.height);
    this.renderer.setPixelRatio(Math.min(device.pixelRatio, 2));

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;

    this.clock = new THREE.Clock();

    this.setLights();
    this.setResize();

    // アセットをpreloadしてからシーンを構築
    this.init();
  }

  async init() {
    this.assets = await preload((progress) => {
      console.log(`loading: ${Math.round(progress * 100)}%`);
    });

    this.setBackground();
    this.setMaterials();
    this.setModels();
    this.addObjects();

    this.renderer.setAnimationLoop(this.render.bind(this));
  }

  setLights() {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.directionalLight.position.set(3, 5, 2);
    this.scene.add(this.directionalLight);
  }

  // GLSLで背景を描く（noiseテクスチャを使用）
  setBackground() {
    this.backgroundMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uNoise: { value: this.assets.textures.noise }
      },
      depthTest: false,
      depthWrite: false
    });

    const background = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.backgroundMaterial);
    background.frustumCulled = false;
    background.renderOrder = -1;
    this.scene.add(background);
  }

  // 山用のシェーダーマテリアル（ノーマルマップ付き）を作成
  setMaterials() {
    const normalMap = this.assets.textures.rockNormal;

    // 大きな山 (mountains.glb / material "Mountain")
    this.mountainMaterial = new THREE.ShaderMaterial({
      vertexShader: terrainVertex,
      fragmentShader: terrainFragment,
      side: THREE.DoubleSide,
      uniforms: {
        uNormalMap: { value: normalMap },
        uNormalScale: { value: new THREE.Vector2(1, 1) },
        uNormalRepeat: { value: new THREE.Vector2(8, 8) }
      }
    });

    // 小さい方の山 (Homepage.glb / material "HomepagePeaks")
    this.peakMaterial = new THREE.ShaderMaterial({
      vertexShader: terrainVertex,
      fragmentShader: terrainFragment,
      side: THREE.DoubleSide,
      uniforms: {
        uNormalMap: { value: normalMap },
        uNormalScale: { value: new THREE.Vector2(0.6, 0.6) },
        uNormalRepeat: { value: new THREE.Vector2(3, 3) }
      }
    });

    // 雲用シェーダーマテリアル (mountains.glb / material "Cloud")
    this.cloudMaterial = new THREE.ShaderMaterial({
      vertexShader: cloudVertex,
      fragmentShader: cloudFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uNoise: { value: this.assets.textures.noise },
        uColor: { value: new THREE.Color(0xffffff) },
        uOpacity: { value: 0.9 }
      }
    });
  }

  // 2つのGLBモデルをシーンに追加
  setModels() {
    const { homepage, mountains } = this.assets.models;

    this.scene.add(mountains);
    this.scene.add(homepage);

    // 大きな山にmountainMaterial、雲にcloudMaterialを割り当てる（他はそのまま）
    // 雲(Foreground/Middleground)はEXT_mesh_gpu_instancingのためInstancedMeshで読み込まれるが、
    // InstancedMeshもisMesh===trueなのでこの判定で拾える（頂点側でinstanceMatrixを適用する）。
    mountains.traverse((object) => {
      if (!object.isMesh) return;

      if (object.material?.name === 'Mountain') {
        object.material = this.mountainMaterial;
      } else if (object.material?.name === 'Cloud') {
        object.material = this.cloudMaterial;
      } else if (object.material?.name === 'Sky') {
        // スカイボックスは最背面の背景として扱う。
        // depthWrite=falseで前景の山・雲を隠さず、renderOrder=-10で最初に描画する。
        object.material.depthWrite = false;
        object.renderOrder = -10;
      }
    });
    console.log(mountains);
    // Homepage側の山(peaks)にpeakMaterialを割り当て
    homepage.traverse((object) => {
      if (object.isMesh) {
        object.material = this.peakMaterial;
      }
    });

    // ワールド行列を確定させてからPoint系のworldPositionを取得
    mountains.updateWorldMatrix(true, true);
    this.setCameraFromPoints(mountains);
  }

  // mountains内のPoint-Homepage / TargetPoint-HomepageのworldPositionでカメラを配置
  setCameraFromPoints(mountains) {
    const point = mountains.getObjectByName('Point-Homepage');
    const target = mountains.getObjectByName('TargetPoint-Homepage');

    if (!point || !target) {
      console.warn('Point-Homepage / TargetPoint-Homepage が見つかりません', { point, target });
      return;
    }

    const cameraPosition = point.getWorldPosition(new THREE.Vector3());
    const lookAt = target.getWorldPosition(new THREE.Vector3());

    this.camera.position.copy(cameraPosition);
    // OrbitControlsが注視点を上書きするため、lookAtではなくtargetを設定
    this.controls.target.copy(lookAt);
    this.controls.update();
  }

  render() {
    const elapsedTime = this.clock.getElapsedTime();

    if (this.backgroundMaterial) {
      this.backgroundMaterial.uniforms.uTime.value = elapsedTime;
    }

    if (this.cloudMaterial) {
      this.cloudMaterial.uniforms.uTime.value = elapsedTime;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  setResize() {
    window.addEventListener('resize', this.onResize.bind(this));
  }
  addObjects() {
    console.log(this.assets);
  }
  onResize() {
    device.width = window.innerWidth;
    device.height = window.innerHeight;

    this.camera.aspect = device.width / device.height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(device.width, device.height);
    this.renderer.setPixelRatio(Math.min(device.pixelRatio, 2));
  }
}
