/**
 * SceneBuilder — dựng lại scene Unity trong Cocos Creator từ file JSON
 * do Tools/Cocos Export/Scene Exporter (CocosExportWindow.cs) xuất ra.
 *
 * Copy file này vào  assets/scripts/pipeline/SceneBuilder.ts
 * Xem COCOS_MIGRATION_PLAN.md mục 6 để biết schema và công thức.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DÙNG TRONG EDITOR (node nằm thật trong Hierarchy, lưu được cùng scene):
 *   1. Gán component này vào 1 node (vd "Root" dưới Canvas)
 *   2. Kéo file JSON vào ô "sceneJson"
 *   3. Tick "Build Now"  -> node hiện ra ngay trong Hierarchy
 *   4. Ctrl+S để lưu scene
 *   Tick "Clear Built" để xoá sạch và dựng lại.
 *
 * DÙNG LÚC RUNTIME (dựng khi Play):
 *   Bật "buildOnStart". Nếu đã bake node vào scene rồi thì TẮT nó đi,
 *   không thì sẽ dựng chồng lên nhau.
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
    _decorator, Component, Node, UITransform, Sprite, SpriteFrame, Color, Vec3,
    JsonAsset, resources, CCClass, js, Size, sp, assetManager, Asset, CCObject,
} from 'cc';
import { FollowNode } from './FollowNode';
import { EDITOR } from 'cc/env';
import { MaterialType } from '../item/ItemController';


const { ccclass, property, executeInEditMode, menu } = _decorator;

/** Editor API chỉ tồn tại trong edit mode; truy cập kiểu này để khỏi vướng typing. */
const Ed: any = (globalThis as any).Editor;

// ---------------------------------------------------------------- types
interface SpriteJson {
    key: string; guid: string; ppu: number;
    nativeSize: [number, number];
    pivot: [number, number];
    color: [number, number, number, number];
    sortingOrder: number;
    /** Giá trị sorting layer của Unity (SortingLayer.GetLayerValueFromID). Thiếu = 0. */
    layerValue?: number;
    /** AABB world của renderer, đã nhân K: [minX, minY, maxX, maxY]. */
    bounds?: [number, number, number, number];
    flipX: boolean; flipY: boolean;
}
/** Renderer KHÔNG phải SpriteRenderer (Spine/MeshRenderer...) — chỉ cần order để xếp lớp. */
interface RenderJson {
    sortingOrder: number;
    layerValue?: number;
    bounds?: [number, number, number, number];
}
interface SpineJson { skeletonData: string | null; defaultAnim: string | null; skin: string | null; loop: boolean; }
interface ComponentJson { type: string; fields: Record<string, unknown>; }
interface NodeJson {
    path: string; parentPath: string | null; active: boolean;
    pos: [number, number, number];
    rot: [number, number, number];
    scale: [number, number, number];
    sprite?: SpriteJson; spine?: SpineJson; render?: RenderJson;
    components?: ComponentJson[];
}

type AABB = [number, number, number, number];

/** 1 nhánh anh em đang được xếp: node gốc + mọi node có order trong nhánh. */
interface Block {
    node: Node;
    sprites: Node[];
    lo: number;
    hi: number;
    origIndex: number;
}
interface LayoutStats {
    dissolved: string[]; pushed: string[]; hoisted: string[]; residual: string[]; cycles: number;
}
interface SceneJson {
    meta: { K: number; scene: string; exportRoot: string | null; exportInactive: boolean };
    assetMap: Record<string, string>;
    nodes: NodeJson[];
    conflicts: { a: string; rangeA: [number, number]; b: string; rangeB: [number, number] }[];
}

// Không có Units runtime: exporter đã quy đổi mọi khoảng cách sang pixel
// (pos, contentSize, snapDistance...). K chỉ còn dùng lúc dựng, xem buildK.

// ---------------------------------------------------------------- builder
@ccclass('SceneBuilder')
@executeInEditMode(true)
@menu('Pipeline/SceneBuilder')
export class SceneBuilder extends Component {

    @property({ type: JsonAsset, tooltip: 'File JSON do CocosExportWindow xuất ra' })
    sceneJson: JsonAsset | null = null;

    @property({
        type: Asset,
        tooltip: 'Kéo thả trực tiếp Folder chứa Sprite từ panel Assets vào đây (hoặc gõ ở ô Sprite Dir)'
    })
    spriteFolder: Asset | null = null;

    @property({ tooltip: 'Thư mục chứa sprite nếu không kéo folder (vd: 3.Sprites/Sprites2 hoặc art/PLY29_Level34/sprites)' })
    spriteDir = '3.Sprites/Sprites2';


    @property({ tooltip: 'Tên node con chứa Sprite. Mỗi node ảnh được dựng thành: node cha (transform, component gameplay) → node con này (UITransform + Sprite).' })
    imageNodeName = 'Image';

    @property({
        tooltip: 'Khoá node ảnh (padlock trong Hierarchy) để click vào hình trong Scene view luôn chọn trúng node CHA '
            + '(chỗ gắn component gameplay) thay vì chọn nhầm node ảnh con.\n'
            + 'Vẫn chọn được node ảnh qua Hierarchy panel như bình thường, chỉ click trong Scene view mới bị chặn.',
    })
    lockImageNode = true;

    @property({ tooltip: 'Sắp xếp siblingIndex theo sortingOrder của Unity' })
    applySorting = true;

    @property({
        tooltip: 'Chỉ ép đúng thứ tự giữa các sprite THỰC SỰ chồng hình (AABB giao nhau). '
            + 'Tắt = ép đúng thứ tự cho mọi cặp (sẽ phải tách/hoà tan nhiều node hơn).',
    })
    overlapOnly = true;

    @property({
        tooltip: 'Cho phép hoà tan folder (node không sprite/không component) hoặc đẩy node vào folder khác '
            + 'khi 2 nhánh anh em có sprite xen kẽ nhau (vd sàn nhà trong Base nằm giữa các Placeholder).',
    })
    restructureFolders = true;

    @property({
        tooltip: 'Cho phép TÁCH sprite con ra khỏi node có sprite/component khi bắt buộc để đúng thứ tự. '
            + 'Node tách ra được gắn FollowNode để vẫn đi theo cha cũ (transform + active).',
    })
    splitEntities = true;

    @property({ tooltip: 'In cảnh báo chi tiết ra console' })
    verbose = true;

    @property({ tooltip: 'Tự dựng khi Play. TẮT nếu đã bake node vào scene, không thì dựng chồng.' })
    buildOnStart = false;

    // ---- nút bấm trong Inspector (checkbox tự nhả ra) ----

    @property({ tooltip: 'Tick để dựng node ngay trong Editor. Xong nhớ Ctrl+S lưu scene.' })
    get buildNow(): boolean { return false; }
    set buildNow(v: boolean) { if (v) void this.build(); }

    @property({ tooltip: 'Tick để xoá sạch node đã dựng dưới node này.' })
    get clearBuilt(): boolean { return false; }
    set clearBuilt(v: boolean) { if (v) this.clear(); }

    /** path → Node, dùng cho pass 2 và cho code gameplay tra cứu */
    readonly nodeMap = new Map<string, Node>();
    /** K của lần build hiện tại — chỉ dùng để tính contentSize từ nativeSize/ppu. */
    private buildK = 100;
    private frames = new Map<string, SpriteFrame>();
    /** Node chủ (owner) → khoá xếp lớp (layerValue*1e6 + sortingOrder). */
    private orderOf = new Map<Node, number>();
    /** Node chủ → AABB world (từ JSON hoặc tự tính). */
    private boundsOf = new Map<Node, AABB>();
    /** Node là "entity": có sprite/spine/component, bị tham chiếu, hoặc inactive → KHÔNG hoà tan. */
    private entities = new Set<Node>();
    private pathOfNode = new Map<Node, string>();
    /** Node ảnh (con `imageNodeName`) → node chủ. Node ảnh được xếp như 1 khối con mang sprite của chủ. */
    private ownerOfImage = new Map<Node, Node>();

    start() {
        if (!EDITOR && this.buildOnStart) void this.build();
    }

    private getCleanSpriteDir(): string {
        let dir = (this.spriteDir || '').trim().replace(/\\/g, '/');
        dir = dir.replace(/^\/+|\/+$/g, '');
        return dir;
    }

    // ------------------------------------------------------------ main
    async build(): Promise<void> {
        if (!this.sceneJson) { console.error('[SceneBuilder] Chưa gán sceneJson'); return; }
        const data = this.sceneJson.json as SceneJson;

        this.clear();
        this.buildK = data.meta?.K ?? 100;

        const neededKeys = new Set(data.nodes.filter((n) => n.sprite).map((n) => n.sprite!.key));
        await this.loadSpriteFrames(neededKeys);

        const referenced = SceneBuilder.collectReferencedPaths(data.nodes);
        for (const n of data.nodes) this.createNode(n, referenced);   // pass 1 — cây + sprite
        if (this.applySorting) this.layoutRenderOrder();              // pass 1.5 — thứ tự render
        for (const n of data.nodes) this.attachComponents(n);    // pass 2 — component + @node:
        for (const n of data.nodes) {                            // pass 3 — active
            const node = this.nodeMap.get(n.path);
            if (node) node.active = n.active;
        }

        console.log(`[SceneBuilder] Dựng xong "${data.meta.scene}"`
            + `${data.meta.exportRoot ? ` (nhánh ${data.meta.exportRoot})` : ''}`
            + `: ${this.nodeMap.size} node, K=${this.buildK}`);

        if (data.conflicts?.length) {
            console.warn(`[SceneBuilder] ${data.conflicts.length} cặp xung đột sortingOrder — kiểm tra bằng mắt:`);
            for (const c of data.conflicts.slice(0, 20)) {
                console.warn(`   [${c.rangeA}] ${c.a}\n      x [${c.rangeB}] ${c.b}`);
            }
        }

        if (EDITOR) {
            console.log('[SceneBuilder] Đang ở Editor — nhấn Ctrl+S để lưu node vào scene.');
            try { Ed?.Message?.send('scene', 'snapshot'); } catch { /* để Ctrl+Z được */ }
        }
    }

    /** Xoá sạch node con đã dựng. */
    clear(): void {
        for (const c of [...this.node.children]) c.destroy();
        this.node.removeAllChildren();
        this.nodeMap.clear();
        this.orderOf.clear();
        this.boundsOf.clear();
        this.entities.clear();
        this.pathOfNode.clear();
        this.ownerOfImage.clear();
    }

    /** Mọi path xuất hiện dưới dạng "@node:<path>" trong field component. */
    private static collectReferencedPaths(nodes: NodeJson[]): Set<string> {
        const out = new Set<string>();
        const scan = (v: unknown): void => {
            if (typeof v === 'string') { if (v.startsWith('@node:')) out.add(v.substring(6)); }
            else if (Array.isArray(v)) v.forEach(scan);
            else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(scan);
        };
        for (const n of nodes) for (const c of n.components ?? []) scan(c.fields);
        return out;
    }

    private static orderKey(sortingOrder: number, layerValue?: number): number {
        return (layerValue ?? 0) * 1_000_000 + sortingOrder;
    }

    // ------------------------------------------------------------ nạp SpriteFrame
    private loadSpriteFrames(neededKeys: Set<string>): Promise<void> {
        return EDITOR ? this.loadFramesFromAssetDb(neededKeys) : this.loadFramesFromResources();
    }

    /** Tra SpriteFrame theo key, không phân biệt hoa/thường ("72_cf_Sd" vẫn khớp "72_cf_sd.png"). */
    private getFrame(key: string): SpriteFrame | undefined {
        return this.frames.get(key.toLowerCase());
    }

    /** Runtime: resources bundle. */
    private loadFramesFromResources(): Promise<void> {
        return new Promise((resolve) => {
            let dir = this.getCleanSpriteDir();
            if (dir.startsWith('assets/resources/')) dir = dir.substring('assets/resources/'.length);
            else if (dir.startsWith('resources/')) dir = dir.substring('resources/'.length);
            resources.loadDir(dir, SpriteFrame, (err, assets) => {
                if (err) { console.error('[SceneBuilder] Lỗi load sprite:', err); resolve(); return; }
                this.frames.clear();
                for (const sf of assets) this.frames.set(sf.name.toLowerCase(), sf);
                console.log(`[SceneBuilder] Đã load ${assets.length} SpriteFrame từ resources/${dir}`);
                resolve();
            });
        });
    }

    /**
     * Edit mode: hỏi asset-db của Editor.
     * `resources.loadDir` không đáng tin ở edit mode, nên phải đi đường này.
     *
     * ⚠ asset-db so pattern PHÂN BIỆT hoa/thường ("3.Sprites/Sprites" ≠ "3.Sprites/sprites")
     *   dù Windows thì không → lấy toàn bộ SpriteFrame trong project một lần rồi tự lọc
     *   theo đường dẫn đã lowercase. Key nào vẫn thiếu thì tìm theo tên file trong toàn project.
     */
    private async loadFramesFromAssetDb(neededKeys: Set<string>): Promise<void> {
        this.frames.clear();
        if (!Ed?.Message?.request) {
            console.error('[SceneBuilder] Không truy cập được Editor API.');
            return;
        }

        // 1. Thư mục ưu tiên: folder kéo thả > spriteDir
        let dirUrl = '';
        if (this.spriteFolder) {
            const uuid = (this.spriteFolder as any)._uuid || (this.spriteFolder as any).uuid;
            if (uuid) {
                try {
                    const info = await Ed.Message.request('asset-db', 'query-asset-info', uuid);
                    if (info && (info.url || info.path)) dirUrl = info.url || info.path;
                    else console.warn('[SceneBuilder] spriteFolder không còn tồn tại trong asset-db (uuid đổi?) — dùng spriteDir.');
                } catch (e) {
                    console.warn('[SceneBuilder] Lỗi query-asset-info từ spriteFolder:', e);
                }
            }
        }
        if (!dirUrl) {
            const dir = this.getCleanSpriteDir();
            if (dir.startsWith('db://')) dirUrl = dir;
            else if (dir.startsWith('assets/')) dirUrl = `db://${dir}`;
            else dirUrl = `db://assets/${dir}`;
        }
        dirUrl = dirUrl.replace(/\\/g, '/').replace(/\/+$/, '');

        // 2. Toàn bộ SpriteFrame trong project (một query duy nhất)
        let all: any[] = [];
        try {
            all = await Ed.Message.request('asset-db', 'query-assets',
                { pattern: 'db://assets/**/*', ccType: 'cc.SpriteFrame' }) ?? [];
        } catch (e) {
            console.error('[SceneBuilder] query-assets lỗi:', e);
            return;
        }
        const urlOf = (i: any): string => String(i.url ?? i.path ?? '').replace(/\\/g, '/');
        const keyOf = (i: any): string => SceneBuilder.keyFromAssetPath(urlOf(i)).toLowerCase();

        const inDirOf = (prefix: string) => {
            const p = prefix.toLowerCase() + '/';
            return all.filter((i) => urlOf(i).toLowerCase().startsWith(p));
        };
        let inDir = inDirOf(dirUrl);
        if (inDir.length === 0 && dirUrl.startsWith('db://assets/') && !dirUrl.startsWith('db://assets/resources/')) {
            const resUrl = dirUrl.replace('db://assets/', 'db://assets/resources/');
            const inRes = inDirOf(resUrl);
            if (inRes.length > 0) { inDir = inRes; dirUrl = resUrl; }
        }
        if (inDir.length === 0) {
            console.warn(`[SceneBuilder] Không thấy SpriteFrame nào trong "${dirUrl}" — sẽ tìm theo tên file trong toàn project.`);
        }

        // 3. Chọn asset cần load: trong thư mục trước, thiếu key nào thì tìm toàn project
        const needed = new Set([...neededKeys].map((k) => k.toLowerCase()));
        const picked = new Map<string, any>();            // keyLower → asset info
        for (const info of inDir) {
            const k = keyOf(info);
            if (k && needed.has(k) && !picked.has(k)) picked.set(k, info);
        }
        const fallbackHits: string[] = [];
        const notFound: string[] = [];
        for (const key of neededKeys) {
            const k = key.toLowerCase();
            if (picked.has(k)) continue;
            const hit = all.find((i) => keyOf(i) === k);
            if (hit) { picked.set(k, hit); fallbackHits.push(`${key} ← ${urlOf(hit)}`); }
            else notFound.push(key);
        }
        if (fallbackHits.length && this.verbose) {
            console.warn(`[SceneBuilder] ${fallbackHits.length} sprite không nằm trong "${dirUrl}", lấy từ nơi khác:\n   ${fallbackHits.join('\n   ')}`);
        }
        if (notFound.length) {
            console.warn(`[SceneBuilder] ${notFound.length} sprite không có trong project: ${notFound.join(', ')}`);
        }

        // 4. Load
        await Promise.all([...picked].map(([k, info]) => new Promise<void>((resolve) => {
            assetManager.loadAny({ uuid: info.uuid }, (err: Error | null, asset: SpriteFrame) => {
                if (err || !asset) {
                    if (this.verbose) console.warn(`[SceneBuilder] Load lỗi ${urlOf(info)}:`, err);
                } else {
                    this.frames.set(k, asset);
                }
                resolve();
            });
        })));

        console.log(`[SceneBuilder] Đã load ${this.frames.size}/${needed.size} SpriteFrame cần dùng`
            + ` (thư mục ${dirUrl}: ${inDir.length} file${fallbackHits.length ? `, +${fallbackHits.length} tìm toàn project` : ''})`);
    }

    /** 'db://assets/3.Sprites/Sprites2/pillow_1.png/spriteFrame' hoặc 'f:\\...\\pillow_1.png' → 'pillow_1' */
    private static keyFromAssetPath(p: string): string {
        if (!p) return '';
        let s = p.replace(/\\/g, '/');
        if (s.endsWith('/spriteFrame')) s = s.slice(0, -'/spriteFrame'.length);
        const atIdx = s.indexOf('@');
        if (atIdx >= 0) s = s.substring(0, atIdx);
        const slash = s.lastIndexOf('/');
        if (slash >= 0) s = s.substring(slash + 1);
        const dot = s.lastIndexOf('.');
        return dot > 0 ? s.substring(0, dot) : s;
    }


    // ------------------------------------------------------------ pass 1
    /**
     * Mỗi node JSON → 1 node Cocos cùng tên (transform, active, component gameplay, con của nó).
     * Nếu node có sprite thì ảnh KHÔNG nằm trên node này mà nằm trên node con `imageNodeName`:
     *
     *     82_cuonlen            ← nodeMap[path], pos/rot/scale, component, @node: trỏ vào đây
     *       ├─ Image            ← UITransform + Sprite (+ flip, color, sortingOrder)
     *       └─ <con khác từ JSON>
     */
    private createNode(n: NodeJson, referenced: Set<string>): void {
        const name = n.path.substring(n.path.lastIndexOf('/') + 1);
        const node = new Node(name);
        this.pathOfNode.set(node, n.path);
        if (n.sprite || n.spine || n.render || n.components?.length || !n.active || referenced.has(n.path)) {
            this.entities.add(node);
        }

        // ⚠ BẮT BUỘC: new Node() cho ra layer DEFAULT, mà pipeline UI của Cocos
        //   chỉ vẽ node UI_2D -> sprite dựng bằng code sẽ KHÔNG hiện, dù Scene view
        //   vẫn thấy đủ và camera vẫn ghi nhận draw call.
        //   Kế thừa layer của node gắn SceneBuilder (nằm dưới Canvas -> UI_2D).
        node.layer = this.node.layer;

        const parent = n.parentPath ? this.nodeMap.get(n.parentPath) : this.node;
        node.setParent(parent ?? this.node);

        node.setPosition(n.pos[0], n.pos[1], n.pos[2]);
        node.setRotationFromEuler(n.rot[0], n.rot[1], n.rot[2]);
        node.setScale(n.scale[0], n.scale[1], n.scale[2]);

        if (n.sprite) this.setupSprite(node, n.sprite);
        if (n.spine) this.setupSpine(node, n.spine);
        if (n.render && !n.sprite) {
            this.orderOf.set(node, SceneBuilder.orderKey(n.render.sortingOrder, n.render.layerValue));
            if (n.render.bounds) this.boundsOf.set(node, n.render.bounds);
        }

        this.nodeMap.set(n.path, node);
    }

    /** Tạo node con `imageNodeName` mang Sprite dưới `owner`; `owner` chỉ giữ UITransform cùng cỡ để gameplay đo bounds / bắt touch. */
    private setupSprite(owner: Node, s: SpriteJson): void {
        // ⚠ Hệ số PPU nằm ở contentSize, KHÔNG nằm ở node.scale —
        //   để node con không bị nhân theo hệ số của node cha.
        const f = this.buildK / s.ppu;
        const size = new Size(s.nativeSize[0] * f, s.nativeSize[1] * f);

        const ownerUt = owner.getComponent(UITransform) ?? owner.addComponent(UITransform);
        ownerUt.setContentSize(size);
        ownerUt.setAnchorPoint(s.pivot[0], s.pivot[1]);

        const img = new Node(this.imageNodeName || 'Image');
        img.layer = owner.layer;
        img.setParent(owner);
        img.setPosition(0, 0, 0);

        // Click trong Scene view sẽ "xuyên qua" node bị khoá và chọn trúng owner (node cha) —
        // đúng cái người dựng scene bằng tay hay bấm nhầm khi node ảnh nằm đè lên node cha.
        if (this.lockImageNode) img.hideFlags |= CCObject.Flags.LockedInEditor;

        const ut = img.addComponent(UITransform);
        ut.setContentSize(size);
        ut.setAnchorPoint(s.pivot[0], s.pivot[1]);

        const sprite = img.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false;

        const sf = this.getFrame(s.key);
        if (sf) sprite.spriteFrame = sf;
        else if (this.verbose) console.warn(`[SceneBuilder] Thiếu SpriteFrame "${s.key}" cho ${owner.name}`);

        sprite.color = new Color(s.color[0] * 255, s.color[1] * 255, s.color[2] * 255, s.color[3] * 255);

        // Flip đặt ở node ảnh để không lật luôn các node con gameplay của owner.
        if (s.flipX || s.flipY) img.setScale(s.flipX ? -1 : 1, s.flipY ? -1 : 1, 1);

        // Khoá xếp lớp đặt trên node CHỦ (owner) — layoutRenderOrder() sắp owner, không sắp node ảnh.
        this.orderOf.set(owner, SceneBuilder.orderKey(s.sortingOrder, s.layerValue));
        if (s.bounds) this.boundsOf.set(owner, s.bounds);
        this.ownerOfImage.set(img, owner);
        this.entities.add(img);   // không bao giờ hoà tan / tách node ảnh
    }

    private setupSpine(node: Node, s: SpineJson): void {
        // Spine không mang qua được bằng JSON — chỉ tạo component rỗng,
        // skeletonData phải gán tay trong editor (plan mục 6.6).
        const skel = node.addComponent(sp.Skeleton);
        skel.loop = s.loop;
        if (s.defaultAnim) skel.animation = s.defaultAnim;
        if (this.verbose) console.warn(`[SceneBuilder] ${node.name}: cần gán tay skeletonData "${s.skeletonData}"`);
    }

    // ------------------------------------------------------------ pass 1.5
    /**
     * Xếp thứ tự render cho khớp Unity.
     *
     * Unity: mọi sprite xếp bằng MỘT dãy sortingOrder toàn cục, không quan tâm cây.
     * Cocos: vẽ theo thứ tự duyệt cây (cha trước con, anh trước em).
     * → Hai nhánh anh em có dải order xen kẽ nhau (vd sàn nhà -10050 trong Base nằm giữa
     *   các Placeholder -10200..-10000) thì KHÔNG sắp siblingIndex kiểu gì cho đúng được.
     *
     * Cách làm, cho từng node cha (đệ quy):
     *   1. Mỗi con = 1 khối. Hai khối "xung đột" khi có cặp sprite chồng hình (overlapOnly)
     *      theo cả 2 chiều order (A có sprite trên B và cũng có sprite dưới B).
     *   2. Gỡ xung đột:
     *      - 2 folder: hoà tan folder ít sprite hơn (con lên làm anh em).
     *      - entity vs folder: đẩy entity VÀO folder, đệ quy sẽ xếp đúng chỗ trong đó.
     *      - 2 entity: tách các con gây xung đột ra khỏi entity, gắn FollowNode.
     *      - không làm được: ghi vào residual, bỏ ràng buộc cặp đó.
     *   3. Sắp topo theo các ràng buộc còn lại; hoà ties bằng min order rồi thứ tự gốc.
     */
    private layoutRenderOrder(): void {
        this.ensureBounds();
        const stats: LayoutStats = { dissolved: [], pushed: [], hoisted: [], residual: [], cycles: 0 };
        this.layoutChildren(this.node, stats);

        const lines: string[] = [];
        if (stats.dissolved.length) lines.push(`hoà tan ${stats.dissolved.length} folder: ${stats.dissolved.join(', ')}`);
        if (stats.pushed.length) lines.push(`đẩy ${stats.pushed.length} node vào folder khác:\n      ${stats.pushed.join('\n      ')}`);
        if (stats.hoisted.length) lines.push(`tách ${stats.hoisted.length} node ra khỏi cha (đã gắn FollowNode):\n      ${stats.hoisted.join('\n      ')}`);
        if (stats.cycles) lines.push(`${stats.cycles} lần gặp vòng ràng buộc, đã xếp theo min order`);
        console.log(`[SceneBuilder] Xếp lớp xong${lines.length ? ':\n   ' + lines.join('\n   ') : ' — không phải đổi cấu trúc.'}`);
        if (stats.residual.length) {
            console.warn(`[SceneBuilder] ${stats.residual.length} xung đột KHÔNG tự gỡ được (sửa sortingOrder bên Unity hoặc kéo tay):\n   ${stats.residual.join('\n   ')}`);
        }
    }

    /** Bảo đảm mọi node có order đều có AABB: thiếu trong JSON thì tự tính từ UITransform. */
    private ensureBounds(): void {
        for (const owner of this.orderOf.keys()) {
            if (this.boundsOf.has(owner)) continue;
            const ut = owner.getComponent(UITransform);
            if (!ut) continue;
            const r = ut.getBoundingBoxToWorld();
            this.boundsOf.set(owner, [r.xMin, r.yMin, r.xMax, r.yMax]);
        }
        // Chưa có node ảnh (JSON cũ, spine...) thì thôi; bounds thiếu = coi như không chồng hình.
        for (const [img] of this.ownerOfImage) {
            if (!img.isValid) this.ownerOfImage.delete(img);
        }
    }

    private isFolder(n: Node): boolean {
        return !this.entities.has(n) && !this.orderOf.has(n);
    }

    private collectOrdered(n: Node, out: Node[]): void {
        if (this.orderOf.has(n)) out.push(n);
        for (const c of n.children) this.collectOrdered(c, out);
    }

    private makeBlock(n: Node, origIndex: number): Block {
        const sprites: Node[] = [];
        // Cocos vẽ cha TRƯỚC con → sprite của cha phải được xếp chung hàng với các con
        // (vd shadow con -10000 phải vẽ trước ảnh cha -9950). Node ảnh đại diện cho sprite của chủ.
        const owner = this.ownerOfImage.get(n);
        if (owner) sprites.push(owner); else this.collectOrdered(n, sprites);
        let lo = Number.POSITIVE_INFINITY, hi = Number.NEGATIVE_INFINITY;
        for (const s of sprites) { const o = this.orderOf.get(s)!; lo = Math.min(lo, o); hi = Math.max(hi, o); }
        return { node: n, sprites, lo, hi, origIndex };
    }

    private overlaps(a: Node, b: Node): boolean {
        if (!this.overlapOnly) return true;
        const A = this.boundsOf.get(a), B = this.boundsOf.get(b);
        if (!A || !B) return false;
        return A[0] < B[2] && B[0] < A[2] && A[1] < B[3] && B[1] < A[3];
    }

    /** fwd: A có sprite phải nằm DƯỚI B; bwd: A có sprite phải nằm TRÊN B. */
    private relation(A: Node[], B: Node[]): { fwd: boolean; bwd: boolean } {
        let fwd = false, bwd = false;
        for (const a of A) {
            const oa = this.orderOf.get(a)!;
            for (const b of B) {
                const ob = this.orderOf.get(b)!;
                if (oa === ob || !this.overlaps(a, b)) continue;
                if (oa < ob) fwd = true; else bwd = true;
                if (fwd && bwd) return { fwd, bwd };
            }
        }
        return { fwd, bwd };
    }

    private layoutChildren(P: Node, stats: LayoutStats): void {
        if (P.children.length === 0) return;
        const path = (n: Node): string => this.pathOfNode.get(n) ?? n.name;

        let blocks: Block[] = P.children.map((c, i) => this.makeBlock(c, i));
        const ignored = new Set<string>();
        const pairKey = (a: Block, b: Block): string => a.node.uuid < b.node.uuid
            ? a.node.uuid + '|' + b.node.uuid : b.node.uuid + '|' + a.node.uuid;
        const dissolvedFolders: Node[] = [];

        for (let iter = 0; iter < 500; iter++) {
            // 1. tìm cặp xung đột đầu tiên
            let A: Block | null = null, B: Block | null = null;
            outer: for (let i = 0; i < blocks.length; i++) {
                if (!blocks[i].sprites.length) continue;
                for (let j = i + 1; j < blocks.length; j++) {
                    if (!blocks[j].sprites.length) continue;
                    if (blocks[j].lo > blocks[i].hi || blocks[i].lo > blocks[j].hi) continue;   // dải không giao → không thể xung đột
                    if (ignored.has(pairKey(blocks[i], blocks[j]))) continue;
                    const r = this.relation(blocks[i].sprites, blocks[j].sprites);
                    if (r.fwd && r.bwd) { A = blocks[i]; B = blocks[j]; break outer; }
                }
            }
            if (!A || !B) break;

            const fA = this.isFolder(A.node), fB = this.isFolder(B.node);

            if (this.restructureFolders && fA && fB) {
                // 2a. hoà tan folder ít sprite hơn
                const F = A.sprites.length <= B.sprites.length ? A : B;
                const kids = [...F.node.children];
                for (const k of kids) k.setParent(P, true);
                blocks = blocks.filter((b) => b !== F);
                for (const k of kids) blocks.push(this.makeBlock(k, blocks.length));
                dissolvedFolders.push(F.node);
                stats.dissolved.push(path(F.node));
                continue;
            }
            if (this.restructureFolders && (fA || fB)) {
                // 2b. đẩy entity vào folder
                const F = fA ? A : B, X = fA ? B : A;
                X.node.setParent(F.node, true);
                blocks = blocks.filter((b) => b !== X);
                const idx = blocks.indexOf(F);
                blocks[idx] = this.makeBlock(F.node, F.origIndex);
                stats.pushed.push(`${path(X.node)}  →  ${path(F.node)}`);
                continue;
            }
            if (this.splitEntities) {
                // 2c. tách con gây xung đột ra khỏi entity
                const tryHoist = (E: Block, O: Block): Node[] => {
                    const rootSprites = this.orderOf.has(E.node) ? [E.node] : [];
                    const rootRel = this.relation(rootSprites, O.sprites);
                    const chosen: Node[] = [];
                    const fallback: Node[] = [];
                    for (const c of E.node.children) {
                        const cs: Node[] = []; this.collectOrdered(c, cs);
                        if (!cs.length) continue;
                        const r = this.relation(cs, O.sprites);
                        if (!r.fwd && !r.bwd) continue;
                        fallback.push(c);
                        if ((r.fwd && r.bwd) || (r.fwd && rootRel.bwd) || (r.bwd && rootRel.fwd)) chosen.push(c);
                    }
                    return chosen.length ? chosen : fallback;
                };
                const first = A.node.children.length >= B.node.children.length ? A : B;
                const second = first === A ? B : A;
                let E = first, hoist = tryHoist(first, second);
                if (!hoist.length) { E = second; hoist = tryHoist(second, first); }
                if (hoist.length) {
                    for (const c of hoist) {
                        const f = c.getComponent(FollowNode) ?? c.addComponent(FollowNode);
                        f.target = E.node;
                        f.originalParentPath = path(E.node);
                        c.setParent(P, true);
                        f.captureOffset();
                        blocks.push(this.makeBlock(c, blocks.length));
                        stats.hoisted.push(`${path(c)}  (theo ${E.node.name})`);
                    }
                    const idx = blocks.indexOf(E);
                    blocks[idx] = this.makeBlock(E.node, E.origIndex);
                    continue;
                }
            }
            // 2d. bó tay → bỏ ràng buộc cặp này, báo cáo
            ignored.add(pairKey(A, B));
            stats.residual.push(`${path(A.node)} [${A.lo}..${A.hi}]  x  ${path(B.node)} [${B.lo}..${B.hi}]`);
        }

        // 3. sắp topo
        const n = blocks.length;
        const after: number[][] = Array.from({ length: n }, () => []);
        const indeg = new Array<number>(n).fill(0);
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = blocks[i], b = blocks[j];
                if (!a.sprites.length || !b.sprites.length) continue;
                if (b.lo > a.hi || a.lo > b.hi) {
                    // dải không giao: thứ tự hiển nhiên theo order
                    if (a.hi < b.lo) { after[i].push(j); indeg[j]++; } else { after[j].push(i); indeg[i]++; }
                    continue;
                }
                if (ignored.has(pairKey(a, b))) continue;
                const r = this.relation(a.sprites, b.sprites);
                if (r.fwd && !r.bwd) { after[i].push(j); indeg[j]++; }
                else if (r.bwd && !r.fwd) { after[j].push(i); indeg[i]++; }
            }
        }
        const done = new Array<boolean>(n).fill(false);
        const order: number[] = [];
        const tie = (i: number, j: number): number => (blocks[i].lo - blocks[j].lo) || (blocks[i].origIndex - blocks[j].origIndex);
        while (order.length < n) {
            let pick = -1;
            for (let i = 0; i < n; i++) {
                if (done[i] || indeg[i] > 0) continue;
                if (pick < 0 || tie(i, pick) < 0) pick = i;
            }
            if (pick < 0) {   // vòng ràng buộc → lấy node min order còn lại
                stats.cycles++;
                for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || tie(i, pick) < 0)) pick = i;
            }
            done[pick] = true; order.push(pick);
            for (const j of after[pick]) indeg[j]--;
        }
        order.forEach((bi, si) => blocks[bi].node.setSiblingIndex(si));

        for (const f of dissolvedFolders) if (f.children.length === 0) f.destroy();

        // 4. đệ quy
        for (const c of [...P.children]) this.layoutChildren(c, stats);
    }

    // ------------------------------------------------------------ pass 2
    private attachComponents(n: NodeJson): void {
        if (!n.components?.length) return;
        const node = this.nodeMap.get(n.path);
        if (!node) return;

        for (const cj of n.components) {
            const cls = js.getClassByName(cj.type) as unknown as (typeof Component) | undefined;
            if (!cls) {
                if (this.verbose) console.warn(`[SceneBuilder] Chưa có class "${cj.type}" — bỏ qua (${n.path})`);
                continue;
            }

            const comp = node.addComponent(cls as never) as unknown as Record<string, unknown>;
            const attrs = CCClass.Attr.getClassAttrs(cls) as Record<string, unknown>;

            for (const [key, raw] of Object.entries(cj.fields)) {
                try {
                    const declared = attrs[`${key}$_$type`] as (new () => unknown) | undefined;
                    comp[key] = this.convert(raw, declared, comp[key]);
                } catch (e) {
                    if (this.verbose) console.warn(`[SceneBuilder] ${cj.type}.${key} gán lỗi:`, e);
                }
            }
        }
    }

    /** Đổi giá trị JSON sang kiểu Cocos, dựa vào kiểu khai báo @property hoặc giá trị mặc định. */
    private convert(raw: unknown, declared?: new () => unknown, current?: unknown): unknown {
        // ⚠ null trong scene Unity thường nghĩa là "gán lúc runtime trong Awake/Start"
        //   (itemGraphic, itemMovement, col, currentHolderSlot...). Ghi đè bằng null
        //   sẽ xoá mất giá trị component vừa tự tính -> giữ nguyên giá trị hiện có.
        if (raw === null || raw === undefined) return current ?? null;

        if (typeof raw === 'string' && raw.startsWith('@node:')) {
            const target = this.nodeMap.get(raw.substring(6));
            if (!target) {
                if (this.verbose) console.warn(`[SceneBuilder] Không tìm thấy node "${raw.substring(6)}"`);
                return null;
            }
            if (declared && declared !== (Node as unknown as new () => unknown)
                && (declared as unknown as typeof Component).prototype instanceof Component) {
                return target.getComponent(declared as unknown as typeof Component);
            }
            return target;
        }

        // asset / prefab — phải gán tay
        if (typeof raw === 'string' && (raw.startsWith('@asset:') || raw.startsWith('@prefab:'))) {
            return current ?? null;
        }

        if (Array.isArray(raw)) {
            const allNum = raw.every((x) => typeof x === 'number');
            if (allNum && declared === (Vec3 as unknown as new () => unknown)) {
                return new Vec3(raw[0] as number, raw[1] as number, raw[2] as number);
            }
            if (allNum && declared === (Color as unknown as new () => unknown)) {
                const [r, g, b, a] = raw as number[];
                return new Color(r * 255, g * 255, b * 255, (a ?? 1) * 255);
            }
            if (allNum && current instanceof Vec3 && raw.length >= 3) {
                return new Vec3(raw[0] as number, raw[1] as number, raw[2] as number);
            }
            if (allNum && current instanceof Color) {
                const [r, g, b, a] = raw as number[];
                return new Color(r * 255, g * 255, b * 255, (a ?? 1) * 255);
            }
            return raw.map((x) => this.convert(x, declared));
        }

        if (typeof raw === 'string') {
            if (typeof current === 'number') {
                const enumVal = (MaterialType as any)[raw];
                if (typeof enumVal === 'number') return enumVal;
            }
            return raw;
        }

        return raw;
    }

}
