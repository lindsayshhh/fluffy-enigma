// Where everything on Palmera Cay lives. Positions are derived from the
// terrain so buildings always sit on the actual shoreline.
import { findShore, height, HILL } from './terrain.js';

function hilltop() {
  let best = { x: HILL.x, z: HILL.z, h: -Infinity };
  for (let dx = -14; dx <= 14; dx += 1) {
    for (let dz = -14; dz <= 14; dz += 1) {
      const h = height(HILL.x + dx, HILL.z + dz);
      if (h > best.h) best = { x: HILL.x + dx, z: HILL.z + dz, h };
    }
  }
  return best;
}

export function computeLayout() {
  const L = {};
  const shoreZ = (x) => findShore(x, 0, 0, 1).z;

  const barShore = shoreZ(-30);
  L.bar = { x: -30, z: barShore - 17 };

  const dockShore = shoreZ(44);
  L.dock = { x: 44, z0: dockShore - 5, z1: dockShore + 44 };
  L.dockEnd = { x: 44, z: L.dock.z1 - 2 };

  L.bungalows = [-128, -102, -76].map((x, i) => {
    const sz = shoreZ(x);
    return { x, z: sz + 26, walk0: sz - 5, walk1: sz + 22.5, mine: i === 1, number: [5, 7, 9][i] };
  });
  const bShore = shoreZ(-102);

  L.volleyball = { x: 10, z: shoreZ(10) - 15 };

  L.loungers = [];
  for (const x of [-70, -62, -54, -46, 18, 26, 34]) {
    L.loungers.push({ x, z: shoreZ(x) - 12 });
  }
  L.umbrellas = [-66, -50, 22, 30].map((x) => ({ x, z: shoreZ(x) - 13.5 }));

  const west = findShore(-60, -6, -1, 0.05);
  L.yoga = { x: west.x + 11, z: west.z };

  const hx = -58;
  const hz = shoreZ(hx) - 24;
  L.hammock = { x: hx, z: hz, a: { x: hx - 2.1, z: hz }, b: { x: hx + 2.1, z: hz } };

  L.grove = { x: -42, z: -22, r: 22 };

  const top = hilltop();
  L.lighthouse = { x: top.x, z: top.z };
  L.wifi = { x: top.x - 4.5, z: top.z + 4 };
  L.bench = { x: top.x - 3, z: top.z + 7.5 };

  L.welcome = { x: 37, z: dockShore - 9 };
  L.spawn = { x: L.bungalows[1].x, z: L.bungalows[1].z - 4.2 };

  L.reef = { x0: 60, x1: 125, z0: shoreZ(92) + 22, z1: shoreZ(92) + 46 };

  // Activities
  L.kayak = { x: 58, z: shoreZ(58) - 2.5 };
  L.bonfire = { x: -6, z: shoreZ(-6) - 8 };
  L.fishing = { x: L.dock.x + 3.5, z: L.dock.z1 - 1.2 };
  const coveShore = findShore(0, 0, 1, -0.42);
  const coveIn = Math.hypot(coveShore.x, coveShore.z);
  L.cove = { x: coveShore.x - (coveShore.x / coveIn) * 3, z: coveShore.z - (coveShore.z / coveIn) * 3, sea: { x: coveShore.x + (coveShore.x / coveIn) * 12, z: coveShore.z + (coveShore.z / coveIn) * 12 } };

  const bwStart = { x: L.bungalows[1].x, z: L.bungalows[1].walk0 };
  L.paths = [
    [bwStart, { x: -80, z: bShore - 12 }, { x: L.bar.x - 6, z: L.bar.z - 4 }],
    [{ x: L.bar.x + 7, z: L.bar.z }, { x: L.volleyball.x - 9, z: L.volleyball.z - 2 }, { x: L.dock.x, z: L.dock.z0 - 2 }],
    [{ x: L.bar.x, z: L.bar.z - 7 }, { x: L.hammock.x + 6, z: L.hammock.z - 4 }, { x: L.yoga.x + 5, z: L.yoga.z }],
    [{ x: L.bar.x + 2, z: L.bar.z - 7 }, { x: L.grove.x + 8, z: L.grove.z + 10 }, { x: 8, z: -40 }, { x: L.lighthouse.x - 12, z: L.lighthouse.z + 6 }, { x: L.wifi.x, z: L.wifi.z }],
    [{ x: L.dock.x, z: L.dock.z0 - 2 }, { x: 52, z: L.dock.z0 - 26 }, { x: L.lighthouse.x + 2, z: L.lighthouse.z + 10 }],
  ];
  return L;
}
