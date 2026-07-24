import type { SVGProps } from "react";

export type ClassicIconName =
  | "app"
  | "new"
  | "open"
  | "save"
  | "add"
  | "export"
  | "music"
  | "warning"
  | "info"
  | "error"
  | "play"
  | "stop"
  | "folder"
  | "delete"
  | "up"
  | "down"
  | "properties"
  | "help"
  | "relink"
  | "check";

export function ClassicIcon({ name, size = 16, ...props }: {
  name: ClassicIconName;
  size?: number;
} & Omit<SVGProps<SVGSVGElement>, "name">) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    shapeRendering: "crispEdges" as const,
    "aria-hidden": props["aria-label"] ? undefined : true
  };

  const art = {
    app: <>
      <rect x="2" y="1" width="9" height="2" fill="#000" />
      <rect x="1" y="3" width="12" height="9" fill="#000" />
      <rect x="2" y="3" width="10" height="8" fill="#c0c0c0" />
      <rect x="3" y="4" width="8" height="2" fill="#000080" />
      <rect x="3" y="7" width="2" height="3" fill="#008000" />
      <rect x="6" y="8" width="2" height="2" fill="#ffff00" />
      <rect x="9" y="6" width="2" height="4" fill="#1084d0" />
      <rect x="4" y="12" width="6" height="2" fill="#000" />
    </>,
    new: <>
      <rect x="3" y="1" width="8" height="1" fill="#000" />
      <rect x="2" y="2" width="10" height="13" fill="#000" />
      <rect x="3" y="2" width="8" height="12" fill="#fff" />
      <rect x="8" y="2" width="3" height="3" fill="#c0c0c0" />
      <rect x="4" y="7" width="6" height="1" fill="#000080" />
      <rect x="4" y="10" width="6" height="1" fill="#000080" />
    </>,
    open: <>
      <rect x="1" y="4" width="6" height="2" fill="#000" />
      <rect x="2" y="3" width="5" height="2" fill="#ffff00" />
      <rect x="1" y="5" width="14" height="9" fill="#000" />
      <rect x="2" y="6" width="12" height="7" fill="#ffff00" />
      <rect x="5" y="7" width="9" height="1" fill="#808000" />
      <rect x="3" y="12" width="9" height="1" fill="#fff" />
    </>,
    save: <>
      <rect x="1" y="1" width="14" height="14" fill="#000" />
      <rect x="2" y="2" width="12" height="12" fill="#000080" />
      <rect x="4" y="2" width="7" height="5" fill="#fff" />
      <rect x="9" y="3" width="2" height="3" fill="#808080" />
      <rect x="4" y="9" width="8" height="5" fill="#fff" />
      <rect x="5" y="10" width="6" height="1" fill="#808080" />
    </>,
    add: <>
      <rect x="2" y="2" width="8" height="12" fill="#000" />
      <rect x="3" y="3" width="6" height="10" fill="#fff" />
      <rect x="6" y="5" width="2" height="5" fill="#000080" />
      <rect x="4" y="9" width="4" height="3" fill="#000080" />
      <rect x="10" y="8" width="5" height="2" fill="#000" />
      <rect x="12" y="6" width="2" height="6" fill="#000" />
      <rect x="11" y="9" width="3" height="1" fill="#00a000" />
    </>,
    export: <>
      <rect x="1" y="3" width="8" height="11" fill="#000" />
      <rect x="2" y="4" width="6" height="9" fill="#fff" />
      <rect x="7" y="7" width="8" height="3" fill="#000" />
      <rect x="10" y="4" width="2" height="9" fill="#000" />
      <rect x="9" y="6" width="3" height="5" fill="#1084d0" />
      <rect x="12" y="8" width="2" height="1" fill="#1084d0" />
    </>,
    music: <>
      <rect x="6" y="2" width="7" height="2" fill="#000080" />
      <rect x="6" y="4" width="2" height="7" fill="#000080" />
      <rect x="11" y="3" width="2" height="6" fill="#000080" />
      <rect x="3" y="9" width="5" height="4" fill="#000" />
      <rect x="8" y="7" width="5" height="4" fill="#000" />
      <rect x="4" y="9" width="3" height="3" fill="#1084d0" />
      <rect x="9" y="7" width="3" height="3" fill="#1084d0" />
    </>,
    warning: <>
      <rect x="7" y="1" width="2" height="2" fill="#000" />
      <rect x="5" y="3" width="6" height="3" fill="#000" />
      <rect x="3" y="6" width="10" height="4" fill="#000" />
      <rect x="1" y="10" width="14" height="4" fill="#000" />
      <rect x="7" y="4" width="2" height="6" fill="#ffff00" />
      <rect x="7" y="11" width="2" height="2" fill="#ffff00" />
    </>,
    info: <>
      <rect x="4" y="1" width="8" height="2" fill="#000" />
      <rect x="2" y="3" width="12" height="10" fill="#000" />
      <rect x="4" y="2" width="8" height="12" fill="#000" />
      <rect x="3" y="4" width="10" height="8" fill="#1084d0" />
      <rect x="7" y="4" width="2" height="2" fill="#fff" />
      <rect x="7" y="7" width="2" height="4" fill="#fff" />
    </>,
    error: <>
      <rect x="3" y="1" width="10" height="2" fill="#000" />
      <rect x="1" y="3" width="14" height="10" fill="#000" />
      <rect x="3" y="2" width="10" height="12" fill="#000" />
      <rect x="2" y="4" width="12" height="8" fill="#a40000" />
      <rect x="5" y="5" width="2" height="2" fill="#fff" />
      <rect x="9" y="5" width="2" height="2" fill="#fff" />
      <rect x="7" y="7" width="2" height="2" fill="#fff" />
      <rect x="5" y="9" width="2" height="2" fill="#fff" />
      <rect x="9" y="9" width="2" height="2" fill="#fff" />
    </>,
    play: <>
      <rect x="3" y="2" width="2" height="12" fill="#000" />
      <rect x="5" y="4" width="3" height="8" fill="#000" />
      <rect x="8" y="6" width="3" height="4" fill="#000" />
      <rect x="11" y="7" width="2" height="2" fill="#000" />
    </>,
    stop: <rect x="3" y="3" width="10" height="10" fill="#000" />,
    folder: <>
      <rect x="1" y="4" width="14" height="10" fill="#000" />
      <rect x="2" y="3" width="6" height="3" fill="#ffff00" />
      <rect x="2" y="5" width="12" height="8" fill="#ffff00" />
      <rect x="3" y="6" width="10" height="1" fill="#fff" />
    </>,
    delete: <>
      <rect x="4" y="2" width="8" height="2" fill="#000" />
      <rect x="2" y="4" width="12" height="2" fill="#000" />
      <rect x="4" y="6" width="8" height="9" fill="#000" />
      <rect x="5" y="6" width="6" height="8" fill="#fff" />
      <rect x="6" y="7" width="1" height="6" fill="#a40000" />
      <rect x="9" y="7" width="1" height="6" fill="#a40000" />
    </>,
    up: <>
      <rect x="7" y="2" width="2" height="12" fill="#000" />
      <rect x="5" y="4" width="6" height="2" fill="#000" />
      <rect x="3" y="6" width="10" height="2" fill="#000" />
    </>,
    down: <>
      <rect x="7" y="2" width="2" height="12" fill="#000" />
      <rect x="3" y="8" width="10" height="2" fill="#000" />
      <rect x="5" y="10" width="6" height="2" fill="#000" />
    </>,
    properties: <>
      <rect x="2" y="1" width="10" height="14" fill="#000" />
      <rect x="3" y="2" width="8" height="12" fill="#fff" />
      <rect x="5" y="4" width="5" height="1" fill="#000080" />
      <rect x="5" y="7" width="5" height="1" fill="#000080" />
      <rect x="5" y="10" width="5" height="1" fill="#000080" />
      <rect x="3" y="4" width="1" height="1" fill="#000" />
      <rect x="3" y="7" width="1" height="1" fill="#000" />
      <rect x="3" y="10" width="1" height="1" fill="#000" />
    </>,
    help: <>
      <rect x="4" y="1" width="8" height="2" fill="#000" />
      <rect x="2" y="3" width="12" height="10" fill="#000" />
      <rect x="4" y="2" width="8" height="12" fill="#000" />
      <rect x="3" y="4" width="10" height="8" fill="#000080" />
      <rect x="6" y="4" width="4" height="2" fill="#fff" />
      <rect x="8" y="6" width="2" height="2" fill="#fff" />
      <rect x="6" y="8" width="3" height="1" fill="#fff" />
      <rect x="7" y="10" width="2" height="2" fill="#fff" />
    </>,
    relink: <>
      <rect x="1" y="3" width="8" height="10" fill="#000" />
      <rect x="2" y="4" width="6" height="8" fill="#ffff00" />
      <rect x="9" y="4" width="5" height="2" fill="#000080" />
      <rect x="12" y="5" width="2" height="4" fill="#000080" />
      <rect x="8" y="9" width="6" height="2" fill="#000080" />
      <rect x="8" y="7" width="2" height="3" fill="#000080" />
    </>,
    check: <>
      <rect x="2" y="7" width="3" height="3" fill="#000" />
      <rect x="4" y="9" width="3" height="3" fill="#000" />
      <rect x="6" y="7" width="3" height="3" fill="#000" />
      <rect x="8" y="5" width="3" height="3" fill="#000" />
      <rect x="10" y="3" width="3" height="3" fill="#000" />
    </>
  }[name];

  return <svg {...common} {...props}>{art}</svg>;
}
