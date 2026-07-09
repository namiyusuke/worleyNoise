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

    // dot積による拡散照明のライト方向
    const lightDirection = new THREE.Vector3(0.4, 0.5, 0.8);

    // 大きな山 (mountains.glb / material "Mountain")
    this.mountainMaterial = new THREE.ShaderMaterial({
      vertexShader: terrainVertex,
      fragmentShader: terrainFragment,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(0xffffff) },
        uNormalMap: { value: normalMap },
        uNormalScale: { value: new THREE.Vector2(1, 1) },
        uNormalRepeat: { value: new THREE.Vector2(3, 5) },
        uLightDirection: { value: lightDirection.clone() }
      }
    });

    // 小さい方の山 (Homepage.glb / material "HomepagePeaks")
    this.peakMaterial = new THREE.ShaderMaterial({
      vertexShader: terrainVertex,
      fragmentShader: terrainFragment,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(0xffffff) },
        uNormalMap: { value: normalMap },
        uNormalScale: { value: new THREE.Vector2(0.6, 0.6) },
        uNormalRepeat: { value: new THREE.Vector2(3, 5) },
        uLightDirection: { value: lightDirection.clone() }
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

    // スクロール連動カメラ（CameraPath / TargetPathに沿って動かす）
    this.setScrollPath(mountains);
  }

  // CameraPath(カメラ位置) と TargetPath(注視点) のラインからカーブを生成し、
  // ページのスクロール量に合わせてカメラを動かす。
  setScrollPath(mountains) {
    // ホームページから下へ降りていく縦パス。終点がPoint-Homepage(初期カメラ位置)と一致する。
    const cameraLine = mountains.getObjectByName('Path-TopChapters');
    const targetLine = mountains.getObjectByName('TargetPath-TopChapters');

    if (!cameraLine || !targetLine) {
      console.warn('Path-TopChapters / TargetPath-TopChapters が見つかりません', { cameraLine, targetLine });
      return;
    }

    // ラインのworldPositionの頂点列からCatmullRomの滑らかなカーブを作る
    const toCurve = (line) => {
      line.updateWorldMatrix(true, false);
      const attr = line.geometry.attributes.position;
      const points = [];
      const v = new THREE.Vector3();
      for (let i = 0; i < attr.count; i++) {
        v.fromBufferAttribute(attr, i).applyMatrix4(line.matrixWorld);
        points.push(v.clone());
      }
      // パスの終点がPoint-Homepageの初期カメラ位置なので、
      // t=0がホームページ、下へ行くほどt=1になるよう頂点列を反転する。
      points.reverse();
      return new THREE.CatmullRomCurve3(points);
    };

    this.cameraCurve = toCurve(cameraLine);
    this.targetCurve = toCurve(targetLine);

    // パスのラインそのものは見せない
    cameraLine.visible = false;
    targetLine.visible = false;

    // スクロールで注視するのでOrbitControlsは無効化
    this.controls.enabled = false;

    // 現在値(scroll)と目標値(targetScroll)。renderでlerpして滑らかに追従させる。
    this.scroll = 0;
    this.targetScroll = 0;

    // 全画面canvasを固定し、スクロール用のダミー高さ(400vh)を作る
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.scrollSpacer = document.createElement('div');
    this.scrollSpacer.style.height = '400vh';
    this.scrollSpacer.style.pointerEvents = 'none';
    document.body.appendChild(this.scrollSpacer);

    window.addEventListener('scroll', () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      this.targetScroll = max > 0 ? window.scrollY / max : 0;
    });
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

    // スクロール連動カメラ：カーブに沿ってカメラ位置と注視点を補間する
    if (this.cameraCurve && this.targetCurve) {
      // 目標スクロール量に滑らかに追従（イージング）
      this.scroll += (this.targetScroll - this.scroll) * 0.08;
      const t = Math.min(Math.max(this.scroll, 0), 1);

      this.camera.position.copy(this.cameraCurve.getPointAt(t));
      this.camera.lookAt(this.targetCurve.getPointAt(t));
    } else {
      this.controls.update();
    }

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
