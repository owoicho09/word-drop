/**
 * shareManager.js — link generation, URL parsing, and clipboard copy.
 */

export const shareManager = {
  /**
   * Builds the shareable URL for a session.
   * Uses ?sid= query param — works on local dev and Vercel alike.
   * (Vercel also accepts /play/:sid via rewrite, but that needs server-side
   * routing which isn't available on npx serve.)
   */
  generateShareLink(sessionId) {
    return `${window.location.origin}/game.html?sid=${sessionId}`;
  },

  /**
   * Parses the session ID out of the current URL.
   * Handles both the pretty /play/:sid route and ?sid= fallback.
   *
   * @returns {string|null}
   */
  parseSessionFromURL() {
    const match = window.location.pathname.match(/\/play\/([a-z0-9]+)/);
    if (match) return match[1];
    return new URLSearchParams(window.location.search).get('sid');
  },

  /** Returns true if the current page was opened from a shared link. */
  isSharedLink() {
    return Boolean(this.parseSessionFromURL());
  },

  /**
   * Copies text to the clipboard.
   * Falls back to execCommand for older mobile browsers.
   *
   * @param {string} text
   * @returns {Promise<boolean>} true on success
   */
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        return true;
      } catch {
        return false;
      }
    }
  },
};
