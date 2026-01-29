let colorIndex = null;
let initPromise = null;

async function initColorIndex() {
  if (colorIndex) return colorIndex;
  if (initPromise) return initPromise;

  initPromise = import("color-name-list")
    .then((mod) => mod.default || mod.colornames || mod)
    .then((list) => {
      const idx = Object.create(null);
      for (const c of list) idx[c.name.toLowerCase()] = c.hex;
      colorIndex = idx;
      return colorIndex;
    })
    .finally(() => {
      initPromise = null;
    });

  return initPromise;
}

function convertColor(color) {
  if (!color) return null;
  if (color.startsWith("#")) return color;

  if (!colorIndex) return "#000000"; // atau: throw new Error("Call initColorIndex() first");

  return colorIndex[color.toLowerCase()] || "#000000";
}

module.exports = { initColorIndex, convertColor };
