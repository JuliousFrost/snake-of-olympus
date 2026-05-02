export type AudioEventName =
  | 'menu-confirm'
  | 'fruit-pickup'
  | 'upgrade-pickup'
  | 'rocket-fire'
  | 'rocket-impact'
  | 'dash-launch'
  | 'damage-hit'
  | 'snake-death'
  | 'mine-trigger'
  | 'victory';

export type AudioEvent = { name: AudioEventName; volume: number };

export function createAudioEventQueue(settings: { masterVolume: number; sfxVolume: number }) {
  const events: AudioEvent[] = [];
  return {
    emit(name: AudioEventName, intensity = 1) {
      const volume = Number((settings.masterVolume * settings.sfxVolume * intensity).toFixed(3));
      if (volume <= 0) return;
      events.push({ name, volume });
    },
    drain(): AudioEvent[] {
      return events.splice(0, events.length);
    },
  };
}
