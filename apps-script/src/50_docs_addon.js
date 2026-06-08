/**
 * Google Docs editor add-on entry points.
 *
 * onInstall fires once when the add-on is installed for a user.
 * onOpen fires every time a document the add-on is installed in is opened.
 * showSidebar is the menu action that actually pops the HTML sidebar.
 *
 * Install path during dev:
 *   1. Apps Script editor → Deploy → Test deployments → install as
 *      "Editor Add-on" for your account.
 *   2. Open any Google Doc → Extensions menu → "OPS Research Tool" →
 *      "Open research panel".
 * Production path:
 *   - Publish via the Google Cloud project's Marketplace SDK with
 *     visibility set to the orono.k12.mn.us domain so the district
 *     admin can install it for all users.
 */

function onInstall(e) {
  onOpen(e);
}

function onOpen(e) {
  try {
    DocumentApp.getUi()
      .createAddonMenu()
      .addItem('Open research panel', 'showSidebar')
      .addSeparator()
      .addItem('Get Chrome extension', 'showChromeExtensionInfo')
      .addToUi();
  } catch (err) {
    // The script may be invoked outside a Docs context (e.g. when the
    // web app is running). onOpen has no effect there — swallow silently.
  }
}

function showSidebar() {
  const html = HtmlService.createTemplateFromFile('sidebar')
    .evaluate()
    .setTitle('OPS Research Tool')
    .setWidth(360);
  DocumentApp.getUi().showSidebar(html);
}

/**
 * Small modal pointing users to the companion Chrome extension's Web Store
 * listing. A menu click runs server-side and can't navigate the Docs tab, so
 * we surface a click-to-open button (opens the store in a new tab) instead.
 * Mainly for staff/teachers + personal devices; managed student devices get
 * the extension force-installed.
 */
function showChromeExtensionInfo() {
  const url = CONFIG.CHROME_WEBSTORE_URL;
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Roboto,Arial,sans-serif;padding:20px;color:#1d2a5d;line-height:1.5">'
    + '<p style="margin:0 0 16px">Install the OPS Research Tool browser extension to highlight '
    + 'and categorize sources while you research the web. Your sources flow straight into this '
    + 'Docs panel for the writing phase.</p>'
    + '<a href="' + url + '" target="_blank" rel="noopener" '
    + 'style="display:inline-block;background:#2d3f89;color:#fff;text-decoration:none;'
    + 'font-family:Lexend,Roboto,Arial,sans-serif;font-weight:600;padding:10px 18px;'
    + 'border-radius:8px">Open the Chrome Web Store &#8599;</a>'
    + '</div>')
    .setWidth(380)
    .setHeight(200);
  DocumentApp.getUi().showModalDialog(html, 'Get the Chrome extension');
}

/** Used by sidebar.html templating to embed sub-files (CSS + JS). */
function includeFile_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
