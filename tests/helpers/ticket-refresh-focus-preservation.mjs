import assert from 'node:assert/strict';

// Reverse only the reviewed focus correction before the independent original
// full-file hashes run. A missing/changed guard or unrelated edit still fails.
const before='<button type="button" className="ticket-secondary-action" disabled={loading || saving} onClick={onReload}>Consultar versão atual</button>';
const after='<button type="button" className="ticket-secondary-action" aria-disabled={loading || saving} onClick={() => { if (!loading && !saving) onReload(); }}>Consultar versão atual</button>';
export function restoreTicketRefreshFocus(source) {
  assert.equal(source.split(after).length-1,1,'exact approved conflict refresh focus correction');
  return source.replace(after,before);
}
export function restoreTicketRefreshFocusStyles(source) {
  for (const [after,before] of [
    ['.ticket-secondary-action:hover:not(:disabled):not([aria-disabled="true"]),','.ticket-secondary-action:hover:not(:disabled),'],
    ['.ticket-secondary-action:disabled,\n.ticket-secondary-action[aria-disabled="true"],','.ticket-secondary-action:disabled,'],
  ]) {
    assert.equal(source.split(after).length-1,1,'exact approved conflict refresh disabled style');
    source=source.replace(after,before);
  }
  return source;
}
