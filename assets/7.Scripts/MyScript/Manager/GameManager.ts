import { _decorator, Color, Component, Material, Node } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Giữ cấu hình level (1 level duy nhất — playable).
 */
@ccclass('GameManager')
export class GameManager extends Component {
    static inst: GameManager | null = null;

    @property({ type: Node, tooltip: 'Root của map 3D' })
    model: Node | null = null;

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

    onLoad() {
        GameManager.inst = this;
    }

    onDestroy() {
        if (GameManager.inst === this) GameManager.inst = null;
    }
}
