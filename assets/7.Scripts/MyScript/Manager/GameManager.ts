import { _decorator, Color, Component, Material, Node } from 'cc';
import { LevelConfig } from './LevelConfig';
const { ccclass, property } = _decorator;

/**
 * Cấu hình chung của gameplay (không phụ thuộc map). Map hiện tại = prefab Level (LevelConfig) có trong scene.
 */
@ccclass('GameManager')
export class GameManager extends Component {
    static inst: GameManager | null = null;

    /** Node gốc phòng của map hiện tại (prefab Level trong scene) */
    get model(): Node | null { return LevelConfig.current?.node ?? null; }

    /** Cấu hình map hiện tại */
    get level(): LevelConfig | null { return LevelConfig.current; }

    @property({ type: Material, tooltip: 'Material xám cho target chưa hoàn thành' })
    grayMat: Material | null = null;

    @property({ group: 'Drag Blink', tooltip: 'Đang kéo item thì target trong map fade màu qua lại để chỉ chỗ cần thả' })
    blinkOnDrag = true;

    @property({ group: 'Drag Blink', tooltip: 'Màu fade tới (nhân vào mainColor của material target, trắng = giữ nguyên màu xám)' })
    blinkColor: Color = new Color(120, 200, 255, 255);

    @property({ group: 'Drag Blink', tooltip: 'Thời gian 1 chu kỳ fade đi-về (giây)' })
    blinkCycle = 0.6;

    @property({ group: 'Drag Blink', tooltip: 'Nghỉ bao lâu ở màu gốc giữa 2 chu kỳ fade (giây, 0 = nháy liên tục)' })
    blinkIdle = 0.4;

    /** Công bố cấu hình gameplay hiện tại để các component khác truy cập qua inst. */
    onLoad() {
        GameManager.inst = this;
    }

    /** Xoá tham chiếu dùng chung nếu component bị huỷ vẫn là instance đang được giữ. */
    onDestroy() {
        if (GameManager.inst === this) GameManager.inst = null;
    }
}
