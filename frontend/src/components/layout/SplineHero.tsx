import { Component, Suspense, lazy, type ReactNode } from 'react';

/**
 * The Spline 3D scene, isolated so it can fail without taking the app with it.
 *
 * Two problems this solves, both caused by importing @splinetool/react-spline directly
 * into a page component:
 *
 * 1. WebGL is not always available. Spline throws when it cannot get a context, and an
 *    uncaught throw during render unmounts the *whole* React tree — not just the scene.
 *    Measured in headless Chrome with the GPU off: `root childElementCount` went to 0
 *    and every route rendered a blank white page. That is the state a user gets on a
 *    VDI session, a machine on Chrome's GPU blocklist, or anywhere hardware
 *    acceleration is switched off by policy — all of which are ordinary in a corporate
 *    fleet, which is exactly who this app is for.
 *
 * 2. Pages that use it are statically imported by the router, so bundling Spline into
 *    them put a whole 3D engine (physics, navmesh, opentype, gaussian-splat decoding)
 *    in the entry chunk: 266 kB -> 2,284 kB. Lazily importing it keeps the engine out
 *    of the first load and fetches it only when a screen that shows it is opened.
 */

const SCENE = 'https://prod.spline.design/bxW7UuZg2uVmhcJd/scene.splinecode';

const Spline = lazy(() => import('@splinetool/react-spline'));

/** The scene alone. Always render it inside a SceneBoundary. */
export function SplineScene() {
  return <Spline scene={SCENE} />;
}

/**
 * Renders `fallback` instead of its children if the 3D scene cannot start.
 *
 * Exported because what a failure should look like depends on where the scene is: the
 * landing page has a styled orb behind it and wants nothing, while the avatar slots
 * want the flat mascot image so there is no hole where a face should be.
 */
export class SceneBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Worth a line in the console: the page still works, so nobody would otherwise
    // know the scene is missing or why.
    console.warn('[spline] 3D scene unavailable, using the fallback', error);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

/**
 * The landing page hero.
 *
 * The fallback is deliberately nothing. The slot it sits in is already a bordered,
 * glowing circle with orbit rings and floating dots around it, so an absent scene still
 * reads as intentional rather than as a hole in the layout.
 */
export default function SplineHero() {
  return (
    <SceneBoundary>
      {/* null, not a spinner: the scene fades in over an already-complete composition,
          so a placeholder would flash for no reason on a fast connection. */}
      <Suspense fallback={null}>
        <SplineScene />
      </Suspense>
    </SceneBoundary>
  );
}
