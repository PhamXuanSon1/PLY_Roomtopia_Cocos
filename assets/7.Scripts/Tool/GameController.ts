import { _decorator, Component, Node } from "cc";
import playableHelper from "./h5-helper";
import { PREVIEW } from "cc/env";
const { ccclass, property } = _decorator;

export var gc: GameController;

@ccclass("GameController")
export class GameController extends Component {

  onLoad() {
    gc = this;
  }
  
  start() {
    playableHelper.gameStart();

    // <!--https://play.google.com/store/apps/details?id=com.vs.antflow
    // -->
    // <!--IOSLink
    // -->

    const androidUrl = "https://play.google.com/store/apps/details?id=com.vs.antflow";
    const iosUrl = "https://play.google.com/store/apps/details?id=com.vs.antflow";
    playableHelper.setStoreUrl(iosUrl, androidUrl); // this section only needs for Google and Unity channel
  }
  setHandleVolumeChange(funct: Function) {
    playableHelper.handleVolumeChange(funct);
  }

  update(deltaTime: number) {}

 

  @property({ tooltip: 'Chỉ khi Preview trong editor: hỏi trước khi mở store (tránh nhảy trang khi đang test)' })
  storeDialogMessage = 'Mở store? (chỉ hỏi khi Preview)';

  redirectToStore() {
    if (PREVIEW && typeof window !== 'undefined') {
      const shouldOpenStore = window.confirm(this.storeDialogMessage);
      console.log('[GameController] redirectToStore (preview) → confirm =', shouldOpenStore);
      if (!shouldOpenStore) return;
    }
    console.log('[GameController] redirectToStore');
    playableHelper.gameEnd();
    playableHelper.redirect();
  }
}


type GameLoad = {
  gameName: string;
  font: string;
  customScale: number;
  customHeight: number;
  customTop: number;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
};

const gameLoad: GameLoad = {
    gameName: "Bus Escape: Traffic Jam",
    font: "Arial",
    customScale: 3,
    customHeight: 100,
    customTop: 70,
    fillStyle: "#ffffff",
    strokeStyle: "#000000",
    lineWidth: 3,
    textBaseline: "top",
    textAlign: "center",
  };

try {
  //@ts-ignore
  window.gameLoad = gameLoad;
} catch (error) {  
}
