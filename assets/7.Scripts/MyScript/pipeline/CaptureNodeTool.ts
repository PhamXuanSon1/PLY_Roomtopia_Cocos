/**
 * CaptureNodeTool — chụp 1 Node (kèm toàn bộ node con) thành PNG theo camera hiện tại.
 *
 *   • CHỈ chụp node được chọn: mọi node khác trong scene không lọt vào ảnh.
 *   • Vùng không có gì vẽ → alpha = 0 (nền trong suốt, không phải màu đen).
 *   • Tự cắt bỏ viền trong suốt (trimTransparent) để ảnh vừa khít node.
 *
 * DÙNG TRONG EDITOR:
 *   1. Gán component này vào 1 node bất kỳ (vd node "Tools" dưới Canvas).
 *   2. Kéo node cần chụp vào ô "Target Node" rồi tick "Capture"
 *      HOẶC chọn node trong Hierarchy rồi tick "Capture Selected" (chụp được nhiều node).
 *   3. File PNG được ghi vào Output Dir (mặc định assets/3.Sprites/Captures) và asset-db tự refresh.
 *
 * CÁCH HOẠT ĐỘNG:
 *   - Tạm đổi layer của node + con sang 1 layer riêng (captureLayerBit, mặc định user layer 19).
 *   - Tạo camera tạm sao chép camera nguồn (vị trí, projection, orthoHeight/fov, near/far)
 *     nhưng visibility chỉ nhìn layer đó, clear màu (0,0,0,0), render vào RenderTexture.
 *   - Đợi engine vẽ 2 frame, đọc pixel, cắt vùng trống, encode PNG bằng canvas, ghi file.
 *   - Trả lại layer cũ + xoá camera tạm dù thành công hay lỗi.
 *
 * ⚠ Layer 19 phải không có node nào khác dùng, nếu có tool sẽ cảnh báo và node đó sẽ lọt vào ảnh.
 * ⚠ Ở Editor, scene phải đang được vẽ (Scene view mở). Nếu tool báo "không nhận được frame",
 *   click vào Scene view rồi tick lại.
 */

import {
    _decorator, Component, Node, Camera, RenderTexture, Color, Canvas, director, Director, Rect,
} from 'cc';
import { EDITOR } from 'cc/env';

const { ccclass, property, executeInEditMode, menu } = _decorator;

/** Editor API chỉ tồn tại trong edit mode; truy cập kiểu này để khỏi vướng typing. */
const Ed: any = (globalThis as any).Editor;
const TAG = '[CaptureNodeTool]';

interface PixelRect { x: number; y: number; w: number; h: number; }

@ccclass('CaptureNodeTool')
@executeInEditMode(true)
@menu('Pipeline/CaptureNodeTool')
export class CaptureNodeTool extends Component {

    @property({ type: Node, tooltip: 'Node cần chụp (chụp cả node con). Bỏ trống thì dùng node đang chọn trong Hierarchy.' })
    targetNode: Node | null = null;

    @property({ type: Camera, tooltip: 'Camera dùng để chụp. Bỏ trống: tự lấy camera của Canvas chứa node, hoặc camera đầu tiên nhìn thấy layer của node.' })
    camera: Camera | null = null;

    @property({ tooltip: 'Thư mục ghi PNG, tính từ gốc project (vd: assets/3.Sprites/Captures hoặc temp/captures).' })
    outputDir = 'assets/3.Sprites/Captures';

    @property({ tooltip: 'Tên file (không cần .png). Bỏ trống = tên node.' })
    fileName = '';

    @property({ tooltip: 'Cắt bỏ viền trong suốt quanh node để ảnh vừa khít.' })
    trimTransparent = true;

    @property({ min: 0, step: 1, tooltip: 'Số pixel viền trong suốt giữ lại quanh node sau khi cắt.' })
    padding = 0;

    @property({ min: 0.1, step: 0.1, tooltip: 'Hệ số độ phân giải. 1 = đúng kích thước pixel camera đang hiển thị, 2 = gấp đôi.' })
    scale = 1;

    @property({ range: [0, 19, 1], slide: true, tooltip: 'User layer tạm dùng để tách node khi chụp. Phải KHÔNG có node nào khác dùng layer này.' })
    captureLayerBit = 19;

    @property({ tooltip: 'Lật ảnh theo chiều dọc khi đọc pixel từ GPU. Nếu ảnh ra bị ngược thì tắt/bật lại.' })
    flipY = true;

    // ---- nút bấm trong Inspector (checkbox tự nhả ra) ----

    @property({ tooltip: 'Tick để chụp Target Node (hoặc node đang chọn nếu Target Node trống).' })
    get capture(): boolean { return false; }
    set capture(v: boolean) { if (v) void this.captureTarget(); }

    @property({ tooltip: 'Tick để chụp TẤT CẢ node đang chọn trong Hierarchy, mỗi node 1 file.' })
    get captureSelected(): boolean { return false; }
    set captureSelected(v: boolean) { if (v) void this.captureAllSelected(); }

    private _busy = false;

    // ======================================================== public API

    /** Chụp targetNode; nếu trống thì chụp node đang chọn trong Editor. */
    async captureTarget(): Promise<string | null> {
        let node = this.targetNode;
        if (!node) {
            const sel = await this.getEditorSelectedNodes();
            node = sel[0] ?? null;
        }
        if (!node) { console.error(`${TAG} Chưa có node: gán Target Node hoặc chọn node trong Hierarchy.`); return null; }
        return this.captureNode(node, this.fileName || undefined);
    }

    /** Chụp lần lượt mọi node đang chọn trong Hierarchy. */
    async captureAllSelected(): Promise<void> {
        const nodes = await this.getEditorSelectedNodes();
        if (nodes.length === 0) { console.error(`${TAG} Không có node nào đang được chọn trong Hierarchy.`); return; }
        let ok = 0;
        for (const n of nodes) {
            const file = await this.captureNode(n);
            if (file) ok++;
        }
        console.log(`${TAG} DONE! Đã chụp ${ok}/${nodes.length} node.`);
    }

    /**
     * Chụp 1 node (kèm con) → PNG. Trả về đường dẫn file đã ghi, hoặc null nếu lỗi.
     * Gọi được từ code khác: `tool.captureNode(node, 'ten_file')`.
     */
    async captureNode(node: Node, fileName?: string): Promise<string | null> {
        if (this._busy) { console.warn(`${TAG} Đang chụp, đợi xong rồi tick lại.`); return null; }
        if (!node || !node.isValid) { console.error(`${TAG} Node không hợp lệ.`); return null; }

        const srcCam = this.camera ?? this.findCameraFor(node);
        if (!srcCam) { console.error(`${TAG} Không tìm thấy camera nào nhìn thấy "${node.name}". Hãy gán ô Camera.`); return null; }

        const bit = 1 << this.captureLayerBit;
        this.warnIfLayerInUse(node, bit);

        this._busy = true;
        const savedLayers = new Map<Node, number>();
        let camNode: Node | null = null;
        let rt: RenderTexture | null = null;

        try {
            // 1. Tách node ra layer riêng
            const mark = (n: Node) => { savedLayers.set(n, n.layer); n.layer = bit; for (const c of n.children) mark(c); };
            mark(node);

            // 2. Camera tạm sao chép camera nguồn, chỉ nhìn layer riêng, nền trong suốt
            const { w, h } = this.computeSize(srcCam);
            rt = new RenderTexture();
            rt.reset({ width: w, height: h });

            camNode = new Node('__CaptureCamera__');
            camNode.layer = srcCam.node.layer;
            camNode.setParent(this.node);
            camNode.setWorldPosition(srcCam.node.worldPosition);
            camNode.setWorldRotation(srcCam.node.worldRotation);
            camNode.setWorldScale(srcCam.node.worldScale);

            const cam = camNode.addComponent(Camera);
            cam.projection = srcCam.projection;
            cam.orthoHeight = srcCam.orthoHeight;
            cam.fov = srcCam.fov;
            cam.fovAxis = srcCam.fovAxis;
            cam.near = srcCam.near;
            cam.far = srcCam.far;
            cam.rect = new Rect(0, 0, 1, 1);
            cam.priority = srcCam.priority - 1;
            cam.visibility = bit;
            cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
            cam.clearColor = new Color(0, 0, 0, 0);
            cam.clearDepth = 1;
            cam.targetTexture = rt;

            // 3. Render ngay bằng pipeline chỉ với camera tạm. Ở edit mode, camera mới tạo KHÔNG được
            //    vòng lặp frame của editor vẽ vào RT (đã thử: 0 pixel dù đợi nhiều frame), nên phải tự render.
            //    Lỗi thì rơi về cách đợi frame.
            if (!this.renderNow(cam)) {
                const drawn = await this.waitFrames(2, 3000);
                if (!drawn) console.warn(`${TAG} Không nhận được frame vẽ từ engine sau 3s — ảnh có thể trống. Click vào Scene view rồi thử lại.`);
            }

            // 4. Đọc pixel (RGBA, gốc dưới-trái theo GL)
            const pixels = rt.readPixels(0, 0, w, h) as Uint8Array | null;
            if (!pixels || pixels.length < w * h * 4) { console.error(`${TAG} readPixels thất bại.`); return null; }

            // 5. Cắt vùng trống
            let rect: PixelRect = { x: 0, y: 0, w, h };
            if (this.trimTransparent) {
                const bb = this.alphaBounds(pixels, w, h, this.padding);
                if (!bb) { console.warn(`${TAG} "${node.name}" không vẽ ra pixel nào trong khung camera — bỏ qua.`); return null; }
                rect = bb;
            }

            // 6. Encode + ghi file
            const dataUrl = this.encodePng(pixels, w, h, rect, this.flipY);
            const name = this.safeName(fileName || node.name);
            const out = await this.savePng(dataUrl, name);
            if (out) console.log(`${TAG} Đã chụp "${node.name}" → ${out} (${rect.w}x${rect.h}px, camera ${srcCam.node.name})`);
            return out;
        } catch (e) {
            console.error(`${TAG} Lỗi khi chụp "${node.name}":`, e);
            return null;
        } finally {
            if (camNode && camNode.isValid) {
                const c = camNode.getComponent(Camera);
                if (c) c.targetTexture = null;
                camNode.removeFromParent();
                camNode.destroy();
            }
            if (rt) rt.destroy();
            for (const [n, layer] of savedLayers) if (n.isValid) n.layer = layer;
            this._busy = false;
        }
    }

    // ======================================================== helpers

    /** Camera của Canvas gần nhất chứa node; không có thì camera đầu tiên nhìn thấy layer của node. */
    private findCameraFor(node: Node): Camera | null {
        for (let p: Node | null = node; p; p = p.parent) {
            const canvas = p.getComponent(Canvas);
            if (canvas?.cameraComponent) return canvas.cameraComponent;
        }
        const scene = director.getScene();
        if (!scene) return null;
        const cams = scene.getComponentsInChildren(Camera)
            .filter((c) => c.node.name !== '__CaptureCamera__' && c.enabledInHierarchy);
        return cams.find((c) => (c.visibility & node.layer) !== 0) ?? cams[0] ?? null;
    }

    /** Cảnh báo nếu ngoài subtree còn node khác đang dùng layer chụp (sẽ lọt vào ảnh). */
    private warnIfLayerInUse(target: Node, bit: number): void {
        const scene = director.getScene();
        if (!scene) return;
        const leaks: string[] = [];
        const walk = (n: Node, inside: boolean) => {
            const nowInside = inside || n === target;
            if (!nowInside && n.layer === bit) leaks.push(n.name);
            for (const c of n.children) walk(c, nowInside);
        };
        walk(scene, false);
        if (leaks.length) {
            console.warn(`${TAG} ${leaks.length} node khác đang dùng layer ${this.captureLayerBit} và sẽ lọt vào ảnh: ${leaks.slice(0, 10).join(', ')}${leaks.length > 10 ? '…' : ''}. Đổi Capture Layer Bit sang layer trống.`);
        }
    }

    /**
     * Kích thước RenderTexture. Ortho: cao = 2*orthoHeight → 1 đơn vị world = 1 pixel (đúng cỡ sprite),
     * rộng theo aspect của camera nguồn. Perspective: theo kích thước pixel camera nguồn đang vẽ.
     */
    private computeSize(srcCam: Camera): { w: number; h: number } {
        const rc = srcCam.camera;
        const aspect = rc && rc.aspect > 0 ? rc.aspect : 16 / 9;
        let w: number; let h: number;
        if (srcCam.projection === Camera.ProjectionType.ORTHO) {
            h = srcCam.orthoHeight * 2 * this.scale;
            w = h * aspect;
        } else {
            w = (rc?.width || 1280) * this.scale;
            h = (rc?.height || 720) * this.scale;
        }
        const clamp = (v: number) => Math.max(1, Math.min(8192, Math.round(v)));
        return { w: clamp(w), h: clamp(h) };
    }

    /**
     * Render một lần, đồng bộ, chỉ với camera `cam` vào targetTexture của nó.
     * Phải tự gom batch 2D (batcher2D.update) vì bình thường việc đó nằm trong Root.frameMove.
     */
    private renderNow(cam: Camera): boolean {
        try {
            const root: any = director.root;
            const rc = cam.camera;
            if (!root?.pipeline || !rc) return false;
            rc.update(true);
            const batcher = root.batcher2D;
            if (batcher) { batcher.update(); batcher.uploadBuffers(); }
            root.pipeline.render([rc]);
            if (batcher) batcher.reset();
            return true;
        } catch (e) {
            console.warn(`${TAG} Render trực tiếp lỗi, chuyển sang đợi frame:`, e);
            return false;
        }
    }

    /**
     * Đợi engine phát EVENT_AFTER_DRAW `n` lần; false nếu quá timeout.
     * ⚠ Ở edit mode engine KHÔNG tự vẽ mỗi frame — chỉ vẽ khi có yêu cầu
     *   (cce.Engine.repaintInEditMode). Phải tự kích trước mỗi frame cần đợi.
     */
    private waitFrames(n: number, timeoutMs: number): Promise<boolean> {
        // repaintInEditMode() bị bỏ qua nếu gọi trong chính frame đang tick (kể cả trong EVENT_AFTER_DRAW)
        // → luôn hoãn sang setTimeout để chạy sau khi tick hiện tại kết thúc.
        const kick = () => {
            if (!EDITOR) return;
            setTimeout(() => {
                try { (globalThis as any).cce?.Engine?.repaintInEditMode?.(); } catch { /* không có cce → engine tự tick */ }
            }, 0);
        };
        return new Promise((resolve) => {
            let left = n;
            let timer: ReturnType<typeof setTimeout> | null = null;
            const onDraw = () => {
                if (--left > 0) { kick(); return; }
                director.off(Director.EVENT_AFTER_DRAW, onDraw);
                if (timer) clearTimeout(timer);
                resolve(true);
            };
            timer = setTimeout(() => { director.off(Director.EVENT_AFTER_DRAW, onDraw); resolve(false); }, timeoutMs);
            director.on(Director.EVENT_AFTER_DRAW, onDraw);
            kick();
        });
    }

    /** Bounding box (toạ độ pixel gốc dưới-trái) của mọi pixel có alpha > 0, cộng padding. null nếu trống hoàn toàn. */
    private alphaBounds(px: Uint8Array, w: number, h: number, pad: number): PixelRect | null {
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
            const row = y * w * 4;
            for (let x = 0; x < w; x++) {
                if (px[row + x * 4 + 3] === 0) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < 0) return null;
        minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
        maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
        return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    }

    /** Cắt `rect` từ buffer RGBA rồi encode PNG bằng canvas → data URL. */
    private encodePng(px: Uint8Array, w: number, _h: number, rect: PixelRect, flipY: boolean): string {
        const doc = (globalThis as any).document as Document | undefined;
        if (!doc) throw new Error('Không có DOM canvas để encode PNG.');
        const canvas = doc.createElement('canvas');
        canvas.width = rect.w; canvas.height = rect.h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Không tạo được 2D context.');
        const img = ctx.createImageData(rect.w, rect.h);
        const rowBytes = rect.w * 4;
        for (let r = 0; r < rect.h; r++) {
            // GL đọc từ dưới lên → hàng trên cùng của ảnh là hàng cuối của rect
            const srcY = flipY ? (rect.y + rect.h - 1 - r) : (rect.y + r);
            const src = (srcY * w + rect.x) * 4;
            img.data.set(px.subarray(src, src + rowBytes), r * rowBytes);
        }
        ctx.putImageData(img, 0, 0);
        return canvas.toDataURL('image/png');
    }

    private safeName(name: string): string {
        const s = name.replace(/\.png$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim();
        return s || 'capture';
    }

    private cleanOutputDir(): string {
        return (this.outputDir || 'temp/captures').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    }

    /** Editor: ghi file vào project + refresh asset-db. Runtime (preview): tải xuống qua trình duyệt. */
    private async savePng(dataUrl: string, name: string): Promise<string | null> {
        const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
        const dir = this.cleanOutputDir();

        if (EDITOR && Ed) {
            const req = (globalThis as any).require as ((m: string) => any) | undefined;
            const fs = req?.('fs'); const path = req?.('path');
            if (!fs || !path) { console.error(`${TAG} Không truy cập được fs/path trong scene process.`); return null; }

            const projectPath = await this.getProjectPath();
            if (!projectPath) { console.error(`${TAG} Không xác định được đường dẫn project.`); return null; }

            const absDir = path.join(projectPath, dir);
            const absFile = path.join(absDir, `${name}.png`);
            fs.mkdirSync(absDir, { recursive: true });
            fs.writeFileSync(absFile, Buffer.from(base64, 'base64'));

            if (dir.startsWith('assets/')) {
                try { await Ed.Message.request('asset-db', 'refresh-asset', `db://${dir}/${name}.png`); }
                catch { try { await Ed.Message.request('asset-db', 'refresh-asset', `db://${dir}`); } catch { /* bỏ qua */ } }
            }
            return absFile;
        }

        const doc = (globalThis as any).document as Document | undefined;
        if (!doc) return null;
        const a = doc.createElement('a');
        a.href = dataUrl; a.download = `${name}.png`;
        doc.body.appendChild(a); a.click(); a.remove();
        return `${name}.png (download)`;
    }

    private async getProjectPath(): Promise<string> {
        if (Ed?.Project?.path) return Ed.Project.path;
        try {
            const assetsPath: string = await Ed.Message.request('asset-db', 'query-path', 'db://assets');
            if (assetsPath) return assetsPath.replace(/[\\/]assets[\\/]?$/, '');
        } catch { /* rơi xuống */ }
        return '';
    }

    /** Node đang chọn trong Hierarchy của Editor (theo thứ tự chọn). */
    private async getEditorSelectedNodes(): Promise<Node[]> {
        if (!EDITOR || !Ed?.Selection?.getSelected) return [];
        let uuids: string[] = [];
        try { uuids = Ed.Selection.getSelected('node') ?? []; } catch { return []; }
        if (uuids.length === 0) return [];
        const scene = director.getScene();
        if (!scene) return [];
        const byUuid = new Map<string, Node>();
        const walk = (n: Node) => { byUuid.set(n.uuid, n); for (const c of n.children) walk(c); };
        walk(scene);
        return uuids.map((u) => byUuid.get(u)).filter((n): n is Node => !!n && n !== this.node);
    }
}
