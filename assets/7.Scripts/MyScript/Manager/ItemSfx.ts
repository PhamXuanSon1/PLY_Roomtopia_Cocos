import { _decorator, AudioClip, AudioSource, Component } from 'cc';
const { ccclass, property, disallowMultiple } = _decorator;

/** ItemSfx — âm thanh khi nhấc / thả item (đặt cùng node với ItemManager) */
@ccclass('ItemSfx')
@disallowMultiple
export class ItemSfx extends Component {
    @property({ type: AudioClip, tooltip: 'Phát khi nhấc item khỏi thanh' })
    pickSound: AudioClip | null = null;

    @property({ type: [AudioClip], tooltip: 'Phát ngẫu nhiên 1 clip khi thả đúng chỗ' })
    dropSounds: AudioClip[] = [];

    @property({ range: [0, 1, 0.05], slide: true, tooltip: 'Âm lượng hiệu ứng (0 = tắt, 1 = to nhất)' })
    sfxVolume = 1;

    private audio: AudioSource | null = null;

    playPick() { this.play(this.pickSound); }

    playDrop() {
        if (this.dropSounds.length) this.play(this.dropSounds[Math.floor(Math.random() * this.dropSounds.length)]);
    }

    /** Phát 1 clip (one-shot) qua AudioSource trên node này */
    private play(clip: AudioClip | null) {
        if (!clip) return;
        if (!this.audio) this.audio = this.getComponent(AudioSource) ?? this.addComponent(AudioSource)!;
        this.audio.playOneShot(clip, this.sfxVolume);
    }
}
