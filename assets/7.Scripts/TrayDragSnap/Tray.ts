import { _decorator, Camera, Component, instantiate, Mesh, Node, Prefab, screen } from 'cc';
import { GameManager } from './GameManager';
import { TargetItem } from './TargetItem';
import { TrayItem } from './TrayItem';
import { CULL_PAD, EDGE_PAD, ICON_FILL, SPACING, TRAY_Y_OFFSET } from './TrayConfig';
const { ccclass, property } = _decorator;

/** Ô trong thanh rộng 0.8 world → icon chiếm ICON_FILL của ô */
const CELL = 0.8;

/**
 * Thanh item. Node Tray là CON của camera nên toạ độ local = toạ độ màn hình
 * theo đơn vị world (ortho): x=0 giữa màn, ±halfW là 2 mép.
 */
@ccclass('Tray')
export class Tray extends Component {
    @property(Prefab) itemPrefab: Prefab | null = null;
    @property(Node) content: Node | null = null;
    @property({ tooltip: 'Khoảng cách trước camera (local -z). Phải nằm TRƯỚC map để không bị che' })
    depth = 10;

    items: TrayItem[] = [];
    visibleCount = 0;
    firstX = 0;
    limitL = 0;
    limitR = 0;
    halfW = 0;

    private _cam: Camera | null = null;
    private _fitCache = new Map<Mesh, number>();

    onLoad() {
        this._cam = this.node.parent?.getComponent(Camera) ?? null;
        if (!this._cam) console.error('[Tray] Tray phải là con của node Camera');
    }

    start() {
        this.build(GameManager.inst!.targets);
    }

    build(targets: TargetItem[]) {
        this.layoutBounds();
        this.content!.setPosition(0, 0, 0);

        // tạo item 1 lần (playable không pool)
        while (this.items.length < targets.length) {
            const n = instantiate(this.itemPrefab!);
            n.setParent(this.content!);
            this.items.push(n.getComponent(TrayItem)!);
        }

        this.items.forEach((it, i) => {
            it.node.setPosition(this.firstX + SPACING * i, 0, 0);
            if (i < targets.length) it.bind(targets[i], this.fitScale(targets[i].renderer!.mesh!));
            it.setActive(i < targets.length);
        });

        this.updateVisibility();
        this.visibleCount = this.items.filter(x => x.isOnScreen).length;
        console.log(`[Tray] ${targets.length} items, halfW=${this.halfW.toFixed(2)}, visible=${this.visibleCount}`);
    }

    /** Tính mép màn hình theo đơn vị world trong không gian local của camera */
    layoutBounds() {
        const cam = this._cam!;
        const w = screen.windowSize;
        const halfH = cam.orthoHeight;
        this.halfW = halfH * w.width / w.height;
        this.firstX = -this.halfW + EDGE_PAD;
        this.limitL = -this.halfW - CULL_PAD;
        this.limitR = this.halfW + CULL_PAD;
        this.node.setPosition(0, -halfH + TRAY_Y_OFFSET, -this.depth);
    }

    /** Scale để mọi icon to bằng nhau (theo cạnh lớn nhất của bounding box) */
    fitScale(mesh: Mesh): number {
        let k = this._fitCache.get(mesh);
        if (k !== undefined) return k;
        const s = mesh.struct;
        const size = Math.max(
            s.maxPosition!.x - s.minPosition!.x,
            s.maxPosition!.y - s.minPosition!.y,
            s.maxPosition!.z - s.minPosition!.z);
        k = size > 0 ? ICON_FILL * CELL / size : 1;
        this._fitCache.set(mesh, k);
        return k;
    }

    /** x của item trong không gian Tray (= màn hình) */
    itemX(it: TrayItem) { return this.content!.position.x + it.node.position.x; }

    updateVisibility() {
        for (const it of this.items) {
            const x = this.itemX(it);
            const on = !!it.target && !it.target.isCompleted && x >= this.limitL && x <= this.limitR;
            it.isOnScreen = on;
            it.setActive(on);
        }
    }

    /** Giới hạn scroll trái: ô cuối cùng dừng sát mép phải */
    scrollMinX() {
        const remain = GameManager.inst!.remain;
        return Math.min(0, -(this.firstX + SPACING * (remain - 1)) + this.halfW - EDGE_PAD);
    }

    update() {
        this.updateVisibility();
    }
}
