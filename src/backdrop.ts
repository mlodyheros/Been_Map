import type { MapMode, MapStyle } from './model'
import type { View } from './paint'

/**
 * The picture under the country shapes, drawn by a shader: a satellite or
 * night-lights image wrapped onto the globe (or unrolled onto the flat map),
 * or land coloured by its height with the mountains standing out in 3D.
 * The plain style has no picture and leaves this layer empty.
 */

const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D image;      // the whole world, for the terrain and night styles
uniform sampler2D close;      // sharper imagery for the area being looked at
uniform sampler2D closeRelief; // shaded relief for that area: mid grey is flat ground, dark is water
uniform sampler2D heights;    // height above the sea, 0…1
uniform vec2 centre;   // device pixels, y up
uniform float scale;   // device pixels per unit
uniform vec4 turn;     // sin/cos of the view longitude, sin/cos of the view latitude
uniform vec2 origin;   // flat map: unit position of the view centre
uniform bool flatMap;
uniform int kind;      // 1 terrain, 2 night, 3 height colours
uniform vec4 box;      // the sharp area's west edge, north edge, width and height in radians
uniform bool hasClose;
uniform bool hasRelief;
uniform bool hasHeights;
uniform float bulge;   // how far the highest mountains stand out of the globe, in globe radii
uniform float heightLod;
out vec4 colour;

const float PI = 3.141592653589793;
const float FLAT_GREY = 0.565; // level ground in the relief imagery (144 of 255)
const float WATER_GREY = 0.345; // the sea and lakes there are one flat grey (88 of 255)

// from "right, up, towards the viewer" to a direction on the Earth
vec3 toEarth(vec3 v) {
  float forward = v.z * turn.w - v.y * turn.z;
  return vec3(forward * turn.y - v.x * turn.x, forward * turn.x + v.x * turn.y, v.z * turn.z + v.y * turn.w);
}

float heightAt(float lng, float lat) {
  return textureLod(heights, vec2(lng / (2.0 * PI) + 0.5, 0.5 - lat / PI), heightLod).r;
}

float heightOf(vec3 dir) {
  return heightAt(atan(dir.y, dir.x), asin(clamp(dir.z, -1.0, 1.0)));
}

// Light from the north-west, the way printed maps are shaded: 1 on level ground.
float hillshade(float lng, float lat) {
  float d = 2.0 * PI / 2048.0 * exp2(heightLod);
  float east = (heightAt(lng + d, lat) - heightAt(lng - d, lat)) / (2.0 * d * max(cos(lat), 0.2));
  float north = (heightAt(lng, lat + d) - heightAt(lng, lat - d)) / (2.0 * d);
  vec3 normal = normalize(vec3(-east * 0.11, -north * 0.11, 1.0));
  vec3 light = normalize(vec3(-0.55, 0.55, 0.62));
  return clamp(1.0 + (dot(normal, light) - light.z) * 1.9, 0.5, 1.45);
}

// Lowlands green, hills sand, mountains brown, the highest and the polar ice white.
// The height map is not linear: it stores roughly the square root of the height,
// so 0.25 is about 400 m, 0.5 about 2 km, 0.8 about 4.8 km.
vec3 heightColour(float h, float lat) {
  vec3 c = vec3(0.64, 0.79, 0.60);
  c = mix(c, vec3(0.80, 0.88, 0.66), smoothstep(0.00, 0.10, h));
  c = mix(c, vec3(0.95, 0.91, 0.70), smoothstep(0.10, 0.27, h));
  c = mix(c, vec3(0.89, 0.76, 0.56), smoothstep(0.27, 0.46, h));
  c = mix(c, vec3(0.72, 0.56, 0.43), smoothstep(0.46, 0.66, h));
  c = mix(c, vec3(0.62, 0.53, 0.50), smoothstep(0.66, 0.84, h));
  // the snow line: about 5.5 km up in the tropics, at sea level near the poles
  // (Antarctica is ice right to its coast; the Arctic lands thaw further north)
  float polar = lat < 0.0 ? smoothstep(1.02, 1.12, -lat) : smoothstep(1.08, 1.36, lat);
  float snowline = mix(0.86, 0.0, polar);
  return mix(c, vec3(0.97, 0.97, 0.98), smoothstep(snowline, snowline + 0.07, h));
}

// How far the ground stands out of the globe, 0…1: true height, undoing the map's square root.
float rise(vec3 dir) {
  float h = heightOf(dir);
  return h * h;
}

void main() {
  vec2 p = (gl_FragCoord.xy - centre) / scale;
  float lat;
  // direction of the longitude as a point on a circle: unlike the angle itself
  // it has no jump at 180°, so its slope is safe to use for picking a mip level
  vec2 around;
  float depth = 1.0;
  float cover = 1.0;
  bool outside = false;

  if (flatMap) {
    // Natural Earth projection, inverted: latitude by Newton's method, then longitude
    // 1.4224 is where the poles land; beyond it the iteration below has no answer
    float y = clamp(p.y + origin.y, -1.4224, 1.4224);
    float x = p.x + origin.x;
    lat = y;
    for (int i = 0; i < 8; i++) {
      float a = lat * lat;
      float b = a * a;
      float f = lat * (1.007226 + a * (0.015085 + b * (-0.044475 + 0.028874 * a - 0.005916 * b))) - y;
      float d = 1.007226 + a * (0.045255 + b * (-0.311325 + 0.259866 * a - 0.065076 * b));
      lat -= f / d;
    }
    float a = lat * lat;
    float lng = x / (0.8707 + a * (-0.131979 + a * (-0.013791 + a * a * a * (0.003971 - 0.001529 * a))));
    outside = abs(p.y + origin.y) > 1.4224 || abs(lng) > PI;
    around = vec2(cos(lng), sin(lng));
  } else if (bulge > 0.0) {
    // The globe with its mountains standing out: walk along the line of sight
    // from just above the highest peak until it goes under the ground.
    float r2 = dot(p, p);
    float top = 1.0 + bulge;
    outside = r2 > top * top;
    float from = sqrt(max(top * top - r2, 0.0));
    float to = r2 < 1.0 ? sqrt(1.0 - r2) : 0.0;
    float z = to;
    bool hit = r2 < 1.0;
    float before = from;
    for (int i = 1; i <= 28; i++) {
      float at = mix(from, to, float(i) / 28.0);
      vec3 point = vec3(p, at);
      float radius = length(point);
      if (radius <= 1.0 + bulge * rise(toEarth(point / radius))) {
        // close in on the exact spot between the last two samples
        float above = before;
        float below = at;
        for (int j = 0; j < 5; j++) {
          float mid = 0.5 * (above + below);
          vec3 m = vec3(p, mid);
          float mr = length(m);
          if (mr <= 1.0 + bulge * rise(toEarth(m / mr))) below = mid;
          else above = mid;
        }
        z = below;
        hit = true;
        break;
      }
      before = at;
    }
    if (!hit) outside = true;
    vec3 surface = vec3(p, z);
    vec3 earth = toEarth(surface / max(length(surface), 1e-6));
    // past the edge of the globe only real mountains show; ground a pixel or two tall would look like specks
    if (r2 >= 1.0 && bulge * rise(earth) * scale < 2.5) outside = true;
    depth = clamp(z, 0.0, 1.0);
    lat = asin(clamp(earth.z, -1.0, 1.0));
    around = earth.xy;
  } else {
    float r = min(dot(p, p), 1.0);
    outside = dot(p, p) > 1.0;
    depth = sqrt(1.0 - r);
    cover = clamp((1.0 - sqrt(r)) * scale, 0.0, 1.0);
    vec3 earth = toEarth(vec3(p, depth));
    lat = asin(clamp(earth.z, -1.0, 1.0));
    around = earth.xy;
  }

  float size = max(dot(around, around), 1e-6);
  float lng = atan(around.y, around.x);
  float u = lng / (2.0 * PI) + 0.5;
  float v = 0.5 - lat / PI;
  vec2 du = vec2(
    around.x * dFdx(around.y) - around.y * dFdx(around.x),
    around.x * dFdy(around.y) - around.y * dFdy(around.x)
  ) / (size * 2.0 * PI);
  vec2 dv = vec2(dFdx(v), dFdy(v));
  vec3 c = kind == 3 ? vec3(0.0) : textureGrad(image, vec2(u, v), vec2(du.x, dv.x), vec2(du.y, dv.y)).rgb;
  if (outside) discard;

  // the sharper pictures of the area being looked at, blended out towards their edge
  float sharpness = 0.0;
  vec3 sharp = vec3(0.0);
  float relief = FLAT_GREY;
  float reliefShare = 0.0;
  if (box.z > 0.0) {
    vec2 q = vec2(mod(lng - box.x, 2.0 * PI) / box.z, (box.y - lat) / box.w);
    if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
      vec2 k = vec2(2.0 * PI / box.z, PI / box.w);
      vec2 edge = smoothstep(0.0, 0.06, q) * smoothstep(0.0, 0.06, 1.0 - q);
      if (hasClose) {
        vec4 t = textureGrad(close, q, vec2(du.x, dv.x) * k, vec2(du.y, dv.y) * k);
        sharp = t.rgb;
        sharpness = t.a * edge.x * edge.y;
      }
      if (hasRelief) {
        vec4 t = textureGrad(closeRelief, q, vec2(du.x, dv.x) * k, vec2(du.y, dv.y) * k);
        // one channel only; 0 marks a tile that has not arrived (the imagery itself never goes that dark)
        relief = t.r;
        reliefShare = step(0.03, t.r) * edge.x * edge.y;
      }
    }
  }

  // how the ground is lit: from the fine relief where there is some, else from the height map
  float coarse = hasHeights ? hillshade(lng, lat) : 1.0;
  float ground = hasHeights ? heightOf(vec3(around / sqrt(size) * cos(lat), sin(lat))) : 0.0;
  // water is exactly one grey; a shaded slope can be just as dark, but slopes are not near sea level
  float water = (1.0 - smoothstep(0.012, 0.03, abs(relief - WATER_GREY))) * (1.0 - smoothstep(0.28, 0.36, ground)) * reliefShare;
  // the fine relief, its contrast raised a little: on its own it is a gentle grey
  float fine = clamp(1.0 + (relief / FLAT_GREY - 1.0) * 1.35, 0.4, 1.7);
  float shade = mix(coarse, mix(fine, 1.0, water), reliefShare);

  if (kind == 1) {
    c = mix(c, sharp, sharpness);
    // a little more colour than the photo has, and the relief picked out
    c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 1.18);
    // dark forest takes shading poorly: light slopes are also lifted, not only shadows deepened
    // light slopes are lifted and shadows deepened by a fixed amount as well, or dark forest would hardly change
    c = c * mix(1.0, shade, 0.8) + vec3(0.13, 0.12, 0.10) * (shade - 1.0);
    c *= mix(0.55, 1.0, pow(depth, 0.45));
    c += vec3(0.25, 0.42, 0.75) * pow(1.0 - depth, 4.0) * 0.6;
  } else if (kind == 2) {
    // How lit each spot is, 0…1, read from the red channel: the ground in both
    // pictures is a dark blue with almost no red, the lights are warm. (The bundled
    // image's lights are dimmer and greyer than the sharp tiles', hence two scales.)
    float litWorld = smoothstep(0.0, 0.2, c.r - 0.25 * c.b); // its ground is blue with a trace of red; its lights grey
    // (the faint haze round cities in the sharp tiles stays dark, or whole regions turn to fog)
    float litClose = smoothstep(0.24, 1.0, sharp.r);
    // (the close tiles saturate over big cities, so their middle tones are pressed down harder)
    float lit = mix(pow(litWorld, 0.9), pow(litClose, 1.8), sharpness);
    // the dark ground, with the light spots of the bundled image taken out of it
    // (where the sharp tiles are in, their own dark ground is used: the bundled one is coarse there)
    vec3 night = vec3(0.035, 0.055, 0.12);
    vec3 ground = mix(mix(c * 1.1, night, litWorld), mix(sharp * vec3(0.8, 0.95, 1.05), night, litClose), sharpness);
    ground *= mix(1.0, shade, 0.35);
    // dim lights glow orange, the brightest city centres turn a warm white
    vec3 light = mix(vec3(1.0, 0.58, 0.24), vec3(1.0, 0.87, 0.62), smoothstep(0.3, 1.0, lit));
    c = ground * (1.0 - 0.7 * lit) + light * (lit * 0.85 + lit * lit * 0.15);
    c += vec3(0.004, 0.008, 0.024);
    c += vec3(0.10, 0.22, 0.55) * pow(1.0 - depth, 3.0);
  } else {
    c = heightColour(ground, lat) * mix(1.0, shade, 0.85);
    c = mix(c, vec3(0.80, 0.88, 0.96), water);
  }
  colour = vec4(clamp(c, 0.0, 1.0) * cover, cover);
}`

type Photo = 'terrain' | 'night'
const FILES: Record<Photo | 'heights', string> = {
  terrain: 'textures/terrain.jpg',
  night: 'textures/night.jpg',
  heights: 'textures/height.png',
}
const KIND: Record<Exclude<MapStyle, 'plain'>, number> = { terrain: 1, night: 2, relief: 3 }
/** How far the highest peaks stand out of the globe at zoom 1, in globe radii: about 25 times life size. */
const BULGE = 0.035

const RAD = Math.PI / 180
// same constants as d3's Natural Earth projection, for the flat map's origin
const flatX = (lng: number, lat: number) => {
  const a = lat * lat
  const b = a * a
  return lng * (0.8707 - 0.131979 * a + b * (-0.013791 + b * (0.003971 * a - 0.001529 * b)))
}
const flatY = (lat: number) => {
  const a = lat * lat
  const b = a * a
  return lat * (1.007226 + a * (0.015085 + b * (-0.044475 + 0.028874 * a - 0.005916 * b)))
}

export interface Backdrop {
  /** Paints the layer; returns false while the style's image is still loading. */
  draw(style: MapStyle, mode: MapMode, width: number, height: number, scale: number, view: View): boolean
  clear(): void
  /** Sharper imagery to lay over part of the map, or null to drop it. */
  setDetail(detail: Detail | null): void
}

export interface Detail {
  style: MapStyle
  /** The picture itself, more detailed than the bundled one. */
  image: HTMLCanvasElement | null
  /** Shaded relief of the same area. */
  relief: HTMLCanvasElement | null
  /** Degrees: west edge, north edge, width, height. */
  west: number
  north: number
  width: number
  height: number
}

export function createBackdrop(canvas: HTMLCanvasElement, onLoad: () => void): Backdrop | null {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true })
  if (!gl) return null

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    return shader
  }
  const program = gl.createProgram()!
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  gl.useProgram(program)

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const corner = gl.getAttribLocation(program, 'corner')
  gl.enableVertexAttribArray(corner)
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)

  const at = (name: string) => gl.getUniformLocation(program, name)
  const uniforms = {
    centre: at('centre'),
    scale: at('scale'),
    turn: at('turn'),
    origin: at('origin'),
    flatMap: at('flatMap'),
    kind: at('kind'),
    box: at('box'),
    hasClose: at('hasClose'),
    hasRelief: at('hasRelief'),
    hasHeights: at('hasHeights'),
    bulge: at('bulge'),
    heightLod: at('heightLod'),
  }
  // one texture unit per picture
  const UNIT = { image: 0, close: 1, closeRelief: 2, heights: 3 }
  for (const [name, unit] of Object.entries(UNIT)) gl.uniform1i(at(name), unit)

  const upload = (
    texture: WebGLTexture,
    unit: number,
    source: TexImageSource,
    format: number,
    repeat: boolean,
    internal: number = format,
  ) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, format, gl.UNSIGNED_BYTE, source)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  const textures = new Map<string, WebGLTexture | 'loading'>()
  const textureFor = (name: keyof typeof FILES) => {
    const known = textures.get(name)
    if (known) return known === 'loading' ? null : known
    textures.set(name, 'loading')
    const image = new Image()
    image.onload = () => {
      const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
      let source: TexImageSource = image
      if (image.width > limit) {
        // older phones cannot hold the full image
        const small = document.createElement('canvas')
        small.width = limit
        small.height = Math.round((image.height * limit) / image.width)
        small.getContext('2d')!.drawImage(image, 0, 0, small.width, small.height)
        source = small
      }
      const texture = gl.createTexture()!
      upload(texture, name === 'heights' ? UNIT.heights : UNIT.image, source, gl.RGB, true)
      textures.set(name, texture)
      onLoad()
    }
    image.onerror = () => textures.delete(name)
    image.src = FILES[name]
    return null
  }

  let detail: Detail | null = null
  const closeTexture = gl.createTexture()!
  const reliefTexture = gl.createTexture()!

  const clear = () => {
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  return {
    clear,
    setDetail(next) {
      detail = next
      if (next?.image) upload(closeTexture, UNIT.close, next.image, gl.RGBA, false)
      // the relief is grey: one channel takes a quarter of the memory, which phones need
      if (next?.relief) upload(reliefTexture, UNIT.closeRelief, next.relief, gl.RED, false, gl.R8)
    },
    draw(style, mode, width, height, scale, view) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      clear()
      if (style === 'plain' || gl.isContextLost()) return true

      // the height map gives every style its relief; only the height colours cannot do without it
      const heights = textureFor('heights')
      const image = style === 'relief' ? null : textureFor(style)
      if (style === 'relief' ? !heights : !image) return false

      if (image) {
        gl.activeTexture(gl.TEXTURE0 + UNIT.image)
        gl.bindTexture(gl.TEXTURE_2D, image)
      }
      if (heights) {
        gl.activeTexture(gl.TEXTURE0 + UNIT.heights)
        gl.bindTexture(gl.TEXTURE_2D, heights)
      }
      const sharp = detail && detail.style === style ? detail : null
      gl.activeTexture(gl.TEXTURE0 + UNIT.close)
      gl.bindTexture(gl.TEXTURE_2D, closeTexture)
      gl.activeTexture(gl.TEXTURE0 + UNIT.closeRelief)
      gl.bindTexture(gl.TEXTURE_2D, reliefTexture)
      if (sharp) gl.uniform4f(uniforms.box, sharp.west * RAD, sharp.north * RAD, sharp.width * RAD, sharp.height * RAD)
      else gl.uniform4f(uniforms.box, 0, 0, 0, 0)
      gl.uniform1i(uniforms.hasClose, sharp?.image ? 1 : 0)
      gl.uniform1i(uniforms.hasRelief, sharp?.relief ? 1 : 0)
      gl.uniform1i(uniforms.hasHeights, heights ? 1 : 0)

      gl.uniform2f(uniforms.centre, width / 2, height / 2)
      gl.uniform1f(uniforms.scale, scale)
      gl.uniform4f(
        uniforms.turn,
        Math.sin(view.lng * RAD),
        Math.cos(view.lng * RAD),
        Math.sin(view.lat * RAD),
        Math.cos(view.lat * RAD),
      )
      gl.uniform2f(uniforms.origin, flatX(view.lng * RAD, view.lat * RAD), flatY(view.lat * RAD))
      gl.uniform1i(uniforms.flatMap, mode === 'flat' ? 1 : 0)
      gl.uniform1i(uniforms.kind, KIND[style])
      // closer in, the mountains stand out less, so they stay a few pixels tall rather than towering
      gl.uniform1f(uniforms.bulge, style === 'relief' && mode === 'globe' ? BULGE / Math.pow(view.zoom, 0.8) : 0)
      // the height map has 2048 points round the world; read it no finer than the screen shows it
      gl.uniform1f(uniforms.heightLod, Math.max(0, Math.log2(2048 / (2 * Math.PI) / scale)))
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      return true
    },
  }
}
