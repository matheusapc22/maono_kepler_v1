/** Local Blob bytes are not external HTTP; WebKit routes their reads through interception. */
export function isLocalBrowserBlob(candidate, pageUrl) {
  try {
    const url = candidate instanceof URL ? candidate : new URL(candidate);
    const page = new URL(pageUrl);
    return url.protocol === 'blob:' && ['http:', 'https:'].includes(page.protocol) &&
      ['127.0.0.1', 'localhost'].includes(page.hostname) && url.origin === page.origin;
  } catch { return false; }
}
