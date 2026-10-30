import type { Zone } from "@shared/schema";

/** Coastal reference points. Coordinates are town centres (WGS84). */
export const ZONES: Zone[] = [
  { id: "panama-city", name: "Ciudad de Panamá", province: "Panamá", coast: "pacific", lat: 8.9824, lon: -79.5199, nearestDart: "32411" },
  { id: "pedasi", name: "Pedasí", province: "Los Santos (Azuero)", coast: "pacific", lat: 7.5313, lon: -80.0275, nearestDart: "32411" },
  { id: "playa-venao", name: "Playa Venao", province: "Los Santos (Azuero)", coast: "pacific", lat: 7.4323, lon: -80.1941, nearestDart: "32411" },
  { id: "playa-reina", name: "Playa Reina", province: "Veraguas (Mariato)", coast: "pacific", lat: 7.6203, lon: -80.9932, nearestDart: "32411" },
  { id: "santa-catalina", name: "Santa Catalina", province: "Veraguas", coast: "pacific", lat: 7.6333, lon: -81.2667, nearestDart: "32411" },
  { id: "puerto-armuelles", name: "Puerto Armuelles", province: "Chiriquí", coast: "pacific", lat: 8.2779, lon: -82.8608, nearestDart: "32411" },
  { id: "david", name: "David", province: "Chiriquí", coast: "pacific", lat: 8.4333, lon: -82.4333, nearestDart: "32411" },
  { id: "jaque", name: "Jaqué / Puerto Piña", province: "Darién", coast: "pacific", lat: 7.5167, lon: -78.1667, nearestDart: "32411" },
  { id: "colon", name: "Colón", province: "Colón", coast: "caribbean", lat: 9.3547, lon: -79.9003, nearestDart: "42407" },
  { id: "portobelo", name: "Portobelo", province: "Colón", coast: "caribbean", lat: 9.5531, lon: -79.6553, nearestDart: "42407" },
  { id: "bocas", name: "Bocas del Toro", province: "Bocas del Toro", coast: "caribbean", lat: 9.3403, lon: -82.242, nearestDart: "42407" },
  { id: "guna-yala", name: "El Porvenir", province: "Guna Yala", coast: "caribbean", lat: 9.5583, lon: -78.95, nearestDart: "42407" },
];

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
