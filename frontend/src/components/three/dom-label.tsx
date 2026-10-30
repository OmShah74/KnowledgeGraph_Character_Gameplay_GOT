"use client";

/**
 * DomLabel — HTML labels anchored to 3D positions, without nested React roots.
 *
 * drei's <Html> mounts a separate React root per label and unmounts it synchronously during
 * React's commit when a <Canvas> unmounts, which races under React 19 ("removeChild ... not a
 * child of this node"). DomLabel instead owns a plain DOM element: it is created and appended
 * once, projected every frame (position, distance-based scale, depth-sorted z-index, culled
 * behind the camera) and removed with a safe el.remove() on unmount.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export type DomLabelProps = {
  position?: [number, number, number];
  text: string;
  sub?: string;
  badge?: string | number | null;
  className?: string;
  subClassName?: string;
  badgeClassName?: string;
  /** Larger = label stays bigger when far away. */
  distanceFactor?: number;
  minScale?: number;
  maxScale?: number;
  interactive?: boolean;
  onClick?: () => void;
  onEnter?: () => void;
  onLeave?: () => void;
  zBase?: number;
  title?: string;
};

const tmp = new THREE.Vector3();

export function DomLabel({
  position = [0, 0, 0], text, sub, badge, className = "", subClassName = "", badgeClassName = "", distanceFactor = 14,
  minScale = 0.35, maxScale = 1.8, interactive = false, onClick, onEnter, onLeave, zBase = 10, title,
}: DomLabelProps) {
  const { gl, camera, size } = useThree();
  const anchor = useRef<THREE.Group>(null);
  const el = useMemo(() => (typeof document === "undefined" ? null : document.createElement("div")), []);
  const handlers = useRef({ onClick, onEnter, onLeave });
  handlers.current = { onClick, onEnter, onLeave };

  // Mount the element next to the canvas once; remove safely on unmount.
  useLayoutEffect(() => {
    if (!el) return;
    const target = gl.domElement.parentNode as HTMLElement | null;
    if (!target) return;
    el.style.position = "absolute";
    el.style.top = "0";
    el.style.left = "0";
    el.style.willChange = "transform";
    el.style.transformOrigin = "0 0";
    target.appendChild(el);
    const click = (e: MouseEvent) => { e.stopPropagation(); handlers.current.onClick?.(); };
    const enter = () => handlers.current.onEnter?.();
    const leave = () => handlers.current.onLeave?.();
    el.addEventListener("click", click);
    el.addEventListener("mouseenter", enter);
    el.addEventListener("mouseleave", leave);
    return () => {
      el.removeEventListener("click", click);
      el.removeEventListener("mouseenter", enter);
      el.removeEventListener("mouseleave", leave);
      el.remove();
    };
  }, [el, gl]);

  // Content & styling (imperative, so no React root is needed inside).
  useEffect(() => {
    if (!el) return;
    el.style.pointerEvents = interactive ? "auto" : "none";
    el.style.cursor = interactive ? "pointer" : "default";
    if (title) el.title = title;
    el.replaceChildren();
    const box = document.createElement("div");
    box.className = className;
    const main = document.createElement("span");
    main.textContent = text;
    box.appendChild(main);
    if (badge !== null && badge !== undefined && badge !== "") {
      const b = document.createElement("span");
      b.className = badgeClassName;
      b.textContent = String(badge);
      box.appendChild(b);
    }
    if (sub) {
      const s = document.createElement("div");
      s.className = subClassName;
      s.textContent = sub;
      box.appendChild(s);
    }
    el.appendChild(box);
  }, [el, text, sub, badge, className, subClassName, badgeClassName, interactive, title]);

  useFrame(() => {
    if (!el || !anchor.current) return;
    anchor.current.getWorldPosition(tmp);
    const dist = camera.position.distanceTo(tmp);
    tmp.project(camera);
    if (tmp.z > 1 || tmp.z < -1 || Math.abs(tmp.x) > 1.2 || Math.abs(tmp.y) > 1.2) {
      if (el.style.display !== "none") el.style.display = "none";
      return;
    }
    if (el.style.display === "none") el.style.display = "";
    const x = ((tmp.x + 1) / 2) * size.width;
    const y = ((1 - tmp.y) / 2) * size.height;
    const s = Math.max(minScale, Math.min(maxScale, distanceFactor / Math.max(dist, 0.001)));
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.toFixed(3)}) translate(-50%, -50%)`;
    el.style.zIndex = String(zBase + Math.max(0, Math.round(1000 - dist * 10)));
  });

  return <group ref={anchor} position={position} />;
}
