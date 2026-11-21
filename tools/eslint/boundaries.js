import path from 'node:path';

// Local ESLint rules that keep the code's dependency direction (README → Code structure).
// - feature-index: code outside src/modules/<feature>/ imports that feature only through its
//   index.ts, so a feature's inner files can change without breaking anyone else.
// - constants-leaf: src/constants/ imports nothing but other constants, so any file may use it.

const MODULES = `${path.sep}src${path.sep}modules${path.sep}`;
const CONSTANTS = `${path.sep}src${path.sep}constants${path.sep}`;
const INDEX_FILES = new Set(['index.js', 'index.ts']);

function featureOf(file) {
  const at = file.indexOf(MODULES);
  if (at === -1) {
    return undefined;
  }
  const rest = file.slice(at + MODULES.length).split(path.sep);
  return rest.length > 1 ? { root: file.slice(0, at + MODULES.length) + rest[0], rest } : undefined;
}

function importsOf(check) {
  return {
    ImportDeclaration: (n) => check(n.source),
    ExportNamedDeclaration: (n) => n.source && check(n.source),
    ExportAllDeclaration: (n) => check(n.source),
  };
}

const featureIndex = {
  meta: {
    type: 'problem',
    messages: {
      deep: "Import the '{{feature}}' feature through its index.ts, not '{{source}}'.",
    },
  },
  create(context) {
    const file = context.filename;
    const own = featureOf(file);
    return importsOf((source) => {
      const spec = source.value;
      if (typeof spec !== 'string' || !spec.startsWith('.')) {
        return;
      }
      const target = path.resolve(path.dirname(file), spec);
      const feature = featureOf(target);
      if (feature === undefined || (own !== undefined && own.root === feature.root)) {
        return;
      }
      const isIndex = feature.rest.length === 2 && INDEX_FILES.has(feature.rest[1]);
      if (!isIndex) {
        context.report({
          node: source,
          messageId: 'deep',
          data: { feature: feature.rest[0], source: spec },
        });
      }
    });
  },
};

const constantsLeaf = {
  meta: {
    type: 'problem',
    messages: { outward: "Constants import only other constants, not '{{source}}'." },
  },
  create(context) {
    const file = context.filename;
    if (!file.includes(CONSTANTS)) {
      return {};
    }
    return importsOf((source) => {
      const spec = source.value;
      if (typeof spec !== 'string' || !spec.startsWith('.')) {
        return;
      }
      const target = path.resolve(path.dirname(file), spec);
      if (!target.includes(CONSTANTS)) {
        context.report({ node: source, messageId: 'outward', data: { source: spec } });
      }
    });
  },
};

export default {
  rules: { 'feature-index': featureIndex, 'constants-leaf': constantsLeaf },
};
