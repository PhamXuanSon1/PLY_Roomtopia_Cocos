import { _decorator, Component, Node } from 'cc';
import { PoolType } from './Ply_Types';
import { Ply_Pool } from './Ply_Pool';
const { ccclass, property } = _decorator;

/**
 * Lớp cơ bản cho mọi đối tượng sinh từ Ply_Pool (tương đương Ply_GameUnit : MonoBehaviour trong Unity).
 * Prefab không gắn script nào kế thừa lớp này thì Ply_Pool tự thêm Ply_GameUnit khi spawn.
 */
@ccclass('Ply_GameUnit')
export class Ply_GameUnit extends Component {

    @property({ type: PoolType, tooltip: 'Loại pool của đối tượng này (Ply_Pool tự gán khi spawn)' })
    public poolType: PoolType = PoolType.BlinkFx;

    /** Node của unit (giữ tên `tf` như Transform trong Unity) */
    public get tf(): Node {
        return this.node;
    }

    /** Trả về pool ngay (không có pool → huỷ node) */
    public despawn(): void {
        this.unscheduleAllCallbacks();
        if (Ply_Pool.Ins) Ply_Pool.Ins.despawn(this.poolType, this);
        else if (this.node.isValid) this.node.destroy();
    }

    /** Trả về pool sau `delay` giây */
    public deSpawnByTime(delay: number = 2): void {
        this.unscheduleAllCallbacks();
        this.scheduleOnce(() => this.despawn(), delay);
    }
}
