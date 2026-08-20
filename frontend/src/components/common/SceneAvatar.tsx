import { Suspense } from 'react';
import Avatar from './Avatar';
import { SceneBoundary, SplineScene } from '../layout/SplineHero';
import styles from './SceneAvatar.module.css';

interface SceneAvatarProps {
  size?: number;
  borderWidth?: number;
}

/**
 * The QBot mark as the live 3D scene rather than the flat mascot image.
 *
 * Degrades to the flat `Avatar` in both directions, which is why it is worth a
 * component rather than dropping the scene inline:
 *
 *  - while the 3D chunk is still downloading, so the face is there from first paint
 *    instead of a hole that fills in a second later;
 *  - permanently, if WebGL is unavailable — the same case that used to blank the app.
 *
 * The scene is authored as a wide hero, so it is scaled up and clipped to the circle:
 * dropped in at its natural framing the subject sits small in the middle with empty
 * space around it, which reads as a mistake at avatar size.
 */
export default function SceneAvatar({ size = 80, borderWidth = 3 }: SceneAvatarProps) {
  const flat = <Avatar size={size} borderWidth={borderWidth} />;

  return (
    <SceneBoundary fallback={flat}>
      <Suspense fallback={flat}>
        <div className={styles.frame} style={{ width: size, height: size, borderWidth }}>
          <div className={styles.scene}>
            <SplineScene />
          </div>
        </div>
      </Suspense>
    </SceneBoundary>
  );
}
