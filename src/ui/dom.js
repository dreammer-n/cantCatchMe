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
  film: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 5h20v14H2zM9 8.5v7l6.5-3.5z" fill-rule="evenodd"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.6l3.1 6.8 7.4.8-5.5 5 1.5 7.3L12 18.8 5.5 21.5 7 14.2 1.5 9.2l7.4-.8z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10V7a6 6 0 0 1 12 0v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1zm3 0h6V7a3 3 0 0 0-6 0z"/></svg>',
  coin: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f0c04a"/><circle cx="12" cy="12" r="6.6" fill="#d39a22"/><rect x="10.4" y="7.4" width="3.2" height="9.2" rx="1" fill="#f6dc8e"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>',
  soundOn:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  soundOff:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  musicOn:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5.5l11-2.5v12.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><ellipse cx="6.2" cy="18" rx="3.2" ry="2.6"/><ellipse cx="17.2" cy="15.5" rx="3.2" ry="2.6"/></svg>',
  musicOff:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5.5l11-2.5v12.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><ellipse cx="6.2" cy="18" rx="3.2" ry="2.6"/><ellipse cx="17.2" cy="15.5" rx="3.2" ry="2.6"/><path d="M3 3l18 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  retry:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2.1-5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M4 3v5h5z"/></svg>',
};
