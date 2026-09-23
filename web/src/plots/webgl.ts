import {
  paletteBytes,
  type ColormapChoice,
  type ColorRange,
  type ColorScale,
} from "./color";
import { canvasPng, validateCanvasSize } from "./capture";
import type { Bounds, MeshGeometry } from "./mesh";
import { PERFORMANCE_MEASURE, measurePerformance } from "../data/performance";
import { meshPixelTriangles, paintMeshPixels } from "./meshRaster";

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 source_position;
layout(location = 1) in float source_value;

uniform vec4 view_bounds;
uniform vec2 color_range;
uniform int scale_mode;

out float color_position;
out float valid_value;

float symlog(float value, float threshold) {
  return sign(value) * log(1.0 + abs(value) / threshold);
}

void main() {
  float width = max(view_bounds.y - view_bounds.x, 1e-30);
  float height = max(view_bounds.w - view_bounds.z, 1e-30);
  gl_Position = vec4(
    2.0 * (source_position.x - view_bounds.x) / width - 1.0,
    2.0 * (source_position.y - view_bounds.z) / height - 1.0,
    0.0,
    1.0
  );

  valid_value = (isnan(source_value) || isinf(source_value)) ? 0.0 : 1.0;
  float value = source_value;
  float minimum = color_range.x;
  float maximum = color_range.y;
  if (scale_mode == 1) {
    if (value <= 0.0 || maximum <= 0.0) valid_value = 0.0;
    value = log(max(value, 1e-30));
    minimum = log(max(minimum, 1e-30));
    maximum = log(maximum);
  } else if (scale_mode == 2) {
    float threshold = max(max(abs(minimum), abs(maximum)) * 0.01, 1e-30);
    value = symlog(value, threshold);
    minimum = symlog(minimum, threshold);
    maximum = symlog(maximum, threshold);
  }
  color_position = clamp((value - minimum) / max(maximum - minimum, 1e-30), 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D palette;
in float color_position;
in float valid_value;
out vec4 output_color;

void main() {
  output_color = valid_value < 0.999
    ? vec4(0.933, 0.933, 0.933, 1.0)
    : texture(palette, vec2(color_position, 0.5));
}`;

export interface MeshDrawSettings {
  colormap: ColormapChoice;
  scale: ColorScale;
  range: ColorRange;
  view: Bounds;
  width: number;
  height: number;
}

/** The small WebGL2 surface used by curvilinear and UGRID fields. */
export interface MeshSurface {
  draw(geometry: MeshGeometry, sourceValues: Float32Array, settings: MeshDrawSettings): void;
  capture(
    geometry: MeshGeometry,
    sourceValues: Float32Array,
    settings: MeshDrawSettings,
    width: number,
    height: number,
  ): Promise<Blob>;
  destroy(): void;
}

export function createMeshRenderer(canvas: HTMLCanvasElement): MeshSurface {
  try {
    return new MeshRenderer(canvas);
  } catch {
    return new CanvasMeshRenderer(canvas);
  }
}

class MeshRenderer implements MeshSurface {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly positionBuffer: WebGLBuffer;
  private readonly valueBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly palette: WebGLTexture;
  private uploadedGeometry: MeshGeometry | undefined;
  private uploadedValues: Float32Array | undefined;
  private uploadedColormap: ColormapChoice | undefined;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("This browser does not provide WebGL2");
    this.gl = gl;
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.positionBuffer = required(gl.createBuffer(), "position buffer");
    this.valueBuffer = required(gl.createBuffer(), "value buffer");
    this.indexBuffer = required(gl.createBuffer(), "index buffer");
    this.palette = required(gl.createTexture(), "palette texture");

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.valueBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.palette);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(required(gl.getUniformLocation(this.program, "palette"), "palette uniform"), 0);
  }

  draw(geometry: MeshGeometry, sourceValues: Float32Array, settings: MeshDrawSettings): void {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.drawAtSize(
      geometry,
      sourceValues,
      settings,
      Math.max(1, Math.round(settings.width * ratio)),
      Math.max(1, Math.round(settings.height * ratio)),
    );
  }

  private drawAtSize(
    geometry: MeshGeometry,
    sourceValues: Float32Array,
    settings: MeshDrawSettings,
    width: number,
    height: number,
  ): void {
    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);

    const geometryChanged = this.uploadedGeometry !== geometry;
    if (geometryChanged) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
      if (geometry.indices) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
      }
      this.uploadedGeometry = geometry;
    }
    if (geometryChanged || this.uploadedValues !== sourceValues) measurePerformance(PERFORMANCE_MEASURE.meshScalarUpload, () => {
      const vertexValues = geometry.indices ? sourceValues : new Float32Array(geometry.scalarIndices.length);
      if (!geometry.indices) {
        for (let index = 0; index < vertexValues.length; index += 1) {
          vertexValues[index] = sourceValues[geometry.scalarIndices[index]] ?? Number.NaN;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.valueBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertexValues, gl.DYNAMIC_DRAW);
      this.uploadedValues = sourceValues;
    });

    if (this.uploadedColormap !== settings.colormap) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.palette);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        256,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        paletteBytes(settings.colormap),
      );
      this.uploadedColormap = settings.colormap;
    }

    gl.uniform4f(
      required(gl.getUniformLocation(this.program, "view_bounds"), "view bounds uniform"),
      settings.view.minimumX - geometry.origin.x,
      settings.view.maximumX - geometry.origin.x,
      settings.view.minimumY - geometry.origin.y,
      settings.view.maximumY - geometry.origin.y,
    );
    gl.uniform2f(
      required(gl.getUniformLocation(this.program, "color_range"), "color range uniform"),
      settings.range.minimum,
      settings.range.maximum,
    );
    gl.uniform1i(
      required(gl.getUniformLocation(this.program, "scale_mode"), "scale uniform"),
      settings.scale === "linear" ? 0 : settings.scale === "log" ? 1 : 2,
    );
    measurePerformance(PERFORMANCE_MEASURE.meshDraw, () => {
      gl.clearColor(0.933, 0.933, 0.933, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (geometry.indices) gl.drawElements(gl.TRIANGLES, geometry.indices.length, gl.UNSIGNED_INT, 0);
      else gl.drawArrays(gl.TRIANGLES, 0, geometry.scalarIndices.length);
    });
  }

  async capture(
    geometry: MeshGeometry,
    sourceValues: Float32Array,
    settings: MeshDrawSettings,
    width: number,
    height: number,
  ): Promise<Blob> {
    validateCanvasSize(width, height);
    const canvas = document.createElement("canvas");
    const renderer = new MeshRenderer(canvas);
    try {
      renderer.validateTargetSize(width, height);
      renderer.drawAtSize(geometry, sourceValues, settings, width, height);
      return await canvasPng(canvas);
    } finally {
      renderer.destroy();
    }
  }

  private validateTargetSize(width: number, height: number): void {
    const dimensions = this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS) as Int32Array;
    const renderbuffer = Number(this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE));
    const maximumWidth = Math.min(dimensions[0], renderbuffer);
    const maximumHeight = Math.min(dimensions[1], renderbuffer);
    if (width > maximumWidth || height > maximumHeight) {
      throw new Error(
        `Export size ${width} × ${height} exceeds the WebGL limit ${maximumWidth} × ${maximumHeight}`,
      );
    }
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.valueBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteTexture(this.palette);
    gl.deleteProgram(this.program);
  }
}

class CanvasMeshRenderer implements MeshSurface {
  private readonly context: CanvasRenderingContext2D;
  private raster?: { geometry: MeshGeometry; key: string; triangles: Int32Array; image: ImageData };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot create a field canvas");
    this.context = context;
  }

  draw(geometry: MeshGeometry, sourceValues: Float32Array, settings: MeshDrawSettings): void {
    measurePerformance(PERFORMANCE_MEASURE.meshDraw, () => {
      this.drawNow(geometry, sourceValues, settings);
    });
  }

  private drawNow(
    geometry: MeshGeometry,
    sourceValues: Float32Array,
    settings: MeshDrawSettings,
  ): void {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.drawAtSize(
      geometry,
      sourceValues,
      settings,
      Math.max(1, Math.round(settings.width * ratio)),
      Math.max(1, Math.round(settings.height * ratio)),
    );
  }

  async capture(
    geometry: MeshGeometry,
    sourceValues: Float32Array,
    settings: MeshDrawSettings,
    width: number,
    height: number,
  ): Promise<Blob> {
    validateCanvasSize(width, height);
    const canvas = document.createElement("canvas");
    const renderer = new CanvasMeshRenderer(canvas);
    renderer.drawAtSize(geometry, sourceValues, settings, width, height);
    return canvasPng(canvas);
  }

  private drawAtSize(
    geometry: MeshGeometry,
    sourceValues: Float32Array,
    settings: MeshDrawSettings,
    width: number,
    height: number,
  ): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const context = this.context;
    const key = JSON.stringify([width, height, settings.view.minimumX, settings.view.maximumX,
      settings.view.minimumY, settings.view.maximumY]);
    if (this.raster?.geometry !== geometry || this.raster.key !== key) {
      const triangles = measurePerformance(PERFORMANCE_MEASURE.meshRasterMap,
        () => meshPixelTriangles(geometry, settings.view, width, height));
      this.raster = { geometry, key, triangles, image: context.createImageData(width, height) };
    }
    const { triangles, image } = this.raster;
    measurePerformance(PERFORMANCE_MEASURE.meshRasterPaint, () => {
      paintMeshPixels(geometry, sourceValues, triangles, image.data, settings.range, settings.scale, settings.colormap);
      context.putImageData(image, 0, 0);
    });
  }

  destroy(): void { this.raster = undefined; }
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const program = required(gl.createProgram(), "shader program");
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`Cannot link ncx field shader: ${message}`);
  }
  return program;
}

function compileShader(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const shader = required(gl.createShader(kind), "shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "unknown compile error";
    gl.deleteShader(shader);
    throw new Error(`Cannot compile ncx field shader: ${message}`);
  }
  return shader;
}

function required<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`WebGL could not create ${name}`);
  return value;
}
