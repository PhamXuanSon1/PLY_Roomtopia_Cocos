import { _decorator, CCInteger, director, instantiate, Node, Prefab, Quat, Vec3 } from 'cc';
import { EDITOR } from 'cc/env';
import { Ply_Singleton } from './Ply_Singleton';
import { Ply_GameUnit } from './Ply_GameUnit';
import { PoolType } from './Ply_Types';
export { PoolType };
const { ccclass, property } = _decorator;

/** 1 dòng khai báo: loại → prefab + số lượng tạo sẵn lúc vào game */
@ccclass('Ply_PoolAmount')
class PoolAmount {
    @property({ type: PoolType, tooltip: 'Loại đối tượng (khai báo trong Ply_Types.PoolType)' })
    type: PoolType = PoolType.BlinkFx;

    @property({ type: CCInteger, min: 0, tooltip: 'Tạo sẵn bấy nhiêu cái lúc vào game (hết thì tự tạo thêm). Đồ xuất hiện nhiều cùng lúc (effect) nên tạo sẵn để khỏi giật' })
    amount: number = 0;

    @property({ type: Prefab, tooltip: 'Prefab của loại này' })
    prefab: Prefab | null = null;
}

/**
 * Ply_Pool — NƠI DUY NHẤT tạo đối tượng từ prefab (chuyển từ Ply_Pool của Unity).
 *
 *  - Lúc chạy : Ply_Pool.Ins.spawn(type, pos, rot, parent) lấy từ pool (thiếu thì tạo thêm), unit.despawn() trả về.
 *  - Trong editor (sinh item xem trước, lưu vào scene): Ply_Pool.create(type) → instantiate prefab khai báo ở đây.
 *  - Prefab không gắn script kế thừa Ply_GameUnit thì tự thêm Ply_GameUnit khi spawn.
 *  Node gắn Ply_Pool nên có scale 1 (effect spawn ra là con của node này).
 */
@ccclass('Ply_Pool')
export class Ply_Pool extends Ply_Singleton {

    public static Ins: Ply_Pool | null = null;

    @property({ type: [PoolAmount], tooltip: 'Danh sách prefab được phép tạo trong game: loại + prefab + số lượng tạo sẵn' })
    poolAmounts: PoolAmount[] = [];

    private dict: Map<PoolType, Ply_GameUnit[]> = new Map();

    onLoad() {
        super.onLoad();
        Ply_Pool.Ins = this;
        this.onInit();
    }

    /** Tạo sẵn `amount` cái cho mỗi loại (ẩn, nằm dưới node pool) */
    private onInit() {
        for (const pa of this.poolAmounts) {
            if (!this.dict.has(pa.type)) this.dict.set(pa.type, []);
            for (let j = 0; j < pa.amount; j++) {
                const unit = this.make(pa.type);
                if (!unit) break;
                unit.node.active = false;
                this.dict.get(pa.type)!.push(unit);
            }
        }
    }

    /** Instantiate 1 cái mới dưới node pool, gắn Ply_GameUnit nếu thiếu */
    private make(type: PoolType): Ply_GameUnit | null {
        const prefab = this.getPrefab(type);
        if (!prefab) { console.error(`[Ply_Pool] chưa khai báo prefab cho ${PoolType[type]}`); return null; }
        const n = instantiate(prefab);
        n.setParent(this.node, false);
        const unit = n.getComponent(Ply_GameUnit) ?? n.addComponent(Ply_GameUnit);
        unit.poolType = type;
        return unit;
    }

    /**
     * Lấy 1 đối tượng ra khỏi pool.
     * @param pos     vị trí world
     * @param rot     góc quay world
     * @param parent  node cha muốn cắm vào (bỏ trống = giữ dưới node pool)
     */
    public spawn(type: PoolType, pos: Vec3 = Vec3.ZERO, rot: Quat = Quat.IDENTITY, parent: Node | null = null): Ply_GameUnit | null {
        const list = this.dict.get(type);
        let unit: Ply_GameUnit | null = null;
        while (list && list.length && !unit) {
            const u = list.shift()!;
            if (u.isValid && u.node.isValid) unit = u;        // bỏ qua cái đã bị huỷ ở ngoài
        }
        if (!unit) unit = this.make(type);
        if (!unit) return null;
        const n = unit.node;
        if (parent && n.parent !== parent) n.setParent(parent, false);
        n.setWorldPosition(pos);
        n.setWorldRotation(rot);
        n.active = true;
        return unit;
    }

    /** Trả đối tượng về pool (ẩn, về lại dưới node pool) */
    public despawn(type: PoolType, unit: Ply_GameUnit) {
        if (!unit || !unit.node || !unit.node.isValid) return;
        unit.node.active = false;
        if (unit.node.parent !== this.node) unit.node.setParent(this.node, false);
        if (!this.dict.has(type)) this.dict.set(type, []);
        const list = this.dict.get(type)!;
        if (list.indexOf(unit) < 0) list.push(unit);
    }

    /** Prefab khai báo cho loại này */
    public getPrefab(type: PoolType): Prefab | null {
        for (const pa of this.poolAmounts) if (pa.type === type) return pa.prefab;
        return null;
    }

    /**
     * Tạo node từ prefab khai báo cho `type`:
     *  - lúc chạy  → spawn từ pool (node sẽ trả về pool khi despawn)
     *  - trong editor (Ply_Pool chưa onLoad) → instantiate thẳng (dùng để sinh item xem trước, lưu vào scene)
     */
    public static create(type: PoolType, parent: Node | null = null): Node | null {
        if (Ply_Pool.Ins && !EDITOR) return Ply_Pool.Ins.spawn(type, Vec3.ZERO, Quat.IDENTITY, parent)?.node ?? null;
        const pool = director.getScene()?.getComponentInChildren(Ply_Pool);
        const prefab = pool?.getPrefab(type);
        if (!prefab) { console.warn(`[Ply_Pool] chưa có Ply_Pool / prefab cho ${PoolType[type]} trong scene`); return null; }
        const n = instantiate(prefab);
        if (parent) n.setParent(parent, false);
        return n;
    }

    onDestroy() {
        super.onDestroy();
        if (Ply_Pool.Ins === this) Ply_Pool.Ins = null;
    }
}
