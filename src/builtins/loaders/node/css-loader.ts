// loading a CSS style is a no-op in Node.js
export default function loadCSSBundle() {
    return Promise.resolve();
};
