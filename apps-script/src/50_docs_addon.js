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

/** Used by sidebar.html templating to embed sub-files (CSS + JS). */
function includeFile_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
