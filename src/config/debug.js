// Debug mode: add ?debug to the page address to get the tuning toolbar and the test hooks
// (window.__carChaseDebug). Off for players; nothing debug-only runs without it.
export const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
