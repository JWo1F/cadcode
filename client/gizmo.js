// The axes gizmo of the dev viewer and the playground, after Blender's: X, Y and Z
// as coloured balls that turn with the camera, the negative ends as paler ones.
// Pressing a ball turns the view to look along that axis, at the ball's side of the
// model; pressing the ball the view already looks from turns it to the other side.

const SVG = 'http://www.w3.org/2000/svg';
const SIZE = 84; // the gizmo's width and height, in CSS pixels
const ARM = 28; // from the centre to a ball's centre

const AXES = [
  { name: 'X', vector: [1, 0, 0], label: 'Right' },
  { name: 'Y', vector: [0, 1, 0], label: 'Back' },
  { name: 'Z', vector: [0, 0, 1], label: 'Top' },
  { name: '-X', vector: [-1, 0, 0], label: 'Left' },
  { name: '-Y', vector: [0, -1, 0], label: 'Front' },
  { name: '-Z', vector: [0, 0, -1], label: 'Bottom' },
];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => {
  const length = Math.hypot(...a) || 1;
  return a.map((v) => v / length);
};

const element = (name, attributes = {}) => {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};

/**
 * Draws the gizmo into `container` and returns its update, which takes every camera
 * the view reports ({ position, target, ortho }).
 * @param {HTMLElement} container
 * @param {{ viewAlong: (direction: number[]) => void }} view
 */
export function createAxisGizmo(container, view) {
  const svg = element('svg', { viewBox: `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`, width: SIZE, height: SIZE, role: 'group', 'aria-label': 'View axes' });
  svg.append(element('circle', { class: 'gizmo-backdrop', r: SIZE / 2 }));
  container.append(svg);

  let camera = null;
  let lastOrder = '';

  // A positive axis is an arm and a labelled ball; a negative one only a pale ball.
  const parts = AXES.map((axis) => {
    const negative = axis.name.startsWith('-');
    const arm = negative ? null : element('line', { class: `gizmo-arm axis-${axis.name}`, x1: 0, y1: 0 });
    const ball = element('g', { class: `gizmo-ball axis-${axis.name.slice(-1)}${negative ? ' negative' : ''}`, role: 'button', tabindex: 0, 'aria-label': `View from ${axis.label.toLowerCase()} (${axis.name})` });
    const title = element('title');
    title.textContent = `${axis.label} (${axis.name})`;
    ball.append(title, element('circle', { r: negative ? 7 : 9 }));
    if (!negative) {
      const text = element('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      text.textContent = axis.name;
      ball.append(text);
    }
    const pick = () => {
      // Already looking from this side: turn to the other one.
      const facing = camera?.ortho && dot(normalize(camera.position.map((v, i) => v - camera.target[i])), axis.vector) > 0.999;
      view.viewAlong(facing ? axis.vector.map((v) => -v) : axis.vector);
    };
    ball.addEventListener('click', pick);
    ball.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      pick();
    });
    return { axis, arm, ball };
  });

  function update(next) {
    camera = next;
    // The camera's frame, Z up as in the view: forward into the screen, right and up on it.
    const forward = normalize(next.target.map((v, i) => v - next.position[i]));
    const right = normalize(cross(forward, [0, 0, 1]));
    const up = cross(right, forward);
    const placed = parts.map((part) => ({
      ...part,
      x: dot(part.axis.vector, right) * ARM,
      y: -dot(part.axis.vector, up) * ARM,
      depth: dot(part.axis.vector, forward),
    }));
    for (const { arm, ball, x, y } of placed) {
      arm?.setAttribute('x2', x);
      arm?.setAttribute('y2', y);
      ball.setAttribute('transform', `translate(${x} ${y})`);
    }
    // Far ones first, so near ones are drawn over them; the arms go under all the balls.
    // Reordered only when the order changes, as moving a node drops its focus.
    placed.sort((a, b) => b.depth - a.depth);
    const order = placed.map((part) => part.axis.name).join();
    if (order === lastOrder) return;
    lastOrder = order;
    for (const { arm } of placed) if (arm) svg.append(arm);
    for (const { ball } of placed) svg.append(ball);
  }

  update({ position: [120, -160, 110], target: [0, 0, 0], ortho: false }); // the view's starting camera
  return update;
}
