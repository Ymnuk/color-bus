// WGSL shader source shared with the WebGPU renderer
export const WGSL = /* wgsl */`
struct Uniforms {
  proj : mat4x4<f32>,
  view : mat4x4<f32>,
  lightDir : vec4<f32>,
  ambient  : vec4<f32>,
  camPos   : vec4<f32>,
  time     : vec4<f32>,
};
@group(0) @binding(0) var<uniform> U : Uniforms;

struct InstIn {
  @location(6) m0 : vec4<f32>,
  @location(7) m1 : vec4<f32>,
  @location(8) m2 : vec4<f32>,
  @location(9) m3 : vec4<f32>,
  @location(10) color : vec4<f32>,
  @location(11) kind : f32,     // 0 = lit mesh, 1 = shadow blob, 2 = unlit quad (digit)
  @location(12) uvRect : vec4<f32>, // x0,y0,x1,y1 of atlas region
};

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) nrm : vec3<f32>,
  @location(1) col : vec4<f32>,
  @location(2) wpos : vec3<f32>,
  @location(3) kind : f32,
  @location(4) uv : vec2<f32>,
};

@vertex
fn vs_main(@location(0) inPos : vec3<f32>,
           @location(1) inNrm : vec3<f32>,
           inst : InstIn) -> VSOut {
  let M = mat4x4<f32>(inst.m0, inst.m1, inst.m2, inst.m3);
  let world = M * vec4<f32>(inPos, 1.0);
  var out : VSOut;
  out.pos  = U.proj * U.view * world;
  out.nrm  = normalize(vec3<f32>(M * vec4<f32>(inNrm, 0.0)));
  out.col  = inst.color;
  out.wpos = world.xyz;
  out.kind = inst.kind;
  // map local quad XY (-0.5..0.5) into atlas rect
  out.uv = vec2<f32>(
    mix(inst.uvRect.x, inst.uvRect.z, inPos.x + 0.5),
    mix(inst.uvRect.y, inst.uvRect.w, 0.5 - inPos.y));
  return out;
}

@group(1) @binding(0) var digitsTex : texture_2d<f32>;
@group(1) @binding(1) var digitsSmp : sampler;

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  if (in.kind > 1.5) { // digit sprite
    let t = textureSample(digitsTex, digitsSmp, in.uv);
    let a = t.a * in.col.a;
    if (a < 0.01) { discard; }
    return vec4<f32>(in.col.rgb, a);
  }
  if (in.kind > 0.5) { // shadow blob
    return vec4<f32>(in.col.rgb, in.col.a);
  }
  let base = in.col.rgb;
  let L = normalize(-U.lightDir.xyz);
  var N = normalize(in.nrm);
  let ndl = max(dot(N, L), 0.0);
  var diff = ndl * 0.85;
  // soft hemisphere ambient (sky tint from above)
  let hemi = 0.5 + 0.5 * abs(N.y);
  let amb = mix(vec3<f32>(0.35,0.32,0.30), U.ambient.rgb, hemi);
  // specular
  let V = normalize(U.camPos.xyz - in.wpos);
  let H = normalize(L + V);
  let spec = pow(max(dot(N, H), 0.0), 42.0) * 0.35;
  var col = base * (amb + diff * vec3<f32>(1.0,0.98,0.92)) + vec3<f32>(spec);
  // slight fog toward sky color at distance
  let dist = length(U.camPos.xyz - in.wpos);
  let fog = clamp((dist - 26.0) / 60.0, 0.0, 0.55);
  col = mix(col, vec3<f32>(0.72,0.86,0.98), fog);
  return vec4<f32>(col, 1.0);
}

// ---- background sky pass ----
@vertex
fn vs_bg(@builtin(vertex_index) vi : u32) -> @location(0) vec2<f32> {
  var p = array<vec2<f32>,3>( vec2<f32>(-2.0, -1.0), vec2<f32>(2.0, -1.0), vec2<f32>(0.0, 3.0) );
  return p[vi];
}
@fragment
fn fs_bg(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  let t = clamp(uv.y * 0.5 + 0.5, 0.0, 1.0);
  let top = vec3<f32>(0.36, 0.72, 0.98);
  let bot = vec3<f32>(0.85, 0.94, 1.0);
  return vec4<f32>(mix(bot, top, t), 1.0);
}
`;
