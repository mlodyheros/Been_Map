import type { MapMode, MapStyle } from './model'
import type { View } from './paint'

/**
 * The photographic layer under the country shapes: a satellite or night-lights
 * image wrapped onto the globe (or unrolled onto the flat map) by a shader.
 * The plain style has no image and leaves this layer empty.
 */

const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D image;
uniform vec2 centre;   // device pixels, y up
uniform float scale;   // device pixels per unit
uniform vec4 turn;     // sin/cos of the view longitude, sin/cos of the view latitude
uniform vec2 origin;   // flat map: unit position of the view centre
uniform bool flatMap;
uniform bool night;
uniform sampler2D close; // sharper imagery for the area being looked at
uniform vec4 box;        // its west edge, north edge, width and height in radians; width 0 = none
out vec4 colour;

const float PI = 3.141592653589793;

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
  } else {
    float r = min(dot(p, p), 1.0);
    outside = dot(p, p) > 1.0;
    depth = sqrt(1.0 - r);
    cover = clamp((1.0 - sqrt(r)) * scale, 0.0, 1.0);
    float forward = depth * turn.w - p.y * turn.z;
    lat = asin(clamp(depth * turn.z + p.y * turn.w, -1.0, 1.0));
    around = vec2(forward * turn.y - p.x * turn.x, forward * turn.x + p.x * turn.y);
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
  vec3 c = textureGrad(image, vec2(u, v), vec2(du.x, dv.x), vec2(du.y, dv.y)).rgb;
  if (outside) discard;
  if (night) c *= 1.5;

  if (box.z > 0.0) {
    vec2 q = vec2(mod(lng - box.x, 2.0 * PI) / box.z, (box.y - lat) / box.w);
    if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
      vec2 k = vec2(2.0 * PI / box.z, PI / box.w);
      vec4 sharp = textureGrad(close, q, vec2(du.x, dv.x) * k, vec2(du.y, dv.y) * k);
      // blend out towards the edge of the sharp area so it has no visible border
      vec2 edge = smoothstep(0.0, 0.06, q) * smoothstep(0.0, 0.06, 1.0 - q);
      c = mix(c, sharp.rgb, sharp.a * edge.x * edge.y);
    }
  }

  if (night) {
    c += vec3(0.004, 0.008, 0.024);
    c += vec3(0.10, 0.22, 0.55) * pow(1.0 - depth, 3.0);
  } else {
    c *= mix(0.55, 1.0, pow(depth, 0.45));
    c += vec3(0.25, 0.42, 0.75) * pow(1.0 - depth, 4.0) * 0.6;
  }
  colour = vec4(c * cover, cover);
}`

const FILES: Record<Exclude<MapStyle, 'plain'>, string> = {
  terrain: 'textures/terrain.jpg',
  night: 'textures/night.jpg',
}

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
  image: HTMLCanvasElement
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
    night: at('night'),
    box: at('box'),
  }
  gl.uniform1i(at('image'), 0)
  gl.uniform1i(at('close'), 1)

  let detail: Detail | null = null
  const detailTexture = gl.createTexture()!

  const textures = new Map<string, WebGLTexture | 'loading'>()
  const textureFor = (style: Exclude<MapStyle, 'plain'>) => {
    const known = textures.get(style)
    if (known) return known === 'loading' ? null : known
    textures.set(style, 'loading')
    const image = new Image()
    image.onload = () => {
      const texture = gl.createTexture()!
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
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
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      textures.set(style, texture)
      onLoad()
    }
    image.onerror = () => textures.delete(style)
    image.src = FILES[style]
    return null
  }

  const clear = () => {
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  return {
    clear,
    setDetail(next) {
      detail = next
      if (!next) return
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, detailTexture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, next.image)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.activeTexture(gl.TEXTURE0)
    },
    draw(style, mode, width, height, scale, view) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      clear()
      if (style === 'plain' || gl.isContextLost()) return true
      const texture = textureFor(style)
      if (!texture) return false
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      if (detail && detail.style === style) {
        gl.uniform4f(uniforms.box, detail.west * RAD, detail.north * RAD, detail.width * RAD, detail.height * RAD)
      } else gl.uniform4f(uniforms.box, 0, 0, 0, 0)
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
      gl.uniform1i(uniforms.night, style === 'night' ? 1 : 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      return true
    },
  }
}
