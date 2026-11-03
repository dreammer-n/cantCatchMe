// Debug mode: add ?debug to the page address to get the tuning toolbar and the test hooks
// (window.__carChaseDebug). Only in the dev server (`npm run dev`) and the test build (`npm run build:test`): the
// scenes load the tools only when import.meta.env.MODE isn't 'production', so `npm run build`, the version players
// get, leaves them out altogether.
export const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
