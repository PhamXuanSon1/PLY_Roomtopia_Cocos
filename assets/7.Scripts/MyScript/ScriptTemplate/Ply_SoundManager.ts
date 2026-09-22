import { _decorator, AudioClip, AudioSource, Node, Enum, CCFloat, CCInteger } from 'cc';
import { Ply_Singleton } from './Ply_Singleton';
const { ccclass, property } = _decorator;

/**
 * Enum cac loai hieu ung am thanh (FX).
 */
export enum FxType {
    PickItem = 0,
    DropItem1 = 1,
    DropItem2 = 2,
    DropItem3 = 3,
}
Enum(FxType);

const FX_TYPE_COUNT = 4;

/**
 * Cau hinh du lieu am thanh.
 * Tuong duong voi class SoundData trong Unity gom AudioClip, volume va repeatCount.
 */
@ccclass('SoundData')
class SoundData {
    @property(AudioClip)
    clip: AudioClip | null = null;

    @property({ type: CCFloat, range: [0, 1], slide: true })
    volume: number = 1;

    @property(CCInteger)
    repeatCount: number = 1;
}

/**
 * Cau hinh FX Audio - chua tat ca du lieu am thanh hieu ung.
 * Moi truong tuong ung voi mot gia tri trong enum FxType.
 */
@ccclass('FxAudio')
class FxAudio {
    @property({ type: SoundData, tooltip: 'Nhấc item khỏi thanh' })
    pickItem: SoundData = new SoundData();

    @property({ type: SoundData, tooltip: 'Thả item (âm 1)' })
    dropItem1: SoundData = new SoundData();

    @property({ type: SoundData, tooltip: 'Thả item (âm 2)' })
    dropItem2: SoundData = new SoundData();

    @property({ type: SoundData, tooltip: 'Thả item (âm 3)' })
    dropItem3: SoundData = new SoundData();
}

/**
 * Quan ly am thanh duoc chuyen tu Unity Ply_SoundManager.
 * 
 * Cac diem khac biet chinh so voi Unity:
 * - Dung AudioSource component cua Cocos thay vi Unity AudioSource
 * - Dung schedule va callback kiem tra hang cho thay vi Coroutine
 * - Nhac nen (BGM) dung component AudioSource rieng gan qua Inspector
 * - Am thanh FX phat qua AudioSource.playOneShot() hoac play()
 */
@ccclass('Ply_SoundManager')
export class Ply_SoundManager extends Ply_Singleton {

    public static Ins: Ply_SoundManager | null = null;

    @property(FxAudio)
    fxAudio: FxAudio = new FxAudio();

    @property(AudioSource)
    bgm1: AudioSource | null = null;

    private fxSources: (AudioSource | null)[] = new Array(FX_TYPE_COUNT).fill(null);
    private queuedCount: number[] = new Array(FX_TYPE_COUNT).fill(0);
    private queueTimers: (number | null)[] = new Array(FX_TYPE_COUNT).fill(null);
    private sequenceSource: AudioSource | null = null;
    private sequence: FxType[] = [];
    private sequenceIndex = 0;
    private sequenceCallback: (() => void) | null = null;

    private isMute: boolean = false;

    onLoad() {
        super.onLoad();
        Ply_SoundManager.Ins = this;
    }

    /**
     * Phat am thanh hieu ung ngay lap tuc.
     * Neu dang phat, no se phat lai tu dau.
     */
    public playFx(fxType: FxType) {
        if (this.isMute) return;

        const data = this.getSoundData(fxType);
        if (!data || !data.clip) return;

        const index = fxType as number;
        if (!this.fxSources[index]) {
            this.fxSources[index] = this.createAudioSource(`SoundFX_${FxType[fxType]}`);
        }

        const source = this.fxSources[index]!;
        source.clip = data.clip;
        source.volume = data.volume;
        source.play();

        // Phat lap de tang am luong (giong xu ly trong Unity)
        for (let i = 1; i < data.repeatCount; i++) {
            source.playOneShot(data.clip, data.volume);
        }
    }

    /**
     * Phat cac FX theo thu tu. FX sau chi bat dau khi FX truoc da phat xong.
     * Goi lai ham nay se huy sequence dang phat va thay bang sequence moi.
     */
    public playFxSequence(fxTypes: readonly FxType[]): void {
        this.stopFxSequence();
        if (this.isMute) return;

        this.sequence = fxTypes.filter((fxType) => {
            const data = this.getSoundData(fxType);
            return !!data?.clip;
        });
        this.sequenceIndex = 0;
        this.playNextFxInSequence();
    }

    private playNextFxInSequence(): void {
        if (this.isMute || this.sequenceIndex >= this.sequence.length) {
            this.stopFxSequence();
            return;
        }

        const fxType = this.sequence[this.sequenceIndex++];
        const data = this.getSoundData(fxType);
        if (!data?.clip) {
            this.playNextFxInSequence();
            return;
        }

        if (!this.sequenceSource) {
            this.sequenceSource = this.createAudioSource('SoundFX_Sequence');
        }

        this.sequenceSource.loop = false;
        this.sequenceSource.clip = data.clip;
        this.sequenceSource.volume = data.volume;
        this.sequenceSource.play();

        const callback = () => {
            if (!this.sequenceSource?.playing) {
                this.unschedule(callback);
                if (this.sequenceCallback === callback) this.sequenceCallback = null;
                this.playNextFxInSequence();
            }
        };
        this.sequenceCallback = callback;
        this.schedule(callback, 0.016);
    }

    /** Dung sequence FX dang phat. */
    public stopFxSequence(): void {
        if (this.sequenceCallback) {
            this.unschedule(this.sequenceCallback);
            this.sequenceCallback = null;
        }
        this.sequenceSource?.stop();
        this.sequence = [];
        this.sequenceIndex = 0;
    }

    /**
     * Phat am thanh hieu ung theo hang cho.
     * Neu dang phat, dua toi da 1 lan vao hang cho.
     * Neu ang ranh, phat ngay va bat dau kiem tra hang cho.
     */
    public playFxQueued(fxType: FxType) {
        if (this.isMute) return;

        const data = this.getSoundData(fxType);
        if (!data || !data.clip) return;

        const index = fxType as number;
        if (!this.fxSources[index]) {
            this.fxSources[index] = this.createAudioSource(`SoundFX_Queued_${FxType[fxType]}`);
        }

        const source = this.fxSources[index]!;
        source.clip = data.clip;
        source.volume = data.volume;

        if (source.playing) {
            // Neu đang phat, chi cho vao hang cho toi da 1 lan
            this.queuedCount[index] = 1;
        } else {
            // Neu ranh thi phat luon
            source.play();

            // Bat dau qua trinh kiem tra hang cho
            this.startQueueCheck(index);
        }
    }

    /**
     * Kiem tra hang cho dinh ky va phat am thanh tiep theo.
     * Thay the cho CheckQueueRoutine dung Coroutine trong Unity.
     */
    private startQueueCheck(index: number) {
        if (this.queueTimers[index] !== null) {
            this.unschedule(this.checkQueueCallback.bind(this, index));
        }

        const callback = () => {
            const source = this.fxSources[index];
            if (!source) {
                this.unschedule(callback);
                this.queueTimers[index] = null;
                return;
            }

            if (!source.playing) {
                if (this.queuedCount[index] > 0) {
                    this.queuedCount[index] = 0;
                    source.play();
                } else {
                    this.unschedule(callback);
                    this.queueTimers[index] = null;
                }
            }
        };

        this.schedule(callback, 0.016);
    }

    private checkQueueCallback(index: number) {
        // Callback giu tham chieu
    }

    /**
     * Phat am thanh hieu ung lặp lai (loop).
     */
    public playLoopFx(fxType: FxType) {
        if (this.isMute) return;

        const data = this.getSoundData(fxType);
        if (!data || !data.clip) return;

        const index = fxType as number;
        if (!this.fxSources[index]) {
            this.fxSources[index] = this.createAudioSource(`SoundFX_Loop_${FxType[fxType]}`);
        }

        const source = this.fxSources[index]!;
        source.clip = data.clip;
        source.volume = data.volume;
        source.loop = true;
        source.play();
    }

    /**
     * Dung mot am thanh hieu ung cu the.
     */
    public stopFx(fxType: FxType) {
        const index = fxType as number;
        if (index >= 0 && index < this.fxSources.length && this.fxSources[index]) {
            this.fxSources[index]!.stop();
        }
    }

    /**
     * Phat nhac nen.
     */
    public playBGM1() {
        if (this.isMute) return;
        if (this.bgm1 && !this.bgm1.playing) {
            this.bgm1.play();
        }
    }

    /**
     * Phat nhac nen (alias cho playBGM1).
     */
    public playBGM2() {
        this.playBGM1();
    }

    /**
     * Lay SoundData tuong ung voi FxType.
     */
    private getSoundData(type: FxType): SoundData | null {
        switch (type) {
            case FxType.PickItem: return this.fxAudio.pickItem;
            case FxType.DropItem1: return this.fxAudio.dropItem1;
            case FxType.DropItem2: return this.fxAudio.dropItem2;
            case FxType.DropItem3: return this.fxAudio.dropItem3;
            default: return null;
        }
    }

    /**
     * Tat tieng chi rieng cac am thanh FX.
     */
    public muteFx() {
        this.isMute = true;
        this.stopFxSequence();
        for (let i = 0; i < this.fxSources.length; i++) {
            if (this.fxSources[i]) {
                this.fxSources[i]!.stop();
            }
        }
    }

    /**
     * Tat toan bo am thanh (BGM + FX).
     */
    public mute() {
        this.isMute = true;
        this.stopFxSequence();
        if (this.bgm1) this.bgm1.stop();
        for (let i = 0; i < this.fxSources.length; i++) {
            if (this.fxSources[i]) {
                this.fxSources[i]!.stop();
            }
        }
    }

    /**
     * Bat lai am thanh.
     */
    public unmute() {
        this.isMute = false;
    }

    /**
     * Dung toan bo am thanh (alias cho mute).
     */
    public stopAll(): void {
        this.mute();
    }

    /**
     * Phat nhac nen.
     */
    public playBGM(): void {
        this.playBGM1();
    }

    /**
     * Dung nhac nen.
     */
    public stopBGM(): void {
        if (this.bgm1) {
            this.bgm1.stop();
        }
    }

    /**
     * Phat am thanh theo FxType (alias cho playFx).
     */
    public playSound(fxType: FxType): void {
        this.playFx(fxType);
    }

    /**
     * Tao mot AudioSource component moi tren node con.
     */
    private createAudioSource(name: string): AudioSource {
        const audioNode = new Node(name);
        audioNode.setParent(this.node);
        return audioNode.addComponent(AudioSource);
    }

    onDestroy() {
        this.stopFxSequence();
        super.onDestroy();
        if (Ply_SoundManager.Ins === this) {
            Ply_SoundManager.Ins = null;
        }
    }
}
