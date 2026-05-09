export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function formatGp(value) {
  return Math.round(value || 0).toLocaleString();
}
