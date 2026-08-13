// SVG paths lifted verbatim from the prototype template so stroke weights and
// corner radii match exactly. The prototype inlined each one; here they are named
// once and stamped by icon().

const PATHS = {
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>',
  doc:
    '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"></path>' +
    '<path d="M14 2v6h6"></path><path d="M9 13h6"></path><path d="M9 17h6"></path>',
  docSmall:
    '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"></path><path d="M14 2v6h6"></path>',
  dashboard:
    '<rect x="3" y="3" width="7" height="9"></rect><rect x="14" y="3" width="7" height="5"></rect>' +
    '<rect x="14" y="12" width="7" height="9"></rect><rect x="3" y="16" width="7" height="5"></rect>',
  mail:
    '<path d="M22 6.5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2Z"></path>' +
    '<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3Z"></path><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"></path>',
  close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
  star: '<path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.8l6.5-.9Z"></path>',
  copy:
    '<path d="M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"></path>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
  check: '<path d="M20 6 9 17l-5-5"></path>',
  expand:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M21 8V5a2 2 0 0 0-2-2h-3"></path>' +
    '<path d="M3 16v3a2 2 0 0 0 2 2h3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>',
  collapse:
    '<path d="M8 3v3a2 2 0 0 1-2 2H3"></path><path d="M21 8h-3a2 2 0 0 1-2-2V3"></path>' +
    '<path d="M3 16h3a2 2 0 0 1 2 2v3"></path><path d="M16 21v-3a2 2 0 0 1 2-2h3"></path>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path>' +
    '<path d="M12 15V3"></path>',
  kebab:
    '<circle cx="12" cy="5" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="12" cy="19" r="1.7"></circle>',
  chevronDown: '<polyline points="6 9 12 15 18 9"></polyline>',
  headset:
    '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H3v-7a9 9 0 0 1 18 0v7h-3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"></path>',
  envelope: '<rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m22 7-10 6L2 7"></path>',
  phone:
    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"></path>',
  clock: '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
  external:
    '<path d="M15 3h6v6"></path><path d="M10 14 21 3"></path>' +
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>',
};

export function icon(name, size = 14, attrs = '') {
  // The kebab and the filled star are the two icons drawn with a fill rather than
  // a stroke, so they carry their own paint attributes.
  let paint = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  let key = name;
  if (name === 'kebab') {
    paint = 'fill="currentColor" stroke="none"';
  } else if (name === 'starFilled') {
    key = 'star';
    paint = 'fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${paint} ${attrs}>${PATHS[key]}</svg>`;
}
