/**
 * Hand-authored geography of the Known World in a 0..100 map space
 * (x: west → east, y: north → south). Westeros occupies x≈3–38, Essos x≈42–100.
 * Gameplay locations (from the backend) share this coordinate space.
 */
export type Pt = [number, number];

export const WESTEROS: Pt[] = [
  [6, 0], [36, 0], [38, 3], [35, 6], [36, 9], [34, 12], [32, 15], [31, 19], [33, 22], [31, 25], [29, 28], [26, 30],
  [24, 31], [27, 32], [30, 32], [33, 33], [35, 36], [35.5, 40], [33, 43], [31, 45], [33, 47], [31, 50], [29, 52], [28.2, 55],
  [28.5, 57.5], [30, 58.5], [31.5, 60.5], [33.5, 62], [34.5, 65.5], [32.5, 69], [34, 73], [36.5, 79], [37, 84], [35, 87],
  [33.5, 90], [28, 91], [21, 88.5], [15, 85.5], [11, 81], [7.5, 76.5], [5, 72], [7.5, 67.5], [6, 61], [4, 55.5], [5, 50.5],
  [8, 46.5], [10.5, 43], [9.5, 37], [11.5, 34], [8.5, 30.5], [6, 27], [9, 22.5], [5.5, 18.5], [4, 13], [5.5, 7], [4.5, 2],
];

export const ESSOS: Pt[] = [
  [44, 22], [48, 19], [55, 18.5], [62, 17], [72, 16], [82, 15], [92, 13], [100, 12], [100, 96], [96, 91], [94, 86],
  [90, 86], [87, 84], [85, 80.5], [82.5, 78], [80.5, 76.5], [77.5, 79.5], [74.5, 81.5], [72, 84.5], [69, 83.5],
  [66.5, 84.5], [64.5, 88], [64, 93], [60, 93], [58.5, 87], [57.5, 79], [56.5, 73.5], [53.5, 73.5], [51, 69.5],
  [48.5, 63], [46.8, 57], [45.5, 52], [44.7, 48.5], [44.5, 43], [46, 37], [47.5, 33], [46, 31.2], [44.2, 27.5],
];

export const ISLANDS: { name: string; pts: Pt[] }[] = [
  { name: "Iron Islands", pts: [[6, 38], [8.5, 37.5], [9, 40], [7.5, 42.5], [5.5, 41.5]] },
  { name: "Dragonstone", pts: [[32.2, 51], [34.2, 50.6], [34.6, 53], [32.6, 53.6]] },
  { name: "Tarth", pts: [[35.5, 62.5], [38, 62], [38.4, 64], [35.8, 64.4]] },
  { name: "Bear Island", pts: [[6.5, 14], [8.8, 13.6], [9, 16], [6.8, 16.4]] },
  { name: "Skagos", pts: [[37, 8.5], [40, 8], [40.5, 11], [37.5, 11.5]] },
  { name: "The Arbor", pts: [[3.5, 77.5], [6, 77], [6.4, 80], [3.8, 80.3]] },
  { name: "Stepstones", pts: [[39, 72], [41, 71.6], [41.4, 73.6], [39.3, 74]] },
  { name: "Tyrosh", pts: [[42.5, 66], [44.5, 65.6], [44.8, 67.8], [42.8, 68.2]] },
  { name: "Lys", pts: [[47, 79], [49.5, 78.6], [49.8, 81], [47.3, 81.3]] },
];

export const RIVERS: { name: string; pts: Pt[]; width?: number }[] = [
  { name: "White Knife", pts: [[20.5, 17], [22, 22], [23.5, 27], [24.5, 30.5]] },
  { name: "Green Fork", pts: [[18.5, 32], [18.6, 36], [19.6, 41], [21, 48]] },
  { name: "Red Fork", pts: [[11.5, 44], [15, 45.2], [18, 46.4], [21, 48]] },
  { name: "Blue Fork", pts: [[24.5, 39], [23.5, 43], [22, 46.5], [21, 48]] },
  { name: "Trident", pts: [[21, 48], [23.5, 49.8], [26.5, 51], [29, 52]], width: 1.6 },
  { name: "Blackwater Rush", pts: [[13, 55.5], [18, 56.4], [23, 56.6], [28.2, 56]], width: 1.3 },
  { name: "Mander", pts: [[19, 60.5], [15.5, 63.5], [11.5, 67], [7.6, 69]], width: 1.4 },
  { name: "Honeywine", pts: [[11, 70.5], [9.5, 72.5], [7.5, 74]] },
  { name: "Greenblood", pts: [[22, 78.5], [27, 80.5], [31, 83], [34.8, 85]] },
  { name: "Rhoyne", pts: [[51.5, 37], [53.5, 48], [55, 58], [55.6, 66], [55.2, 73]], width: 1.6 },
  { name: "Skahazadhan", pts: [[86, 58], [82.5, 64], [79.5, 69.5], [78.5, 74]] },
];

export const LAKES: { name: string; c: Pt; r: number }[] = [
  { name: "Gods Eye", c: [22.5, 49.6], r: 1.7 },
  { name: "Long Lake", c: [20, 25.5], r: 0.9 },
];

// Ridged mountain ranges (strokes) and isolated peaks
export const MOUNTAINS: { name: string; pts: Pt[]; width: number; height: number }[] = [
  { name: "The Frostfangs", pts: [[8, 1], [11, 4], [14, 6.5], [17, 8]], width: 4, height: 1.0 },
  { name: "Mountains of the Moon", pts: [[25.5, 33.5], [28, 36], [30.5, 39], [32, 42.5]], width: 3.5, height: 1.0 },
  { name: "The Red Mountains", pts: [[15, 75], [20, 76.5], [26, 77.5], [32, 76.5], [35, 75]], width: 3, height: 0.85 },
  { name: "Westerlands Hills", pts: [[8, 47], [9.5, 51], [10.5, 55]], width: 3, height: 0.45 },
  { name: "The Bone Mountains", pts: [[89, 28], [90, 40], [88.5, 52], [89.5, 62]], width: 4, height: 0.95 },
  { name: "Mother of Mountains", pts: [[74.5, 37.5], [75.5, 38.5]], width: 2.5, height: 0.8 },
  { name: "The Fourteen Flames", pts: [[60.5, 88.5], [62.5, 90.5]], width: 3, height: 1.0 },
  { name: "The Dragonmont", pts: [[33.6, 51.6], [33.8, 52]], width: 1.2, height: 0.7 },
];

export const FORESTS: { name: string; c: Pt; r: number; density: number; snowy?: boolean }[] = [
  { name: "The Haunted Forest", c: [20, 6.5], r: 6, density: 1, snowy: true },
  { name: "The Wolfswood", c: [15, 21], r: 3.2, density: 0.9, snowy: true },
  { name: "The Kingswood", c: [30, 60.5], r: 2.4, density: 1 },
  { name: "The Rainwood", c: [33, 66], r: 1.8, density: 0.9 },
  { name: "Forest of Qohor", c: [59, 41], r: 3.4, density: 0.8 },
  { name: "The Whispering Wood", c: [16, 43], r: 1.3, density: 0.9 },
  { name: "Riverlands groves", c: [18, 52], r: 2, density: 0.5 },
  { name: "The Reach orchards", c: [13, 62], r: 3.2, density: 0.45 },
];

export const ROADS: { name: string; pts: Pt[] }[] = [
  { name: "The Kingsroad", pts: [[22, 11], [21, 16], [20, 22], [19.5, 29], [18.5, 37], [20, 50], [24, 54], [27, 56], [29, 60], [30, 64]] },
  { name: "The Roseroad", pts: [[27, 56], [21, 59], [16, 63], [12, 65], [10, 69], [8, 73]] },
  { name: "The River Road", pts: [[20, 50], [15, 45], [11, 48], [7, 51]] },
  { name: "The High Road", pts: [[21, 48], [25, 42], [29, 38]] },
];

export type Biome = { c: Pt; r: number; color: [number, number, number]; strength: number };
export const BIOMES: Biome[] = [
  { c: [20, 4], r: 18, color: [232, 238, 244], strength: 0.95 },   // lands of always winter
  { c: [20, 18], r: 14, color: [168, 176, 160], strength: 0.6 },   // the North
  { c: [19, 30], r: 4, color: [92, 112, 84], strength: 0.75 },     // the Neck swamps
  { c: [18, 47], r: 9, color: [104, 140, 82], strength: 0.6 },     // riverlands
  { c: [13, 64], r: 10, color: [112, 156, 76], strength: 0.7 },    // the Reach
  { c: [27, 82], r: 11, color: [212, 176, 118], strength: 0.85 },  // Dorne sands
  { c: [69, 44], r: 16, color: [158, 168, 92], strength: 0.7 },    // Dothraki Sea
  { c: [88, 72], r: 12, color: [176, 92, 64], strength: 0.85 },    // the Red Waste
  { c: [74, 76], r: 8, color: [196, 160, 104], strength: 0.6 },    // Slaver's Bay
  { c: [61, 90], r: 5, color: [70, 56, 52], strength: 0.85 },      // Valyria ash
  { c: [55, 30], r: 10, color: [118, 136, 92], strength: 0.5 },    // Andalos / Norvos
];

export const SEAS: { name: string; at: Pt }[] = [
  { name: "The Narrow Sea", at: [40.5, 42] },
  { name: "The Sunset Sea", at: [1.5, 50] },
  { name: "The Shivering Sea", at: [52, 8] },
  { name: "The Summer Sea", at: [55, 97] },
  { name: "Slaver's Bay", at: [76.5, 84] },
  { name: "Blackwater Bay", at: [31, 55] },
  { name: "The Bite", at: [29, 30] },
  { name: "Shipbreaker Bay", at: [36.5, 60] },
  { name: "Ironman's Bay", at: [10.5, 39.5] },
];

export const REGION_LABELS: { name: string; at: Pt }[] = [
  { name: "BEYOND THE WALL", at: [24, 4] }, { name: "THE NORTH", at: [16, 17] }, { name: "THE RIVERLANDS", at: [16, 41] },
  { name: "THE VALE", at: [30, 35] }, { name: "THE WESTERLANDS", at: [9, 49.5] }, { name: "THE CROWNLANDS", at: [25, 53] },
  { name: "THE REACH", at: [14, 63] }, { name: "THE STORMLANDS", at: [30, 67] }, { name: "DORNE", at: [24, 84] },
  { name: "THE IRON ISLANDS", at: [5, 36.5] }, { name: "THE FREE CITIES", at: [50, 42] }, { name: "THE DOTHRAKI SEA", at: [68, 48] },
  { name: "SLAVER'S BAY", at: [72, 70] }, { name: "THE RED WASTE", at: [88, 66] }, { name: "OLD VALYRIA", at: [61, 84] },
  { name: "LHAZAR", at: [80, 60] },
];

// Towns and castles that appear on the map (labels only; gameplay locations come from the backend).
export const SETTLEMENTS: { name: string; at: Pt; kind: "city" | "castle" | "town" | "ruin" }[] = [
  { name: "White Harbor", at: [24.5, 29.5], kind: "city" }, { name: "Moat Cailin", at: [19.6, 30.8], kind: "ruin" },
  { name: "Deepwood Motte", at: [12, 18], kind: "castle" }, { name: "Karhold", at: [30, 16.5], kind: "castle" },
  { name: "Torrhen's Square", at: [14.5, 26], kind: "castle" }, { name: "Greywater Watch", at: [17.2, 32.5], kind: "castle" },
  { name: "Bear Island", at: [7.6, 15], kind: "castle" }, { name: "Seagard", at: [11.8, 38.5], kind: "castle" },
  { name: "Lannisport", at: [5.8, 52.5], kind: "city" }, { name: "The Golden Tooth", at: [11.2, 48.5], kind: "castle" },
  { name: "Maidenpool", at: [27, 47], kind: "town" }, { name: "Gulltown", at: [32.5, 41], kind: "city" },
  { name: "Runestone", at: [34, 36.5], kind: "castle" }, { name: "Duskendale", at: [28.3, 53.6], kind: "town" },
  { name: "Bitterbridge", at: [19, 61.5], kind: "castle" }, { name: "Ashford", at: [17, 66.5], kind: "castle" },
  { name: "Brightwater Keep", at: [10.5, 67.8], kind: "castle" }, { name: "Starfall", at: [16.5, 83], kind: "castle" },
  { name: "Yronwood", at: [25, 80.5], kind: "castle" }, { name: "Godsgrace", at: [30.5, 81], kind: "castle" },
  { name: "Evenfall Hall", at: [36.8, 63.2], kind: "castle" }, { name: "Seaguard", at: [5.5, 31], kind: "castle" },
  { name: "Lorath", at: [56, 21.5], kind: "city" }, { name: "Norvos", at: [58, 33], kind: "city" },
  { name: "Qohor", at: [62.5, 40.5], kind: "city" }, { name: "Myr", at: [49.5, 59], kind: "city" },
  { name: "Tyrosh", at: [43.7, 66.8], kind: "city" }, { name: "Lys", at: [48.4, 80], kind: "city" },
  { name: "Selhorys", at: [54.4, 56], kind: "town" }, { name: "Mantarys", at: [66.5, 82], kind: "city" },
  { name: "New Ghis", at: [73, 89.5], kind: "city" }, { name: "Lhazar villages", at: [79, 62.5], kind: "town" },
  { name: "Bhorash", at: [83.5, 77], kind: "town" }, { name: "Vaes Tolorro", at: [84.5, 72], kind: "ruin" },
  { name: "Ghoyan Drohe", at: [57.5, 47], kind: "ruin" }, { name: "Sarnath", at: [67, 28], kind: "ruin" },
  { name: "Ib", at: [70, 9], kind: "town" }, { name: "The Fist of the First Men", at: [17.5, 4.5], kind: "ruin" },
  { name: "Craster's Keep", at: [21.5, 8], kind: "ruin" }, { name: "Shadow Tower", at: [12, 11], kind: "castle" },
  { name: "Saltpans", at: [27.5, 49.5], kind: "town" }, { name: "Bronzegate", at: [29.5, 62], kind: "castle" },
];

/** Monuments rendered as 3D models, keyed by gameplay location id when they sit on one. */
export const MONUMENTS = {
  wall: { from: [5, 11] as Pt, to: [34.5, 11] as Pt },
};

export const MAP_SCALE = 0.6; // world units per map unit
export const toWorld = ([x, y]: Pt): [number, number] => [(x - 50) * MAP_SCALE, (y - 50) * MAP_SCALE];
