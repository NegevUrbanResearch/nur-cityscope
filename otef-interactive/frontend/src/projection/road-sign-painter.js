import { ROAD_SIGN_ASPECT, ROAD_SIGN_BASE_WIDTH } from "../shared/road-sign-settings.js";

const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const BASE_HEIGHT = ROAD_SIGN_BASE_WIDTH / ROAD_SIGN_ASPECT;
const CORNER_RADIUS = ROAD_SIGN_BASE_WIDTH * (62 / 524);

function traceOuterSilhouette(context) {
  const left = -ROAD_SIGN_BASE_WIDTH / 2;
  const right = ROAD_SIGN_BASE_WIDTH / 2;
  const top = -BASE_HEIGHT / 2;
  const bottom = BASE_HEIGHT / 2;
  const radius = Math.min(CORNER_RADIUS, (right - left) / 2, (bottom - top) / 2);
  context.beginPath();
  context.moveTo(left + radius, top);
  context.lineTo(right - radius, top);
  context.quadraticCurveTo(right, top, right, top + radius);
  context.lineTo(right, bottom - radius);
  context.quadraticCurveTo(right, bottom, right - radius, bottom);
  context.lineTo(left + radius, bottom);
  context.quadraticCurveTo(left, bottom, left, bottom - radius);
  context.lineTo(left, top + radius);
  context.quadraticCurveTo(left, top, left + radius, top);
  context.closePath();
}

function paintLeader(context, sign) {
  if (!sign.leader?.enabled || (sign.leader.x === sign.x && sign.leader.y === sign.y)) return;
  context.beginPath();
  context.moveTo(sign.leader.x, sign.leader.y);
  context.lineTo(sign.x, sign.y);
  context.strokeStyle = "#d4e5da";
  context.lineWidth = 1;
  context.stroke();
}

function drawableSigns(signs, artwork) {
  return signs.filter((sign) => sign?.visible && artwork?.[sign.theme]);
}

/** Paint Road 232 artwork in the unwarped 1920x1080 source plane. */
export function paintRoadSigns(context, { signs = [], artwork = {}, rasterScale = 1 } = {}) {
  if (!context) return [];
  const width = OUTPUT_WIDTH * rasterScale;
  const height = OUTPUT_HEIGHT * rasterScale;
  context.clearRect(0, 0, width, height);
  context.save();
  context.scale(rasterScale, rasterScale);
  const bounds = [];
  const drawable = drawableSigns(signs, artwork);
  for (const sign of drawable) paintLeader(context, sign);
  for (const sign of drawable) {
    const image = artwork[sign.theme];
    context.save();
    context.translate(sign.x, sign.y);
    context.rotate((sign.rotateDeg * Math.PI) / 180);
    context.scale(sign.scale, sign.scale);
    traceOuterSilhouette(context);
    context.clip();
    context.drawImage(image, -ROAD_SIGN_BASE_WIDTH / 2, -BASE_HEIGHT / 2, ROAD_SIGN_BASE_WIDTH, BASE_HEIGHT);
    context.restore();
    bounds.push({ id: sign.id, x: sign.x, y: sign.y, width: ROAD_SIGN_BASE_WIDTH * sign.scale,
      height: BASE_HEIGHT * sign.scale, rotateDeg: sign.rotateDeg });
  }
  context.restore();
  return bounds;
}

export { BASE_HEIGHT as ROAD_SIGN_BASE_HEIGHT, traceOuterSilhouette as traceRoadSignOuterSilhouette };
