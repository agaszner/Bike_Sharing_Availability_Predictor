// Tiny element builders for the Flows and Model views. Children are appended as nodes or text, never parsed as HTML.
const SVG_NS = 'http://www.w3.org/2000/svg';

function build(node, attrs, children) {
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null && v !== false) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

export const el = (tag, attrs, ...children) => build(document.createElement(tag), attrs, children);
export const svg = (tag, attrs, ...children) => build(document.createElementNS(SVG_NS, tag), attrs, children);
