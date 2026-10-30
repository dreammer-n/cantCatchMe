// Tiny helpers for the HTML interface laid over the game canvas.

let root = null;

// The overlay that holds the HUD and all menus (created once).
export function uiRoot() {
  if (!root) {
    root = document.createElement('div');
    root.id = 'ui';
    document.body.appendChild(root);
  }
  return root;
}

// el('button', 'btn btn-primary', 'PLAY') or el('div', 'row', [child, child])
export function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (Array.isArray(content)) node.append(...content.filter(Boolean));
  else if (content instanceof Node) node.append(content);
  else if (content !== undefined && content !== null) node.textContent = String(content);
  return node;
}

// A button that reacts on press (not release), never takes keyboard focus and never lets the
// touch fall through to the steering surface underneath.
export function button(className, content, onPress, label) {
  const node = el('button', className);
  node.type = 'button';
  node.tabIndex = -1;
  if (typeof content === 'string' && content.startsWith('<svg')) node.innerHTML = content;
  else if (content instanceof Node) node.append(content);
  else node.textContent = content;
  if (label) node.setAttribute('aria-label', label);
  node.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    onPress(event);
  });
  node.addEventListener('click', (event) => event.preventDefault());
  return node;
}

export const ICONS = {
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>',
  soundOn:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  soundOff:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  police:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="7" width="14" height="13" rx="3" fill="#eef1f4"/><rect x="7" y="10" width="10" height="5" rx="1.5" fill="#24344a"/><rect x="6" y="4" width="6" height="3" rx="1" fill="#ff3b30"/><rect x="12" y="4" width="6" height="3" rx="1" fill="#3d8bff"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
  retry:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2.1-5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M4 3v5h5z"/></svg>',
};
