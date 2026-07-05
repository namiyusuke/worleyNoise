import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { dot, float, floor, Fn, fract, If, length, Loop, min, mix, pass, rotate, screenUV, sin, smoothstep, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import * as T from 'three/webgpu';





const device = {
  width: window.innerWidth,
  height: window.innerHeight,
  pixelRatio: window.devicePixelRatio
};

export default class Three {
  constructor(canvas) {
    this.canvas = canvas;

    this.scene = new T.Scene();

    this.camera = new T.PerspectiveCamera(75, device.width / device.height, 0.1, 100);
    this.camera.position.set(0, 0, 2);
    this.scene.add(this.camera);

    this.renderer = new T.WebGPURenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true
    });
    this.renderer.setSize(device.width, device.height);
    this.renderer.setPixelRatio(Math.min(device.pixelRatio, 2));

    this.controls = new OrbitControls(this.camera, this.canvas);

    this.clock = new T.Clock();

    // マウスの目標位置（screenUV に合わせて 0〜1 で保持）
    this.mouse = { x: 0.5, y: 0.5 };

    this.setLights();
    this.setGeometry();
    this.setResize();
    this.setMouse();
    this.addObjects();

    // WebGPURenderer の初期化は非同期。完了後にアニメーションループを開始する
    this.renderer.init().then(() => {
      this.renderer.setAnimationLoop(this.render.bind(this));
    });
  }

  setLights() {
    this.ambientLight = new T.AmbientLight(new T.Color(1, 1, 1, 1));
    this.scene.add(this.ambientLight);
  }

  addObjects() {
    const time = uniform(0);
    this.timeUniform = time;
    this.postProcess = new T.RenderPipeline(this.renderer);
    this.quadCamera = new T.OrthographicCamera(-1, 1, 1, -1, -3, 3);
    this.quadCamera.lookAt(0, 0, 0);
    this.quadCamera.position.set(0, 0, 3);
    this.quadMaterial = new T.MeshBasicNodeMaterial({
      transparent: true
    });
let vignette = uniform(new T.Color(0.4, 0.15, 0.05).convertSRGBToLinear());
let clearColor = uniform(new T.Color(1.0, 0.5, 0.1).convertSRGBToLinear());

    // GUI で調整する Circle の中心位置
    this.circleParams = {
      centerX: uniform(0.5),
      centerY: uniform(0.5)
    };
    this.quadMaterial.colorNode = Fn(() => {
      const distort = sin(uv().y.mul(10.0)).mul(0.1);
      const center = vec2(this.circleParams.centerX, this.circleParams.centerY);
      const dist = length(screenUV.sub(center).add(vec2(distort, 0.0)));
      // 中央=1（円の中）, 外=0 の塗りつぶし円
      const circle = smoothstep(0.3, 0.2, dist);
      // 背景(vignette=暗い) と 円(clearColor=明るい) を混ぜる → 円が発光の種になる
      return mix(vec4(vignette, 1), vec4(clearColor, 1), circle);
    })();
    this.quadGeometory = new T.PlaneGeometry(2, 2);
    this.quadMesh = new T.Mesh(this.quadGeometory, this.quadMaterial);

    this.sceneA = new T.Scene();
    this.sceneA.add(this.quadMesh);

    // sceneA を描いたテクスチャ（歪ませる元）
    const scenePass = pass(this.sceneA, this.quadCamera);

    // GUI で調整する customUV の回転・スキュー
    this.uvParams = {
      rotation: uniform(-0.5),
      skewX: uniform(1.0),
      skewY: uniform(0.2)
    };
    let customUV = rotate(uv().sub(0.5).mul(30), this.uvParams.rotation).mul(
      vec2(this.uvParams.skewX, this.uvParams.skewY)
    );

    // vec2 を入れると 0〜1 の疑似ランダムな vec2 を返すハッシュ関数
    const random2 = Fn(([p]) => {
      const rand = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(rand).mul(43758.5453));
    });

    const worleyNoise = Fn(([p]) => {
      // 各
      const intCell = floor(p).toVar();
      const f = fract(p).toVar();
      const mindDist = float(10).toVar();
      const mpoint = vec2(0).toVar();
      Loop({ start: -1, end: 1, condition: '<=', name: 'xIndex' }, ({ xIndex }) => {
        Loop({ start: -1, end: 1, condition: '<=', name: 'yIndex' }, ({ yIndex }) => {
          const neighbour = vec2(xIndex, yIndex);
          let rand = random2(intCell.add(neighbour));
          let point = float(0.5).add(sin(rand.mul(6.2831).add(time)).mul(0.5));
          const diff = neighbour.add(point).sub(f);
          const dist = length(diff);
          If(dist.lessThan(mindDist), () => {
            mpoint.assign(point);
          });
          mindDist.assign(min(mindDist, dist));
        });
      });
      return mpoint;
    });
    const mpoint = worleyNoise(customUV);
    const offset = mpoint.sub(vec2(0.5)).mul(0.2);
    const final = uv().add(offset);
    // ずらしたUV(final)でシーンを読む → 歪んだ画面（ぼかす前）
    const notBlurred = scenePass.getTextureNode().sample(final);

    // 歪ませた画面を sceneB に描く（notBlurred を定義した後に代入）
    this.material = new T.MeshBasicNodeMaterial({ transparent: true });
    this.material.colorNode = notBlurred;
    this.quadMeshB = new T.Mesh(this.quadGeometory, this.material);
    this.sceneB = new T.Scene();
    this.sceneB.add(this.quadMeshB);

    // 被写界深度(DOF)のパラメータを uniform 化して GUI で調整できるようにする
    this.dofParams = {
      focus: uniform(1.0),
      focalLength: uniform(1.0),
      bokehScale: uniform(7.0)
    };
    const passForDepthOfField = pass(this.sceneB, this.quadCamera);
    const viewZ = passForDepthOfField.getViewZNode();
    const dofPass = dof(
      passForDepthOfField,
      viewZ,
      this.dofParams.focus,
      this.dofParams.focalLength,
      this.dofParams.bokehScale
    );

    // bloom(発光)：明るい部分だけがにじんで光る。元画像に加算する
    // bloom(node, strength, radius, threshold)
    this.bloomPass = bloom(dofPass, 1.0, 0.5, 0.2);
    this.postProcess.outputNode = dofPass.add(this.bloomPass);

    this.setGUI();
  }

  setGUI() {
    const gui = new GUI();

    // 円の中心はマウス追従（setMouse / render）で制御するため GUI からは外す

    const uvFolder = gui.addFolder('CustomUV');
    uvFolder.add(this.uvParams.rotation, 'value', -Math.PI, Math.PI, 0.01).name('uvRotation');
    uvFolder.add(this.uvParams.skewX, 'value', 0, 3, 0.01).name('uvSkewX');
    uvFolder.add(this.uvParams.skewY, 'value', 0, 3, 0.01).name('uvSkewY');

    const dofFolder = gui.addFolder('Depth of Field');
    dofFolder.add(this.dofParams.focus, 'value', 0, 10, 0.001).name('focus');
    dofFolder.add(this.dofParams.focalLength, 'value', 0, 5, 0.001).name('focalLength');
    dofFolder.add(this.dofParams.bokehScale, 'value', 0, 10, 0.01).name('bokehScale');

    const bloomFolder = gui.addFolder('Bloom');
    bloomFolder.add(this.bloomPass.strength, 'value', 0, 3, 0.01).name('strength');
    bloomFolder.add(this.bloomPass.radius, 'value', 0, 1, 0.01).name('radius');
    bloomFolder.add(this.bloomPass.threshold, 'value', 0, 1, 0.01).name('threshold');
  }

  setGeometry() {
    this.planeGeometry = new T.PlaneGeometry(1, 1, 128, 128);
    this.planeMaterial = new T.MeshBasicNodeMaterial({
      side: T.DoubleSide,
      wireframe: false
    });
    // 旧 fragment.glsl: gl_FragColor = vec4(vUv, 0.0, 1.0) の TSL 版
    this.planeMaterial.colorNode = vec4(uv(), 0.0, 1.0);

    this.planeMesh = new T.Mesh(this.planeGeometry, this.planeMaterial);
    this.scene.add(this.planeMesh);
  }

  render() {
    const elapsedTime = this.clock.getElapsedTime();
    this.timeUniform.value = elapsedTime;

    // 円の中心をマウス位置へ滑らかに追従させる（0.1 = 追従の速さ。小さいほど遅れて付いてくる）
    const ease = 0.1;
    this.circleParams.centerX.value += (this.mouse.x - this.circleParams.centerX.value) * ease;
    this.circleParams.centerY.value += (this.mouse.y - this.circleParams.centerY.value) * ease;

    // this.renderer.render(this.sceneA, this.quadCamera);
    this.postProcess.render();
  }

  setResize() {
    window.addEventListener('resize', this.onResize.bind(this));
  }

  setMouse() {
    window.addEventListener('pointermove', (event) => {
      // 画面座標(左上原点) → screenUV(左下原点, 0〜1) に変換
      this.mouse.x = event.clientX / device.width;
      this.mouse.y = 1 - event.clientY / device.height;
    });
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
