import { Size, view } from 'cc';
import { EDITOR } from 'cc/env';

/**
 * Kích thước màn hình dùng để LAYOUT (BoxBg, FitInBox, BottomBar...).
 *
 *  - Lúc chạy: = view.getVisibleSize().
 *  - Trong editor: EditorPreview đặt `override` (dọc/ngang, độ phân giải) → các script layout dựng đúng
 *    như trên thiết bị đó ngay trong Scene editor, không cần Play. Không có EditorPreview → như lúc chạy.
 *
 * File này KHÔNG import script nào khác (tránh vòng import: EditorPreview import các script layout).
 */
export class PreviewScreen {
    /** Editor: kích thước màn đang xem trước (EditorPreview gán). null = theo view */
    static override: Size | null = null;

    static visibleSize(): Size {
        if (EDITOR && PreviewScreen.override) return PreviewScreen.override;
        return view.getVisibleSize();
    }

    static get landscape(): boolean {
        const s = PreviewScreen.visibleSize();
        return s.width > s.height;
    }

    /** orthoHeight của WCam theo màn hình (UI.resize và EditorPreview dùng chung) */
    static worldOrthoHeight(size: Size): number {
        const aspect = size.width / size.height;
        const targetWidth = 6.6;
        return aspect < 1.2 ? Math.max(6.8, targetWidth / (2 * aspect)) : 6.0;
    }
}
