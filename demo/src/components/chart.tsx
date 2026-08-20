import { useEffect, useRef } from "react";
import type { VisualizationCallbacks, VisualizationController, VisualizationFrame } from "@genetic-assembly/visualizations";

export function Chart({ create, frame, callbacks, className = "chart" }: {
  create: (element: HTMLElement, callbacks: VisualizationCallbacks) => VisualizationController;
  frame: VisualizationFrame;
  callbacks?: VisualizationCallbacks;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<VisualizationController | undefined>(undefined);
  const callbackRef = useRef(callbacks);
  callbackRef.current = callbacks;

  useEffect(() => {
    if (!host.current) return;
    controller.current = create(host.current, {
      onHover: (id) => callbackRef.current?.onHover?.(id),
      onSelect: (id) => callbackRef.current?.onSelect?.(id),
      onFilter: (ids) => callbackRef.current?.onFilter?.(ids),
    });
    const resize = new ResizeObserver(() => controller.current?.resize());
    resize.observe(host.current);
    return () => { resize.disconnect(); controller.current?.destroy(); controller.current = undefined; };
  }, [create]);

  useEffect(() => { controller.current?.update(frame); }, [frame]);
  return <div ref={host} className={className} />;
}
