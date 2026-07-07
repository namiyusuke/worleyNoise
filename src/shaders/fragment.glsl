varying vec2 vUv;

uniform float uTime;
uniform sampler2D uNoise;

void main() {
  // ノイズテクスチャをゆっくりスクロールさせてサンプリング
  vec2 uv = vUv;
  float n = texture2D(uNoise, uv + vec2(uTime * 0.02, uTime * 0.01)).r;

  // 上下グラデーションにノイズを乗せた背景
  vec3 top = vec3(0.05, 0.06, 0.12);
  vec3 bottom = vec3(0.02, 0.02, 0.04);
  vec3 color = mix(bottom, top, uv.y);
  color += (n - 0.5) * 0.08;

  gl_FragColor = vec4(color, 1.0);
}
