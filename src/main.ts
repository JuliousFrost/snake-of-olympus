import Phaser from 'phaser';
import './style.css';
import { MatchScene } from './game/scenes/MatchScene';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = '<div id="game"></div>';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#120b18',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  physics: { default: 'arcade' },
  render: {
    antialias: true,
    pixelArt: false,
  },
  scene: [MatchScene],
});
