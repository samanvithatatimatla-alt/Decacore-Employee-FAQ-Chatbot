import { Component, Suspense, lazy, type ReactNode } from 'react';

/**
 * The landing page's 3D hero, isolated so it can fail without taking the app with it.
 *
 * Two problems this solves, both caused by importing @splinetool/react-spline directly
 * into WelcomePage:
 *
 * 1. WebGL is not always available. Spline throws when it cannot get a context, and an
 *    uncaught throw during render unmounts the *whole* React tree — not just the hero.
 *    Measured in headless Chrome with the GPU off: `root childElementCount` went to 0
 *    and every route rendered a blank white page. That is the state a user gets on a
 *    VDI session, a machine on Chrome's GPU blocklist, or anywhere hardware
 *    acceleration is switched off by policy — all of which are ordinary in a corporate
 *    fleet, which is exactly who this app is for.
 *
 * 2. WelcomePage is statically imported by the router, so bundling Spline into it put
 *    a whole 3D engine (physics, navmesh, opentype, gaussian-splat decoding) in the
 *    entry chunk: 266 kB -> 2,284 kB, and ~5 MB of JavaScript in total. Someone opening
 *    /chat downloaded all of it to render a page that has no 3D on it at all.
 *
 * The fallback is deliberately nothing. The slot it sits in is already a bordered,
 * glowing circle with orbit rings and floating dots around it, so an absent scene still
 * reads as intentional rather than as a hole in the layout.
 */

const Spline = lazy(() => import('@splinetool/react-spline'));

const SCENE = 'https://prod.spline.design/bxW7UuZg2uVmhcJd/scene.splinecode';

interface BoundaryProps {
  children: ReactNode;
}

class SceneBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Worth a line in the console: the page still works, so nobody would otherwise
    // know the hero is missing or why.
    console.warn('[welcome] 3D hero unavailable, continuing without it', error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function SplineHero() {
  return (
    <SceneBoundary>
      {/* null, not a spinner: the scene fades in over an already-complete composition,
          so a placeholder would flash for no reason on a fast connection. */}
      <Suspense fallback={null}>
        <Spline scene={SCENE} />
      </Suspense>
    </SceneBoundary>
  );
}
