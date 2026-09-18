import {
  _decorator,
  BoxCollider,
  color,
  Color,
  Component,
  ImageAsset,
  Rect,
  Sprite,
  SpriteFrame,
  Texture2D,
  UITransform,
  v2,
  v3,
  v4,
  Vec2,
  Vec3,
  Vec4,
} from "cc";
import { ColorType } from "../Gameplay/Data";



const { ccclass, property, executeInEditMode } = _decorator;

/* ================= CONFIG ================= */

var WIDTH = 30;
var HEIGHT = 30;

export enum CellType {
  Empty = 0, // alpha = 0
  Sand = 1, // normal
  Solid = 2, // is choosing
  None = 3, // border cutted
}

// export var sand: SandSimulationChunked = null!;

/* ================= COMPONENT ================= */

@ccclass("SandSimulationChunked")
@executeInEditMode(true)
export class SandSimulationChunked extends Component {
  @property(Sprite)
  sprite: Sprite = null!;
  @property(Sprite)
  spriteRef: Sprite = null!;
  refData: Uint8ClampedArray = null!;

  @property([Color])
  colors: Color[] = [];
  // @property([Color])
  chosenColors: Color[] = [];

  /* ================= DATA ================= */

  grid = new Uint8Array(WIDTH * HEIGHT);
  cGrid = new Uint8Array(WIDTH * HEIGHT);
  parent = new Uint16Array(WIDTH * HEIGHT);
  texData = new Uint8Array(WIDTH * HEIGHT * 4);
  colData = new Array(WIDTH * HEIGHT).fill(color());
  texture!: Texture2D;
  empties: Vec2[] = [];
  paths: Vec2[][] = [];
  @property
  original: boolean = true;
  // @property
  noiseDensity: number = 0.005;
  // @property
  noiseCoverage: number = 0.1;

  acc = 0;
  STEP = 1 / 30;

  DIR8 = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  inited: boolean = false;
  index: Vec2 = v2(200, 200);
  uT: UITransform = null!;
  // box: BoxCollider = null!;

  map: Map<number, number> = new Map();
  colorData: number[][] = [];
  total: number = 0;

  /* ================= LIFECYCLE ================= */

  onLoad() {
    // sand = this;
  }

  getSize() {
    let w = this.uT.node.getWorldScale().x * this.uT.width;
    let h = this.uT.node.getWorldScale().y * this.uT.height;
    return v2(w, h);
  }

  initialize(): void {
    this.init([], this.index);
    let colorArray = this.colors.map((c) => "#" + c.toHEX());
    console.log(JSON.stringify(colorArray));
  }

  isUndefined(x: number, y: number) {
    return x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT;
  }

  setParent(x: number, y: number, p: number) {
    this.parent[this.idx(x, y)] = p;
  }
  getParent(x: number, y: number) {
    let p = this.parent[this.idx(x, y)];
    let id = this.revertIdx(p);
    if(this.isUndefined(id.x, id.y)) return -1;
    return p;
  }

  

  init(colorData: number[], index: Vec2) {
    // index = v2(285, 315);
    this.inited = true;
    WIDTH = index.x;
    HEIGHT = index.y;
    this.index = v2(WIDTH, HEIGHT);
    this.grid = new Uint8Array(WIDTH * HEIGHT);
    this.cGrid = new Uint8Array(WIDTH * HEIGHT);
    this.parent = new Uint16Array(WIDTH * HEIGHT);
    this.parent.fill(65535); // use 65535 to represent -1 for unsigned array
    this.texData = new Uint8Array(WIDTH * HEIGHT * 4);
    this.colData = new Array(WIDTH * HEIGHT).fill(color());

    const chosenColors = [
      ColorType.Red,
      // ColorType.Blue,
      // ColorType.Green,
      ColorType.Yellow,
      // ColorType.Purple,
      // ColorType.LightBlue,
      // ColorType.Pink,
      // ColorType.Black,
      // ColorType.Orange,
      ColorType.White,
      // ColorType.Brown,
      // ColorType.LightBrown,
      // ColorType.Skin,
      // ColorType.DarkGreen,
      ColorType.Gray,
    ];

    this.chosenColors = this.colors.filter(
      (c, i) => chosenColors.indexOf(i) !== -1,
    );

    this.initTexture();
    this.initMap(colorData);
    this.updateTextureChunked();

    // setTimeout(() => {
    //   console.log(this.bottoms);

    //   this.bottoms.forEach(b => {
    //     let v = this.revertIdx(b);
    //     this.setNonePixel(v);
    //   })
    //   this.updateTextureChunked();
    // }, 2000);
  }

  randomId = 0;
  public randomType(): ColorType {
    let r = this.randomId % 2;
    this.randomId++;
    if (r < 1) return ColorType.Green;
    return ColorType.LightBlue;
  }

  linear: number = 0;
  update(dt: number) {
    return;
    if (!this.inited) return;
    this.acc += dt;
    let mul = (this.acc / this.STEP) | 0;
    if (this.linear != mul) {
      this.linear = mul;
      for (let i = 0; i < 5; i++) {
        this.stepFallChunked(false);
        this.updateTextureChunked();
      }
    }
    if (this.linear < 5) return;
    this.acc = 0;
    this.linear = 0;
    for (let i = 0; i < 2; i++) {
      this.stepFallChunked(true);
      this.updateTextureChunked();
    }
  }

  /* ================= INIT ================= */

  initTexture() {
    this.texture = new Texture2D();
    this.texture.reset({
      width: WIDTH,
      height: HEIGHT,
      format: 35,
    });
    this.texture.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);

    let fr = new SpriteFrame();
    fr.packable = false;
    fr.rect = new Rect(0, 0, WIDTH, HEIGHT);
    fr.texture = this.texture;
    this.sprite.spriteFrame = fr;
    this.uT = this.sprite.getComponent(UITransform);
    // this.box = this.sprite.getComponent(BoxCollider);
    // this.box.size = v3(this.uT.width, this.uT.height, 0);
  }

  setNonePixel(index: Vec2) {
    let x = index.x;
    let y = index.y;

    this.grid[this.idx(x, y)] = CellType.None;
  }

  roundRectPixels(radius: number = 5) {
    const w = this.index.x;
    const h = this.index.y;
    const r2 = radius * radius;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let cx = -1,
          cy = -1;

        // bottom-left
        if (x < radius && y < radius) {
          cx = radius;
          cy = radius;
        }
        // bottom-right
        else if (x >= w - radius && y < radius) {
          cx = w - 1 - radius;
          cy = radius;
        }
        // top-left
        else if (x < radius && y >= h - radius) {
          cx = radius;
          cy = h - 1 - radius;
        }
        // top-right
        else if (x >= w - radius && y >= h - radius) {
          cx = w - 1 - radius;
          cy = h - 1 - radius;
        }

        // nếu pixel nằm trong vùng góc
        if (cx !== -1) {
          const dx = x - cx;
          const dy = y - cy;

          // ngoài hình tròn → cắt
          if (dx * dx + dy * dy > r2) {
            this.setNonePixel(v2(x, y));
          }
        }
      }
    }
  }
  private shouldApplyNoise(pixelIndex: number): boolean {
    const coverage = Math.max(0, Math.min(1, this.noiseCoverage));
    if (coverage <= 0) return false;
    if (coverage >= 1) return true;

    const randomValue = (((pixelIndex * 97) + 31) % 1000) / 1000;
    return randomValue < coverage;
  }

  private applyIndexNoise(baseColor: Color, pixelIndex: number): Color {
    if (!this.shouldApplyNoise(pixelIndex)) {
      return baseColor;
    }

    const noise = (((pixelIndex * 73) + 17) % 21) - 10;
    const strength = Math.max(0, this.noiseDensity);
    const scale = 1 + noise * strength;

    const r = Math.round(Math.min(255, Math.max(0, baseColor.r * scale)));
    const g = Math.round(Math.min(255, Math.max(0, baseColor.g * scale)));
    const b = Math.round(Math.min(255, Math.max(0, baseColor.b * scale)));

    return color(r, g, b, baseColor.a);
  }

  initMap(colorData: number[]) {
    let sr = this.spriteRef.spriteFrame.texture as Texture2D;
    let h = sr.height;
    let w = sr.width;
    let image = sr.image;
    this.refData = readImagePixels(image);
    this.map = new Map();

    // this.roundRectPixels();

    for (let i = WIDTH * 0; i < WIDTH; i++) {
      for (let j = HEIGHT * 0; j < HEIGHT; j++) {
        if (this.grid[this.idx(i, j)] === CellType.None) continue;

        let x = ((i / WIDTH) * w) | 0;
        let y = (((HEIGHT - 1 - j) / HEIGHT) * h) | 0;
        let col = getPixel(x, y, w, this.refData);
        let rs = findNearestColor(col, this.chosenColors);
        if(!this.original) {
          // col = rs.color;
          col = Color.lerp(col, col, rs.color, 0.2);
          col = this.applyIndexNoise(col, this.idx(i, j));
        }
        let cIndex = this.colors.indexOf(rs.color);

        if (!this.map.has(cIndex)) {
          this.map.set(cIndex, 0);
        }

        this.map.set(cIndex, this.map.get(cIndex) + 1);

        let index = this.idx(i, j);
        let p = index * 4;
        this.texData[p] = col.r;
        this.texData[p + 1] = col.g;
        this.texData[p + 2] = col.b;
        this.texData[p + 3] = 255;

        this.grid[index] = CellType.Sand;
        this.cGrid[index] = cIndex;
        this.colData[index] = color(col.r, col.g, col.b, 255);
      }
    }
    this.texture.uploadData(this.texData);
    // console.log(this.map);

    let keys = Array.from(this.map.keys()).sort(
      (a, b) => this.map.get(b) - this.map.get(a),
    );
    keys = keys.filter((k) => this.map.get(k) > 0);
    this.total = keys.reduce((a, b) => a + this.map.get(b), 0);
    console.log("Total", this.total);
    keys.forEach((k, i) => {
      this.colorData.push([k, this.map.get(k), this.map.get(k) / this.total]);
      console.log(k, ColorType[k], this.map.get(k));
    });
  }

  indexToWpos(x: number, y: number) {
    let w = this.uT.width;
    let h = this.uT.height;
    x = (x * w) / WIDTH - w / 2;
    y = (y * h) / HEIGHT - h / 2;
    let local = v3(x, y, -5);
    let wpos = v3();
    let m = this.sprite.node.parent.worldMatrix.clone();
    wpos = Vec3.transformMat4(wpos, local, m);
    wpos.z = this.sprite.node.worldPosition.z;
    return wpos;
  }

  wposToIndex(wpos: Vec3) {
    let local = this.sprite.node.parent.inverseTransformPoint(v3(), wpos);
    let w = this.uT.width;
    let h = this.uT.height;
    local.x += w / 2;
    local.y += h / 2;
    local.x = (local.x / w) * WIDTH;
    local.y = (local.y / h) * HEIGHT;
    local.x = local.x | 0;
    local.y = local.y | 0;
    return local;
  }

  checkPoint(hitPoint: Vec3, color: ColorType) {
    let local = this.wposToIndex(hitPoint);
    let i = this.idx(local.x, local.y);
    this.cGrid[i] = color;

    this.updateTextureChunked();
  }

  setSolidPixel(index: Vec2) {
    let x = index.x;
    let y = index.y;

    let i = this.idx(x, y);
    this.grid[i] = CellType.Solid;
  }

  removePixel(index: Vec2) {
    let x = index.x;
    let y = index.y;
    let i = this.idx(x, y);
    this.grid[i] = CellType.Empty;
    this.empties.push(index);
  }

  setSandPixel(index: Vec2) {
    let x = index.x;
    let y = index.y;
    let i = this.idx(x, y);
    this.grid[i] = CellType.Sand;
  }

  /* ================= FALL ================= */

  stepFallChunked(linear: boolean = false) {
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (this.grid[this.idx(x, y)] === CellType.Sand) {
          if (!linear) this.tryMove(x, y);
          else this.tryMoveLinear(x, y);
        }
      }
    }
  }
  tryMove(x: number, y: number) {
    const dirs = Math.random() < 0.5 ? [-1, 1] : [1, -1];

    for (const dx of dirs) {
      const nx = x + dx;
      const ny = y - 1;
      if (nx < 0 || nx >= WIDTH || ny < 0) continue;

      if (this.grid[this.idx(nx, ny)] === CellType.Empty) {
        this.swap(x, y, nx, ny);
        return;
      }
    }
  }
  tryMoveLinear(x: number, y: number) {
    const dirs = [0];

    for (const dx of dirs) {
      const nx = x + dx;
      const ny = y - 1;
      if (nx < 0 || nx >= WIDTH || ny < 0) continue;

      if (this.grid[this.idx(nx, ny)] === CellType.Empty) {
        this.swap(x, y, nx, ny);
        return;
      }
    }
  }

  updateTextureChunked() {
    for (let y = HEIGHT - 1; y >= 0; y--) {
      for (let x = 0; x < WIDTH; x++) {
        const i = this.idx(x, y);
        const ty = HEIGHT - 1 - y;
        const p = (ty * WIDTH + x) * 4;

        if (this.grid[i] === CellType.Empty || this.grid[i] === CellType.None) {
          this.texData[p + 3] = 0;
        } else {
          let color = this.colors[this.cGrid[i]];
          color = this.colData[i];
          this.texData[p] = color.r;
          this.texData[p + 1] = color.g;
          this.texData[p + 2] = color.b;
          this.texData[p + 3] = color.a;

          // this.texData[p]     = this.colData[p];
          // this.texData[p + 1] = this.colData[p + 1];
          // this.texData[p + 2] = this.colData[p + 2];
          // this.texData[p + 3] = this.colData[p + 3];
        }
      }
    }
    this.texture.uploadData(this.texData);
  }

  /* ================= UTIL ================= */

  idx(x: number, y: number) {
    return y * WIDTH + x;
  }

  revertIdx(i: number) {
    return v2(i % WIDTH, (i / WIDTH) | 0);
  }

  revertAll() {
    let data = [];
    for (let i = 0; i < WIDTH; i++) {
      for (let j = 0; j < HEIGHT; j++) {
        let index = this.idx(i, j);
        let c = this.cGrid[index];
        data.push(c);
      }
    }
    console.log(JSON.stringify(data));
  }

  swap(x1: number, y1: number, x2: number, y2: number) {
    const i1 = this.idx(x1, y1);
    const i2 = this.idx(x2, y2);

    const t = this.grid[i1];
    this.grid[i1] = this.grid[i2];
    this.grid[i2] = t;

    let c = this.cGrid[i1];
    this.cGrid[i1] = this.cGrid[i2];
    this.cGrid[i2] = c;

    let col = this.colData[i1];
    this.colData[i1] = this.colData[i2];
    this.colData[i2] = col;
  }
}

function getPixel(
  x: number,
  y: number,
  width: number,
  refData: Uint8ClampedArray,
) {
  let i = (y * width + x) * 4;
  return color(refData[i], refData[i + 1], refData[i + 2], refData[i + 3]);
}

function readImagePixels(image: ImageAsset): Uint8ClampedArray | null {
  if (image.isCompressed) return null;

  const src = image.data;

  if (!src) return null;

  if (src instanceof Uint8Array || src instanceof Uint8ClampedArray) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src as any, 0, 0);

  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

export function findNearestColor(
  target: Color,
  palette: Color[],
): { color: Color; index: number; distance: number } {
  let bestIndex = -1;
  let bestDist = Infinity;

  for (let i = 0; i < palette.length; i++) {
    const c = palette[i];

    const dr = target.r - c.r;
    const dg = target.g - c.g;
    const db = target.b - c.b;

    const dist = dr * dr + dg * dg + db * db;

    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }

  return {
    color: palette[bestIndex],
    index: bestIndex,
    distance: Math.sqrt(bestDist),
  };
}
