varying vec2 vUv;
varying float vRatio;

void main() {
  vUv = uv;

  vec4 mvPosition = vec4(position, 1.0);

  // 板ポリのデフォルトのアスペクト比（インスタンスでない場合は1.0）
  float aspect = 1.0;

  // InstancedMesh(EXT_mesh_gpu_instancing)の場合はインスタンス行列を適用する。
  // three.jsがInstancedMesh描画時にUSE_INSTANCINGをdefineしinstanceMatrixを注入する。
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;

    // インスタンス行列の各列ベクトルの長さ = そのインスタンスのスケール。
    // X/Yスケールの比をアスペクト比として渡し、fragment側でUVの歪みを補正する。
    float scaleX = length(instanceMatrix[0].xyz);
    float scaleY = length(instanceMatrix[1].xyz);
    aspect = scaleX / scaleY;
  #endif

  vRatio = aspect;

  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
}
