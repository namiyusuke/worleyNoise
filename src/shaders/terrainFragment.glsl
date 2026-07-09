varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;

uniform vec3 uColor;
uniform sampler2D uNormalMap;
uniform vec2 uNormalScale;
uniform vec2 uNormalRepeat;
uniform vec3 uLightDirection;

// タンジェント属性を持たないメッシュ用に、derivativeからノーマルマップを適用する
vec3 perturbNormal(vec3 position, vec3 N, vec2 uv) {
  vec3 q0 = dFdx(position);
  vec3 q1 = dFdy(position);
  vec2 st0 = dFdx(uv);
  vec2 st1 = dFdy(uv);

  vec3 q1perp = cross(q1, N);
  vec3 q0perp = cross(N, q0);

  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;

  float det = max(dot(T, T), dot(B, B));
  float scale = (det == 0.0) ? 0.0 : inversesqrt(det);

  vec3 mapN = texture2D(uNormalMap, uv).xyz * 2.0 - 1.0;
  mapN.xy *= uNormalScale;

  return normalize(T * (mapN.x * scale) + B * (mapN.y * scale) + N * mapN.z);
}

void main() {
  vec2 uv = vUv * uNormalRepeat;
  vec3 N = perturbNormal(vWorldPosition, normalize(vWorldNormal), uv);

  // dot積によるシンプルな拡散照明
  vec3 L = normalize(uLightDirection);
  float diffuse = max(dot(N, L), 0.0);

  // 影色と光色をdiffuseでミックスしたものを加える
  vec3 diffuseColor = mix(vec3(0.55, 0.64, 0.75), vec3(0.96, 0.97, 0.98), diffuse);

  gl_FragColor = vec4(uColor * diffuse + diffuseColor, 1.0);
}
