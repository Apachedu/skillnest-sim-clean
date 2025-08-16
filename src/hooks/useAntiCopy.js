import { useEffect } from "react";

export default function useAntiCopy() {
  useEffect(() => {
    const handleContextMenu = (e) => {
      e.preventDefault();
    };

    const handleKeyDown = (e) => {
      const key = e.key?.toLowerCase();
      const ctrlOrCmd = e.ctrlKey || e.metaKey;

      // Block common copy/save/inspect combos and devtools
      const blocked =
        (ctrlOrCmd && ["c", "s", "u", "p"].includes(key)) || // copy, save, view-source, print
        (ctrlOrCmd && e.shiftKey && ["i", "j", "c"].includes(key)) || // devtools
        key === "f12";

      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    const handleDragStart = (e) => {
      e.preventDefault();
    };

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("dragstart", handleDragStart, true);

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("dragstart", handleDragStart, true);
    };
  }, []);
}
